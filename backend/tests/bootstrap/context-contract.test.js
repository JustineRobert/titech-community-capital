
import { test } from '@jest/globals';
import assert from 'node:assert/strict';

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

const LIFECYCLE_PHASES = EXPECTED_BOOTSTRAP_PHASES.filter(
  (phase) => !['httpServer', 'runtimeReady'].includes(phase),
);

function createDeterministicPhaseDefinitions() {
  return LIFECYCLE_PHASES.map((name, index) => ({
    name,
    priority: (index + 1) * 100,
    required: true,
    dependencies: index === 0 ? [] : [LIFECYCLE_PHASES[index - 1]],

    start: async () => {
      if (name === 'logger') {
        return {
          logger: {
            debug() {},
            info() {},
            warn() {},
            error() {},
          },
        };
      }

      return {
        context: {
          [name]: {
            status: 'ready',
            phase: name,
          },
        },
      };
    },

    stop: async () => undefined,

    health: async () => ({
      status: 'UP',
    }),

    readiness: async () => ({
      ready: true,
    }),
  }));
}

function getProcessListenerSnapshot() {
  return {
    SIGINT: process.listenerCount('SIGINT'),
    SIGTERM: process.listenerCount('SIGTERM'),
    uncaughtException: process.listenerCount('uncaughtException'),
    unhandledRejection: process.listenerCount('unhandledRejection'),
    exit: process.listenerCount('exit'),
    beforeExit: process.listenerCount('beforeExit'),
  };
}

async function createIsolatedBootstrap(ApplicationBootstrap) {
  const bootstrap = new ApplicationBootstrap({
    startServer: false,
    requireApplication: false,
    phases: createDeterministicPhaseDefinitions(),
  });

  await bootstrap.initialize();
  bootstrap.setApplication(() => {});

  return bootstrap;
}

async function shutdownBootstrap(
  bootstrap,
  reason = 'contract-test-cleanup',
) {
  if (!bootstrap) {
    return;
  }

  const state = bootstrap.context?.getState?.();

  if (state && !['created', 'stopped'].includes(state)) {
    await bootstrap.shutdown(reason);
  }
}

test('BootstrapContext ESM barrel exposes the canonical contract', async () => {
  const contextModule = await import('../../bootstrap/context/index.js');

  assert.equal(typeof contextModule.BootstrapContext, 'function');

  assert.ok(
    Array.isArray(contextModule.BOOTSTRAP_PHASES),
    'BOOTSTRAP_PHASES must be an array',
  );

  assert.deepEqual(
    contextModule.BOOTSTRAP_PHASES,
    EXPECTED_BOOTSTRAP_PHASES,
    'BOOTSTRAP_PHASES must preserve the canonical startup sequence',
  );
});

test('ApplicationBootstrap accepts the first middleware-created app but locks its identity afterward', async () => {
  const { ApplicationBootstrap } = await import(
    '../../bootstrap/ApplicationBootstrap.js'
  );

  const canonicalApplication = function canonicalExpressApplication() {};
  const phases = createDeterministicPhaseDefinitions().map((phase) => {
    if (phase.name !== 'middleware') return phase;
    return {
      ...phase,
      start: async () => ({
        context: {
          middleware: { status: 'ready', phase: 'middleware' },
          application: canonicalApplication,
        },
      }),
    };
  });

  const bootstrap = new ApplicationBootstrap({
    startServer: false,
    requireApplication: true,
    phases,
  });

  try {
    await bootstrap.initialize();
    assert.equal(bootstrap.getApplication(), null);

    const result = await bootstrap.start();

    assert.equal(result.started, true);
    assert.equal(bootstrap.getApplication(), canonicalApplication);
    assert.equal(bootstrap.context.application, canonicalApplication);
    assert.equal(bootstrap.isReady(), true);

    assert.throws(
      () => bootstrap.setApplication(function replacementApplication() {}),
      (error) => error?.code === 'APPLICATION_LOCKED',
      'a different Express application must not replace the canonical instance during an active lifecycle',
    );

    assert.doesNotThrow(
      () => bootstrap.setApplication(canonicalApplication),
      'idempotently binding the canonical app must not be treated as replacement',
    );
  } finally {
    await shutdownBootstrap(bootstrap, 'application-lock-regression-cleanup');
  }
});

