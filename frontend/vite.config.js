/**
 * =============================================================================
 * TITech Community Capital Ltd
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   frontend/vite.config.js
 *
 * Purpose:
 *   Enterprise-grade Vite + React + Vitest configuration.
 *
 * Responsibilities:
 *   - Configure React with the automatic JSX runtime.
 *   - Load mode-aware VITE_* environment variables safely.
 *   - Configure development API and Socket.IO proxying.
 *   - Provide stable ESM-safe path aliases.
 *   - Configure production-oriented build output.
 *   - Configure deterministic dependency optimization.
 *   - Configure Vitest + React Testing Library.
 *
 * Architectural Constraints:
 *   - Do not introduce a second application architecture.
 *   - Do not create backend services from the frontend config.
 *   - Do not hard-code secrets.
 *   - Do not use CommonJS globals such as __dirname or require().
 *
 * Runtime:
 *   Node.js 20+
 *
 * Module System:
 *   ES Modules (ESM)
 *
 * =============================================================================
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  defineConfig,
  loadEnv,
} from "vite";

import react from "@vitejs/plugin-react";

/* =============================================================================
 * MODULE IDENTITY
 * =============================================================================
 */

/**
 * ESM-safe equivalent of the project directory.
 *
 * This avoids CommonJS __dirname and is compatible with Vite's ESM config
 * loading model.
 */
const CURRENT_FILE = fileURLToPath(
  import.meta.url,
);

const PROJECT_ROOT = path.dirname(
  CURRENT_FILE,
);

/**
 * Frontend source directory.
 */
const SRC_DIR = path.resolve(
  PROJECT_ROOT,
  "src",
);

/**
 * Production build directory.
 */
const DIST_DIR = path.resolve(
  PROJECT_ROOT,
  "dist",
);

/* =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const DEFAULT_DEV_PORT = 3000;

const DEFAULT_PREVIEW_PORT = 4173;

const DEFAULT_API_ORIGIN =
  "http://localhost:5000";

const DEFAULT_API_PATH =
  "/api";

const DEFAULT_CHUNK_WARNING_LIMIT =
  1000;

/**
 * Supported application targets.
 *
 * Kept intentionally conservative so the generated bundle remains compatible
 * with modern browsers without changing the application's architecture.
 */
const BUILD_TARGET = "es2020";

/* =============================================================================
 * UTILITY FUNCTIONS
 * =============================================================================
 */

/**
 * Parse a positive TCP port safely.
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function parsePort(
  value,
  fallback,
) {
  const port = Number(value);

  if (
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535
  ) {
    return port;
  }

  return fallback;
}

/**
 * Remove a single trailing slash.
 *
 * @param {string} value
 * @returns {string}
 */
function stripTrailingSlash(value) {
  return String(value).replace(
    /\/+$/,
    "",
  );
}

/**
 * Normalize an API URL supplied by the frontend environment.
 *
 * Examples:
 *
 *   http://localhost:5000
 *       -> http://localhost:5000
 *
 *   http://localhost:5000/api
 *       -> http://localhost:5000
 *
 *   http://localhost:5000/api/
 *       -> http://localhost:5000
 *
 * Relative values such as "/api" are not suitable as proxy targets and
 * therefore fall back to the configured backend origin.
 *
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeApiProxyTarget(
  value,
  fallback = DEFAULT_API_ORIGIN,
) {
  const candidate = String(
    value || "",
  ).trim();

  if (!candidate) {
    return fallback;
  }

  try {
    const parsed = new URL(
      candidate,
    );

    /**
     * Proxy targets should point to the backend origin rather than the
     * browser-facing /api path.
     */
    if (
      parsed.pathname === DEFAULT_API_PATH ||
      parsed.pathname === `${DEFAULT_API_PATH}/`
    ) {
      parsed.pathname = "";
      parsed.search = "";
      parsed.hash = "";
    }

    return stripTrailingSlash(
      parsed.toString(),
    );
  } catch {
    return fallback;
  }
}

