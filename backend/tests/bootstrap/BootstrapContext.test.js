"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/tests/bootstrap/BootstrapContext.test.js
 *
 * Purpose:
 *   Enterprise production-grade unit tests for the canonical TITech
 *   BootstrapContext lifecycle and phase-management contract.
 *
 * Test Runner:
 *   Node.js built-in node:test
 *
 * Runtime:
 *   Node.js 20+
 *
 * Coverage:
 *
 *   ✓ Context initializes
 *   ✓ Factory creates a canonical context
 *   ✓ Context starts from CREATED
 *   ✓ start() changes state to BOOTSTRAPPING
 *   ✓ Bootstrap start metadata/timestamps are recorded
 *   ✓ Phase starts
 *   ✓ Phase completion is recorded
 *   ✓ Phase duration is recorded
 *   ✓ Phase failure is recorded
 *   ✓ Failed phase marks context FAILED
 *   ✓ READY state works
 *   ✓ Failed state cannot be marked READY
 *   ✓ Phase snapshots work
 *   ✓ Diagnostics contain lifecycle information
 *   ✓ Completed/pending/failed phase collections work
 *   ✓ Bootstrap completion is deterministic
 *   ✓ Invalid phase names are rejected
 *   ✓ Duplicate phase starts are rejected
 *   ✓ Completed phases cannot be started again
 *   ✓ Non-running phases cannot be completed
 *   ✓ Factory and direct construction expose the same contract
 *   ✓ TITech terminology is preserved
 *
 * Architectural Principle:
 *   These tests validate the canonical bootstrap lifecycle contract without
 *   initializing databases, Redis, HTTP servers, Express middleware, routes,
 *   queues, external providers, or other infrastructure.
 *
 * =============================================================================
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BootstrapContext,
  createBootstrapContext,
  BOOTSTRAP_PHASES,
  PHASE_STATES,
  CONTEXT_STATES,
} = require("../../bootstrap/context");

/**
 * =============================================================================
 * Test Helpers
 * =============================================================================
 */

/**
 * Create a fresh context for every test.
 *
 * The context is intentionally isolated so one test cannot leak lifecycle
 * state into another test.
 */
function createTestContext(options = {}) {
  return createBootstrapContext({
    id: "bootstrap-test-context",
    metadata: {
      application: "TITech Community Capital",
      component: "bootstrap-test",
      ...options.metadata,
    },
    ...options,
  });
}

/**
 * Return the first canonical bootstrap phase.
 */
function firstPhase() {
  assert.ok(
    Array.isArray(BOOTSTRAP_PHASES),
    "TITech BOOTSTRAP_PHASES must be an array.",
  );

  assert.ok(
    BOOTSTRAP_PHASES.length > 0,
    "TITech BOOTSTRAP_PHASES must contain at least one phase.",
  );

  return BOOTSTRAP_PHASES[0];
}

/**
 * Complete every canonical phase.
 *
 * This is intentionally kept local to the test suite rather than adding
 * production-only helpers to BootstrapContext.
 */
function completeAllPhases(context) {
  for (const phase of BOOTSTRAP_PHASES) {
    context.startPhase(phase);
    context.completePhase(phase);
  }

  return context;
}

/**
 * =============================================================================
 * Contract / Initialization
 * =============================================================================
 */

test("BootstrapContext initializes", () => {
  const context = createTestContext();

  assert.ok(
    context instanceof BootstrapContext,
    "Factory must return a BootstrapContext instance.",
  );

  assert.equal(
    context.state,
    CONTEXT_STATES.CREATED,
    "A new TITech bootstrap context must begin in CREATED state.",
  );

  assert.ok(
    context.id,
    "Bootstrap context must have a stable identity.",
  );

  assert.ok(
    context.createdAt instanceof Date,
    "Bootstrap context must record createdAt.",
  );

  assert.equal(
    context.error,
    null,
    "A new bootstrap context must not contain an error.",
  );

  assert.equal(
    context.runtime.ready,
    false,
    "A new bootstrap context must not be runtime-ready.",
  );

  assert.equal(
    context.runtime.acceptingTraffic,
    false,
    "A new bootstrap context must not accept traffic.",
  );
});

