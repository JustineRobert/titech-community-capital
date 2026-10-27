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

/**
 * Build deterministic bootstrap phases so the regression tests do not
 * depend on external services or production infrastructure.
 */
function deterministicPhases(canonicalApplication) {
  return PHASES.map((name, index) => ({
    name,
    priority: (index + 1) * 100,
    required: true,
    dependencies: index === 0 ? [] : [PHASES[index - 1]],

    start: async (context = {}, bootstrap = null) => {
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

      if (name === 'middleware') {
        const application = resolveCanonicalApplication(
          context,
          () => canonicalApplication,
          bootstrap,
        );

        return {
          context: {
            middleware: {
              status: 'ready',
              phase: name,
            },
            application,
            app: application,
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
    health: async () => ({ status: 'UP' }),
    readiness: async () => ({ ready: true }),
  }));
}

/* ============================================================================
 * Canonical Application Ownership and Lifecycle Lock
 * ========================================================================== */

test(
  'middleware phase binds one canonical Express app while active replacement stays locked',
  async () => {
    const canonicalApplication = function canonicalExpressApplication() {};

    const bootstrap = new ApplicationBootstrap({
      startServer: false,
      requireApplication: true,
      phases: deterministicPhases(canonicalApplication),
    });

    try {
      await bootstrap.initialize();

      assert.equal(
        bootstrap.getApplication(),
        null,
        'no app should exist before middleware initialization',
      );

      const startResult = await bootstrap.start();

      assert.equal(
        startResult.started,
        true,
        'the canonical startup should succeed',
      );

      assert.equal(
        bootstrap.getApplication(),
        canonicalApplication,
        'bootstrap must retain the canonical application',
      );

      assert.equal(
        bootstrap.context.application,
        canonicalApplication,
        'bootstrap context must reference the canonical application',
      );

      assert.equal(
        bootstrap.isReady(),
        true,
        'readiness must follow successful phase completion',
      );

      assert.throws(
        () =>
          bootstrap.setApplication(
            function replacementExpressApplication() {},
          ),
        (error) => error?.code === 'APPLICATION_LOCKED',
        'active lifecycle must still reject replacing the canonical app',
      );

      assert.doesNotThrow(
        () => bootstrap.setApplication(canonicalApplication),
        're-binding the same instance must be idempotent',
      );
    } finally {
      await bootstrap.shutdown(
        'application-lock-regression-test-cleanup',
      );
    }
  },
);

/* ============================================================================
 * Reuse of Bootstrap-Owned Application
 * ========================================================================== */

test(
  'middleware reuses the bootstrap-owned application ahead of stale context aliases',
  () => {
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

    const resolved = resolveCanonicalApplication(
      context,
      () => {
        factoryCalls += 1;
        return function unexpectedNewApplication() {};
      },
      bootstrapOwner,
    );

    assert.equal(
      resolved,
      canonicalApplication,
      'resolver must return the bootstrap-owned application',
    );

    assert.equal(
      context.application,
      canonicalApplication,
      'application context alias must be repaired',
    );

    assert.equal(
      context.app,
      canonicalApplication,
      'app context alias must be repaired',
    );

    assert.equal(
      factoryCalls,
      0,
      'resolver must not construct a duplicate Express app',
    );
  },
);

/* ============================================================================
 * Exactly-One-Application Creation
 * ========================================================================== */

test(
  'middleware creates exactly one app only when no canonical instance exists',
  () => {
    let factoryCalls = 0;

    const createdApplication = function createdExpressApplication() {};
    const context = {};

    const resolved = resolveCanonicalApplication(context, () => {
      factoryCalls += 1;
      return createdApplication;
    });

    assert.equal(
      resolved,
      createdApplication,
      'resolver must return the newly created application',
    );

    assert.equal(
      context.application,
      createdApplication,
      'application alias must reference the created instance',
    );

    assert.equal(
      context.app,
      createdApplication,
      'app alias must reference the created instance',
    );

    assert.equal(
      factoryCalls,
      1,
      'application factory must execute exactly once',
    );
  },
);

/* ============================================================================
 * Legal Routes, Consent, Publication Gates and Official Branding
 * ========================================================================== */

test(
  'public legal routes are wired from login and account creation to the canonical legal pages',
  async () => {
    const repositoryRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../..',
    );

    const read = (relativePath) =>
      readFile(path.join(repositoryRoot, relativePath), 'utf8');

    const [
      routes,
      login,
      register,
      main,
      themeCss,
      vercelConfig,
      middleware,
      registrationController,
      sharedLegalContent,
      legalDocuments,
    ] = await Promise.all([
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

    /*
     * Canonical route declaration and lazy-loaded legal page modules.
     * These checks tolerate ordinary whitespace and quote-style changes.
     */

    assert.match(
      routes,
      /\bLEGAL\s*:\s*['"]\/legal['"]/,
      'canonical legal route must be declared',
    );

    assert.match(
      routes,
      /import\s*\(\s*['"]\.\.\/legal\/LegalDocuments\.jsx['"]\s*\)/,
      'legal document module must be lazy-loaded from its expected path',
    );

    assert.match(
      routes,
      /module\.LegalIndexPage/,
      'legal index page must be wired into the route configuration',
    );

    assert.match(
      routes,
      /module\.TermsOfServicePage/,
      'terms of service page must be wired into the route configuration',
    );

    assert.match(
      routes,
      /module\.PrivacyPolicyPage/,
      'privacy policy page must be wired into the route configuration',
    );

    assert.match(
      routes,
      /path\s*=\s*\{\s*ROUTES\.LEGAL\s*\}/,
      'legal route must use the canonical route constant',
    );

    /*
     * Login, registration and shared legal links.
     */

    assert.match(
      login,
      /LegalDocumentLinks/,
      'login page must expose the shared legal document links',
    );

    assert.match(
      register,
      /LegalDocumentLinks/,
      'registration page must expose the shared legal document links',
    );

    for (const href of ['/legal', '/terms', '/privacy']) {
      const hasDoubleQuotedHref = legalDocuments.includes(
        `to="${href}"`,
      );

      const hasSingleQuotedHref = legalDocuments.includes(
        `to='${href}'`,
      );

      const hasBracedDoubleQuotedHref = legalDocuments.includes(
        `to={"${href}"}`,
      );

      const hasBracedSingleQuotedHref = legalDocuments.includes(
        `to={'${href}'}`,
      );

      assert.ok(
        hasDoubleQuotedHref ||
          hasSingleQuotedHref ||
          hasBracedDoubleQuotedHref ||
          hasBracedSingleQuotedHref,
        `shared legal links should route to ${href}`,
      );
    }

    /*
     * Official theme integration and middleware application resolution.
     */

    assert.match(
      main,
      /\bimport\s*['"]\.\/branding\/official-theme\.css['"]\s*;/,
      'main entry point must load the official TITech theme',
    );

    assert.match(
      register,
      /LegalConsentFields/,
      'registration page must include the legal consent fields',
    );

    assert.match(
      middleware,
      /resolveCanonicalApplication\s*\(\s*context\s*,\s*express\s*,\s*bootstrap\s*\)/,
      'middleware must resolve the canonical application',
    );

    assert.match(
      register,
      /termsVersion:\s*LEGAL_DOCUMENT_VERSION/,
      'registration must capture the terms document version',
    );

    assert.match(
      register,
      /privacyVersion:\s*LEGAL_DOCUMENT_VERSION/,
      'registration must capture the privacy document version',
    );

    /*
     * Registration safety gates must remain closed until the required
     * legal publication and acceptance integration work is completed.
     */

    assert.match(
      registrationController,
      /LEGAL_PUBLICATION_BLOCKED/,
      'legal publication safety gate must exist',
    );

    assert.match(
      registrationController,
      /LEGAL_ACCEPTANCE_INTEGRATION_BLOCKED/,
      'legal acceptance integration safety gate must exist',
    );

    assert.match(
      registrationController,
      /CANONICAL_LEGAL_ACCEPTANCE_INTEGRATION_READY\s*=\s*false/,
      'canonical legal acceptance integration must not be falsely marked ready',
    );

    assert.doesNotMatch(
      registrationController,
      /termsAndPrivacy/,
      'legacy termsAndPrivacy acceptance must not bypass the canonical integration',
    );

    /*
     * Shared legal publication state.
     */

    const legalContent = JSON.parse(sharedLegalContent);

    assert.equal(
      legalContent.acceptanceIntegrationStatus,
      'not-integrated',
      'legal acceptance integration must remain explicitly unintegrated',
    );

    assert.equal(
      legalContent.productionRegistrationEnabled,
      false,
      'production registration must remain disabled',
    );

    assert.equal(
      legalContent.status,
      'draft',
      'the legal release gate must remain closed until approved',
    );

    /*
     * Official TITech palette tokens must remain available.
     */

    const paletteTokens = [
      '--titech-official-deep-blue',
      '--titech-official-electric-blue',
      '--titech-official-bright-blue',
      '--titech-official-cyan',
      '--titech-official-green',
      '--titech-official-lime',
      '--titech-official-gold',
      '--titech-official-navy',
      '--titech-official-white',
    ];

    for (const paletteToken of paletteTokens) {
      assert.ok(
        themeCss.includes(paletteToken),
        `official theme token missing: ${paletteToken}`,
      );
    }

    /*
     * Vercel must support frontend SPA deep links.
     */

    const vercel = JSON.parse(vercelConfig);

    assert.ok(
      vercel.rewrites?.some(
        (rule) => rule.destination === '/index.html',
      ),
      'Vercel must rewrite deep-link requests to the SPA entry point',
    );
  },
);