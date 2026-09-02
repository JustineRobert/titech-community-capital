'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/index.js
 *
 * Purpose:
 *   Enterprise-grade application bootstrap composition root.
 *
 * Responsibilities:
 *   - Establish the canonical startup sequence.
 *   - Load and validate environment configuration first.
 *   - Initialize application configuration.
 *   - Register subsystem lifecycle hooks.
 *   - Execute deterministic startup.
 *   - Install process signal handling.
 *   - Expose a controlled shutdown path.
 *   - Prevent duplicate bootstrap execution.
 *   - Prevent duplicate process handlers.
 *   - Provide bootstrap diagnostics.
 *   - Keep application orchestration out of app.js.
 *
 * Canonical startup pipeline:
 *
 *   process.env
 *       ↓
 *   environment
 *       ↓
 *   configuration
 *       ↓
 *   logger
 *       ↓
 *   observability
 *       ↓
 *   resilience
 *       ↓
 *   database
 *       ↓
 *   middleware
 *       ↓
 *   routes
 *       ↓
 *   HTTP server
 *
 * Canonical shutdown pipeline:
 *
 *   HTTP server
 *       ↓
 *   queues / workers
 *       ↓
 *   Socket.IO
 *       ↓
 *   idempotency
 *       ↓
 *   Redis
 *       ↓
 *   database
 *       ↓
 *   observability / logger
 *
 * IMPORTANT:
 *   This module does NOT contain financial business logic.
 *
 *   It is the composition root only.
 *
 * =============================================================================
 */

const path = require('node:path');

/**
 * -----------------------------------------------------------------------------
 * Bootstrap Dependencies
 * -----------------------------------------------------------------------------
 *
 * These modules should remain lightweight.
 *
 * environment.js:
 *   Reads process.env, loads .env files, normalizes values, validates runtime
 *   environment and exposes immutable environment configuration.
 *
 * config/index.js:
 *   Converts the environment layer into application-level configuration.
 *
 * hooks.js:
 *   Owns lifecycle registration and execution.
 */

const environment = require('./environment');
const config = require('../config');
const {
  hooks,
  initialize: initializeHooks,
  start: startHooks,
  stop: stopHooks,
  startup,
  lifecycle,
  installSignalHandlers,
  installProcessErrorHandlers,
  snapshot: getHookSnapshot,
  getState: getHookState,
} = require('./hooks');

/**
 * -----------------------------------------------------------------------------
 * Optional Bootstrap Integrations
 * -----------------------------------------------------------------------------
 *
 * The bootstrap root supports integration modules without requiring every
 * subsystem to be hard-coded here.
 *
 * Each module may expose one of:
 *
 *   registerBootstrapHooks(context)
 *   registerHooks(context)
 *   bootstrap(context)
 *
 * A module must not execute irreversible startup merely because it is imported.
 * Registration and execution remain controlled by hooks.js.
 *
 * ----------------------------------------------------------------------------- */

const OPTIONAL_MODULES = Object.freeze({
  logger: [
    '../logger',
    '../logging',
    '../observability/logger',
  ],

  observability: [
    '../observability',
  ],

  resilience: [
    '../middleware/resilience',
    '../resilience',
  ],

  database: [
    '../database',
    '../db',
  ],

  redis: [
    '../redis',
    '../infrastructure/redis',
  ],

  queue: [
    '../queue',
    '../queues',
    '../infrastructure/queue',
  ],

  middleware: [
    '../bootstrap/middleware',
    './middleware',
  ],

  routes: [
    '../routes',
  ],

  server: [
    '../server',
    '../http/server',
  ],
});

/**
 * -----------------------------------------------------------------------------
 * State
 * -----------------------------------------------------------------------------
 */

const BOOTSTRAP_STATES = Object.freeze({
  CREATED: 'created',
  REGISTERING: 'registering',
  INITIALIZING: 'initializing',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
});

let state = BOOTSTRAP_STATES.CREATED;

let bootstrapPromise = null;

let shutdownPromise = null;

let registrationComplete = false;

let processHandlersInstalled = false;

let bootstrapStartedAt = null;

let bootstrapStoppedAt = null;

let bootstrapFailure = null;