test("createBootstrapContext() and direct BootstrapContext construction expose the same contract", () => {
  const factoryContext = createBootstrapContext({
    id: "factory-context",
  });

  const directContext = new BootstrapContext({
    id: "direct-context",
  });

  assert.ok(
    factoryContext instanceof BootstrapContext,
  );

  assert.ok(
    directContext instanceof BootstrapContext,
  );

  assert.equal(
    factoryContext.state,
    directContext.state,
  );

  assert.deepEqual(
    Object.keys(factoryContext.phases),
    Object.keys(directContext.phases),
  );
});

/**
 * =============================================================================
 * Lifecycle Start
 * =============================================================================
 */

test("start() changes state to BOOTSTRAPPING", () => {
  const context = createTestContext();

  const returned = context.start();

  assert.equal(
    returned,
    context,
    "start() must return the same BootstrapContext instance.",
  );

  assert.equal(
    context.state,
    CONTEXT_STATES.BOOTSTRAPPING,
    "start() must transition CREATED → BOOTSTRAPPING.",
  );

  assert.ok(
    context.startedAt instanceof Date,
    "start() must record startedAt.",
  );

  assert.equal(
    context.runtime.ready,
    false,
    "Runtime must remain not-ready while bootstrapping.",
  );

  assert.equal(
    context.runtime.acceptingTraffic,
    false,
    "Traffic must not be accepted while bootstrapping.",
  );
});

test("start() records a bootstrap_started lifecycle event", () => {
  const context = createTestContext();

  context.start();

  const event = context.history.find(
    (entry) => entry.type === "bootstrap_started",
  );

  assert.ok(
    event,
    "Bootstrap start must be recorded in lifecycle history.",
  );

  assert.ok(
    event.timestamp instanceof Date,
    "Bootstrap start event must contain a timestamp.",
  );
});

test("start() rejects an already bootstrapping context", () => {
  const context = createTestContext();

  context.start();

  assert.throws(
    () => context.start(),
    {
      message:
        /Cannot start bootstrap context from state "bootstrapping"\./,
    },
  );
});

/**
 * =============================================================================
 * Phase Start
 * =============================================================================
 */

test("phase starts", () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  const record = context.startPhase(
    phase,
    {
      critical: true,
      fatal: true,
      test: true,
    },
  );

  assert.equal(
    record.state,
    PHASE_STATES.RUNNING,
    "Started phase must be RUNNING.",
  );

  assert.ok(
    record.startedAt instanceof Date,
    "Started phase must have startedAt.",
  );

  assert.equal(
    record.completedAt,
    null,
    "A running phase must not have completedAt.",
  );

  assert.equal(
    record.durationMs,
    null,
    "A running phase must not yet have durationMs.",
  );

  assert.equal(
    record.error,
    null,
    "A running phase must not contain an error.",
  );

  assert.deepEqual(
    record.metadata,
    {
      critical: true,
      fatal: true,
      test: true,
    },
  );

  assert.equal(
    context.getPhaseState(phase),
    PHASE_STATES.RUNNING,
  );

  const event = context.history.find(
    (entry) =>
      entry.type === "phase_started" &&
      entry.metadata?.phase === phase,
  );

  assert.ok(
    event,
    "Phase start must be recorded in lifecycle history.",
  );
});

/**
 * =============================================================================
 * Phase Completion
 * =============================================================================
 */

test("phase completes", () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);

  const record = context.completePhase(
    phase,
    {
      critical: true,
      fatal: true,
      result: "success",
    },
  );

  assert.equal(
    record.state,
    PHASE_STATES.COMPLETED,
  );

  assert.ok(
    record.startedAt instanceof Date,
  );

  assert.ok(
    record.completedAt instanceof Date,
  );

  assert.equal(
    typeof record.durationMs,
    "number",
  );

  assert.ok(
    record.durationMs >= 0,
    "Phase duration must never be negative.",
  );

  assert.equal(
    record.error,
    null,
  );

  assert.deepEqual(
    record.metadata,
    {
      critical: true,
      fatal: true,
      result: "success",
    },
  );

  assert.equal(
    context.isPhaseComplete(phase),
    true,
  );

  assert.equal(
    context.isPhaseFailed(phase),
    false,
  );

  const event = context.history.find(
    (entry) =>
      entry.type === "phase_completed" &&
      entry.metadata?.phase === phase,
  );

  assert.ok(
    event,
    "Phase completion must be recorded in lifecycle history.",
  );
});