/**
 * Return the configured application version without depending on
 * CommonJS-only globals.
 *
 * Priority:
 *   VITE_APP_VERSION
 *   npm_package_version
 *   fallback
 *
 * @param {Record<string, string>} env
 * @returns {string}
 */
function resolveAppVersion(env) {
  return (
    env.VITE_APP_VERSION ||
    process.env.npm_package_version ||
    "0.0.0"
  );
}

/**
 * Determine whether a module path belongs to a dependency.
 *
 * @param {string} id
 * @returns {boolean}
 */
function isNodeModule(id) {
  return id.includes(
    "node_modules",
  );
}

/* =============================================================================
 * MANUAL CHUNKING
 * =============================================================================
 */

/**
 * Stable vendor chunk strategy.
 *
 * The goal is to keep frequently-used framework/vendor code cacheable while
 * avoiding an excessive number of tiny chunks.
 *
 * @param {string} id
 * @returns {string|undefined}
 */
function manualChunks(id) {
  if (!isNodeModule(id)) {
    return undefined;
  }

  if (
    id.includes(
      "node_modules/react",
    ) ||
    id.includes(
      "node_modules/react-dom",
    )
  ) {
    return "react";
  }

  if (
    id.includes(
      "node_modules/react-router",
    )
  ) {
    return "router";
  }

  if (
    id.includes(
      "node_modules/redux",
    ) ||
    id.includes(
      "node_modules/react-redux",
    ) ||
    id.includes(
      "node_modules/redux-thunk",
    )
  ) {
    return "redux";
  }

  if (
    id.includes(
      "node_modules/formik",
    ) ||
    id.includes(
      "node_modules/yup",
    )
  ) {
    return "forms";
  }

  if (
    id.includes(
      "node_modules/recharts",
    )
  ) {
    return "charts";
  }

  if (
    id.includes(
      "node_modules/axios",
    ) ||
    id.includes(
      "node_modules/socket.io-client",
    )
  ) {
    return "network";
  }

  return "vendor";
}

/* =============================================================================
 * CONFIGURATION
 * =============================================================================
 */