/**
 * Runtime resources shared with lifecycle hooks.
 *
 * This object is intentionally mutable internally but is never exposed
 * directly. Hook consumers receive the same application context.
 */
let context = null;

/**
 * -----------------------------------------------------------------------------
 * Error Types
 * -----------------------------------------------------------------------------
 */

class BootstrapError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'BootstrapError';

    this.code =
      options.code ||
      'BOOTSTRAP_ERROR';

    this.phase =
      options.phase ||
      null;

    this.cause =
      options.cause ||
      null;

    this.details = Object.freeze({
      ...(options.details || {}),
    });

    Error.captureStackTrace?.(
      this,
      BootstrapError,
    );
  }
}

/**
 * -----------------------------------------------------------------------------
 * Safe Module Loading
 * -----------------------------------------------------------------------------
 *
 * We support controlled optional integrations without hiding runtime errors.
 *
 * IMPORTANT:
 *   "Module does not exist" may be treated as optional.
 *
 *   Once the module exists but itself throws while loading, the error is
 *   propagated. This prevents serious configuration/import errors from being
 *   silently swallowed.
 */

function moduleExists(modulePath) {
  try {
    require.resolve(modulePath);
    return true;
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      return false;
    }

    throw error;
  }
}

function loadFirstAvailable(paths, category) {
  for (const modulePath of paths) {
    if (!moduleExists(modulePath)) {
      continue;
    }

    try {
      return {
        modulePath,
        module: require(modulePath),
      };
    } catch (error) {
      throw new BootstrapError(
        `Failed to load bootstrap integration "${category}".`,
        {
          code:
            'BOOTSTRAP_MODULE_LOAD_FAILED',

          cause: error,

          phase:
            BOOTSTRAP_STATES.REGISTERING,

          details: {
            category,
            modulePath,
          },
        },
      );
    }
  }

  return null;
}

/**
 * -----------------------------------------------------------------------------
 * Context Creation
 * -----------------------------------------------------------------------------
 */

function createContext() {
  const safeEnvironment =
    environment;

  return {
    environment: safeEnvironment,

    config,

    hooks,

    app: null,

    server: null,

    logger: null,

    observability: null,

    resilience: null,

    database: null,

    redis: null,

    queue: null,

    io: null,

    metadata: {
      service:
        config?.app?.serviceName ||
        config?.service?.name ||
        environment?.app?.serviceName ||
        'acfos-backend',

      version:
        config?.app?.version ||
        environment?.app?.version ||
        '0.0.0',

      environment:
        environment?.runtime?.nodeEnv ||
        environment?.app?.nodeEnv ||
        process.env.NODE_ENV ||
        'development',

      rootDirectory:
        path.resolve(__dirname, '..', '..'),
    },
  };
}

/**
 * -----------------------------------------------------------------------------
 * Integration Registration
 * -----------------------------------------------------------------------------
 */

/**
 * Invoke a standard hook-registration API if present.
 */
function registerModuleHooks(
  loaded,
  registrationContext,
  category,
) {
  if (!loaded) {
    return false;
  }

  const exported = loaded.module;

  const candidates = [
    exported?.registerBootstrapHooks,
    exported?.registerHooks,
    exported?.default?.registerBootstrapHooks,
    exported?.default?.registerHooks,
  ].filter(
    (handler) =>
      typeof handler === 'function',
  );

  if (candidates.length === 0) {
    return false;
  }

  const registerHandler =
    candidates[0];

  registerHandler(
    registrationContext,
  );

  return true;
}

/**
 * Register the canonical lifecycle boundaries for the application.
 *
 * This function deliberately prefers subsystem-owned hook registration.
 * Bootstrap index.js defines ordering; individual subsystems define their own
 * implementation details.
 */
