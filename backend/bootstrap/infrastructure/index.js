"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Infrastructure Bootstrap Composition Root
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/infrastructure/index.js
 *
 * Purpose:
 *   Canonical infrastructure bootstrap entry point for the TITech Community
 *   Capital backend runtime.
 *
 * Production-grade responsibilities
 * =============================================================================
 *
 * ✓ Provides ONE canonical infrastructure initializer
 * ✓ Exports the initializer directly for bootstrap/app.js compatibility
 * ✓ Supports optional infrastructure providers without making development
 *   startup depend on unavailable optional components
 * ✓ Preserves the canonical BootstrapContext instance
 * ✓ Never overwrites context.state
 * ✓ Never replaces BootstrapContext lifecycle authority
 * ✓ Maintains dependency injection through context.container
 * ✓ Supports database, cache, queues, storage, security, messaging and other
 *   infrastructure adapters through deterministic discovery
 * ✓ Supports CommonJS direct-function and named-module exports
 * ✓ Fails fast for explicitly required infrastructure
 * ✓ Degrades gracefully for optional infrastructure
 * ✓ Provides infrastructure health/status metadata
 * ✓ Prevents duplicate initialization
 * ✓ Provides idempotent shutdown
 * ✓ Preserves original infrastructure errors and causes
 * ✓ Uses TITech terminology consistently
 * ✓ Compatible with Node.js 20+ / CommonJS
 *
 * Architecture
 * =============================================================================
 *
 *   BootstrapContext
 *        │
 *        ▼
 *   Infrastructure Context
 *        │
 *        ├── database
 *        ├── cache
 *        ├── queue
 *        ├── storage
 *        ├── messaging
 *        ├── security
 *        ├── observability
 *        └── other adapters
 *
 * Canonical lifecycle authority
 * =============================================================================
 *
 *   BootstrapContext
 *
 * Compatibility/read-model
 * =============================================================================
 *
 *   runtime/state.js
 *
 * IMPORTANT
 * =============================================================================
 *
 * This module MUST NOT perform:
 *
 *   context.state = ...
 *
 * and MUST NOT replace the canonical BootstrapContext with another application
 * state object.
 *
 * The module exports the initializer directly:
 *
 *   module.exports = initializeInfrastructure;
 *
 * Therefore bootstrap/app.js can resolve it regardless of whether the module
 * is consumed as:
 *
 *   const initializeInfrastructure = require("./infrastructure");
 *
 * or through a named/default export resolver.
 *
 * =============================================================================
 */


/* =============================================================================
 * OPTIONAL MODULE LOADER
 * =============================================================================
 */

const path = require("node:path");
const fs = require("node:fs");


/* =============================================================================
 * RUNTIME STATE
 * =============================================================================
 */

let initialized = false;
let initializingPromise = null;
let shutdownPromise = null;

let activeContext = null;

const infrastructureRegistry = new Map();
const infrastructureStatus = new Map();


/* =============================================================================
 * SERVICE METADATA
 * =============================================================================
 */

function getConfiguration(context) {
  return (
    context?.configuration ||
    context?.config ||
    {}
  );
}

function getEnvironment(context) {
  return (
    context?.environment ||
    getConfiguration(context)?.environment ||
    process.env.NODE_ENV ||
    "development"
  );
}

function getLogger(context) {
  return (
    context?.logger ||
    console
  );
}

function getServiceName(context) {
  return (
    getConfiguration(context)?.serviceName ||
    process.env.SERVICE_NAME ||
    "titech-community-capital-backend"
  );
}

function getApplicationName(context) {
  return (
    getConfiguration(context)?.applicationName ||
    getConfiguration(context)?.application ||
    process.env.APPLICATION_NAME ||
    "TITech Community Capital"
  );
}

function getApplicationVersion(context) {
  return (
    getConfiguration(context)?.version ||
    getConfiguration(context)?.appVersion ||
    process.env.APP_VERSION ||
    "1.0.0"
  );
}

function createMetadata(
  context,
  extra = {},
) {
  return {
    component:
      "bootstrap/infrastructure",

    service:
      getServiceName(context),

    application:
      getApplicationName(context),

    version:
      getApplicationVersion(context),

    environment:
      getEnvironment(context),

    ...extra,
  };
}


/* =============================================================================
 * SAFE LOGGING
 * =============================================================================
 */