test('BootstrapContext protects state and enforces forward phase order', async () => {
  const { createBootstrapContext } = await import(
    '../../bootstrap/context/index.js'
  );

  const context = createBootstrapContext({
    metadata: {
      requireHttpServer: false,
    },
  });

  assert.equal(context.getState(), 'created');

  assert.throws(
    () => {
      context.state = 'created';
    },
    /read-only/i,
    'bootstrap state must not be directly assignable',
  );

  context.start();

  assert.equal(context.getState(), 'starting');

  context.beginPhase('environment');
  context.completePhase('environment');

  assert.equal(context.getPhaseState('environment'), 'completed');

  assert.throws(
    () => context.beginPhase('logger'),
    /next phase|configuration/i,
    'bootstrap must reject out-of-order phase transitions',
  );

  context.beginPhase('configuration');
  context.completePhase('configuration');

  assert.equal(context.getPhaseState('configuration'), 'completed');

  assert.throws(
    () => context.completePhase('configuration'),
    /already|complete|completed|not running|not active/i,
    'a completed phase must not be completed a second time',
  );
});

test('ApplicationBootstrap phase results cannot overwrite protected lifecycle state', async () => {
  const { ApplicationBootstrap } = await import(
    '../../bootstrap/ApplicationBootstrap.js'
  );

  const bootstrap = new ApplicationBootstrap({
    startServer: false,
    requireApplication: false,
  });

  try {
    await bootstrap.initialize();

    bootstrap.context.start();

    assert.equal(bootstrap.context.getState(), 'starting');

    assert.doesNotThrow(() => {
      bootstrap.applyPhaseResult({
        context: {
          configuration: {
            source: 'test',
          },
          state: 'created',
        },
      });
    });

    assert.equal(
      bootstrap.context.getState(),
      'starting',
      'phase results must not overwrite protected lifecycle state',
    );

    assert.deepEqual(
      bootstrap.context.configuration,
      {
        source: 'test',
      },
      'ordinary configuration data must still be applied',
    );
  } finally {
    await shutdownBootstrap(bootstrap, 'phase-result-contract-cleanup');
  }
});

test(
  'ApplicationBootstrap completes deterministic startup without opening a network server',
  async () => {
    const { ApplicationBootstrap } = await import(
      '../../bootstrap/ApplicationBootstrap.js'
    );

    const bootstrap = await createIsolatedBootstrap(ApplicationBootstrap);

    try {
      const result = await bootstrap.start();

      assert.equal(
        result.started,
        true,
        'start() must report successful startup',
      );

      assert.equal(
        bootstrap.isReady(),
        true,
        'readiness must only be reported after successful startup',
      );

      assert.equal(bootstrap.context.getState(), 'ready');

      for (const phase of [
        'environment',
        'configuration',
        'routes',
        'httpServer',
        'runtimeReady',
      ]) {
        assert.equal(
          bootstrap.context.getPhaseState(phase),
          'completed',
          `${phase} must complete before startup is considered ready`,
        );
      }
    } finally {
      await shutdownBootstrap(bootstrap, 'startup-contract-cleanup');
    }

    assert.equal(
      bootstrap.context.getState(),
      'stopped',
      'shutdown must transition the context to stopped',
    );

    assert.equal(
      bootstrap.isReady(),
      false,
      'shutdown must clear the readiness state',
    );
  },
);

test(
  'ApplicationBootstrap startup and shutdown do not leak process listeners',
  async () => {
    const { ApplicationBootstrap } = await import(
      '../../bootstrap/ApplicationBootstrap.js'
    );

    const bootstrap = await createIsolatedBootstrap(ApplicationBootstrap);
    const baseline = getProcessListenerSnapshot();

    try {
      const result = await bootstrap.start();

      assert.equal(result.started, true);
      assert.equal(bootstrap.context.getState(), 'ready');
      assert.equal(bootstrap.isReady(), true);
    } finally {
      await shutdownBootstrap(bootstrap, 'listener-contract-cleanup');
    }

    assert.equal(bootstrap.context.getState(), 'stopped');
    assert.equal(bootstrap.isReady(), false);

    assert.deepEqual(
      getProcessListenerSnapshot(),
      baseline,
      'startup and shutdown must not leave additional process listeners',
    );
  },
);