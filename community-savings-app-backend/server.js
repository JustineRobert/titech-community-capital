'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/server.js
 *
 * Purpose:
 *   Enterprise backend process entry point.
 *
 * Architectural Role:
 *   `server.js` is intentionally thin.
 *
 *   It is responsible ONLY for:
 *
 *     1. Loading process environment.
 *     2. Validating the Node.js runtime.
 *     3. Installing process-level fatal-error protection.
 *     4. Loading the canonical TITech bootstrap orchestrator.
 *     5. Starting the application.
 *     6. Providing safe diagnostic helpers.
 *
 * Canonical Startup:
 *
 *   server.js
 *       │
 *       ▼
 *   bootstrap/app.js
 *       │
 *       ▼
 *   BootstrapContext
 *       │
 *       ├── environment
 *       ├── configuration
 *       ├── logger
 *       ├── observability
 *       ├── readiness
 *       ├── resilience
 *       ├── infrastructure
 *       ├── services
 *       ├── middleware
 *       ├── routes
 *       ├── server
 *       └── runtime
 *              │
 *              ▼
 *           READY
 *
 * IMPORTANT:
 *
 * This file MUST NOT:
 *
 *   - create an Express application;
 *   - register Express middleware;
 *   - register routes;
 *   - connect directly to MongoDB;
 *   - connect directly to Redis;
 *   - initialize queues;
 *   - initialize Socket.IO;
 *   - initialize business services;
 *   - execute bootstrap phases itself;
 *   - duplicate lifecycle hooks;
 *   - duplicate shutdown orchestration;
 *   - maintain an independent bootstrap state machine.
 *
 * Those responsibilities belong to:
 *
 *   backend/bootstrap/
 *
 * Specifically:
 *
 *   backend/bootstrap/app.js
 *   backend/bootstrap/context/
 *   backend/bootstrap/lifecycle/
 *   backend/bootstrap/hooks.js
 *
 * Runtime:
 *   Node.js 20+
 *
 * Module System:
 *   CommonJS
 *
 * =============================================================================
 */

const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const dotenv = require('dotenv');

/**
 * =============================================================================
 * Environment Loading
 * =============================================================================
 *
 * Environment loading happens before the bootstrap composition root is loaded
 * so configuration can consume process.env deterministically.
 *
 * This does NOT constitute application bootstrap.
 */

const ENV_FILE = path.resolve(
  process.cwd(),
  '.env',
);

const dotenvResult = dotenv.config({
  path: ENV_FILE,
});

/**
 * dotenv intentionally does not fail the process when `.env` is absent.
 *
 * Production environments may provide environment variables through:
 *
 *   - container runtime;
 *   - Kubernetes;
 *   - CI/CD;
 *   - cloud secret managers;
 *   - process supervisors;
 *   - infrastructure configuration.
 *
 * The bootstrap configuration layer remains responsible for validating
 * required application configuration.
 */

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const MIN_NODE_MAJOR = 20;

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  'titech-community-capital-backend';

const NODE_ENV =
  process.env.NODE_ENV ||
  'development';

const FATAL_EXIT_CODE = 1;

const PROCESS_SIGNALS = Object.freeze([
  'SIGTERM',
  'SIGINT',
]);

/**
 * =============================================================================
 * Runtime State
 * =============================================================================
 *
 * These variables intentionally represent only process-entry concerns.
 *
 * Application lifecycle state belongs to BootstrapContext.
 */

let bootstrapModule = null;

let logger = console;

let processHandlersInstalled = false;

let fatalHandlingStarted = false;

/**
 * =============================================================================
 * Sensitive Metadata Protection
 * =============================================================================
 *
 * Never expose credentials or connection material through process-entry
 * diagnostics.
 */

const SENSITIVE_KEY_PATTERN =
  /password|passwd|passcode|pin|otp|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|client[-_]?secret|jwt|mongo(uri)?|mongodb|redis|database|connection|string/i;

/**
 * =============================================================================
 * Safe Metadata Sanitization
 * =============================================================================
 */