function registerSubsystemHooks() {
  if (registrationComplete) {
    return;
  }

  state =
    BOOTSTRAP_STATES.REGISTERING;

  if (!context) {
    context =
      createContext();
  }

  const registrationContext =
    Object.freeze({
      ...context,
    });

  /**
   * ---------------------------------------------------------------------------
   * Logger
   * ---------------------------------------------------------------------------
   */

  const loggerModule =
    loadFirstAvailable(
      OPTIONAL_MODULES.logger,
      'logger',
    );

  if (loggerModule) {
    const registered =
      registerModuleHooks(
        loggerModule,
        registrationContext,
        'logger',
      );

    if (!registered) {
      const logger =
        loggerModule.module?.logger ||
        loggerModule.module?.default;

      if (logger) {
        context.logger =
          logger;
      }
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Observability
   * ---------------------------------------------------------------------------
   */

  const observabilityModule =
    loadFirstAvailable(
      OPTIONAL_MODULES.observability,
      'observability',
    );

  if (observabilityModule) {
    registerModuleHooks(
      observabilityModule,
      registrationContext,
      'observability',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Resilience
   * ---------------------------------------------------------------------------
   */

  const resilienceModule =
    loadFirstAvailable(
      OPTIONAL_MODULES.resilience,
      'resilience',
    );

  if (resilienceModule) {
    registerModuleHooks(
      resilienceModule,
      registrationContext,
      'resilience',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Database
   * ---------------------------------------------------------------------------
   */

  const databaseModule =
    loadFirstAvailable(
      OPTIONAL_MODULES.database,
      'database',
    );

  if (databaseModule) {
    registerModuleHooks(
      databaseModule,
      registrationContext,
      'database',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Redis
   * ---------------------------------------------------------------------------
   */

  const redisModule =
    loadFirstAvailable(
      OPTIONAL_MODULES.redis,
      'redis',
    );

  if (redisModule) {
    registerModuleHooks(
      redisModule,
      registrationContext,
      'redis',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Queue
   * ---------------------------------------------------------------------------
   */

  const queueModule =
    loadFirstAvailable(
      OPTIONAL_MODULES.queue,
      'queue',
    );

  if (queueModule) {
    registerModuleHooks(
      queueModule,
      registrationContext,
      'queue',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Middleware
   * ---------------------------------------------------------------------------
   */

  const middlewareModule =
    loadFirstAvailable(
      OPTIONAL_MODULES.middleware,
      'middleware',
    );

  if (middlewareModule) {
    registerModuleHooks(
      middlewareModule,
      registrationContext,
      'middleware',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Routes
   * ---------------------------------------------------------------------------
   */

  const routesModule =
    loadFirstAvailable(
      OPTIONAL_MODULES.routes,
      'routes',
    );

  if (routesModule) {
    registerModuleHooks(
      routesModule,
      registrationContext,
      'routes',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * HTTP Server
   * ---------------------------------------------------------------------------
   */

  const serverModule =
    loadFirstAvailable(
      OPTIONAL_MODULES.server,
      'server',
    );

  if (serverModule) {
    registerModuleHooks(
      serverModule,
      registrationContext,
      'server',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Canonical Safety Hooks
   * ---------------------------------------------------------------------------
   *
   * These hooks intentionally exist at the composition-root level.
   *
   * They provide lifecycle boundaries even when a subsystem module has not
   * yet been migrated to its own registerHooks() implementation.
   *
   * Do NOT perform actual infrastructure initialization here.
   */

  if (
    !hooks.has('bootstrap-context')
  ) {
    startup(
      'bootstrap-context',
      async ({
        metadata,
      }) => {
        /**
         * The bootstrap context itself is already available.
         *
         * This hook exists as the dependency anchor for foundational
         * components which need an explicit root lifecycle dependency.
         */
        context.metadata =
          {
            ...context.metadata,
            ...metadata,
          };
      },
      {
        priority: -1_000,

        critical: true,
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Deterministic Fallback Boundaries
   * ---------------------------------------------------------------------------
   *
   * These hooks are intentionally conditional.
   *
   * They don't initialize resources themselves. Their presence allows migrated
   * subsystems to depend on canonical lifecycle names without creating
   * duplicate registrations.
   */

  ensureDependencyAnchor(
    'environment',
    ['bootstrap-context'],
    -900,
  );

  ensureDependencyAnchor(
    'configuration',
    ['environment'],
    -800,
  );

  ensureDependencyAnchor(
    'logger',
    ['configuration'],
    -700,
  );

  ensureDependencyAnchor(
    'observability',
    ['logger'],
    -600,
  );

  ensureDependencyAnchor(
    'resilience',
    ['observability'],
    -500,
  );

  ensureDependencyAnchor(
    'database',
    ['resilience'],
    -400,
  );

  ensureDependencyAnchor(
    'redis',
    ['database'],
    -300,
  );

  ensureDependencyAnchor(
    'middleware',
    ['database'],
    0,
  );

  ensureDependencyAnchor(
    'routes',
    ['middleware'],
    100,
  );

  ensureDependencyAnchor(
    'http-server',
    ['routes'],
    1_000,
  );

  registrationComplete = true;
}

/**
 * -----------------------------------------------------------------------------
 * Dependency Anchor
 * -----------------------------------------------------------------------------
 *
 * This provides stable names for cross-module dependencies while allowing
 * actual implementations to register richer lifecycle hooks separately.
 */
function ensureDependencyAnchor(
  name,
  dependencies,
  priority,
) {
  if (hooks.has(name)) {
    return;
  }

  startup(
    name,
    async () => undefined,
    {
      priority,

      dependencies,

      critical: true,
    },
  );
}

/**
 * -----------------------------------------------------------------------------
 * Process Lifecycle Handlers
 * -----------------------------------------------------------------------------
 */

function installProcessLifecycleHandlers() {
  if (processHandlersInstalled) {
    return;
  }

  installSignalHandlers({
    signals: [
      'SIGTERM',
      'SIGINT',
      'SIGQUIT',
    ],

    context: {
      service:
        context?.metadata?.service,
    },

    exit: true,

    onShutdown: async (
      signal,
    ) => {
      context.shutdownReason =
        signal;
    },
  });

  installProcessErrorHandlers({
    shutdownOnError: true,

    onUncaughtException:
      async (error) => {
        bootstrapFailure =
          error;

        if (
          context?.logger?.fatal
        ) {
          context.logger.fatal(
            {
              err: error,
            },
            'Uncaught exception.',
          );
        } else {
          process.stderr.write(
            `[bootstrap] uncaught exception: ${error?.stack || error}\n`,
          );
        }
      },

    onUnhandledRejection:
      async (error) => {
        bootstrapFailure =
          error;

        if (
          context?.logger?.fatal
        ) {
          context.logger.fatal(
            {
              err: error,
            },
            'Unhandled promise rejection.',
          );
        } else {
          process.stderr.write(
            `[bootstrap] unhandled rejection: ${error?.stack || error}\n`,
          );
        }
      },
  });

  processHandlersInstalled = true;
}

/**
 * -----------------------------------------------------------------------------
 * Startup
 * -----------------------------------------------------------------------------
 */

async function bootstrap() {
  /**
   * Return the same in-flight promise.
   *
   * This is critical when multiple entry points accidentally call bootstrap()
   * during application startup.
   */
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise =
    (async () => {
      if (
        state ===
        BOOTSTRAP_STATES.RUNNING
      ) {
        return context;
      }

      if (
        state ===
        BOOTSTRAP_STATES.STOPPING
      ) {
        throw new BootstrapError(
          'Application is currently shutting down.',
          {
            code:
              'BOOTSTRAP_SHUTDOWN_IN_PROGRESS',
          },
        );
      }

      if (
        state ===
        BOOTSTRAP_STATES.STOPPED
      ) {
        throw new BootstrapError(
          'Application bootstrap has already been stopped.',
          {
            code:
              'BOOTSTRAP_ALREADY_STOPPED',
          },
        );
      }

      try {
        bootstrapStartedAt =
          new Date();

        /**
         * ---------------------------------------------------------------------
         * Phase 1 — Environment
         * ---------------------------------------------------------------------
         *
         * environment.js has already loaded and validated process.env at
         * module initialization.
         *
         * Accessing it here makes the dependency explicit in the composition
         * root.
         */
        if (!environment) {
          throw new BootstrapError(
            'Environment bootstrap is unavailable.',
            {
              code:
                'BOOTSTRAP_ENVIRONMENT_UNAVAILABLE',
            },
          );
        }

        /**
         * ---------------------------------------------------------------------
         * Phase 2 — Configuration
         * ---------------------------------------------------------------------
         *
         * Requiring config after environment guarantees the environment layer
         * is ready before application configuration is resolved.
         */
        if (!config) {
          throw new BootstrapError(
            'Application configuration is unavailable.',
            {
              code:
                'BOOTSTRAP_CONFIG_UNAVAILABLE',
            },
          );
        }

        /**
         * ---------------------------------------------------------------------
         * Phase 3 — Context
         * ---------------------------------------------------------------------
         */

        context =
          createContext();

        /**
         * ---------------------------------------------------------------------
         * Phase 4 — Register Hooks
         * ---------------------------------------------------------------------
         */

        registerSubsystemHooks();

        /**
         * ---------------------------------------------------------------------
         * Phase 5 — Install Process Lifecycle
         * ---------------------------------------------------------------------
         */

        installProcessLifecycleHandlers();

        /**
         * ---------------------------------------------------------------------
         * Phase 6 — Initialize
         * ---------------------------------------------------------------------
         */

        state =
          BOOTSTRAP_STATES.INITIALIZING;

        await initializeHooks(
          context,
        );

        /**
         * ---------------------------------------------------------------------
         * Phase 7 — Start
         * ---------------------------------------------------------------------
         */

        state =
          BOOTSTRAP_STATES.STARTING;

        await startHooks(
          context,
        );

        /**
         * ---------------------------------------------------------------------
         * Phase 8 — Running
         * ---------------------------------------------------------------------
         */

        state =
          BOOTSTRAP_STATES.RUNNING;

        return context;
      } catch (error) {
        bootstrapFailure =
          error;

        state =
          BOOTSTRAP_STATES.FAILED;

        throw new BootstrapError(
          'Application bootstrap failed.',
          {
            code:
              'BOOTSTRAP_START_FAILED',

            phase: state,

            cause: error,

            details: {
              hookState:
                getHookState(),

              hookSnapshot:
                getHookSnapshot(),
            },
          },
        );
      }
    })();

  try {
    return await bootstrapPromise;
  } finally {
    /**
     * Keep bootstrapPromise after successful startup.
     *
     * This guarantees subsequent callers receive the same initialized
     * application context instead of executing startup again.
     *
     * On failure it is cleared so a test harness or controlled supervisor may
     * make another attempt after correcting the root cause.
     */
    if (
      state !==
      BOOTSTRAP_STATES.RUNNING
    ) {
      bootstrapPromise =
        null;
    }
  }
}

/**
 * -----------------------------------------------------------------------------
 * Shutdown
 * -----------------------------------------------------------------------------
 */

async function shutdown(
  reason = 'application-request',
) {
  if (
    shutdownPromise
  ) {
    return shutdownPromise;
  }

  shutdownPromise =
    (async () => {
      if (
        state ===
        BOOTSTRAP_STATES.STOPPED
      ) {
        return;
      }

      if (
        state ===
        BOOTSTRAP_STATES.CREATED
      ) {
        state =
          BOOTSTRAP_STATES.STOPPED;

        bootstrapStoppedAt =
          new Date();

        return;
      }

      state =
        BOOTSTRAP_STATES.STOPPING;

      try {
        if (context) {
          context.shutdownReason =
            reason;
        }

        await stopHooks({
          ...(context || {}),
          reason,
        });

        state =
          BOOTSTRAP_STATES.STOPPED;

        bootstrapStoppedAt =
          new Date();
      } catch (error) {
        state =
          BOOTSTRAP_STATES.FAILED;

        bootstrapFailure =
          error;

        throw new BootstrapError(
          'Application shutdown failed.',
          {
            code:
              'BOOTSTRAP_SHUTDOWN_FAILED',

            cause: error,

            phase:
              BOOTSTRAP_STATES.STOPPING,

            details: {
              reason,
              hookState:
                getHookState(),
              hookSnapshot:
                getHookSnapshot(),
            },
          },
        );
      }
    })();

  return shutdownPromise;
}

/**
 * -----------------------------------------------------------------------------
 * Health / Readiness
 * -----------------------------------------------------------------------------
 */

function isReady() {
  return (
    state ===
    BOOTSTRAP_STATES.RUNNING
  );
}

function isShuttingDown() {
  return (
    state ===
      BOOTSTRAP_STATES.STOPPING ||
    state ===
      BOOTSTRAP_STATES.STOPPED
  );
}

function isFailed() {
  return (
    state ===
    BOOTSTRAP_STATES.FAILED
  );
}

/**
 * -----------------------------------------------------------------------------
 * Diagnostics
 * -----------------------------------------------------------------------------
 */

function snapshot() {
  return Object.freeze({
    state,

    ready:
      isReady(),

    shuttingDown:
      isShuttingDown(),

    failed:
      isFailed(),

    bootstrapStartedAt,

    bootstrapStoppedAt,

    failure:
      bootstrapFailure
        ? Object.freeze({
            name:
              bootstrapFailure.name,

            code:
              bootstrapFailure.code,

            message:
              bootstrapFailure.message,
          })
        : null,

    process: Object.freeze({
      pid:
        process.pid,

      nodeVersion:
        process.version,

      platform:
        process.platform,

      arch:
        process.arch,
    }),

    application: Object.freeze({
      name:
        environment?.app?.name ||
        null,

      serviceName:
        environment?.app?.serviceName ||
        null,

      version:
        environment?.app?.version ||
        null,

      environment:
        environment?.runtime?.nodeEnv ||
        null,
    }),

    hooks:
      getHookSnapshot(),
  });
}

/**
 * -----------------------------------------------------------------------------
 * Public Registration Helpers
 * -----------------------------------------------------------------------------
 *
 * These helpers allow entry points/tests to register custom bootstrap hooks
 * before calling bootstrap().
 */

function registerHook(options) {
  if (
    state !==
      BOOTSTRAP_STATES.CREATED &&
    state !==
      BOOTSTRAP_STATES.REGISTERING
  ) {
    throw new BootstrapError(
      'Hooks can only be registered before application startup.',
      {
        code:
          'BOOTSTRAP_REGISTRATION_LOCKED',
      },
    );
  }

  if (
    registrationComplete
  ) {
    throw new BootstrapError(
      'Bootstrap hook registration has already been finalized.',
      {
        code:
          'BOOTSTRAP_REGISTRATION_COMPLETE',
      },
    );
  }

  return hooks.register(
    options,
  );
}

/**
 ------------------------------------------------------------------------------
 * Context Access
 * -----------------------------------------------------------------------------
 */

function getContext() {
  return context;
}

function getEnvironment() {
  return environment;
}

function getConfig() {
  return config;
}

/**
 * -----------------------------------------------------------------------------
 * Explicit Initialization API
 * -----------------------------------------------------------------------------
 *
 * Useful for:
 *   - integration tests
 *   - workers
 *   - CLI processes
 *   - migration processes
 *   - alternative HTTP entry points
 */

async function initialize(options = {}) {
  if (
    state ===
    BOOTSTRAP_STATES.RUNNING
  ) {
    return context;
  }

  if (
    options.registerHooks !== false
  ) {
    registerSubsystemHooks();
  }

  if (
    options.installProcessHandlers !==
    false
  ) {
    installProcessLifecycleHandlers();
  }

  context =
    context ||
    createContext();

  state =
    BOOTSTRAP_STATES.INITIALIZING;

  try {
    await initializeHooks(
      context,
    );

    state =
      BOOTSTRAP_STATES.RUNNING;

    return context;
  } catch (error) {
    state =
      BOOTSTRAP_STATES.FAILED;

    bootstrapFailure =
      error;

    throw error;
  }
}

/**
 * -----------------------------------------------------------------------------
 * Exports
 * -----------------------------------------------------------------------------
 */

module.exports = Object.freeze({
  /**
   * Core lifecycle.
   */
  bootstrap,
  start: bootstrap,
  shutdown,

  /**
   * Initialization.
   */
  initialize,

  /**
   * Hook registration.
   */
  registerHook,

  /**
   * Context.
   */
  getContext,
  getEnvironment,
  getConfig,

  /**
   * Health/state.
   */
  isReady,
  isShuttingDown,
  isFailed,

  /**
   * Diagnostics.
   */
  snapshot,

  /**
   * State constants.
   */
  BOOTSTRAP_STATES,

  /**
   * Errors.
   */
  BootstrapError,
});