test("phase completion records a deterministic duration", () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);

  const record = context.completePhase(phase);

  assert.equal(
    typeof record.durationMs,
    "number",
  );

  assert.ok(
    Number.isFinite(record.durationMs),
    "Phase duration must be finite.",
  );

  assert.ok(
    record.durationMs >= 0,
    "Phase duration must be zero or greater.",
  );
});

/**
 * =============================================================================
 * Phase Failure
 * =============================================================================
 */

test("phase failure is recorded", () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);

  const error = new Error(
    "TITech bootstrap test failure.",
  );

  error.code = "BOOTSTRAP_TEST_FAILURE";

  const record = context.failPhase(
    phase,
    error,
    {
      critical: true,
      fatal: true,
    },
  );

  assert.equal(
    record.state,
    PHASE_STATES.FAILED,
  );

  assert.ok(
    record.startedAt instanceof Date,
  );

  assert.ok(
    record.completedAt instanceof Date,
  );

  assert.equal(
    typeof record.durationMs,
    "number",
  );

  assert.ok(
    record.error,
    "Failed phase must contain normalized error information.",
  );

  assert.equal(
    record.error.name,
    "Error",
  );

  assert.equal(
    record.error.message,
    "TITech bootstrap test failure.",
  );

  assert.equal(
    record.error.code,
    "BOOTSTRAP_TEST_FAILURE",
  );

  assert.equal(
    context.getPhaseState(phase),
    PHASE_STATES.FAILED,
  );

  assert.equal(
    context.isPhaseFailed(phase),
    true,
  );

  assert.equal(
    context.state,
    CONTEXT_STATES.FAILED,
    "Phase failure must transition the context into FAILED state.",
  );

  assert.equal(
    context.runtime.ready,
    false,
  );

  assert.equal(
    context.runtime.acceptingTraffic,
    false,
  );

  const event = context.history.find(
    (entry) =>
      entry.type === "phase_failed" &&
      entry.metadata?.phase === phase,
  );

  assert.ok(
    event,
    "Phase failure must be recorded in lifecycle history.",
  );
});

/**
 * =============================================================================
 * READY State
 * =============================================================================
 */

test("ready state works", () => {
  const context = createTestContext();

  context.start();

  const returned = context.markReady();

  assert.equal(
    returned,
    context,
    "markReady() must return the same context instance.",
  );

  assert.equal(
    context.state,
    CONTEXT_STATES.READY,
  );

  assert.ok(
    context.readyAt instanceof Date,
  );

  assert.equal(
    context.runtime.ready,
    true,
  );

  assert.equal(
    context.runtime.acceptingTraffic,
    true,
  );

  assert.equal(
    context.isReady(),
    true,
  );

  assert.equal(
    context.isFailed(),
    false,
  );

  assert.ok(
    typeof context.runtime.startupDurationMs === "number",
  );

  const event = context.history.find(
    (entry) => entry.type === "runtime_ready",
  );

  assert.ok(
    event,
    "Runtime readiness must be recorded in lifecycle history.",
  );
});

test("failed state cannot be ready", () => {
  const context = createTestContext();

  context.start();

  context.markFailed(
    new Error("TITech bootstrap failure."),
    firstPhase(),
  );

  assert.equal(
    context.state,
    CONTEXT_STATES.FAILED,
  );

  assert.equal(
    context.isFailed(),
    true,
  );

  assert.equal(
    context.isReady(),
    false,
  );

  assert.throws(
    () => context.markReady(),
    {
      message:
        /Cannot mark TITech runtime ready from state "failed"\./,
    },
  );

  assert.equal(
    context.state,
    CONTEXT_STATES.FAILED,
    "Failed context must remain FAILED after rejected readiness transition.",
  );

  assert.equal(
    context.runtime.ready,
    false,
  );

  assert.equal(
    context.runtime.acceptingTraffic,
    false,
  );
});

/**
 * =============================================================================
 * Phase Snapshots
 * =============================================================================
 */

test("phase snapshots work", () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(
    phase,
    {
      critical: true,
      fatal: false,
      operation: "test-phase",
    },
  );

  const runningSnapshot =
    context.getPhaseRecord(phase);

  assert.notEqual(
    runningSnapshot,
    context.phases[phase],
    "Phase snapshot must not expose the live phase record.",
  );

  assert.equal(
    runningSnapshot.state,
    PHASE_STATES.RUNNING,
  );

  assert.deepEqual(
    runningSnapshot.metadata,
    {
      critical: true,
      fatal: false,
      operation: "test-phase",
    },
  );

  context.completePhase(
    phase,
    {
      completedBy: "BootstrapContext.test",
    },
  );

  const completedSnapshot =
    context.getPhaseRecord(phase);

  assert.equal(
    completedSnapshot.state,
    PHASE_STATES.COMPLETED,
  );

  assert.ok(
    completedSnapshot.completedAt instanceof Date,
  );

  assert.equal(
    completedSnapshot.metadata.operation,
    "test-phase",
  );

  assert.equal(
    completedSnapshot.metadata.completedBy,
    "BootstrapContext.test",
  );
});

