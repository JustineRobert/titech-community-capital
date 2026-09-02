/**
 * frontend/vitest.config.js
 *
 * TITech Community Capital
 *
 * Enterprise-grade Vitest configuration for the React/Vite frontend.
 *
 * Responsibilities:
 * - Configure Vitest test execution.
 * - Configure React/Vite integration.
 * - Configure jsdom browser-like testing.
 * - Load global test setup.
 * - Configure V8 coverage reporting.
 * - Provide a stable @ alias for src/.
 * - Remain compatible with native ES modules.
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  test: {
    /**
     * Makes Vitest APIs such as describe(), it(), expect(), beforeEach()
     * available globally.
     */
    globals: true,

    /**
     * Browser-like DOM environment for React component tests.
     */
    environment: 'jsdom',

    /**
     * Global test initialization.
     */
    setupFiles: ['./src/setupTests.js'],

    /**
     * Test discovery.
     */
    include: [
      'src/**/*.{test,spec}.{js,jsx,ts,tsx}',
    ],

    exclude: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '**/*.config.{js,mjs,cjs,ts}',
    ],

    /**
     * Coverage configuration.
     */
    coverage: {
      provider: 'v8',

      reporter: [
        'text',
        'json',
        'html',
        'lcov',
      ],

      reportsDirectory: './coverage',

      /**
       * Fail CI when coverage falls below these thresholds.
       *
       * These are intentionally moderate initial gates and can be
       * increased progressively as the frontend test suite matures.
       */
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },

      exclude: [
        'src/main.{js,jsx,ts,tsx}',
        'src/vite-env.d.ts',
        '**/*.d.ts',
        '**/*.config.{js,mjs,cjs,ts}',
        '**/index.{js,jsx,ts,tsx}',
      ],
    },

    /**
     * Prevent Vitest from silently hanging because of open resources.
     */
    teardownTimeout: 10_000,

    /**
     * Reasonable timeout for frontend unit/component tests.
     */
    testTimeout: 10_000,

    /**
     * Reasonable timeout for lifecycle hooks.
     */
    hookTimeout: 10_000,

    /**
     * Clear mocks between tests while preserving mock implementations.
     */
    clearMocks: true,

    /**
     * Reset mock call state between tests.
     */
    mockReset: true,

    /**
     * Restore original implementations after tests.
     */
    restoreMocks: true,

    /**
     * Use isolated test environments to reduce cross-test contamination.
     */
    isolate: true,

    /**
     * Keep console output useful during development and CI.
     */
    reporters: ['default'],

    /**
     * Prevent accidental execution of tests that call process.exit().
     */
    dangerouslyIgnoreUnhandledErrors: false,
  },
});