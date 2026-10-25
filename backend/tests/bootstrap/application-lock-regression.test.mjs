import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
import { ApplicationBootstrap } from '../../bootstrap/ApplicationBootstrap.js';

const PHASES = Object.freeze([
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
]);

function deterministicPhases(canonicalApplication) {
  return PHASES.map((name, index) => ({
    name,
    priority: (index + 1) * 100,
    required: true,
    dependencies: index === 0 ? [] : [PHASES[index - 1]],
    start: async () => {
      if (name === 'logger') {
        return { logger: { debug() {}, info() {}, warn() {}, error() {} } };
      }

      if (name === 'middleware') {
        return {
          context: {
            middleware: { status: 'ready', phase: name },
            application: canonicalApplication,
          },
        };
      }

      return { context: { [name]: { status: 'ready', phase: name } } };
    },
    stop: async () => undefined,
    health: async () => ({ status: 'UP' }),
    readiness: async () => ({ ready: true }),
  }));
}

test('initial middleware-created Express app binds once while active replacement stays locked', async () => {
  const canonicalApplication = function canonicalExpressApplication() {};
  const bootstrap = new ApplicationBootstrap({
    startServer: false,
    requireApplication: true,
    phases: deterministicPhases(canonicalApplication),
  });

  try {
    await bootstrap.initialize();
    assert.equal(bootstrap.getApplication(), null, 'no app should exist before middleware initialization');

    const startResult = await bootstrap.start();

    assert.equal(startResult.started, true, 'the canonical startup should succeed');
    assert.equal(bootstrap.getApplication(), canonicalApplication);
    assert.equal(bootstrap.context.application, canonicalApplication);
    assert.equal(bootstrap.isReady(), true, 'readiness must follow successful phase completion');

    assert.throws(
      () => bootstrap.setApplication(function replacementExpressApplication() {}),
      (error) => error?.code === 'APPLICATION_LOCKED',
      'active lifecycle must still reject replacing the canonical app',
    );

    assert.doesNotThrow(
      () => bootstrap.setApplication(canonicalApplication),
      're-binding the same instance must be idempotent',
    );
  } finally {
    await bootstrap.shutdown('application-lock-regression-test-cleanup');
  }
});


test('public legal routes are wired from login and account creation to the canonical legal pages', async () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const read = (relativePath) => readFile(path.join(repositoryRoot, relativePath), 'utf8');
  const [routes, login, register, main, themeCss, vercelConfig] = await Promise.all([
    read('frontend/src/routes/AppRoutes.jsx'),
    read('frontend/src/pages/Login.jsx'),
    read('frontend/src/pages/Register.jsx'),
    read('frontend/src/main.jsx'),
    read('frontend/src/branding/official-theme.css'),
    read('frontend/vercel.json'),
  ]);

  assert.match(routes, /LEGAL:\s*['"]\/legal['"]/);
  assert.match(routes, /import\(['"]\.\.\/pages\/Legal['"]\)/);
  assert.match(routes, /path=\{ROUTES\.LEGAL\}/);
  for (const href of ['/legal', '/terms', '/privacy']) {
    assert.ok(login.includes(`\"${href}\"`) || login.includes(`'${href}'`), `login should link ${href}`);
    assert.ok(register.includes(`\"${href}\"`) || register.includes(`'${href}'`), `register should link ${href}`);
  }
  assert.match(main, /import '\.\/branding\/official-theme\.css';/);
  for (const paletteToken of ['--titech-official-deep-blue', '--titech-official-electric-blue', '--titech-official-bright-blue', '--titech-official-cyan', '--titech-official-green', '--titech-official-lime', '--titech-official-gold', '--titech-official-navy', '--titech-official-white']) {
    assert.ok(themeCss.includes(paletteToken), `official theme token missing: ${paletteToken}`);
  }
  const vercel = JSON.parse(vercelConfig);
  assert.ok(vercel.rewrites?.some((rule) => rule.destination === '/index.html'), 'Vercel must rewrite deep-link requests to the SPA entry point');
});