export default defineConfig(
  ({
    mode,
    command,
    isPreview,
  }) => {
    /**
     * Only VITE_* variables are intentionally loaded into frontend
     * configuration.
     *
     * This reduces the chance of accidentally consuming a backend secret
     * from an unrestricted environment namespace.
     */
    const env = loadEnv(
      mode,
      PROJECT_ROOT,
      "VITE_",
    );

    const isProduction =
      mode === "production";

    const isDevelopment =
      mode === "development";

    const isBuild =
      command === "build";

    /**
     * Resolve ports deterministically.
     */
    const devPort = parsePort(
      env.VITE_PORT,
      DEFAULT_DEV_PORT,
    );

    const previewPort = parsePort(
      env.VITE_PREVIEW_PORT,
      DEFAULT_PREVIEW_PORT,
    );

    /**
     * Backend proxy origin.
     *
     * Supports both:
     *
     *   VITE_API_PROXY_URL=http://localhost:5000
     *
     * and:
     *
     *   VITE_API_URL=http://localhost:5000/api
     *
     * while preserving compatibility with the existing setup.
     */
    const apiProxyTarget =
      normalizeApiProxyTarget(
        env.VITE_API_PROXY_URL ||
          env.VITE_API_URL,
        DEFAULT_API_ORIGIN,
      );

    /**
     * Browser-facing API URL.
     *
     * This is intentionally kept separate from the proxy target.
     */
    const browserApiUrl =
      env.VITE_API_URL ||
      (
        isProduction
          ? ''
          : `${stripTrailingSlash(
              DEFAULT_API_ORIGIN,
            )}${DEFAULT_API_PATH}`
      );

    const appVersion =
      resolveAppVersion(env);

    return {
      /* =========================================================================
       * PROJECT ROOT
       * =========================================================================
       */

      root: PROJECT_ROOT,

      /* =========================================================================
       * ENVIRONMENT
       * =========================================================================
       */

      envDir: PROJECT_ROOT,

      /**
       * Keep environment exposure restricted to VITE_*.
       *
       * Do not change this to "" because that could expose unrelated
       * environment values to client code.
       */
      envPrefix: "VITE_",

      /* =========================================================================
       * PLUGINS
       * =========================================================================
       */

      plugins: [
        react({
          jsxRuntime: "automatic",
        }),
      ],

      /* =========================================================================
       * SERVER
       * =========================================================================
       */

      server: {
        host:
          env.VITE_HOST ||
          "0.0.0.0",

        port: devPort,

        /**
         * Preserve the existing developer-friendly behavior of allowing
         * Vite to choose another available port.
         */
        strictPort:
          env.VITE_STRICT_PORT ===
          "true",

        /**
         * Keep browser HMR deterministic when the frontend is accessed from
         * another machine on the development network.
         */
        hmr: {
          host:
            env.VITE_HMR_HOST ||
            undefined,

          port: parsePort(
            env.VITE_HMR_PORT,
            devPort,
          ),
        },

        proxy: {
          /**
           * HTTP API proxy.
           *
           * Frontend:
           *   /api/*
           *
           * Backend:
           *   http://localhost:5000/api/*
           */
          "/api": {
            target:
              apiProxyTarget,

            changeOrigin: true,

            secure:
              env.VITE_PROXY_SECURE ===
              "true",

            ws: true,

            /**
             * Preserve the /api request path.
             */
            rewrite: (requestPath) =>
              requestPath,
          },

          /**
           * Socket.IO WebSocket + polling proxy.
           */
          "/socket.io": {
            target:
              apiProxyTarget,

            changeOrigin: true,

            secure:
              env.VITE_PROXY_SECURE ===
              "true",

            ws: true,
          },
        },
      },

      /* =========================================================================
       * PREVIEW
       * =========================================================================
       */

      preview: {
        host:
          env.VITE_PREVIEW_HOST ||
          "0.0.0.0",

        port: previewPort,

        strictPort:
          env.VITE_PREVIEW_STRICT_PORT ===
          "true",
      },

      /* =========================================================================
       * RESOLUTION / ALIASES
       * =========================================================================
       */

      resolve: {
        alias: {
          "@": SRC_DIR,

          "@components": path.resolve(
            SRC_DIR,
            "components",
          ),

          "@hooks": path.resolve(
            SRC_DIR,
            "hooks",
          ),

          "@services": path.resolve(
            SRC_DIR,
            "services",
          ),

          "@store": path.resolve(
            SRC_DIR,
            "store",
          ),

          "@utils": path.resolve(
            SRC_DIR,
            "utils",
          ),

          "@assets": path.resolve(
            SRC_DIR,
            "assets",
          ),

          /**
           * Explicit frontend configuration alias.
           */
          "@config": path.resolve(
            SRC_DIR,
            "config",
          ),
        },
      },

      /* =========================================================================
       * GLOBAL DEFINITIONS
       * =========================================================================
       */

      define: {
        /**
         * Application metadata.
         *
         * This is intentionally non-sensitive.
         */
        __APP_VERSION__:
          JSON.stringify(
            appVersion,
          ),

        __APP_ENV__:
          JSON.stringify(mode),

        __APP_BUILD__:
          JSON.stringify(
            isProduction
              ? "production"
              : isDevelopment
                ? "development"
                : mode,
          ),

        __APP_PREVIEW__:
          JSON.stringify(
            Boolean(isPreview),
          ),

        /**
         * Compatibility bridge for any existing source code that reads:
         *
         *   process.env.VITE_API_URL
         *
         * Prefer import.meta.env.VITE_API_URL in new frontend code.
         */
        "process.env.VITE_API_URL":
          JSON.stringify(
            browserApiUrl,
          ),
      },

      /* =========================================================================
       * BUILD
       * =========================================================================
       */

      build: {
        outDir: DIST_DIR,

        emptyOutDir: true,

        target: BUILD_TARGET,

        /**
         * Production source maps are configurable rather than automatically
         * disabled. This keeps debugging possible without forcing the policy
         * into the application architecture.
         */
        sourcemap:
          env.VITE_SOURCEMAP === "true" ||
          (
            isDevelopment &&
            !isBuild
          ),

        /**
         * Keep the existing Terser strategy.
         *
         * This requires the Terser package to be available in the frontend
         * dependency tree.
         */
        minify: "terser",

        cssCodeSplit: true,

        chunkSizeWarningLimit:
          parsePort(
            env.VITE_CHUNK_SIZE_WARNING_LIMIT,
            DEFAULT_CHUNK_WARNING_LIMIT,
          ),

        assetsInlineLimit:
          parsePort(
            env.VITE_ASSETS_INLINE_LIMIT,
            4096,
          ),

        modulePreload: true,

        reportCompressedSize: true,

        rollupOptions: {
          output: {
            manualChunks,

            chunkFileNames:
              "assets/js/[name]-[hash].js",

            entryFileNames:
              "assets/js/[name]-[hash].js",

            assetFileNames:
              "assets/[ext]/[name]-[hash].[ext]",

            /**
             * Keep generated bundles deterministic and cache friendly.
             */
            sourcemapFileNames:
              "assets/maps/[name]-[hash].map",
          },
        },

        terserOptions: {
          compress: {
            drop_console:
              isProduction &&
              env.VITE_DROP_CONSOLE !==
                "false",

            drop_debugger: true,

            passes:
              Number(
                env.VITE_TERSER_PASSES ||
                  2,
              ),
          },

          mangle: true,

          format: {
            comments: false,
          },
        },
      },

      /* =========================================================================
       * DEPENDENCY OPTIMIZATION
       * =========================================================================
       */

      optimizeDeps: {
        include: [
          "react",
          "react-dom",
          "react-router-dom",
          "axios",
          "socket.io-client",
          "redux",
          "react-redux",
          "redux-thunk",
          "formik",
          "yup",
          "recharts",
        ],

        /**
         * Prevent Vite from aggressively excluding explicitly configured
         * frontend runtime dependencies.
         */
        force:
          env.VITE_FORCE_OPTIMIZE_DEPS ===
          "true",
      },

      /* =========================================================================
       * TESTING / VITEST
       * =========================================================================
       */

      test: {
        globals: true,

        environment: "jsdom",

        setupFiles: [
          path.resolve(
            SRC_DIR,
            "setupTests.js",
          ),
        ],

        css: true,

        clearMocks: true,

        restoreMocks: true,

        mockReset: true,

        testTimeout: 10000,

        hookTimeout: 10000,

        /**
         * Avoid accidental hanging test processes from open handles.
         */
        teardownTimeout: 10000,

        /**
         * Keep test discovery focused on application source/tests.
         */
        include: [
          "src/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx}",
        ],

        exclude: [
          "node_modules",
          "dist",
          "coverage",
          ".git",
          "**/e2e/**",
        ],

        coverage: {
          provider: "v8",

          reporter: [
            "text",
            "html",
            "json",
            "lcov",
          ],

          reportsDirectory:
            path.resolve(
              PROJECT_ROOT,
              "coverage",
            ),

          exclude: [
            "node_modules/",
            "dist/",
            "coverage/",
            "**/*.config.js",
            "**/*.config.mjs",
            "**/*.test.js",
            "**/*.test.jsx",
            "**/*.test.ts",
            "**/*.test.tsx",
            "**/*.spec.js",
            "**/*.spec.jsx",
            "**/*.spec.ts",
            "**/*.spec.tsx",
            "src/setupTests.js",
            "src/main.jsx",
            "src/main.js",
            "**/index.js",
            "**/index.jsx",
            "**/index.ts",
            "**/index.tsx",
          ],

          thresholds: {
            statements: 80,
            branches: 75,
            functions: 80,
            lines: 80,
          },
        },
      },

      /* =========================================================================
       * LOGGING
       * =========================================================================
       */

      clearScreen:
        env.VITE_CLEAR_SCREEN !==
        "false",

      /* =========================================================================
       * FUTURE-PROOFING
       * =========================================================================
       *
       * This keeps the configuration explicit and avoids relying on
       * undocumented defaults for application architecture.
       * =========================================================================
       */

      appType: "spa",
    };
  },
);