test("phase snapshots protect metadata from direct mutation", () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(
    phase,
    {
      immutableExpectation: true,
    },
  );

  const snapshot =
    context.getPhaseRecord(phase);

  snapshot.metadata.immutableExpectation = false;

  const freshSnapshot =
    context.getPhaseRecord(phase);

  assert.equal(
    freshSnapshot.metadata.immutableExpectation,
    true,
    "Phase metadata snapshots must be defensive copies.",
  );
});

/**
 * =============================================================================
 * Diagnostics
 * =============================================================================
 */

test("diagnostics snapshot contains lifecycle state and phase information", () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);
  context.completePhase(phase);

  const diagnostics =
    context.getDiagnostics();

  assert.equal(
    diagnostics.id,
    context.id,
  );

  assert.equal(
    diagnostics.state,
    CONTEXT_STATES.BOOTSTRAPPING,
  );

  assert.ok(
    diagnostics.createdAt instanceof Date,
  );

  assert.ok(
    diagnostics.startedAt instanceof Date,
  );

  assert.ok(
    diagnostics.phases,
    "Diagnostics must include phase diagnostics.",
  );

  assert.equal(
    diagnostics.phases[phase].state,
    PHASE_STATES.COMPLETED,
  );

  assert.ok(
    Array.isArray(diagnostics.completedPhases),
  );

  assert.ok(
    diagnostics.completedPhases.includes(phase),
  );

  assert.ok(
    Array.isArray(diagnostics.pendingPhases),
  );

  assert.ok(
    Array.isArray(diagnostics.failedPhases),
  );

  assert.ok(
    Array.isArray(diagnostics.skippedPhases),
  );

  assert.ok(
    Array.isArray(diagnostics.shutdownHooks),
  );
});

test("toJSON() returns the canonical diagnostics snapshot", () => {
  const context = createTestContext();

  const diagnostics =
    context.getDiagnostics();

  const serialized =
    context.toJSON();

  assert.deepEqual(
    serialized,
    diagnostics,
  );
});

/**
 * =============================================================================
 * Phase Collections
 * =============================================================================
 */

test("pending phases are reported correctly", () => {
  const context = createTestContext();

  const phase = firstPhase();

  assert.ok(
    context.getPendingPhases().includes(phase),
  );

  assert.deepEqual(
    context.getCompletedPhases(),
    [],
  );

  assert.deepEqual(
    context.getFailedPhases(),
    [],
  );
});

test("completed phases are reported correctly", () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);
  context.completePhase(phase);

  assert.ok(
    context.getCompletedPhases().includes(phase),
  );

  assert.ok(
    !context.getPendingPhases().includes(phase),
  );

  assert.ok(
    !context.getFailedPhases().includes(phase),
  );
});

test("failed phases are reported correctly", () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);

  context.failPhase(
    phase,
    new Error("TITech phase failure."),
  );

  assert.ok(
    context.getFailedPhases().includes(phase),
  );

  assert.ok(
    !context.getCompletedPhases().includes(phase),
  );
});

/**
 * =============================================================================
 * Bootstrap Completion
 * =============================================================================
 */

test("bootstrap is incomplete until all phases are completed or skipped", () => {
  const context = createTestContext();

  context.start();

  assert.equal(
    context.isBootstrapComplete(),
    false,
  );

  completeAllPhases(context);

  assert.equal(
    context.isBootstrapComplete(),
    true,
  );
});

test("skipped phases count toward bootstrap completion", () => {
  const context = createTestContext();

  context.start();

  for (const phase of BOOTSTRAP_PHASES) {
    context.skipPhase(
      phase,
      "not_required_for_unit_test",
    );
  }

  assert.equal(
    context.isBootstrapComplete(),
    true,
  );

  assert.equal(
    context.getSkippedPhases().length,
    BOOTSTRAP_PHASES.length,
  );
});