function safeLog(
  context,
  level,
  metadata,
  message,
) {
  try {
    const logger =
      getLogger(context);

    if (
      logger &&
      typeof logger[level] === "function"
    ) {
      if (message !== undefined) {
        logger[level](
          metadata,
          message,
        );
      } else {
        logger[level](
          metadata,
        );
      }

      return;
    }
  } catch {
    // Fall through to console fallback.
  }

  try {
    const fallback =
      typeof console[level] ===
      "function"
        ? console[level]
        : console.log;

    if (message !== undefined) {
      fallback(
        metadata,
        message,
      );
    } else {
      fallback(
        metadata,
      );
    }
  } catch {
    // Logging must never become infrastructure-fatal.
  }
}

function logInfo(
  context,
  metadata,
  message,
) {
  safeLog(
    context,
    "info",
    metadata,
    message,
  );
}

function logWarn(
  context,
  metadata,
  message,
) {
  safeLog(
    context,
    "warn",
    metadata,
    message,
  );
}

function logError(
  context,
  metadata,
  message,
) {
  safeLog(
    context,
    "error",
    metadata,
    message,
  );
}

function logDebug(
  context,
  metadata,
  message,
) {
  safeLog(
    context,
    "debug",
    metadata,
    message,
  );
}


/* =============================================================================
 * ERROR FACTORY
 * =============================================================================
 */

function createInfrastructureError(
  message,
  options = {},
) {
  const error =
    new Error(
      message ||
        "TITech infrastructure bootstrap failed.",
    );

  error.name =
    options.name ||
    "InfrastructureStartupError";

  error.code =
    options.code ||
    "STARTUP_INFRASTRUCTURE_FAILED";

  error.phase =
    "infrastructure";

  error.component =
    "bootstrap/infrastructure";

  error.operation =
    options.operation ||
    "initialize-infrastructure";

  error.retryable =
    options.retryable === true;

  error.critical =
    options.critical !== false;

  error.fatal =
    options.fatal !== false;

  if (options.dependency) {
    error.dependency =
      options.dependency;
  }

  if (options.cause) {
    error.cause =
      options.cause;
  }

  if (options.details) {
    error.details =
      options.details;
  }

  return error;
}


/* =============================================================================
 * VALIDATION
 * =============================================================================
 */

function assertContext(context) {
  if (
    !context ||
    typeof context !== "object"
  ) {
    throw createInfrastructureError(
      "TITech infrastructure bootstrap requires a valid BootstrapContext instance.",
      {
        operation:
          "validate-bootstrap-context",

        code:
          "STARTUP_INFRASTRUCTURE_CONTEXT_INVALID",
      },
    );
  }

  if (
    typeof context.getState !==
    "function"
  ) {
    throw createInfrastructureError(
      "TITech infrastructure bootstrap requires BootstrapContext.getState().",
      {
        operation:
          "validate-bootstrap-context",

        code:
          "STARTUP_INFRASTRUCTURE_CONTEXT_CONTRACT_INVALID",
      },
    );
  }

  const state =
    context.getState();

  if (
    typeof state !== "string"
  ) {
    throw createInfrastructureError(
      "TITech BootstrapContext lifecycle state must remain a primitive string.",
      {
        operation:
          "validate-bootstrap-context-state",

        code:
          "STARTUP_INFRASTRUCTURE_CONTEXT_STATE_INVALID",
      },
    );
  }

  if (
    state !== "starting" &&
    state !== "infrastructure"
  ) {
    throw createInfrastructureError(
      `TITech infrastructure bootstrap cannot execute while BootstrapContext is in "${state}" state.`,
      {
        operation:
          "validate-bootstrap-context-state",

        code:
          "STARTUP_INFRASTRUCTURE_INVALID_LIFECYCLE_STATE",

        details: {
          state,
          expected: [
            "starting",
            "infrastructure",
          ],
        },
      },
    );
  }
}


/* =============================================================================
 * CONTAINER SUPPORT
 * =============================================================================
 */

function ensureContainer(context) {
  if (
    !context.container ||
    typeof context.container !== "object"
  ) {
    context.container = {};
  }

  return context.container;
}


/* =============================================================================
 * CONFIGURATION HELPERS
 * =============================================================================
 */

function readBoolean(
  configuration,
  keys,
  fallback = false,
) {
  for (const key of keys) {
    if (
      configuration?.[key] !==
      undefined
    ) {
      const value =
        configuration[key];

      if (
        typeof value === "boolean"
      ) {
        return value;
      }

      if (
        typeof value === "string"
      ) {
        const normalized =
          value
            .trim()
            .toLowerCase();

        if (
          [
            "true",
            "1",
            "yes",
            "on",
          ].includes(
            normalized,
          )
        ) {
          return true;
        }

        if (
          [
            "false",
            "0",
            "no",
            "off",
          ].includes(
            normalized,
          )
        ) {
          return false;
        }
      }
    }
  }

  return fallback;
}

