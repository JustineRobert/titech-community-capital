
'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * File: backend/jest.config.cjs
 * Canonical Jest Configuration
 * ============================================================================
 *
 * MODULE STRATEGY
 * ----------------------------------------------------------------------------
 * - Application JavaScript follows backend/package.json "type": "module".
 * - This configuration remains CommonJS because its extension is .cjs.
 * - Jest ESM tests run with --experimental-vm-modules.
 * - transform: {} preserves native module formats.
 * - .cjs tests remain eligible for Jest discovery.
 * - Native node:test suites under tests/unit/platform/ run through
 *   the dedicated "npm run test:control-plane" script, not Jest.
 * - Native .mjs suites are intentionally not discovered by these patterns.
 *
 * SAFETY AND RELIABILITY
 * ----------------------------------------------------------------------------
 * - Resolve paths relative to this configuration file.
 * - Validate JEST_MAX_WORKERS instead of accepting invalid values silently.
 * - Use V8 coverage instrumentation explicitly.
 * - Ignore generated, build and native-test-runner artifacts.
 * - Preserve clearMocks/restoreMocks behavior for existing Jest tests.
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Do not register a legacy global setup file that clears collections or drops
 * a database after every test file. Database lifecycle must be isolated and
 * explicitly owned by the relevant integration-test suite.
 * ============================================================================
 */

const path = require('node:path');

const ROOT_DIR = __dirname;

/* ============================================================================
 * Worker Configuration
 * ========================================================================== */

/**
 * Accept:
 *   JEST_MAX_WORKERS=1
 *   JEST_MAX_WORKERS=2
 *   JEST_MAX_WORKERS=50%
 *   JEST_MAX_WORKERS=100%
 *
 * Reject malformed values during configuration loading so CI failures
 * provide a clear, actionable message.
 */
function resolveMaxWorkers() {
  const configuredValue =
    process.env.JEST_MAX_WORKERS?.trim();

  if (!configuredValue) {
    return process.env.CI ? 2 : '50%';
  }

  if (/^[1-9]\d*$/.test(configuredValue)) {
    const workers = Number(configuredValue);

    if (Number.isSafeInteger(workers)) {
      return workers;
    }
  }

  if (/^(?:[1-9]\d?|100)%$/.test(configuredValue)) {
    return configuredValue;
  }

  throw new Error(
    '[TITech Jest configuration] Invalid JEST_MAX_WORKERS value. ' +
      'Use a positive integer or a percentage from 1% to 100%.',
  );
}

/* ============================================================================
 * Jest Configuration
 * ========================================================================== */

module.exports = {
  displayName: 'TITech Backend Tests',

  rootDir: ROOT_DIR,

  roots: [
    '<rootDir>',
  ],

  testEnvironment: 'node',

  /*
   * Deliberately exclude .mjs from Jest test discovery.
   *
   * TITech's Node-native regression tests use node:test and are executed
   * through their dedicated npm scripts.
   */
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/__tests__/**/*.test.cjs',

    '**/*.test.js',
    '**/*.test.cjs',

    '**/*.spec.js',
    '**/*.spec.cjs',

    '**/tests/**/*.test.js',
    '**/tests/**/*.test.cjs',
  ],

  moduleFileExtensions: [
    'mjs',
    'js',
    'cjs',
    'json',
  ],

  /*
   * Native ESM execution is handled by Node and Jest's VM modules.
   * Do not introduce a CommonJS-emitting transformer into this configuration.
   */
  transform: {},

  /*
   * financialStates.test.js and the rest of tests/unit/platform/ are
   * executed with node:test through the existing test:control-plane script.
   * Excluding the directory prevents Jest from reporting that those tests
   * contain no Jest-registered test cases.
   */
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/dist/',
    '<rootDir>/coverage/',
    '<rootDir>/generated/',
    '<rootDir>/tests/unit/platform/',
  ],

  modulePathIgnorePatterns: [
    '<rootDir>/dist/',
    '<rootDir>/coverage/',
    '<rootDir>/generated/',
  ],

  watchPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
    '<rootDir>/coverage/',
    '<rootDir>/generated/',
  ],

  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/generated/',
    '/fixtures/',
    '/tests/',
  ],

  /*
   * V8 coverage is explicit and compatible with the native ESM strategy.
   * Coverage remains opt-in; this setting does not itself enable collection.
   */
  coverageProvider: 'v8',

  collectCoverage: false,

  collectCoverageFrom: [
    'controllers/**/*.js',
    'services/**/*.js',
    'middleware/**/*.js',
    'models/**/*.js',
    'routes/**/*.js',
    'modules/**/*.js',

    '!**/tests/**',
    '!**/__tests__/**',
    '!**/fixtures/**',
    '!**/generated/**',
    '!**/coverage/**',
    '!**/dist/**',
  ],

  coverageDirectory: path.join(
    ROOT_DIR,
    'coverage',
  ),

  coverageReporters: [
    'text',
    'lcov',
    'json',
    'cobertura',
  ],

  testTimeout: 30_000,

  verbose: true,

  bail: false,

  passWithNoTests: false,

  injectGlobals: true,

  clearMocks: true,

  restoreMocks: true,

  resetMocks: false,

  maxWorkers: resolveMaxWorkers(),

  /*
   * No global setup file is registered here intentionally.
   *
   * Review and isolate the legacy tests/setup.js database hooks before
   * enabling setupFilesAfterEnv. Global teardown must never drop a shared
   * database used by other test files or workers.
   */
};
