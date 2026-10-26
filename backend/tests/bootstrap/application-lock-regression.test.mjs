import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
import { ApplicationBootstrap } from '../../bootstrap/ApplicationBootstrap.js';
import { resolveCanonicalApplication } from '../../bootstrap/resolveCanonicalApplication.js';

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
    start: async (context = {}, bootstrap = null) => {
      if (name === 'logger') {
        return { logger: { debug() {}, info() {}, warn() {}, error() {} } };
      }

      if (name === 'middleware') {
        const application = resolveCanonicalApplication(context, () => canonicalApplication, bootstrap);
        return {
          context: {
            middleware: { status: 'ready', phase: name },
            application,
            app: application,
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

test('middleware phase binds one canonical Express app while active replacement stays locked', async () => {
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


test('middleware reuses the bootstrap-owned application ahead of stale context aliases', () => {
  const canonicalApplication = function canonicalExpressApplication() {};
  const staleApplication = function staleContextApplication() {};
  let factoryCalls = 0;
  const context = {
    application: staleApplication,
    app: staleApplication,
  };
  const bootstrapOwner = {
    application: canonicalApplication,
    getApplication: () => canonicalApplication,
  };

  const resolved = resolveCanonicalApplication(context, () => {
    factoryCalls += 1;
    return function unexpectedNewApplication() {};
  }, bootstrapOwner);

  assert.equal(resolved, canonicalApplication);
  assert.equal(context.application, canonicalApplication);
  assert.equal(context.app, canonicalApplication);
  assert.equal(factoryCalls, 0, 'resolver must not construct a duplicate Express app');
});

test('middleware creates exactly one app only when no canonical instance exists', () => {
  let factoryCalls = 0;
  const createdApplication = function createdExpressApplication() {};
  const context = {};

  const resolved = resolveCanonicalApplication(context, () => {
    factoryCalls += 1;
    return createdApplication;
  });

  assert.equal(resolved, createdApplication);
  assert.equal(context.application, createdApplication);
  assert.equal(context.app, createdApplication);
  assert.equal(factoryCalls, 1);
});

test('public legal routes are wired from login and account creation to the canonical legal pages', async () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const read = (relativePath) => readFile(path.join(repositoryRoot, relativePath), 'utf8');
  const [routes, login, register, main, themeCss, vercelConfig, middleware, registrationController, sharedLegalContent, legalDocuments] = await Promise.all([
    read('frontend/src/routes/AppRoutes.jsx'),
    read('frontend/src/pages/Login.jsx'),
    read('frontend/src/pages/Register.jsx'),
    read('frontend/src/main.jsx'),
    read('frontend/src/branding/official-theme.css'),
    read('frontend/vercel.json'),
    read('backend/bootstrap/middleware.js'),
    read('backend/controllers/authController.js'),
    read('shared/legal/legalDocuments.json'),
    read('frontend/src/legal/LegalDocuments.jsx'),
  ]);

  assert.match(routes, /LEGAL:\s*['"]\/legal['"]/);
  assert.match(routes, /import\(['"]\.\.\/legal\/LegalDocuments\.jsx['"]\)/);
  assert.match(routes, /module\.LegalIndexPage/);
  assert.match(routes, /module\.TermsOfServicePage/);
  assert.match(routes, /module\.PrivacyPolicyPage/);
  assert.match(routes, /path=\{ROUTES\.LEGAL\}/);
  assert.match(login, /LegalDocumentLinks/);
  assert.match(register, /LegalDocumentLinks/);
  for (const href of ['/legal', '/terms', '/privacy']) {
    assert.ok(legalDocuments.includes(`to=\"${href}\"`) || legalDocuments.includes(`to=\'{href}\'`), `shared legal links should route to ${href}`);
  }
  assert.match(main, /import '\.\/branding\/official-theme\.css';/);
  assert.match(register, /LegalConsentFields/);
  assert.match(middleware, /resolveCanonicalApplication\(context, express, bootstrap\)/);
  assert.match(register, /termsVersion:\s*LEGAL_DOCUMENT_VERSION/);
  assert.match(register, /privacyVersion:\s*LEGAL_DOCUMENT_VERSION/);
  assert.match(registrationController, /LEGAL_PUBLICATION_BLOCKED/);
  assert.match(registrationController, /LEGAL_ACCEPTANCE_INTEGRATION_BLOCKED/);
  assert.match(registrationController, /CANONICAL_LEGAL_ACCEPTANCE_INTEGRATION_READY = false/);
  assert.doesNotMatch(registrationController, /termsAndPrivacy/);
  assert.equal(JSON.parse(sharedLegalContent).acceptanceIntegrationStatus, 'not-integrated');
  assert.equal(JSON.parse(sharedLegalContent).productionRegistrationEnabled, false);
  assert.equal(JSON.parse(sharedLegalContent).status, 'draft', 'the legal release gate must remain closed until approved');
  for (const paletteToken of ['--titech-official-deep-blue', '--titech-official-electric-blue', '--titech-official-bright-blue', '--titech-official-cyan', '--titech-official-green', '--titech-official-lime', '--titech-official-gold', '--titech-official-navy', '--titech-official-white']) {
    assert.ok(themeCss.includes(paletteToken), `official theme token missing: ${paletteToken}`);
  }
  const vercel = JSON.parse(vercelConfig);
  assert.ok(vercel.rewrites?.some((rule) => rule.destination === '/index.html'), 'Vercel must rewrite deep-link requests to the SPA entry point');
});