function readString(
  configuration,
  keys,
  fallback = undefined,
) {
  for (const key of keys) {
    if (
      configuration?.[key] !==
      undefined &&
      configuration?.[key] !== null
    ) {
      const value =
        String(
          configuration[key],
        ).trim();

      if (value) {
        return value;
      }
    }
  }

  return fallback;
}


/* =============================================================================
 * MODULE EXPORT / INITIALIZER RESOLUTION
 * =============================================================================
 *
 * Supports:
 *
 *   module.exports = fn
 *   module.exports = { initialize: fn }
 *   module.exports = { bootstrap: fn }
 *   module.exports = { start: fn }
 *   module.exports = { default: fn }
 */

function resolveInitializer(
  moduleValue,
) {
  if (
    typeof moduleValue ===
    "function"
  ) {
    return moduleValue;
  }

  if (
    !moduleValue ||
    typeof moduleValue !==
      "object"
  ) {
    return null;
  }

  const candidates = [
    moduleValue.initialize,
    moduleValue.bootstrap,
    moduleValue.start,
    moduleValue.init,
    moduleValue.default,
  ];

  return (
    candidates.find(
      (
        candidate,
      ) =>
        typeof candidate ===
        "function",
    ) || null
  );
}

function resolveShutdown(
  moduleValue,
) {
  if (
    !moduleValue ||
    typeof moduleValue !==
      "object"
  ) {
    return null;
  }

  const candidates = [
    moduleValue.shutdown,
    moduleValue.stop,
    moduleValue.close,
    moduleValue.dispose,
    moduleValue.destroy,
  ];

  return (
    candidates.find(
      (
        candidate,
      ) =>
        typeof candidate ===
        "function",
    ) || null
  );
}


/* =============================================================================
 * INFRASTRUCTURE ADAPTER DEFINITIONS
 * =============================================================================
 *
 * The resolver intentionally looks in multiple conventional locations so the
 * composition root can coexist with a growing enterprise backend without
 * forcing every optional infrastructure provider to exist immediately.
 */

const ADAPTER_DEFINITIONS =
  Object.freeze([
    {
      key: "database",

      label:
        "database",

      requiredKeys: [
        "DATABASE_REQUIRED",
        "MONGO_REQUIRED",
        "DB_REQUIRED",
      ],

      enabledKeys: [
        "DATABASE_ENABLED",
        "MONGO_ENABLED",
        "DB_ENABLED",
      ],

      paths: [
        "../../infrastructure/database",
        "../../infrastructure/db",
        "../../../services/database",
        "../../../services/db",
      ],
    },

    {
      key: "cache",

      label:
        "cache",

      requiredKeys: [
        "CACHE_REQUIRED",
        "REDIS_REQUIRED",
      ],

      enabledKeys: [
        "CACHE_ENABLED",
        "REDIS_ENABLED",
      ],

      paths: [
        "../../infrastructure/cache",
        "../../infrastructure/redis",
        "../../../services/cache",
        "../../../services/redis",
      ],
    },

    {
      key: "queue",

      label:
        "queue",

      requiredKeys: [
        "QUEUE_REQUIRED",
        "MESSAGE_QUEUE_REQUIRED",
      ],

      enabledKeys: [
        "QUEUE_ENABLED",
        "MESSAGE_QUEUE_ENABLED",
      ],

      paths: [
        "../../infrastructure/queue",
        "../../infrastructure/messaging",
        "../../../services/queue",
      ],
    },

    {
      key: "storage",

      label:
        "storage",

      requiredKeys: [
        "STORAGE_REQUIRED",
        "OBJECT_STORAGE_REQUIRED",
      ],

      enabledKeys: [
        "STORAGE_ENABLED",
        "OBJECT_STORAGE_ENABLED",
      ],

      paths: [
        "../../infrastructure/storage",
        "../../infrastructure/objectStorage",
        "../../../services/storage",
      ],
    },

    {
      key: "messaging",

      label:
        "messaging",

      requiredKeys: [
        "MESSAGING_REQUIRED",
        "NOTIFICATION_REQUIRED",
      ],

      enabledKeys: [
        "MESSAGING_ENABLED",
        "NOTIFICATIONS_ENABLED",
      ],

      paths: [
        "../../infrastructure/messaging",
        "../../infrastructure/notifications",
        "../../../services/messaging",
        "../../../services/notifications",
      ],
    },

    {
      key: "security",

      label:
        "security",

      requiredKeys: [
        "SECURITY_INFRASTRUCTURE_REQUIRED",
      ],

      enabledKeys: [
        "SECURITY_INFRASTRUCTURE_ENABLED",
        "SECURITY_ENABLED",
      ],

      paths: [
        "../../infrastructure/security",
        "../../../services/security",
      ],
    },
  ]);


