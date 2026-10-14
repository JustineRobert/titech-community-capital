
/**
 * TITech Community Capital
 *
 * File: backend/tests/bootstrap/BootstrapContext.test.js
 *
 * Purpose:
 *   Verify the canonical BootstrapContext lifecycle, phase transitions,
 *   dependency requirements, failure handling, diagnostics, and readiness.
 *
 * Test runner: Jest with ESM support.
 *
 * Architecture:
 *   These tests exercise the bootstrap context directly. They must not start
 *   a real database, Redis client, HTTP listener, queue, or external provider.
 *
 * Runtime readiness is only valid after required phases and dependencies
 * satisfy the actual BootstrapContext contract.
 */

import { test } from '@jest/globals';
import assert from 'node:assert/strict';

import {
  BootstrapContext,
  createBootstrapContext,
  BOOTSTRAP_PHASES,
  PHASE_STATES,
  CONTEXT_STATES,
} from '../../bootstrap/context/index.js';

const EXPECTED_BOOTSTRAP_PHASES = [
  'environment',
  'configuration',
  'logger',
  'observability',
  'readiness',
  'resilience',
  'infrastructure',
  'services',
  'middleware',
  'routes',
  'httpServer',
  'runtimeReady',
];

function createTestContext(options = {}) {
  const {
    id = 'bootstrap-test-context',
    metadata = {},
    ...contextOptions
  } = options;

  return createBootstrapContext({
    ...contextOptions,
    id,
    metadata: {
      application: 'TITech Community Capital',
      component: 'bootstrap-test',
      ...metadata,
    },
  });
}

function firstPhase() {
  assert.ok(
    Array.isArray(BOOTSTRAP_PHASES),
    'BOOTSTRAP_PHASES must be an array.',
  );

  assert.ok(
    BOOTSTRAP_PHASES.length > 0,
    'BOOTSTRAP_PHASES must contain at least one phase.',
  );

  return BOOTSTRAP_PHASES[0];
}

function completeAllPhases(context) {
  for (const phase of BOOTSTRAP_PHASES) {
    context.startPhase(phase);
    context.completePhase(phase);
  }

  return context;
}

