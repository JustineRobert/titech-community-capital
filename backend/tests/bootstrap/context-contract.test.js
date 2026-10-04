import test from 'node:test';
import assert from 'node:assert/strict';

test('BootstrapContext ESM barrel exposes the canonical contract', async () => {
  const contextModule = await import('../../bootstrap/context/index.js');
  assert.equal(typeof contextModule.BootstrapContext, 'function');
  assert.ok(Array.isArray(contextModule.BOOTSTRAP_PHASES));
  assert.ok(contextModule.BOOTSTRAP_PHASES.includes('configuration'));
  assert.ok(contextModule.BOOTSTRAP_PHASES.includes('httpServer'));
  assert.ok(contextModule.BOOTSTRAP_PHASES.includes('runtimeReady'));
});

test('BootstrapContext protects state and enforces the forward phase sequence', async () => {
  const { createBootstrapContext } = await import('../../bootstrap/context/index.js');
  const context = createBootstrapContext({ metadata: { requireHttpServer: false } });
  assert.equal(context.getState(), 'created');
  assert.throws(() => { context.state = 'created'; }, /read-only/i);
  context.start();
  assert.equal(context.getState(), 'starting');
  context.beginPhase('environment');
  context.completePhase('environment');
  assert.throws(() => context.beginPhase('logger'), /next phase|configuration/i);
  context.beginPhase('configuration');
  context.completePhase('configuration');
  assert.equal(context.getPhaseState('configuration'), 'completed');
});

test('ApplicationBootstrap phase results cannot assign protected context state', async () => {
  const { ApplicationBootstrap } = await import('../../bootstrap/ApplicationBootstrap.js');
  const bootstrap = new ApplicationBootstrap({ startServer: false, requireApplication: false });
  await bootstrap.initialize();
  bootstrap.context.start();
  assert.doesNotThrow(() => bootstrap.applyPhaseResult({ context: { configuration: { source: 'test' }, state: 'created' } }));
  assert.equal(bootstrap.context.getState(), 'starting');
  assert.deepEqual(bootstrap.context.configuration, { source: 'test' });
});

test('ApplicationBootstrap completes an isolated deterministic startup lifecycle without a network server', async () => {
  const { ApplicationBootstrap } = await import('../../bootstrap/ApplicationBootstrap.js');
  const phaseNames = ['environment', 'configuration', 'logger', 'observability', 'readiness', 'resilience', 'infrastructure', 'services', 'middleware', 'routes'];
  const priority = Object.fromEntries(phaseNames.map((name, index) => [name, (index + 1) * 100]));
  const definitions = phaseNames.map((name, index) => ({
    name,
    priority: priority[name],
    required: true,
    dependencies: index === 0 ? [] : [phaseNames[index - 1]],
    start: async () => {
      if (name === 'logger') return { logger: { debug() {}, info() {}, warn() {}, error() {} } };
      return { context: { [name]: { status: 'ready', phase: name } } };
    },
    stop: async () => undefined,
    health: async () => ({ status: 'UP' }),
    readiness: async () => ({ ready: true }),
  }));
  const bootstrap = new ApplicationBootstrap({ startServer: false, requireApplication: false, phases: definitions });
  bootstrap.initialize();
  bootstrap.setApplication(() => {});
  const result = await bootstrap.start();
  assert.equal(bootstrap.isReady(), true);
  assert.equal(result.started, true);
  assert.equal(bootstrap.context.getState(), 'ready');
  assert.equal(bootstrap.context.getPhaseState('runtimeReady'), 'completed');
  await bootstrap.shutdown('contract-test');
  assert.equal(bootstrap.context.getState(), 'stopped');
});


test('ApplicationBootstrap restart cycles do not accumulate process listeners', async () => {
  const { ApplicationBootstrap } = await import('../../bootstrap/ApplicationBootstrap.js');
  const phaseNames = ['environment', 'configuration', 'logger', 'observability', 'readiness', 'resilience', 'infrastructure', 'services', 'middleware', 'routes'];
  const definitions = phaseNames.map((name, index) => ({
    name,
    priority: (index + 1) * 100,
    required: true,
    dependencies: index === 0 ? [] : [phaseNames[index - 1]],
    start: async () => ({ context: { [name]: { status: 'ready', phase: name } } }),
    stop: async () => undefined,
    health: async () => ({ status: 'UP' }),
    readiness: async () => ({ ready: true }),
  }));

  const bootstrap = new ApplicationBootstrap({
    startServer: false,
    requireApplication: false,
    allowRestart: true,
    phases: definitions,
  });
  bootstrap.initialize();
  bootstrap.setApplication(() => {});

  const baseline = {
    SIGINT: process.listenerCount('SIGINT'),
    SIGTERM: process.listenerCount('SIGTERM'),
    uncaughtException: process.listenerCount('uncaughtException'),
    unhandledRejection: process.listenerCount('unhandledRejection'),
    exit: process.listenerCount('exit'),
    beforeExit: process.listenerCount('beforeExit'),
  };

  for (let i = 0; i < 3; i += 1) {
    await bootstrap.start();
    assert.equal(bootstrap.context.getState(), 'ready');
    await bootstrap.shutdown(`restart-cycle-${i + 1}`);
    assert.equal(bootstrap.context.getState(), 'stopped');

    assert.deepEqual({
      SIGINT: process.listenerCount('SIGINT'),
      SIGTERM: process.listenerCount('SIGTERM'),
      uncaughtException: process.listenerCount('uncaughtException'),
      unhandledRejection: process.listenerCount('unhandledRejection'),
      exit: process.listenerCount('exit'),
      beforeExit: process.listenerCount('beforeExit'),
    }, baseline);
  }
});