/* =============================================================================
 * OPTIONAL MODULE DISCOVERY
 * =============================================================================
 */

function tryRequire(
  absolutePath,
) {
  try {
    return require(
      absolutePath,
    );
  } catch (error) {
    if (
      error &&
      error.code ===
        "MODULE_NOT_FOUND"
    ) {
      return null;
    }

    throw error;
  }
}

function resolveModulePath(
  baseDir,
  candidates,
) {
  for (const candidate of candidates) {
    const absolutePath =
      path.resolve(
        baseDir,
        candidate,
      );

    try {
      if (
        fs.existsSync(
          `${absolutePath}.js`,
        ) ||
        fs.existsSync(
          `${absolutePath}.cjs`,
        ) ||
        fs.existsSync(
          absolutePath,
        ) ||
        fs.existsSync(
          path.join(
            absolutePath,
            "index.js",
          ),
        ) ||
        fs.existsSync(
          path.join(
            absolutePath,
            "index.cjs",
          ),
        )
      ) {
        return absolutePath;
      }
    } catch {
      // Continue discovering alternatives.
    }
  }

  return null;
}


/* =============================================================================
 * CONFIGURATION-DRIVEN REQUIREDNESS
 * =============================================================================
 */

function isAdapterEnabled(
  definition,
  configuration,
) {
  return readBoolean(
    configuration,
    definition.enabledKeys,
    true,
  );
}

function isAdapterRequired(
  definition,
  configuration,
) {
  return readBoolean(
    configuration,
    definition.requiredKeys,
    false,
  );
}


/* =============================================================================
 * ADAPTER REGISTRATION
 * =============================================================================
 */

function registerAdapter(
  key,
  adapter,
  metadata = {},
) {
  infrastructureRegistry.set(
    key,
    adapter,
  );

  infrastructureStatus.set(
    key,
    {
      key,

      state:
        "ready",

      initializedAt:
        new Date().toISOString(),

      optional:
        metadata.optional ===
        true,

      required:
        metadata.required ===
        true,

      source:
        metadata.source ||
        null,
    },
  );
}

function registerStaticInfrastructure(
  context,
) {
  /**
   * Reuse infrastructure already placed in the context by previous phases.
   *
   * This is deliberately additive.
   */
  const existing =
    context.infrastructure;

  if (
    existing &&
    typeof existing === "object"
  ) {
    for (
      const [
        key,
        value,
      ] of Object.entries(
        existing,
      )
    ) {
      if (
        value !== undefined &&
        value !== null
      ) {
        registerAdapter(
          key,
          value,
          {
            source:
              "bootstrap-context",
          },
        );
      }
    }
  }
}


/* =============================================================================
 * ADAPTER INITIALIZATION
 * =============================================================================
 */