function registerReadinessDependencies(context) {
  const dependencies = [
    'application',
    'configuration',
    'logger',
    'observability',
    'readiness',
    'resilience',
    'infrastructure',
    'services',
    'middleware',
    'routes',
    'httpServer',
  ];

  for (const name of dependencies) {
    const value =
      name === 'logger'
        ? {
            debug() {},
            info() {},
            warn() {},
            error() {},
          }
        : {
            name,
            status: 'ready',
            testDependency: true,
          };

    context.registerDependency(name, value);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Contract and initialization
 */

test('BootstrapContext factory creates a valid context', () => {
  const context = createTestContext();

  assert.ok(
    context instanceof BootstrapContext,
    'The factory must return a BootstrapContext instance.',
  );

  assert.equal(context.state, CONTEXT_STATES.CREATED);
  assert.equal(context.getState(), CONTEXT_STATES.CREATED);
  assert.ok(context.id);
  assert.ok(context.createdAt instanceof Date);
  assert.equal(context.error, null);
  assert.equal(context.runtime.ready, false);
  assert.equal(context.runtime.acceptingTraffic, false);
});

test('factory and direct construction expose equivalent initial contracts', () => {
  const factoryContext = createBootstrapContext({
    id: 'factory-context',
  });

  const directContext = new BootstrapContext({
    id: 'direct-context',
  });

  assert.ok(factoryContext instanceof BootstrapContext);
  assert.ok(directContext instanceof BootstrapContext);

  assert.equal(factoryContext.getState(), directContext.getState());

  assert.deepEqual(
    Object.keys(factoryContext.phases),
    Object.keys(directContext.phases),
  );

  assert.deepEqual(
    Object.keys(factoryContext.phases),
    EXPECTED_BOOTSTRAP_PHASES,
  );
});

test('custom metadata preserves default metadata unless explicitly overridden', () => {
  const context = createTestContext({
    metadata: {
      environment: 'test',
    },
  });

  assert.equal(
    context.metadata.application,
    'TITech Community Capital',
  );

  assert.equal(context.metadata.component, 'bootstrap-test');
  assert.equal(context.metadata.environment, 'test');
});

/**
 * Lifecycle start
 */

test('start transitions CREATED to STARTING and records start time', () => {
  const context = createTestContext();

  const returned = context.start();

  assert.equal(returned, context);
  assert.equal(context.getState(), CONTEXT_STATES.STARTING);
  assert.ok(context.startedAt instanceof Date);
  assert.equal(context.runtime.ready, false);
  assert.equal(context.runtime.acceptingTraffic, false);
});

test('start records a bootstrap_started lifecycle event', () => {
  const context = createTestContext();

  context.start();

  const event = context.history.find(
    (entry) => entry.type === 'bootstrap_started',
  );

  assert.ok(event, 'Bootstrap start must be recorded in history.');
  assert.ok(event.timestamp instanceof Date);
});

test('start rejects a second start while the context is already starting', () => {
  const context = createTestContext();

  context.start();

  assert.throws(
    () => context.start(),
    /Cannot start TITech bootstrap context from state ["']starting["']\./i,
  );
});

/**
 * Phase start and ordering
 */

test('a canonical phase can be started and its metadata recorded', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();
  const metadata = {
    critical: true,
    fatal: true,
    test: true,
  };

  const record = context.startPhase(phase, metadata);

  assert.equal(record.state, PHASE_STATES.RUNNING);
  assert.ok(record.startedAt instanceof Date);
  assert.equal(record.completedAt, null);
  assert.equal(record.durationMs, null);
  assert.equal(record.error, null);
  assert.deepEqual(record.metadata, metadata);
  assert.equal(context.getPhaseState(phase), PHASE_STATES.RUNNING);

  const event = context.history.find(
    (entry) =>
      entry.type === 'phase_started' &&
      entry.metadata?.phase === phase,
  );

  assert.ok(event, 'Phase start must be recorded in history.');
});

test('canonical phases must be started in forward order', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();
  const nextPhase = BOOTSTRAP_PHASES[1];

  assert.ok(nextPhase, 'The canonical sequence must contain a next phase.');

  assert.throws(
    () => context.startPhase(nextPhase),
    /next phase|canonical phase|expected/i,
    'A later phase must not start before the current phase is completed.',
  );

  context.startPhase(phase);
  context.completePhase(phase);

  assert.equal(context.getPhaseState(phase), PHASE_STATES.COMPLETED);
});

test('a running phase cannot be started twice', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);

  assert.throws(
    () => context.startPhase(phase),
    new RegExp(escapeRegExp(phase)),
  );
});

/**
 * Phase completion and duration
 */

test('a running phase completes and records its result metadata', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase, {
    critical: true,
    fatal: true,
  });

  const record = context.completePhase(phase, {
    result: 'success',
  });

  assert.equal(record.state, PHASE_STATES.COMPLETED);
  assert.ok(record.startedAt instanceof Date);
  assert.ok(record.completedAt instanceof Date);

  assert.equal(typeof record.durationMs, 'number');
  assert.ok(Number.isFinite(record.durationMs));
  assert.ok(record.durationMs >= 0);

  assert.equal(record.error, null);

  assert.deepEqual(record.metadata, {
    critical: true,
    fatal: true,
    result: 'success',
  });

  assert.equal(context.isPhaseComplete(phase), true);
  assert.equal(context.isPhaseFailed(phase), false);

  const event = context.history.find(
    (entry) =>
      entry.type === 'phase_completed' &&
      entry.metadata?.phase === phase,
  );

  assert.ok(event, 'Phase completion must be recorded in history.');
});