function sanitizeMetadata(metadata) {
  if (
    !metadata ||
    typeof metadata !== 'object'
  ) {
    return {};
  }

  const output = {};

  for (
    const [key, value] of Object.entries(
      metadata,
    )
  ) {
    if (
      SENSITIVE_KEY_PATTERN.test(
        String(key),
      )
    ) {
      continue;
    }

    if (
      value instanceof Error
    ) {
      output[key] = {
        name:
          value.name,

        message:
          value.message,

        code:
          value.code,
      };

      continue;
    }

    if (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      output[key] = value;
      continue;
    }

    try {
      output[key] = JSON.parse(
        JSON.stringify(value),
      );
    } catch {
      output[key] =
        '[unserializable]';
    }
  }

  return output;
}

/**
 * =============================================================================
 * Safe Logging
 * =============================================================================
 *
 * Logging must never become the reason that the process cannot report a
 * startup/shutdown failure.
 */

function logInfo(
  message,
  metadata = {},
) {
  const safeMetadata =
    sanitizeMetadata(metadata);

  try {
    if (
      logger &&
      typeof logger.info === 'function'
    ) {
      logger.info(
        message,
        safeMetadata,
      );

      return;
    }
  } catch {
    // Fall through to console.
  }

  try {
    console.info(
      message,
      safeMetadata,
    );
  } catch {
    // Logging must never crash the process.
  }
}

function logWarn(
  message,
  metadata = {},
) {
  const safeMetadata =
    sanitizeMetadata(metadata);

  try {
    if (
      logger &&
      typeof logger.warn === 'function'
    ) {
      logger.warn(
        message,
        safeMetadata,
      );

      return;
    }
  } catch {
    // Fall through to console.
  }

  try {
    console.warn(
      message,
      safeMetadata,
    );
  } catch {
    // Logging must never crash the process.
  }
}

function logError(
  message,
  metadata = {},
) {
  const safeMetadata =
    sanitizeMetadata(metadata);

  try {
    if (
      logger &&
      typeof logger.error === 'function'
    ) {
      logger.error(
        message,
        safeMetadata,
      );

      return;
    }
  } catch {
    // Fall through to console.
  }

  try {
    console.error(
      message,
      safeMetadata,
    );
  } catch {
    // Logging must never crash the process.
  }
}

/**
 * =============================================================================
 * Runtime Validation
 * =============================================================================
 *
 * This validates only process/runtime prerequisites.
 *
 * Application configuration is deliberately NOT validated here.
 * That belongs to the canonical bootstrap configuration phase.
 */

function validateRuntime() {
  const nodeVersion =
    process.versions?.node ||
    process.version;

  const nodeMajor =
    Number(
      nodeVersion.split('.')[0],
    );

  if (
    !Number.isInteger(nodeMajor) ||
    nodeMajor < MIN_NODE_MAJOR
  ) {
    throw new Error(
      `TITech requires Node.js ${MIN_NODE_MAJOR}+. Current runtime: ${process.version}`,
    );
  }

  const requiredFeatures =
    Object.freeze({
      randomUUID:
        typeof crypto.randomUUID ===
        'function',

      structuredClone:
        typeof global.structuredClone ===
        'function',

      fetch:
        typeof global.fetch ===
        'function',

      AbortController:
        typeof global.AbortController ===
        'function',

      URL:
        typeof global.URL ===
        'function',

      setTimeout:
        typeof global.setTimeout ===
        'function',
    });

  const missingFeatures =
    Object.entries(
      requiredFeatures,
    )
      .filter(
        ([, available]) =>
          !available,
      )
      .map(
        ([name]) => name,
      );

  if (
    missingFeatures.length > 0
  ) {
    throw new Error(
      `Required TITech runtime features are unavailable: ${missingFeatures.join(
        ', ',
      )}`,
    );
  }

  const supportedPlatforms =
    new Set([
      'win32',
      'linux',
      'darwin',
    ]);

  if (
    !supportedPlatforms.has(
      process.platform,
    )
  ) {
    throw new Error(
      `Unsupported platform: ${process.platform}`,
    );
  }

  const supportedArchitectures =
    new Set([
      'x64',
      'arm64',
    ]);

  if (
    !supportedArchitectures.has(
      process.arch,
    )
  ) {
    throw new Error(
      `Unsupported architecture: ${process.arch}`,
    );
  }

  return Object.freeze({
    nodeVersion,

    nodeMajor,

    platform:
      process.platform,

    architecture:
      process.arch,

    hostname:
      os.hostname(),

    cpuCount:
      os.cpus()?.length || 1,

    pid:
      process.pid,
  });
}