async function initializeAdapter(
  context,
  definition,
) {
  const configuration =
    getConfiguration(context);

  const enabled =
    isAdapterEnabled(
      definition,
      configuration,
    );

  const required =
    isAdapterRequired(
      definition,
      configuration,
    );

  if (!enabled) {
    infrastructureStatus.set(
      definition.key,
      {
        key:
          definition.key,

        state:
          "disabled",

        initializedAt:
          null,

        optional:
          !required,

        required,

        source:
          "configuration",
      },
    );

    logDebug(
      context,
      createMetadata(
        context,
        {
          event:
            "adapter.disabled",

          infrastructure:
            definition.key,
        },
      ),
      `TITech infrastructure adapter "${definition.label}" is disabled by configuration.`,
    );

    return null;
  }

  const infrastructureRoot =
    path.resolve(
      __dirname,
      "../..",
    );

  const resolvedPath =
    resolveModulePath(
      infrastructureRoot,
      definition.paths,
    );

  if (!resolvedPath) {
    if (required) {
      throw createInfrastructureError(
        `Required TITech infrastructure adapter "${definition.label}" could not be located.`,
        {
          operation:
            `initialize-${definition.key}`,

          dependency:
            definition.key,

          code:
            "STARTUP_INFRASTRUCTURE_ADAPTER_MISSING",

          details: {
            searched:
              definition.paths,
          },
        },
      );
    }

    infrastructureStatus.set(
      definition.key,
      {
        key:
          definition.key,

        state:
          "unavailable",

        initializedAt:
          null,

        optional: true,

        required: false,

        source:
          null,
      },
    );

    logDebug(
      context,
      createMetadata(
        context,
        {
          event:
            "adapter.optional_unavailable",

          infrastructure:
            definition.key,
        },
      ),
      `Optional TITech infrastructure adapter "${definition.label}" is not configured.`,
    );

    return null;
  }

  let moduleValue;

  try {
    moduleValue =
      tryRequire(
        resolvedPath,
      );
  } catch (error) {
    throw createInfrastructureError(
      `TITech infrastructure adapter "${definition.label}" failed to load.`,
      {
        operation:
          `load-${definition.key}`,

        dependency:
          definition.key,

        cause:
          error,
      },
    );
  }

  if (!moduleValue) {
    if (required) {
      throw createInfrastructureError(
        `Required TITech infrastructure adapter "${definition.label}" loaded as an empty module.`,
        {
          operation:
            `load-${definition.key}`,

          dependency:
            definition.key,

          code:
            "STARTUP_INFRASTRUCTURE_ADAPTER_EMPTY",
        },
      );
    }

    return null;
  }

  const initializer =
    resolveInitializer(
      moduleValue,
    );

  if (!initializer) {
    if (required) {
      throw createInfrastructureError(
        `Required TITech infrastructure adapter "${definition.label}" does not expose a supported initializer.`,
        {
          operation:
            `resolve-${definition.key}`,

          dependency:
            definition.key,

          code:
            "STARTUP_INFRASTRUCTURE_ADAPTER_INITIALIZER_MISSING",
        },
      );
    }

    logWarn(
      context,
      createMetadata(
        context,
        {
          event:
            "adapter.initializer_unavailable",

          infrastructure:
            definition.key,

          source:
            resolvedPath,
        },
      ),
      `Optional TITech infrastructure adapter "${definition.label}" has no callable initializer.`,
    );

    infrastructureStatus.set(
      definition.key,
      {
        key:
          definition.key,

        state:
          "unavailable",

        initializedAt:
          null,

        optional: true,

        required: false,

        source:
          resolvedPath,
      },
    );

    return null;
  }

  const startedAt =
    process.hrtime.bigint();

  try {
    const adapterContext = {
      context,

      bootstrapContext:
        context,

      app:
        context.application,

      application:
        context.application,

      configuration,

      config:
        configuration,

      environment:
        getEnvironment(context),

      logger:
        getLogger(context),

      container:
        ensureContainer(context),

      metadata:
        createMetadata(
          context,
          {
            infrastructure:
              definition.key,
          },
        ),
    };

    const instance =
      await initializer(
        adapterContext,
      );

    const resolvedInstance =
      instance ||
      moduleValue?.instance ||
      moduleValue?.service ||
      moduleValue;

    registerAdapter(
      definition.key,
      resolvedInstance,
      {
        required,

        optional:
          !required,

        source:
          resolvedPath,
      },
    );

    const durationMs =
      Number(
        process.hrtime.bigint() -
          startedAt,
      ) / 1_000_000;

    logInfo(
      context,
      createMetadata(
        context,
        {
          event:
            "adapter.ready",

          infrastructure:
            definition.key,

          durationMs,

          source:
            resolvedPath,
        },
      ),
      `TITech infrastructure adapter "${definition.label}" initialized successfully.`,
    );

    return resolvedInstance;
  } catch (error) {
    throw createInfrastructureError(
      `TITech infrastructure adapter "${definition.label}" failed during initialization.`,
      {
        operation:
          `initialize-${definition.key}`,

        dependency:
          definition.key,

        cause:
          error,

        details: {
          source:
            resolvedPath,
        },
      },
    );
  }
}


/* =============================================================================
 * CONTEXT PUBLICATION
 * =============================================================================
 */