test('phase duration is finite and never negative', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);
  const record = context.completePhase(phase);

  assert.equal(typeof record.durationMs, 'number');
  assert.ok(Number.isFinite(record.durationMs));
  assert.ok(record.durationMs >= 0);
});

test('a completed phase cannot be completed a second time', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);
  context.completePhase(phase);

  assert.throws(
    () => context.completePhase(phase),
    /already|complete|completed|not running|not active|canonical phase/i,
  );
});

test('a completed phase cannot be started again', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);
  context.completePhase(phase);

  assert.throws(
    () => context.startPhase(phase),
    /already|completed|not the next canonical phase|next phase/i,
  );
});

test('a pending phase cannot be completed without being started', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  assert.throws(
    () => context.completePhase(phase),
    /pending|not running|not active|cannot complete/i,
  );
});

/**
 * Phase failure
 */

test('phase failure records normalized error information and blocks readiness', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);

  const error = new Error('TITech bootstrap test failure.');
  error.code = 'BOOTSTRAP_TEST_FAILURE';

  const record = context.failPhase(phase, error, {
    critical: true,
    fatal: true,
  });

  assert.equal(record.state, PHASE_STATES.FAILED);
  assert.ok(record.startedAt instanceof Date);
  assert.ok(record.completedAt instanceof Date);
  assert.equal(typeof record.durationMs, 'number');
  assert.ok(record.durationMs >= 0);

  assert.deepEqual(record.error, {
    name: 'Error',
    message: 'TITech bootstrap test failure.',
    code: 'BOOTSTRAP_TEST_FAILURE',
  });

  assert.equal(context.getPhaseState(phase), PHASE_STATES.FAILED);
  assert.equal(context.isPhaseFailed(phase), true);
  assert.equal(context.getState(), CONTEXT_STATES.FAILED);
  assert.equal(context.runtime.ready, false);
  assert.equal(context.runtime.acceptingTraffic, false);

  const event = context.history.find(
    (entry) =>
      entry.type === 'phase_failed' &&
      entry.metadata?.phase === phase,
  );

  assert.ok(event, 'Phase failure must be recorded in history.');
});

test('markFailed records a normalized error and its failing phase', () => {
  const context = createTestContext();

  context.start();

  const error = new Error('TITech configuration bootstrap failed.');
  error.code = 'TITECH_CONFIG_BOOTSTRAP_FAILED';

  context.markFailed(error, 'configuration');

  assert.equal(context.getState(), CONTEXT_STATES.FAILED);
  assert.ok(context.failedAt instanceof Date);

  assert.deepEqual(context.error, {
    name: 'Error',
    message: 'TITech configuration bootstrap failed.',
    code: 'TITECH_CONFIG_BOOTSTRAP_FAILED',
  });

  const event = context.history.find(
    (entry) => entry.type === 'bootstrap_failed',
  );

  assert.ok(event);
  assert.equal(event.metadata.phase, 'configuration');
});

/**
 * Runtime readiness
 */

test('markReady succeeds only after canonical startup and dependency registration', () => {
  const context = createTestContext();

  context.start();
  registerReadinessDependencies(context);
  completeAllPhases(context);

  const returned = context.markReady();

  assert.equal(returned, context);
  assert.equal(context.getState(), CONTEXT_STATES.READY);
  assert.ok(context.readyAt instanceof Date);
  assert.equal(context.runtime.ready, true);
  assert.equal(context.runtime.acceptingTraffic, true);
  assert.equal(context.isReady(), true);
  assert.equal(context.isFailed(), false);
  assert.equal(typeof context.runtime.startupDurationMs, 'number');
  assert.ok(context.runtime.startupDurationMs >= 0);

  const event = context.history.find(
    (entry) => entry.type === 'runtime_ready',
  );

  assert.ok(event, 'Runtime readiness must be recorded in history.');
});