/**
 * =============================================================================
 * Canonical Bootstrap Module Loader
 * =============================================================================
 *
 * NEVER load backend/app.js here.
 *
 * backend/app.js is the Express application factory.
 *
 * backend/bootstrap/app.js is the canonical lifecycle composition root.
 */

function loadBootstrapModule() {
  if (bootstrapModule) {
    return bootstrapModule;
  }

  const loaded =
    require('./bootstrap/app');

  if (
    !loaded ||
    typeof loaded !== 'object'
  ) {
    throw new TypeError(
      'TITech bootstrap/app.js did not export the expected bootstrap object.',
    );
  }

  if (
    typeof loaded.startApplication !==
    'function'
  ) {
    throw new TypeError(
      'TITech bootstrap/app.js does not expose startApplication().',
    );
  }

  if (
    typeof loaded.shutdownApplication !==
    'function'
  ) {
    logWarn(
      'TITech bootstrap/app.js does not expose shutdownApplication().',
    );
  }

  bootstrapModule =
    loaded;

  /**
   * Prefer the canonical bootstrap logger when one is available.
   */
  if (
    loaded.logger &&
    typeof loaded.logger === 'object'
  ) {
    logger =
      loaded.logger;
  }

  return bootstrapModule;
}

/**
 * =============================================================================
 * Fatal Process Error Handling
 * =============================================================================
 *
 * Uncaught exceptions and unhandled rejections are process-level failures.
 *
 * The application receives one final opportunity to perform graceful
 * shutdown, after which the process exits non-zero.
 */

async function handleFatalProcessError(
  type,
  reason,
) {
  if (fatalHandlingStarted) {
    return;
  }

  fatalHandlingStarted =
    true;

  const error =
    reason instanceof Error
      ? reason
      : new Error(
          String(reason),
        );

  logError(
    `TITech ${type} detected.`,
    {
      name:
        error.name,

      message:
        error.message,

      code:
        error.code,

      stack:
        NODE_ENV !== 'production'
          ? error.stack
          : undefined,
    },
  );

  try {
    const bootstrap =
      loadBootstrapModule();

    if (
      typeof bootstrap.shutdownApplication ===
      'function'
    ) {
      await bootstrap.shutdownApplication({
        reason: type,

        exit: false,

        exitCode:
          FATAL_EXIT_CODE,
      });
    }
  } catch (
    shutdownError
  ) {
    logError(
      'TITech fatal-error shutdown failed.',
      {
        name:
          shutdownError?.name,

        message:
          shutdownError?.message,

        code:
          shutdownError?.code,
      },
    );
  }

  process.exitCode =
    FATAL_EXIT_CODE;

  /**
   * Fatal process errors must terminate the process.
   *
   * This prevents the backend from remaining alive in an unknown or partially
   * corrupted state.
   */
  process.exit(
    FATAL_EXIT_CODE,
  );
}

/**
 * =============================================================================
 * Process Handler Installation
 * =============================================================================
 *
 * Process-level fatal handlers are intentionally owned here.
 *
 * SIGTERM/SIGINT are deliberately delegated to bootstrap/app.js so there is
 * exactly one application shutdown controller.
 */