function publishInfrastructureContext(
  context,
) {
  const infrastructure = {};

  for (
    const [
      key,
      value,
    ] of infrastructureRegistry.entries()
  ) {
    infrastructure[key] =
      value;
  }

  /**
   * Store infrastructure on the existing canonical context.
   *
   * This does NOT replace context.state.
   */
  if (
    typeof context.setInfrastructure ===
    "function"
  ) {
    context.setInfrastructure(
      infrastructure,
    );
  } else {
    context.infrastructure =
      infrastructure;
  }

  const container =
    ensureContainer(context);

  container.infrastructure =
    infrastructure;

  /**
   * Publish individual infrastructure services into the same DI container.
   */
  for (
    const [
      key,
      value,
    ] of Object.entries(
      infrastructure,
    )
  ) {
    if (
      value !== undefined &&
      value !== null
    ) {
      container[key] =
        value;
    }
  }

  context.infrastructureRegistry =
    infrastructureRegistry;

  context.infrastructureStatus =
    infrastructureStatus;

  return infrastructure;
}


/* =============================================================================
 * INFRASTRUCTURE SNAPSHOT
 * =============================================================================
 */

function getInfrastructureStatus() {
  const adapters = {};

  for (
    const [
      key,
      status,
    ] of infrastructureStatus.entries()
  ) {
    adapters[key] = {
      ...status,
    };
  }

  return {
    initialized,

    count:
      infrastructureRegistry.size,

    adapters,
  };
}

function getInfrastructure(
  key,
) {
  if (
    key !== undefined
  ) {
    return (
      infrastructureRegistry.get(
        key,
      ) || null
    );
  }

  return Object.fromEntries(
    infrastructureRegistry.entries(),
  );
}

function isInfrastructureReady() {
  if (!initialized) {
    return false;
  }

  for (
    const status of
      infrastructureStatus.values()
  ) {
    if (
      status.state ===
        "failed" &&
      status.required ===
        true
    ) {
      return false;
    }
  }

  return true;
}


/* =============================================================================
 * CORE INFRASTRUCTURE INITIALIZER
 * =============================================================================
 */