test('markReady cannot be called before startup begins', () => {
  const context = createTestContext();

  assert.throws(
    () => context.markReady(),
    /Cannot mark TITech runtime ready from state ["']created["']\./i,
  );

  assert.equal(context.getState(), CONTEXT_STATES.CREATED);
  assert.equal(context.runtime.ready, false);
  assert.equal(context.runtime.acceptingTraffic, false);
});

test('failed context cannot transition to ready', () => {
  const context = createTestContext();

  context.start();
  context.markFailed(
    new Error('TITech bootstrap failure.'),
    firstPhase(),
  );

  assert.equal(context.getState(), CONTEXT_STATES.FAILED);
  assert.equal(context.isFailed(), true);
  assert.equal(context.isReady(), false);

  assert.throws(
    () => context.markReady(),
    /Cannot mark TITech runtime ready from state ["']failed["']\./i,
  );

  assert.equal(context.getState(), CONTEXT_STATES.FAILED);
  assert.equal(context.runtime.ready, false);
  assert.equal(context.runtime.acceptingTraffic, false);
});

test('isReady stays false until the readiness transition succeeds', () => {
  const context = createTestContext();

  assert.equal(context.isReady(), false);

  context.start();

  assert.equal(context.isReady(), false);
  assert.equal(context.runtime.acceptingTraffic, false);
});

/**
 * Phase snapshots and diagnostics
 */

test('phase snapshots contain lifecycle state and merged metadata', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase, {
    critical: true,
    operation: 'test-phase',
  });

  const runningSnapshot = context.getPhaseRecord(phase);

  assert.notEqual(runningSnapshot, context.phases[phase]);
  assert.equal(runningSnapshot.state, PHASE_STATES.RUNNING);

  assert.deepEqual(runningSnapshot.metadata, {
    critical: true,
    operation: 'test-phase',
  });

  context.completePhase(phase, {
    completedBy: 'BootstrapContext.test.js',
  });

  const completedSnapshot = context.getPhaseRecord(phase);

  assert.equal(completedSnapshot.state, PHASE_STATES.COMPLETED);
  assert.ok(completedSnapshot.completedAt instanceof Date);
  assert.equal(completedSnapshot.metadata.operation, 'test-phase');
  assert.equal(
    completedSnapshot.metadata.completedBy,
    'BootstrapContext.test.js',
  );
});

test('mutating a phase snapshot does not alter the live phase metadata', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase, {
    immutableExpectation: true,
  });

  const snapshot = context.getPhaseRecord(phase);
  snapshot.metadata.immutableExpectation = false;

  const freshSnapshot = context.getPhaseRecord(phase);

  assert.equal(
    freshSnapshot.metadata.immutableExpectation,
    true,
    'Snapshots must not expose mutable live metadata.',
  );
});

test('diagnostics expose lifecycle and phase collections', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);
  context.completePhase(phase);

  const diagnostics = context.getDiagnostics();

  assert.equal(diagnostics.id, context.id);
  assert.equal(diagnostics.state, CONTEXT_STATES.STARTING);
  assert.ok(diagnostics.createdAt instanceof Date);
  assert.ok(diagnostics.startedAt instanceof Date);

  assert.ok(diagnostics.phases);
  assert.equal(
    diagnostics.phases[phase].state,
    PHASE_STATES.COMPLETED,
  );

  for (const collection of [
    'completedPhases',
    'pendingPhases',
    'failedPhases',
    'skippedPhases',
    'shutdownHooks',
  ]) {
    assert.ok(
      Array.isArray(diagnostics[collection]),
      `Diagnostics must expose ${collection}.`,
    );
  }

  assert.ok(diagnostics.completedPhases.includes(phase));
});

test('toJSON exposes the diagnostics contract', () => {
  const context = createTestContext();

  assert.deepEqual(context.toJSON(), context.getDiagnostics());
});

/**
 * Phase collections and completion
 */