/**
 * =============================================================================
 * Phase Invariants
 * =============================================================================
 */

test("invalid phase names are rejected", () => {
  const context = createTestContext();

  assert.throws(
    () => context.startPhase("invalid-phase"),
    {
      message:
        /Unknown TITech bootstrap phase "invalid-phase"\./,
    },
  );

  assert.throws(
    () => context.completePhase("invalid-phase"),
    {
      message:
        /Unknown TITech bootstrap phase "invalid-phase"\./,
    },
  );

  assert.throws(
    () => context.failPhase(
      "invalid-phase",
      new Error("invalid"),
    ),
    {
      message:
        /Unknown TITech bootstrap phase "invalid-phase"\./,
    },
  );
});

test("a phase cannot be started twice while running", () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);

  assert.throws(
    () => context.startPhase(phase),
    {
      message:
        new RegExp(
          `TITech bootstrap phase "${phase}" is already running\\.`,
        ),
    },
  );
});

test("a completed phase cannot be started again", () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);
  context.completePhase(phase);

  assert.throws(
    () => context.startPhase(phase),
    {
      message:
        new RegExp(
          `TITech bootstrap phase "${phase}" has already completed\\.`,
        ),
    },
  );
});

test("a non-running phase cannot be completed", () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  assert.throws(
    () => context.completePhase(phase),
    {
      message:
        new RegExp(
          `Cannot complete TITech bootstrap phase "${phase}" because its current state is "pending"\\.`,
        ),
    },
  );
});

/**
 * =============================================================================
 * Failure Contract
 * =============================================================================
 */

test("markFailed() records normalized error information", () => {
  const context = createTestContext();

  context.start();

  const error = new Error(
    "TITech configuration bootstrap failed.",
  );

  error.code = "TITECH_CONFIG_BOOTSTRAP_FAILED";

  context.markFailed(
    error,
    "configuration",
  );

  assert.equal(
    context.state,
    CONTEXT_STATES.FAILED,
  );

  assert.ok(
    context.failedAt instanceof Date,
  );

  assert.deepEqual(
    context.error,
    {
      name: "Error",
      message: "TITech configuration bootstrap failed.",
      stack: error.stack,
      code: "TITECH_CONFIG_BOOTSTRAP_FAILED",
    },
  );

  const event =
    context.history.find(
      (entry) =>
        entry.type === "bootstrap_failed",
    );

  assert.ok(
    event,
  );

  assert.equal(
    event.metadata.phase,
    "configuration",
  );
});

/**
 * =============================================================================
 * Runtime Readiness Contract
 * =============================================================================
 */

test("isReady() remains false before markReady()", () => {
  const context = createTestContext();

  assert.equal(
    context.isReady(),
    false,
  );

  context.start();

  assert.equal(
    context.isReady(),
    false,
  );
});

test("markReady() requires BOOTSTRAPPING state", () => {
  const context = createTestContext();

  assert.throws(
    () => context.markReady(),
    {
      message:
        /Cannot mark TITech runtime ready from state "created"\./,
    },
  );
});

/**
 * =============================================================================
 * Test Suite Integrity
 * =============================================================================
 */

test("canonical TITech bootstrap phases are stable and ordered", () => {
  assert.deepEqual(
    BOOTSTRAP_PHASES,
    [
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
    ],
  );
});

test("canonical lifecycle states are available", () => {
  assert.equal(
    CONTEXT_STATES.CREATED,
    "created",
  );

  assert.equal(
    CONTEXT_STATES.BOOTSTRAPPING,
    "bootstrapping",
  );

  assert.equal(
    CONTEXT_STATES.READY,
    "ready",
  );

  assert.equal(
    CONTEXT_STATES.FAILED,
    "failed",
  );

  assert.equal(
    CONTEXT_STATES.SHUTTING_DOWN,
    "shutting_down",
  );

  assert.equal(
    CONTEXT_STATES.STOPPED,
    "stopped",
  );
});

test("canonical phase states are available", () => {
  assert.equal(
    PHASE_STATES.PENDING,
    "pending",
  );

  assert.equal(
    PHASE_STATES.RUNNING,
    "running",
  );

  assert.equal(
    PHASE_STATES.COMPLETED,
    "completed",
  );

  assert.equal(
    PHASE_STATES.FAILED,
    "failed",
  );

  assert.equal(
    PHASE_STATES.SKIPPED,
    "skipped",
  );
});