async function initializeInfrastructure(
  context,
) {
  if (initialized) {
    /**
     * Same-context idempotency.
     */
    if (
      activeContext === context
    ) {
      return (
        context.infrastructure ||
        getInfrastructure()
      );
    }

    /**
     * A second context must not silently reuse the first application's
     * infrastructure graph.
     */
    throw createInfrastructureError(
      "TITech infrastructure has already been initialized for another BootstrapContext.",
      {
        operation:
          "initialize-infrastructure",

        code:
          "STARTUP_INFRASTRUCTURE_ALREADY_BOUND",
      },
    );
  }

  if (
    initializingPromise
  ) {
    return initializingPromise;
  }

  initializingPromise =
    (async () => {
      assertContext(
        context,
      );

      const configuration =
        getConfiguration(context);

      activeContext =
        context;

      infrastructureRegistry.clear();
      infrastructureStatus.clear();

      const startedAt =
        process.hrtime.bigint();

      logInfo(
        context,
        createMetadata(
          context,
          {
            event:
              "bootstrap.started",
          },
        ),
        "TITech infrastructure bootstrap started.",
      );

      try {
        /**
         * Ensure the infrastructure namespace exists before discovering
         * providers.
         */
        ensureContainer(context);

        registerStaticInfrastructure(
          context,
        );

        /**
         * Configuration-level infrastructure objects can be injected directly.
         *
         * Example:
         *
         * configuration.infrastructure.database
         */
        const configuredInfrastructure =
          configuration?.infrastructure;

        if (
          configuredInfrastructure &&
          typeof configuredInfrastructure ===
            "object"
        ) {
          for (
            const [
              key,
              adapter,
            ] of Object.entries(
              configuredInfrastructure,
            )
          ) {
            if (
              adapter !== undefined &&
              adapter !== null
            ) {
              registerAdapter(
                key,
                adapter,
                {
                  source:
                    "configuration",
              },
            );
          }
        }

        /**
         * Initialize conventional adapters.
         *
         * The list is deliberately deterministic.
         */
        for (
          const definition of
            ADAPTER_DEFINITIONS
        ) {
          await initializeAdapter(
            context,
            definition,
          );
        }

        const infrastructure =
          publishInfrastructureContext(
            context,
          );

        const durationMs =
          Number(
            process.hrtime.bigint() -
              startedAt,
          ) / 1_000_000;

        initialized =
          true;

        logInfo(
          context,
          createMetadata(
            context,
            {
              event:
                "bootstrap.completed",

              durationMs,

              adapterCount:
                infrastructureRegistry.size,

              adapters:
                Object.keys(
                  infrastructure,
                ),
            },
          ),
          "TITech infrastructure bootstrap completed successfully.",
        );

        return infrastructure;
      } catch (error) {
        initialized =
          false;

        infrastructureStatus.forEach(
          (status, key) => {
            infrastructureStatus.set(
              key,
              {
                ...status,
                state:
                  "failed",
              },
            );
          },
        );

        const normalized =
          error?.phase ===
            "infrastructure"
            ? error
            : createInfrastructureError(
                "TITech infrastructure bootstrap failed.",
                {
                  cause:
                    error,
                },
              );

        logError(
          context,
          createMetadata(
            context,
            {
              event:
                "bootstrap.failed",

              code:
                normalized.code,

              message:
                normalized.message,

              cause:
                normalized.cause?.message,
            },
          ),
          "TITech infrastructure bootstrap failed.",
        );

        throw normalized;
      }
    })();

  try {
    return await initializingPromise;
  } finally {
    initializingPromise =
      null;
  }
}


/* =============================================================================
 * SHUTDOWN
 * =============================================================================
 */

async function shutdownInfrastructure(
  options = {},
) {
  if (
    shutdownPromise
  ) {
    return shutdownPromise;
  }

  if (
    !initialized &&
    infrastructureRegistry.size ===
      0
  ) {
    return;
  }

  shutdownPromise =
    (async () => {
      const context =
        activeContext;

      const reason =
        options.reason ||
        "shutdown";

      logInfo(
        context,
        createMetadata(
          context,
          {
            event:
              "shutdown.started",

            reason,
          },
        ),
        "TITech infrastructure shutdown started.",
      );

      const entries =
        Array.from(
          infrastructureRegistry.entries(),
        ).reverse();

      const failures = [];

      for (
        const [
          key,
          adapter,
        ] of entries
      ) {
        const definition =
          ADAPTER_DEFINITIONS.find(
            (
              candidate,
            ) =>
              candidate.key ===
              key,
          );

        /**
         * A module's shutdown lifecycle is preferred.
         */
        let shutdownFn =
          null;

        try {
          shutdownFn =
            resolveShutdown(
              adapter,
            );

          if (
            !shutdownFn &&
            definition
          ) {
            const infrastructureRoot =
              path.resolve(
                __dirname,
                "../..",
              );

            const resolvedPath =
              resolveModulePath(
                infrastructureRoot,
                definition.paths,
              );

            if (
              resolvedPath
            ) {
              const moduleValue =
                tryRequire(
                  resolvedPath,
                );

              shutdownFn =
                resolveShutdown(
                  moduleValue,
                );
            }
          }

          if (
            shutdownFn
          ) {
            await shutdownFn({
              context,

              bootstrapContext:
                context,

              reason,

              logger:
                getLogger(context),
            });
          }

          infrastructureStatus.set(
            key,
            {
              ...(
                infrastructureStatus.get(
                  key,
                ) || {
                  key,
                }
              ),

              state:
                "stopped",

              stoppedAt:
                new Date().toISOString(),
            },
          );
        } catch (error) {
          failures.push({
            key,

            error,
          });

          infrastructureStatus.set(
            key,
            {
              ...(
                infrastructureStatus.get(
                  key,
                ) || {
                  key,
                }
              ),

              state:
                "shutdown_failed",

              shutdownError:
                error?.message,
            },
          );

          logWarn(
            context,
            createMetadata(
              context,
              {
                event:
                  "adapter.shutdown_failed",

                infrastructure:
                  key,

                message:
                  error?.message,
              },
            ),
            `TITech infrastructure adapter "${key}" shutdown failed.`,
          );
        }
      }

      infrastructureRegistry.clear();

      if (
        activeContext &&
        activeContext.infrastructure
      ) {
        try {
          if (
            typeof activeContext.setInfrastructure ===
            "function"
          ) {
            activeContext.setInfrastructure(
              {},
            );
          } else {
            activeContext.infrastructure =
              {};
          }
        } catch {
          /**
           * Never mutate BootstrapContext.state here.
           */
        }
      }

      initialized =
        false;

      activeContext =
        null;

      const status =
        failures.length
          ? "partial"
          : "complete";

      logInfo(
        context,
        createMetadata(
          context,
          {
            event:
              "shutdown.completed",

            status,

            failures:
              failures.length,
          },
        ),
        failures.length
          ? "TITech infrastructure shutdown completed with provider failures."
          : "TITech infrastructure shutdown completed successfully.",
      );

      if (
        failures.length &&
        options.failOnError ===
          true
      ) {
        const error =
          createInfrastructureError(
            "TITech infrastructure shutdown completed with one or more adapter failures.",
            {
              operation:
                "shutdown-infrastructure",

              code:
                "SHUTDOWN_INFRASTRUCTURE_FAILED",

              fatal: false,

              critical: false,

              details: {
                failures:
                  failures.map(
                    (
                      item,
                    ) => ({
                      key:
                        item.key,

                      message:
                        item.error
                          ?.message,
                    }),
                  ),
              },
            },
          );

        throw error;
      }

      return {
        status,

        failures:
          failures.map(
            (
              item,
            ) => ({
              key:
                item.key,

              message:
                item.error?.message,
            }),
          ),
      };
    })();

  try {
    return await shutdownPromise;
  } finally {
    shutdownPromise =
      null;
  }
}


/* =============================================================================
 * HEALTH
 * =============================================================================
 */

async function health(
  context = activeContext,
) {
  const adapters = {};

  for (
    const [
      key,
      adapter,
    ] of infrastructureRegistry.entries()
  ) {
    let adapterHealth;

    try {
      if (
        typeof adapter?.health ===
        "function"
      ) {
        adapterHealth =
          await adapter.health();
      } else if (
        typeof adapter?.isReady ===
        "function"
      ) {
        adapterHealth = {
          ready:
            Boolean(
              await adapter.isReady(),
            ),
        };
      } else {
        adapterHealth = {
          ready:
            infrastructureStatus.get(
              key,
            )?.state ===
            "ready",
        };
      }
    } catch (error) {
      adapterHealth = {
        ready:
          false,

        status:
          "unhealthy",

        error:
          error?.message,
      };
    }

    adapters[key] =
      adapterHealth;
  }

  const ready =
    initialized &&
    Object.values(
      adapters,
    ).every(
      (
        adapter,
      ) =>
        adapter?.ready !==
          false,
    );

  return {
    status:
      ready
        ? "healthy"
        : "not_ready",

    ready,

    initialized,

    adapterCount:
      infrastructureRegistry.size,

    adapters,

    timestamp:
      new Date().toISOString(),
  };
}


/* =============================================================================
 * READINESS
 * =============================================================================
 */

async function isReady() {
  if (!initialized) {
    return false;
  }

  try {
    const result =
      await health();

    return result.ready;
  } catch {
    return false;
  }
}


/* =============================================================================
 * RESET
 * =============================================================================
 *
 * Intended for controlled tests only. Not part of normal production lifecycle.
 */

async function resetForTests() {
  if (
    process.env.NODE_ENV !==
      "test" &&
    process.env.TITECH_ALLOW_INFRASTRUCTURE_RESET !==
      "true"
  ) {
    throw createInfrastructureError(
      "TITech infrastructure reset is restricted to test or explicitly enabled environments.",
      {
        operation:
          "reset-infrastructure",
        code:
          "INFRASTRUCTURE_RESET_FORBIDDEN",
        fatal: false,
        critical: false,
      },
    );
  }

  try {
    await shutdownInfrastructure({
      reason:
        "test-reset",
      failOnError:
        false,
    });
  } finally {
    infrastructureRegistry.clear();
    infrastructureStatus.clear();
    initialized =
      false;
    activeContext =
      null;
  }
}


/* =============================================================================
 * PUBLIC API
 * =============================================================================
 *
 * IMPORTANT:
 *
 * Export the initializer itself so bootstrap/app.js resolves the module even
 * when infrastructure/index.js is consumed as:
 *
 *   const initializeInfrastructure = require("./infrastructure");
 *
 * Additional enterprise lifecycle APIs are attached as properties to that
 * function, preserving CommonJS compatibility.
 */

initializeInfrastructure.shutdown =
  shutdownInfrastructure;

initializeInfrastructure.health =
  health;

initializeInfrastructure.isReady =
  isReady;

initializeInfrastructure.getInfrastructure =
  getInfrastructure;

initializeInfrastructure.getStatus =
  getInfrastructureStatus;

initializeInfrastructure.resetForTests =
  resetForTests;

initializeInfrastructure.initialize =
  initializeInfrastructure;

initializeInfrastructure.bootstrap =
  initializeInfrastructure;

initializeInfrastructure.start =
  initializeInfrastructure;

initializeInfrastructure.default =
  initializeInfrastructure;

initializeInfrastructure.version =
  "1.0.0";

initializeInfrastructure.component =
  "bootstrap/infrastructure";

initializeInfrastructure.service =
  "titech-community-capital-backend";


/* =============================================================================
 * COMMONJS EXPORT
 * =============================================================================
 */

module.exports =
  initializeInfrastructure;