test('pending phases are reported correctly', () => {
  const context = createTestContext();
  const phase = firstPhase();

  assert.ok(context.getPendingPhases().includes(phase));
  assert.deepEqual(context.getCompletedPhases(), []);
  assert.deepEqual(context.getFailedPhases(), []);
});

test('completed phases are reported correctly', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);
  context.completePhase(phase);

  assert.ok(context.getCompletedPhases().includes(phase));
  assert.ok(!context.getPendingPhases().includes(phase));
  assert.ok(!context.getFailedPhases().includes(phase));
});

test('failed phases are reported correctly', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  context.startPhase(phase);
  context.failPhase(phase, new Error('TITech phase failure.'));

  assert.ok(context.getFailedPhases().includes(phase));
  assert.ok(!context.getCompletedPhases().includes(phase));
});

test('bootstrap is incomplete until every canonical phase is accounted for', () => {
  const context = createTestContext();

  context.start();

  assert.equal(context.isBootstrapComplete(), false);

  completeAllPhases(context);

  assert.equal(context.isBootstrapComplete(), true);
});

test('skipped phases count toward completion but runtimeReady cannot be skipped', () => {
  const context = createTestContext();

  context.start();

  for (const phase of BOOTSTRAP_PHASES) {
    if (phase === 'runtimeReady') {
      context.startPhase(phase);
      context.completePhase(phase);
    } else {
      context.skipPhase(phase, 'not_required_for_unit_test');
    }
  }

  assert.equal(context.isBootstrapComplete(), true);
  assert.equal(
    context.getSkippedPhases().length,
    BOOTSTRAP_PHASES.length - 1,
  );

  assert.equal(
    context.getPhaseState('runtimeReady'),
    PHASE_STATES.COMPLETED,
  );
});

/**
 * Invalid and repeated transitions
 */

test('invalid phase names are rejected consistently', () => {
  const context = createTestContext();

  const invalidPhase = 'invalid-phase';

  assert.throws(
    () => context.startPhase(invalidPhase),
    /Unknown TITech bootstrap phase ["']invalid-phase["']\./,
  );

  assert.throws(
    () => context.completePhase(invalidPhase),
    /Unknown TITech bootstrap phase ["']invalid-phase["']\./,
  );

  assert.throws(
    () => context.failPhase(invalidPhase, new Error('invalid')),
    /Unknown TITech bootstrap phase ["']invalid-phase["']\./,
  );
});

test('a non-running phase cannot be completed', () => {
  const context = createTestContext();

  context.start();

  const phase = firstPhase();

  assert.throws(
    () => context.completePhase(phase),
    /pending|not running|not active|cannot complete/i,
  );
});

/**
 * Canonical contract stability
 */

test('canonical bootstrap phases are stable and ordered', () => {
  assert.deepEqual(BOOTSTRAP_PHASES, EXPECTED_BOOTSTRAP_PHASES);
});

test('canonical context states are available', () => {
  assert.equal(CONTEXT_STATES.CREATED, 'created');
  assert.equal(CONTEXT_STATES.STARTING, 'starting');
  assert.equal(
    CONTEXT_STATES.BOOTSTRAPPING,
    CONTEXT_STATES.STARTING,
  );
  assert.equal(CONTEXT_STATES.READY, 'ready');
  assert.equal(CONTEXT_STATES.FAILED, 'failed');
  assert.equal(CONTEXT_STATES.SHUTTING_DOWN, 'shutting_down');
  assert.equal(CONTEXT_STATES.STOPPED, 'stopped');
});

test('canonical phase states are available', () => {
  assert.equal(PHASE_STATES.PENDING, 'pending');
  assert.equal(PHASE_STATES.RUNNING, 'running');
  assert.equal(PHASE_STATES.COMPLETED, 'completed');
  assert.equal(PHASE_STATES.FAILED, 'failed');
  assert.equal(PHASE_STATES.SKIPPED, 'skipped');
});