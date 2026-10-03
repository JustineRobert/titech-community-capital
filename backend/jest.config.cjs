/**
 * TITech Community Capital — canonical Jest configuration.
 *
 * Application source is ESM. Intentional CommonJS test/boundary files use
 * .cjs so module intent is explicit. Jest is launched through Node with the
 * ESM VM support required by the Jest 30 ESM runtime.
 */

module.exports = {
  displayName: 'TITech Backend Tests',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
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
  moduleFileExtensions: ['js', 'cjs', 'mjs', 'json'],
  transform: {},
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/generated/',
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/dist/',
    '<rootDir>/coverage/',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/generated/',
    '/fixtures/',
    '/tests/helpers/',
  ],
  testTimeout: 30_000,
  verbose: true,
  bail: false,
  passWithNoTests: false,
  injectGlobals: true,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: false,
  maxWorkers: process.env.JEST_MAX_WORKERS || (process.env.CI ? 2 : '50%'),
  collectCoverage: false,
  collectCoverageFrom: [
    'controllers/**/*.js',
    'services/**/*.js',
    'middleware/**/*.js',
    'models/**/*.js',
    'routes/**/*.js',
    'modules/**/*.js',
    '!**/tests/**',
    '!**/fixtures/**',
    '!**/generated/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'json', 'cobertura'],
};