function installProcessHandlers() {
  if (processHandlersInstalled) {
    return false;
  }

  processHandlersInstalled =
    true;

  process.once(
    'uncaughtException',
    (error) => {
      void handleFatalProcessError(
        'uncaught exception',
        error,
      );
    },
  );

  process.once(
    'unhandledRejection',
    (reason) => {
      void handleFatalProcessError(
        'unhandled promise rejection',
        reason,
      );
    },
  );

  return true;
}

/**
 * =============================================================================
 * Start Application
 * =============================================================================
 *
 * This is the only normal startup entry point exposed by server.js.
 *
 * All application lifecycle phases are delegated to bootstrap/app.js.
 */

async function startServer() {
  const runtime =
    validateRuntime();

  logInfo(
    'Starting TITech Community Capital backend process.',
    {
      serviceName:
        SERVICE_NAME,

      environment:
        NODE_ENV,

      nodeVersion:
        runtime.nodeVersion,

      nodeMajor:
        runtime.nodeMajor,

      platform:
        runtime.platform,

      architecture:
        runtime.architecture,

      hostname:
        runtime.hostname,

      pid:
        runtime.pid,

      envFileLoaded:
        Boolean(
          dotenvResult &&
          !dotenvResult.error,
        ),
    },
  );

  const bootstrap =
    loadBootstrapModule();

  /**
   * Canonical application lifecycle.
   *
   * bootstrap/app.js is responsible for coordinating:
   *
   *   environment
   *   configuration
   *   logger
   *   observability
   *   readiness
   *   resilience
   *   infrastructure
   *   services
   *   middleware
   *   routes
   *   server
   *   runtime
   *
   * The resulting BootstrapContext is expected to report READY only after all
   * mandatory phases have completed successfully.
   */
  const result =
    await bootstrap.startApplication();

  logInfo(
    'TITech Community Capital backend startup completed.',
    {
      serviceName:
        SERVICE_NAME,

      environment:
        NODE_ENV,

      pid:
        process.pid,
    },
  );

  return result;
}

/**
 * =============================================================================
 * Operational State
 * =============================================================================
 *
 * Diagnostic helper only.
 *
 * It never creates or initializes application state.
 */

function getServerState() {
  try {
    const bootstrap =
      loadBootstrapModule();

    if (
      typeof bootstrap.getRuntimeState ===
      'function'
    ) {
      return bootstrap.getRuntimeState();
    }

    if (
      typeof bootstrap.getHealthState ===
      'function'
    ) {
      return bootstrap.getHealthState();
    }

    if (
      typeof bootstrap.getBootstrapContext ===
      'function'
    ) {
      const context =
        bootstrap.getBootstrapContext();

      if (
        context &&
        typeof context.snapshot ===
          'function'
      ) {
        return context.snapshot();
      }
    }
  } catch {
    /**
     * Diagnostics must never become another source of process failure.
     */
  }

  return Object.freeze({
    serviceName:
      SERVICE_NAME,

    environment:
      NODE_ENV,

    running:
      false,
  });
}

/**
 * =============================================================================
 * Process Initialization
 * =============================================================================
 *
 * Install only process-fatal handlers.
 *
 * Application lifecycle signal handlers remain owned by bootstrap/app.js.
 */

installProcessHandlers();

/**
 * =============================================================================
 * Direct Process Execution
 * =============================================================================
 *
 * When imported by tests, no application startup occurs.
 *
 * When executed directly:
 *
 *   node backend/server.js
 *
 * the canonical bootstrap composition root is started.
 */

if (
  require.main === module
) {
  startServer().catch(
    (error) => {
      logError(
        'TITech Community Capital backend startup failed.',
        {
          name:
            error?.name,

          message:
            error?.message,

          code:
            error?.code,

          stack:
            NODE_ENV !== 'production'
              ? error?.stack
              : undefined,
        },
      );

      process.exit(
        FATAL_EXIT_CODE,
      );
    },
  );
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 *
 * Keep the public surface deliberately small.
 *
 * No internal bootstrap implementation is exported from this process entry
 * point.
 */

module.exports =
  Object.freeze({
    startServer,

    validateRuntime,

    getServerState,

    installProcessHandlers,
  });