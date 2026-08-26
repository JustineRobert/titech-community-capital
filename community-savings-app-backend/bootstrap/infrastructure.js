"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Infrastructure Bootstrap / Lifecycle Orchestrator
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/infrastructure.js
 *
 * Purpose:
 *   Canonical enterprise infrastructure composition adapter for TITech
 *   Community Capital.
 *
 * Architecture
 * -----------------------------------------------------------------------------
 *
 *   environment
 *       ↓
 *   configuration
 *       ↓
 *   logger
 *       ↓
 *   observability
 *       ↓
 *   readiness
 *       ↓
 *   resilience
 *       ↓
 *   infrastructure
 *       ├── database
 *       ├── redis
 *       ├── eventBus
 *       ├── queue
 *       ├── socketIO
 *       └── apiGateway
 *       ↓
 *   services
 *       ↓
 *   middleware
 *       ↓
 *   routes
 *       ↓
 *   HTTP server
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * ✓ Infrastructure lifecycle composition
 * ✓ Explicit adapter registration
 * ✓ Configuration-driven adapter resolution
 * ✓ Repository adapter discovery
 * ✓ Deterministic dependency registration
 * ✓ Database / MongoDB lifecycle
 * ✓ Redis lifecycle
 * ✓ Queue / worker lifecycle
 * ✓ Event-bus lifecycle
 * ✓ Resilience lifecycle
 * ✓ Socket.IO lifecycle
 * ✓ API Gateway lifecycle
 * ✓ Duplicate-registration protection
 * ✓ Optional infrastructure graceful degradation
 * ✓ Critical infrastructure fail-fast semantics
 * ✓ Runtime initialization contract for bootstrap/app.js
 * ✓ Runtime shutdown contract
 * ✓ Partial-startup cleanup
 * ✓ Failed-start rollback bookkeeping
 * ✓ Started-state verification
 * ✓ Infrastructure diagnostics
 * ✓ Health/readiness-aware lifecycle context
 * ✓ Mutable execution context for runtime handles
 * ✓ Immutable infrastructure metadata namespace
 * ✓ Canonical BootstrapContext preservation
 * ✓ CommonJS export compatibility
 * ✓ No business logic
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 * This module is an ORCHESTRATION ADAPTER.
 *
 * It does NOT implement:
 *   - database queries
 *   - Redis commands
 *   - financial transaction logic
 *   - ledger logic
 *   - queue business logic
 *   - event handlers
 *   - HTTP route logic
 *   - Socket.IO event handlers
 *   - gateway business rules
 *
 * Existing infrastructure implementations remain authoritative.
 *
 * Lifecycle authority
 * -----------------------------------------------------------------------------
 *
 * BootstrapContext
 *   → canonical application lifecycle authority
 *
 * runtime/state.js
 *   → compatibility/read-model only
 *
 * This module NEVER assigns a foreign object to:
 *
 *   context.state
 *
 * =============================================================================
 */

const path = require("node:path");

/* =============================================================================
 * HOOK ENGINE
 * =============================================================================
 */

const {
  hooks,
  startup,
  lifecycle,
} = require("./hooks");

/* =============================================================================
 * INFRASTRUCTURE MODULE DEFINITIONS
 * =============================================================================
 */

const INFRASTRUCTURE_MODULES = Object.freeze({
  database: Object.freeze([
    "../database",
    "../db",
    "../database/index",
    "../db/index",
    "../config/database",
    "../config/db",
    "../services/database",
    "../services/db",
    "../infrastructure/database",
    "../infrastructure/mongodb",
    "../infrastructure/db",
    "../lib/database",
    "../lib/mongodb",
  ]),

  redis: Object.freeze([
    "../redis",
    "../redis/index",
    "../config/redis",
    "../config/cache",
    "../services/redis",
    "../services/cache",
    "../infrastructure/redis",
    "../infrastructure/cache",
    "../cache/redis",
    "../cache",
    "../lib/redis",
    "../lib/cache",
  ]),

  resilience: Object.freeze([
    "../middleware/resilience",
    "../resilience",
    "../resilience/index",
    "../config/resilience",
    "../infrastructure/resilience",
    "../services/resilience",
  ]),

  eventBus: Object.freeze([
    "../event-bus",
    "../eventBus",
    "../event-bus/index",
    "../eventBus/index",
    "../events",
    "../config/event-bus",
    "../config/eventBus",
    "../services/event-bus",
    "../services/eventBus",
    "../infrastructure/event-bus",
    "../infrastructure/eventBus",
  ]),

  queue: Object.freeze([
    "../queue",
    "../queues",
    "../job-queue",
    "../jobQueue",
    "../queue/index",
    "../queues/index",
    "../config/queue",
    "../config/jobs",
    "../services/queue",
    "../services/queues",
    "../services/job-queue",
    "../infrastructure/queue",
    "../infrastructure/jobs",
  ]),

  socketIO: Object.freeze([
    "../socket",
    "../socket.io",
    "../socketIO",
    "../socket/index",
    "../socket.io/index",
    "../socketIO/index",
    "../realtime",
    "../config/socket",
    "../config/socketIO",
    "../services/socket",
    "../services/realtime",
    "../infrastructure/socket",
    "../infrastructure/socket.io",
    "../infrastructure/realtime",
  ]),

  apiGateway: Object.freeze([
    "../api-gateway",
    "../apiGateway",
    "../gateway",
    "../api-gateway/index",
    "../apiGateway/index",
    "../gateway/index",
    "../config/api-gateway",
    "../config/apiGateway",
    "../config/gateway",
    "../services/api-gateway",
    "../services/apiGateway",
    "../services/gateway",
    "../infrastructure/api-gateway",
    "../infrastructure/apiGateway",
    "../infrastructure/gateway",
  ]),
});

/* =============================================================================
 * LIFECYCLE DEPENDENCIES
 * =============================================================================
 */

const DEPENDENCIES = Object.freeze({
  resilience: Object.freeze([
    "observability",
  ]),

  database: Object.freeze([
    "resilience",
  ]),

  redis: Object.freeze([
    "database",
  ]),

  eventBus: Object.freeze([
    "redis",
  ]),

  queue: Object.freeze([
    "redis",
    "eventBus",
  ]),

  socketIO: Object.freeze([
    "eventBus",
  ]),

  apiGateway: Object.freeze([
    "eventBus",
    "resilience",
  ]),
});

/* =============================================================================
 * PRIORITIES
 * =============================================================================
 */

const PRIORITIES = Object.freeze({
  resilience: -500,
  database: -400,
  redis: -300,
  eventBus: -200,
  queue: -100,
  socketIO: 0,
  apiGateway: 100,
});

/* =============================================================================
 * FEATURE FLAGS
 * =============================================================================
 */

const ENABLE_FLAGS = Object.freeze({
  database: "MONGODB_ENABLED",
  redis: "REDIS_ENABLED",
  resilience: "RESILIENCE_ENABLED",
  eventBus: "EVENT_BUS_ENABLED",
  queue: "QUEUE_ENABLED",
  socketIO: "SOCKET_IO_ENABLED",
  apiGateway: "API_GATEWAY_ENABLED",
});

/* =============================================================================
 * DEFAULT ENABLEMENT
 * =============================================================================
 */

const DEFAULT_ENABLED = Object.freeze({
  database: true,
  redis: true,
  resilience: true,
  eventBus: true,
  queue: true,
  socketIO: false,
  apiGateway: false,
});

/* =============================================================================
 * SUBSYSTEM ORDER
 * =============================================================================
 */

const SUBSYSTEM_ORDER = Object.freeze([
  "resilience",
  "database",
  "redis",
  "eventBus",
  "queue",
  "socketIO",
  "apiGateway",
]);

/* =============================================================================
 * LIFECYCLE METHOD NAMES
 * =============================================================================
 */

const START_METHODS = Object.freeze([
  "initialize",
  "init",
  "connect",
  "start",
  "bootstrap",
  "open",
]);

const STOP_METHODS = Object.freeze([
  "shutdown",
  "close",
  "disconnect",
  "stop",
  "destroy",
  "dispose",
]);

/* =============================================================================
 * CONFIGURATION MODULE KEYS
 * =============================================================================
 */

const CONFIGURATION_MODULE_KEYS = Object.freeze([
  "module",
  "adapter",
  "implementation",
  "path",
  "modulePath",
  "require",
]);

/* =============================================================================
 * INTERNAL STATE
 * =============================================================================
 */

const registrationState = new Map();

let initialized = false;
let initializing = false;
let shuttingDown = false;

let initializationPromise = null;
let shutdownPromise = null;

let initializationContext = null;
let initializationResult = null;

let startupAttempted = false;

/* =============================================================================
 * UTILITY HELPERS
 * =============================================================================
 */

function isFunction(value) {
  return typeof value === "function";
}

function isObjectLike(value) {
  return (
    value !== null &&
    typeof value === "object"
  );
}

function isModuleResolutionError(error) {
  return Boolean(
    error &&
      (
        error.code === "MODULE_NOT_FOUND" ||
        error.code === "ERR_MODULE_NOT_FOUND"
      ),
  );
}

function getNowIso() {
  return new Date().toISOString();
}

function moduleExists(modulePath) {
  try {
    require.resolve(modulePath);

    return true;
  } catch (error) {
    if (isModuleResolutionError(error)) {
      return false;
    }

    throw error;
  }
}

function resolveModule(paths) {
  for (const modulePath of paths) {
    if (!moduleExists(modulePath)) {
      continue;
    }

    return {
      modulePath,
      module: require(modulePath),
      source: "repository",
    };
  }

  return null;
}

function unwrapModule(moduleValue) {
  if (
    moduleValue &&
    moduleValue.__esModule &&
    moduleValue.default
  ) {
    return moduleValue.default;
  }

  return moduleValue;
}

function uniqueCandidates(candidates) {
  const result = [];
  const seen = new Set();

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    result.push(candidate);
  }

  return result;
}

function parseBooleanFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized = String(value)
    .trim()
    .toLowerCase();

  if (
    [
      "true",
      "1",
      "yes",
      "on",
      "enabled",
    ].includes(normalized)
  ) {
    return true;
  }

  if (
    [
      "false",
      "0",
      "no",
      "off",
      "disabled",
    ].includes(normalized)
  ) {
    return false;
  }

  return null;
}

/* =============================================================================
 * CONFIGURATION MODULE RESOLUTION
 * =============================================================================
 */

function getSubsystemConfiguration(
  context,
  subsystem,
) {
  const config =
    context?.configuration ??
    context?.config ??
    null;

  if (!config) {
    return null;
  }

  return (
    config?.infrastructure?.[subsystem] ??
    config?.[subsystem] ??
    null
  );
}

function getConfiguredAdapterDefinition(
  context,
  subsystem,
) {
  const configuration =
    getSubsystemConfiguration(
      context,
      subsystem,
    );

  if (!configuration) {
    return null;
  }

  if (
    isFunction(configuration) ||
    (
      isObjectLike(configuration) &&
      (
        isFunction(configuration.initialize) ||
        isFunction(configuration.start) ||
        isFunction(configuration.connect)
      )
    )
  ) {
    return {
      value: configuration,
      source: "configuration-object",
    };
  }

  for (
    const key of CONFIGURATION_MODULE_KEYS
  ) {
    const candidate =
      configuration?.[key];

    if (
      candidate === undefined ||
      candidate === null
    ) {
      continue;
    }

    return {
      value: candidate,
      source: `configuration.${key}`,
    };
  }

  return null;
}

function resolveConfiguredAdapter(
  context,
  subsystem,
) {
  const definition =
    getConfiguredAdapterDefinition(
      context,
      subsystem,
    );

  if (!definition) {
    return null;
  }

  if (
    typeof definition.value !== "string"
  ) {
    return {
      modulePath: `configured:${subsystem}`,
      module: definition.value,
      source: definition.source,
    };
  }

  const configuredPath =
    definition.value.trim();

  if (!configuredPath) {
    return null;
  }

  const backendRoot =
    path.resolve(
      __dirname,
      "..",
    );

  const absolutePath =
    path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(
          backendRoot,
          configuredPath,
        );

  if (!moduleExists(absolutePath)) {
    throw new Error(
      `TITech configured ${subsystem} infrastructure adapter "${configuredPath}" could not be resolved from "${backendRoot}".`,
    );
  }

  return {
    modulePath: absolutePath,
    module: require(absolutePath),
    source: definition.source,
  };
}

function resolveInfrastructureModule(
  context,
  subsystem,
) {
  const configured =
    resolveConfiguredAdapter(
      context,
      subsystem,
    );

  if (configured) {
    return configured;
  }

  return resolveModule(
    INFRASTRUCTURE_MODULES[subsystem] ??
    [],
  );
}

/* =============================================================================
 * LIFECYCLE METHOD DISCOVERY
 * =============================================================================
 */

function getCandidateMethod(
  target,
  names,
) {
  if (!target) {
    return null;
  }

  for (const name of names) {
    if (isFunction(target[name])) {
      return {
        target,
        name,
        fn: target[name],
      };
    }
  }

  return null;
}

function resolveLifecycleMethods(
  loadedModule,
) {
  if (!loadedModule) {
    return null;
  }

  const rawModule =
    loadedModule.module ??
    loadedModule;

  const exported =
    unwrapModule(rawModule);

  const candidates =
    uniqueCandidates([
      exported,
      exported?.service,
      exported?.client,
      exported?.manager,
      exported?.instance,
      exported?.infrastructure,
      exported?.default,
      exported?.default?.service,
      exported?.default?.client,
      exported?.default?.manager,
      exported?.default?.instance,
      exported?.default?.infrastructure,
    ]);

  let start = null;
  let stop = null;

  for (const candidate of candidates) {
    if (!start) {
      start =
        getCandidateMethod(
          candidate,
          START_METHODS,
        );
    }

    if (!stop) {
      stop =
        getCandidateMethod(
          candidate,
          STOP_METHODS,
        );
    }

    if (start && stop) {
      break;
    }
  }

  return {
    exported,
    start,
    stop,
  };
}

/* =============================================================================
 * LIFECYCLE INVOCATION
 * =============================================================================
 */

async function invokeLifecycleMethod(
  lifecycleMethod,
  context,
) {
  if (!lifecycleMethod) {
    return undefined;
  }

  if (!isFunction(lifecycleMethod.fn)) {
    throw new TypeError(
      "TITech infrastructure lifecycle method is not callable.",
    );
  }

  return lifecycleMethod.fn.call(
    lifecycleMethod.target,
    context,
  );
}

/* =============================================================================
 * INFRASTRUCTURE EXECUTION CONTEXT
 * =============================================================================
 *
 * IMPORTANT DESIGN
 * -----------------------------------------------------------------------------
 *
 * This function intentionally creates TWO layers:
 *
 * 1. `infrastructure`
 *    Immutable read-mostly metadata and shared references.
 *
 * 2. returned execution context
 *    Mutable lifecycle execution state.
 *
 * The BootstrapContext itself is retained by reference under:
 *
 *   executionContext.bootstrapContext
 *   executionContext.infrastructure.bootstrapContext
 *
 * Neither layer replaces:
 *
 *   bootstrapContext.state
 *
 * with infrastructure runtime state.
 *
 * Runtime handles are intentionally kept on the mutable execution context:
 *
 *   executionContext.database
 *   executionContext.redis
 *   executionContext.queue
 *   executionContext.eventBus
 *   executionContext.socketIO
 *   executionContext.apiGateway
 *
 * The immutable namespace does NOT contain those mutable handles.
 * =============================================================================
 */

function createInfrastructureContext(
  context,
) {
  const configuration =
    context?.configuration ??
    context?.config ??
    null;

  /**
   * ---------------------------------------------------------------------------
   * Immutable infrastructure metadata
   * ---------------------------------------------------------------------------
   */
  const infrastructure = {
    rootDirectory:
      path.resolve(
        __dirname,
        "..",
      ),

    environment:
      context?.environment ??
      null,

    configuration,

    config:
      configuration,

    logger:
      context?.logger ??
      null,

    observability:
      context?.observability ??
      null,

    readiness:
      context?.readiness ??
      null,

    resilience:
      context?.resilience ??
      null,

    hooks:
      context?.hooks ??
      hooks ??
      null,

    /**
     * Canonical lifecycle authority.
     *
     * Retained by reference.
     *
     * NEVER:
     *
     *   infrastructure.bootstrapContext.state = ...
     *
     * Infrastructure code must use the BootstrapContext lifecycle API instead.
     */
    bootstrapContext:
      context ??
      null,
  };

  Object.freeze(infrastructure);

  /**
   * ---------------------------------------------------------------------------
   * Mutable execution context
   * ---------------------------------------------------------------------------
   *
   * Existing infrastructure adapters may safely attach runtime resources.
   */
  return {
    bootstrapContext:
      context ??
      null,

    environment:
      context?.environment ??
      null,

    configuration,

    config:
      configuration,

    logger:
      context?.logger ??
      null,

    observability:
      context?.observability ??
      null,

    readiness:
      context?.readiness ??
      null,

    resilience:
      context?.resilience ??
      null,

    infrastructure,
  };
}

/* =============================================================================
 * LIFECYCLE CONTEXT ENRICHMENT
 * =============================================================================
 *
 * This helper guarantees that every lifecycle callback receives the SAME
 * mutable execution-context instance for a subsystem startup/shutdown cycle.
 *
 * We avoid:
 *
 *   { ...executionContext, ...hookContext }
 *
 * as the primary context because spreading creates a new object and therefore
 * prevents runtime handles attached by one callback from becoming authoritative
 * on the shared infrastructure execution context.
 *
 * Hook-specific metadata is attached under `hook` rather than replacing the
 * shared execution context.
 * =============================================================================
 */

function createLifecycleExecutionContext(
  executionContext,
  hookContext,
) {
  if (
    !executionContext ||
    typeof executionContext !== "object"
  ) {
    throw new TypeError(
      "TITech infrastructure execution context must be an object.",
    );
  }

  executionContext.hook =
    hookContext ?? null;

  return executionContext;
}

/* =============================================================================
 * ENABLEMENT / CRITICALITY
 * =============================================================================
 */

function readEnabledFlag(
  context,
  subsystem,
) {
  const config =
    context?.configuration ??
    context?.config ??
    null;

  const environment =
    context?.environment ??
    null;

  const configCandidates = [
    config?.infrastructure?.[
      subsystem
    ]?.enabled,

    config?.infrastructure?.enabled?.[
      subsystem
    ],

    config?.[subsystem]?.enabled,

    config?.services?.[
      subsystem
    ]?.enabled,

    subsystem === "database"
      ? config?.database?.enabled
      : undefined,

    subsystem === "redis"
      ? config?.redis?.enabled
      : undefined,

    subsystem === "queue"
      ? config?.queue?.enabled
      : undefined,

    subsystem === "resilience"
      ? config?.resilience?.enabled
      : undefined,

    subsystem === "eventBus"
      ? config?.eventBus?.enabled
      : undefined,

    subsystem === "socketIO"
      ? config?.socketIO?.enabled
      : undefined,

    subsystem === "apiGateway"
      ? config?.apiGateway?.enabled
      : undefined,
  ];

  for (const candidate of configCandidates) {
    const parsed =
      parseBooleanFlag(candidate);

    if (parsed !== null) {
      return parsed;
    }
  }

  const environmentCandidates = [
    environment?.[subsystem]?.enabled,

    environment?.infrastructure?.[
      subsystem
    ]?.enabled,

    environment?.infrastructure?.enabled?.[
      subsystem
    ],

    process.env[
      ENABLE_FLAGS[subsystem]
    ],
  ];

  for (
    const candidate of
      environmentCandidates
  ) {
    const parsed =
      parseBooleanFlag(candidate);

    if (parsed !== null) {
      return parsed;
    }
  }

  return Boolean(
    DEFAULT_ENABLED[subsystem],
  );
}

function isCriticalSubsystem(
  subsystem,
  context,
) {
  const config =
    context?.configuration ??
    context?.config ??
    null;

  const configuredCritical =
    parseBooleanFlag(
      config?.infrastructure?.[
        subsystem
      ]?.critical,
    );

  if (configuredCritical !== null) {
    return configuredCritical;
  }

  return [
    "database",
    "redis",
    "resilience",
  ].includes(subsystem);
}

/* =============================================================================
 * REGISTRATION STATE
 * =============================================================================
 */

function getRegistration(
  subsystem,
) {
  return registrationState.get(
    subsystem,
  );
}

function setRegistration(
  subsystem,
  value,
) {
  const registration =
    Object.freeze({
      subsystem,
      ...value,
      updatedAt:
        getNowIso(),
    });

  registrationState.set(
    subsystem,
    registration,
  );

  return registration;
}

function markRegistrationFailure(
  subsystem,
  error,
) {
  const current =
    getRegistration(
      subsystem,
    );

  return setRegistration(
    subsystem,
    {
      ...(current ?? {}),

      enabled:
        current?.enabled ??
        true,

      available:
        current?.available ??
        false,

      registered:
        current?.registered ??
        false,

      started: false,

      state: "failed",

      lastError: {
        name:
          error?.name,

        code:
          error?.code,

        message:
          error?.message,
      },

      failedAt:
        getNowIso(),
    },
  );
}

function markRegistrationStopped(
  subsystem,
) {
  const current =
    getRegistration(
      subsystem,
    );

  if (!current) {
    return;
  }

  setRegistration(
    subsystem,
    {
      ...current,

      started: false,

      state:
        "stopped",

      stoppedAt:
        getNowIso(),
    },
  );
}

/* =============================================================================
 * REGISTER ONE INFRASTRUCTURE COMPONENT
 * =============================================================================
 */

function registerInfrastructureComponent(
  subsystem,
  context,
) {
  const existing =
    getRegistration(
      subsystem,
    );

  if (
    existing &&
    existing.state !== "failed"
  ) {
    return existing;
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      INFRASTRUCTURE_MODULES,
      subsystem,
    )
  ) {
    throw new Error(
      `Unknown TITech infrastructure subsystem "${subsystem}".`,
    );
  }

  const enabled =
    readEnabledFlag(
      context,
      subsystem,
    );

  const critical =
    isCriticalSubsystem(
      subsystem,
      context,
    );

  if (!enabled) {
    return setRegistration(
      subsystem,
      {
        enabled: false,
        available: false,
        registered: false,
        started: false,
        state: "disabled",
        critical,
        reason: "disabled",
      },
    );
  }

  let loaded;

  try {
    loaded =
      resolveInfrastructureModule(
        context,
        subsystem,
      );
  } catch (error) {
    return markRegistrationFailure(
      subsystem,
      error,
    );
  }

  if (!loaded) {
    return setRegistration(
      subsystem,
      {
        enabled: true,
        available: false,
        registered: false,
        started: false,
        state: "unavailable",
        critical,
        reason:
          "module-not-found",
      },
    );
  }

  const resolvedLifecycle =
    resolveLifecycleMethods(
      loaded,
    );

  if (
    !resolvedLifecycle?.start
  ) {
    return setRegistration(
      subsystem,
      {
        enabled: true,
        available: true,
        registered: false,
        started: false,
        state: "invalid",
        critical,
        reason:
          "startup-lifecycle-method-missing",
        modulePath:
          loaded.modulePath,
        resolutionSource:
          loaded.source ??
          "unknown",
        startupMethod:
          null,
        shutdownMethod:
          resolvedLifecycle?.stop?.name ??
          null,
      },
    );
  }

  /**
   * ONE shared mutable execution context for this infrastructure subsystem.
   */
  const executionContext =
    createInfrastructureContext(
      context,
    );

  const dependencies =
    DEPENDENCIES[subsystem] ??
    [];

  const priority =
    PRIORITIES[subsystem] ??
    0;

  const metadata =
    Object.freeze({
      subsystem,

      modulePath:
        loaded.modulePath,

      resolutionSource:
        loaded.source ??
        "unknown",

      startupMethod:
        resolvedLifecycle
          .start.name,

      shutdownMethod:
        resolvedLifecycle
          .stop?.name ??
        null,

      dependencies: [
        ...dependencies,
      ],

      priority,

      critical,
    });

  if (
    hooks &&
    typeof hooks.has ===
      "function" &&
    !hooks.has(
      subsystem,
    )
  ) {
    lifecycle(
      subsystem,
      {
        priority,

        dependencies,

        critical,

        metadata,

        start:
          async hookContext => {
            createLifecycleExecutionContext(
              executionContext,
              hookContext,
            );

            setRegistration(
              subsystem,
              {
                enabled: true,
                available: true,
                registered: true,
                started: false,
                state: "starting",
                critical,
                modulePath:
                  loaded.modulePath,
                resolutionSource:
                  loaded.source ??
                  "unknown",
                startupMethod:
                  resolvedLifecycle
                    .start.name,
                shutdownMethod:
                  resolvedLifecycle
                    .stop?.name ??
                  null,
                dependencies: [
                  ...dependencies,
                ],
                priority,
              },
            );

            try {
              const result =
                await invokeLifecycleMethod(
                  resolvedLifecycle.start,
                  executionContext,
                );

              /**
               * Runtime handles belong to the mutable execution context.
               *
               * Examples:
               *
               *   executionContext.database
               *   executionContext.redis
               *   executionContext.queue
               *
               * No runtime handle is copied into the immutable infrastructure
               * namespace.
               */
              setRegistration(
                subsystem,
                {
                  enabled: true,
                  available: true,
                  registered: true,
                  started: true,
                  state: "started",
                  critical,
                  modulePath:
                    loaded.modulePath,
                  resolutionSource:
                    loaded.source ??
                    "unknown",
                  startupMethod:
                    resolvedLifecycle
                      .start.name,
                  shutdownMethod:
                    resolvedLifecycle
                      .stop?.name ??
                    null,
                  dependencies: [
                    ...dependencies,
                  ],
                  priority,
                  lastStartResult:
                    result,
                  startedAt:
                    getNowIso(),
                },
              );

              return result;
            } catch (error) {
              markRegistrationFailure(
                subsystem,
                error,
              );

              throw error;
            }
          },

        stop:
          async hookContext => {
            createLifecycleExecutionContext(
              executionContext,
              hookContext,
            );

            const current =
              getRegistration(
                subsystem,
              );

            if (
              !current ||
              !current.started
            ) {
              markRegistrationStopped(
                subsystem,
              );

              return undefined;
            }

            try {
              const result =
                await invokeLifecycleMethod(
                  resolvedLifecycle.stop,
                  executionContext,
                );

              markRegistrationStopped(
                subsystem,
              );

              return result;
            } catch (error) {
              markRegistrationFailure(
                subsystem,
                error,
              );

              throw error;
            }
          },
      },
    );
  }

  return setRegistration(
    subsystem,
    {
      enabled: true,
      available: true,
      registered: true,
      started: false,
      state: "registered",
      critical,
      modulePath:
        loaded.modulePath,
      resolutionSource:
        loaded.source ??
        "unknown",
      startupMethod:
        resolvedLifecycle
          .start.name,
      shutdownMethod:
        resolvedLifecycle
          .stop?.name ??
        null,
      dependencies: [
        ...dependencies,
      ],
      priority,
      reason:
        hooks &&
        typeof hooks.has ===
          "function" &&
        hooks.has(
          subsystem,
        )
          ? "already-registered"
          : undefined,
    },
  );
}

/* =============================================================================
 * REGISTER ALL INFRASTRUCTURE
 * =============================================================================
 */

function registerInfrastructure(
  context = {},
) {
  const normalizedContext =
    context || {};

  const results = {};

  for (
    const subsystem of
      SUBSYSTEM_ORDER
  ) {
    results[subsystem] =
      registerInfrastructureComponent(
        subsystem,
        normalizedContext,
      );
  }

  return Object.freeze({
    ...results,

    initialized:
      false,

    registeredAt:
      getNowIso(),
  });
}

/* =============================================================================
 * PROVIDED INFRASTRUCTURE REGISTRATION
 * =============================================================================
 */

function registerProvidedInfrastructure(
  subsystem,
  moduleValue,
  context = {},
  options = {},
) {
  if (!moduleValue) {
    throw new TypeError(
      `Cannot register TITech infrastructure "${subsystem}" without a module.`,
    );
  }

  const existing =
    getRegistration(
      subsystem,
    );

  if (
    existing &&
    existing.state !== "failed"
  ) {
    return existing;
  }

  const exported =
    unwrapModule(
      moduleValue,
    );

  const explicitStart =
    isFunction(options.start)
      ? {
          target: exported,
          name:
            "explicit-start",
          fn: options.start,
        }
      : null;

  const explicitStop =
    isFunction(options.stop)
      ? {
          target: exported,
          name:
            "explicit-stop",
          fn: options.stop,
        }
      : null;

  const automatic =
    resolveLifecycleMethods({
      modulePath:
        options.modulePath ??
        `provided:${subsystem}`,

      module:
        exported,
    });

  const resolvedStart =
    explicitStart ??
    automatic?.start ??
    null;

  const resolvedStop =
    explicitStop ??
    automatic?.stop ??
    null;

  if (!resolvedStart) {
    throw new TypeError(
      `TITech infrastructure "${subsystem}" does not expose a supported startup lifecycle method.`,
    );
  }

  const executionContext =
    createInfrastructureContext(
      context,
    );

  const critical =
    options.critical ??
    isCriticalSubsystem(
      subsystem,
      context,
    );

  const dependencies =
    Array.isArray(
      options.dependencies,
    )
      ? [
          ...options.dependencies,
        ]
      : DEPENDENCIES[
          subsystem
        ] ?? [];

  const priority =
    options.priority ??
    PRIORITIES[subsystem] ??
    0;

  const modulePath =
    options.modulePath ??
    `provided:${subsystem}`;

  if (
    hooks &&
    typeof hooks.has ===
      "function" &&
    !hooks.has(
      subsystem,
    )
  ) {
    lifecycle(
      subsystem,
      {
        priority,
        dependencies,
        critical,

        metadata: {
          subsystem,
          explicit: true,
          critical,
          priority,
          dependencies: [
            ...dependencies,
          ],
          modulePath,
        },

        start:
          async hookContext => {
            createLifecycleExecutionContext(
              executionContext,
              hookContext,
            );

            setRegistration(
              subsystem,
              {
                enabled: true,
                available: true,
                registered: true,
                started: false,
                state: "starting",
                explicit: true,
                critical,
                modulePath,
                resolutionSource:
                  "explicit",
                startupMethod:
                  resolvedStart.name,
                shutdownMethod:
                  resolvedStop?.name ??
                  null,
                dependencies: [
                  ...dependencies,
                ],
                priority,
              },
            );

            try {
              const result =
                await invokeLifecycleMethod(
                  resolvedStart,
                  executionContext,
                );

              setRegistration(
                subsystem,
                {
                  enabled: true,
                  available: true,
                  registered: true,
                  started: true,
                  state: "started",
                  explicit: true,
                  critical,
                  modulePath,
                  resolutionSource:
                    "explicit",
                  startupMethod:
                    resolvedStart.name,
                  shutdownMethod:
                    resolvedStop?.name ??
                    null,
                  dependencies: [
                    ...dependencies,
                  ],
                  priority,
                  lastStartResult:
                    result,
                  startedAt:
                    getNowIso(),
                },
              );

              return result;
            } catch (error) {
              markRegistrationFailure(
                subsystem,
                error,
              );

              throw error;
            }
          },

        stop:
          async hookContext => {
            createLifecycleExecutionContext(
              executionContext,
              hookContext,
            );

            const current =
              getRegistration(
                subsystem,
              );

            if (
              !current ||
              !current.started
            ) {
              markRegistrationStopped(
                subsystem,
              );

              return undefined;
            }

            try {
              const result =
                await invokeLifecycleMethod(
                  resolvedStop,
                  executionContext,
                );

              markRegistrationStopped(
                subsystem,
              );

              return result;
            } catch (error) {
              markRegistrationFailure(
                subsystem,
                error,
              );

              throw error;
            }
          },
      },
    );
  }

  return setRegistration(
    subsystem,
    {
      enabled: true,
      available: true,
      registered: true,
      started: false,
      state: "registered",
      explicit: true,
      critical,
      modulePath,
      resolutionSource:
        "explicit",
      startupMethod:
        resolvedStart.name,
      shutdownMethod:
        resolvedStop?.name ??
        null,
      dependencies: [
        ...dependencies,
      ],
      priority,
    },
  );
}

/* =============================================================================
 * EXPLICIT ADAPTERS
 * =============================================================================
 */

function registerDatabase(
  moduleValue,
  context = {},
  options = {},
) {
  return registerProvidedInfrastructure(
    "database",
    moduleValue,
    context,
    options,
  );
}

function registerRedis(
  moduleValue,
  context = {},
  options = {},
) {
  return registerProvidedInfrastructure(
    "redis",
    moduleValue,
    context,
    options,
  );
}

function registerQueue(
  moduleValue,
  context = {},
  options = {},
) {
  return registerProvidedInfrastructure(
    "queue",
    moduleValue,
    context,
    options,
  );
}

function registerEventBus(
  moduleValue,
  context = {},
  options = {},
) {
  return registerProvidedInfrastructure(
    "eventBus",
    moduleValue,
    context,
    options,
  );
}

function registerResilience(
  moduleValue,
  context = {},
  options = {},
) {
  return registerProvidedInfrastructure(
    "resilience",
    moduleValue,
    context,
    options,
  );
}

function registerSocketIO(
  moduleValue,
  context = {},
  options = {},
) {
  return registerProvidedInfrastructure(
    "socketIO",
    moduleValue,
    context,
    options,
  );
}

function registerApiGateway(
  moduleValue,
  context = {},
  options = {},
) {
  return registerProvidedInfrastructure(
    "apiGateway",
    moduleValue,
    context,
    options,
  );
}

/* =============================================================================
 * HOOK ENGINE STARTUP RESOLUTION
 * =============================================================================
 */

function resolveHookStartupExecutor() {
  if (typeof startup === "function") {
    return {
      target: null,
      method: "startup",
      execute: startup,
    };
  }

  const candidates = [
    [startup, "run"],
    [startup, "execute"],
    [startup, "start"],
    [startup, "initialize"],
    [hooks, "run"],
    [hooks, "execute"],
    [hooks, "start"],
    [hooks, "initialize"],
  ];

  for (
    const [target, method] of
      candidates
  ) {
    if (
      target &&
      isFunction(target[method])
    ) {
      return {
        target,
        method,
        execute:
          target[method],
      };
    }
  }

  return null;
}

function resolveHookShutdownExecutor() {
  const candidates = [
    [startup, "shutdown"],
    [startup, "stop"],
    [startup, "close"],
    [startup, "destroy"],
    [hooks, "shutdown"],
    [hooks, "stop"],
    [hooks, "close"],
    [hooks, "destroy"],
  ];

  for (
    const [target, method] of
      candidates
  ) {
    if (
      target &&
      isFunction(target[method])
    ) {
      return {
        target,
        method,
        execute:
          target[method],
      };
    }
  }

  return null;
}

/* =============================================================================
 * EXECUTE REGISTERED INFRASTRUCTURE
 * =============================================================================
 */

async function executeRegisteredInfrastructure(
  context = {},
) {
  const executionContext =
    createInfrastructureContext(
      context,
    );

  const executor =
    resolveHookStartupExecutor();

  if (!executor) {
    throw new Error(
      "TITech infrastructure hook startup engine is unavailable.",
    );
  }

  return executor.execute.call(
    executor.target,
    executionContext,
  );
}

/* =============================================================================
 * EXECUTE INFRASTRUCTURE SHUTDOWN
 * =============================================================================
 */

async function executeRegisteredInfrastructureShutdown(
  context = {},
) {
  const executionContext =
    createInfrastructureContext(
      context,
    );

  const executor =
    resolveHookShutdownExecutor();

  if (!executor) {
    throw new Error(
      "TITech infrastructure hook shutdown engine is unavailable.",
    );
  }

  return executor.execute.call(
    executor.target,
    executionContext,
  );
}

/* =============================================================================
 * REGISTRATION VALIDATION
 * =============================================================================
 */

function getInfrastructureStatus() {
  const status = {};

  for (
    const [
      subsystem,
      value,
    ] of registrationState
  ) {
    status[subsystem] = {
      ...value,
    };
  }

  return Object.freeze(
    status,
  );
}

function getCriticalUnavailableSubsystems() {
  return Object.values(
    getInfrastructureStatus(),
  )
    .filter(
      entry =>
        entry.enabled &&
        entry.critical &&
        (
          !entry.available ||
          !entry.registered
        ),
    )
    .map(
      entry =>
        entry.subsystem,
    );
}

function getCriticalNotStartedSubsystems() {
  return Object.values(
    getInfrastructureStatus(),
  )
    .filter(
      entry =>
        entry.enabled &&
        entry.critical &&
        (
          !entry.available ||
          !entry.registered ||
          !entry.started
        ),
    )
    .map(
      entry =>
        entry.subsystem,
    );
}

function validateRegistrationsBeforeStart() {
  const invalid =
    Object.values(
      getInfrastructureStatus(),
    )
      .filter(
        entry =>
          entry.enabled &&
          entry.critical &&
          (
            !entry.available ||
            !entry.registered
          ),
      );

  if (!invalid.length) {
    return true;
  }

  const details =
    invalid
      .map(
        entry =>
          `${entry.subsystem} (${
            entry.reason ||
            "unavailable"
          })`,
      )
      .join(", ");

  throw new Error(
    `TITech critical infrastructure is unavailable: ${details}.`,
  );
}

function validateStartedInfrastructure() {
  const notStarted =
    getCriticalNotStartedSubsystems();

  if (!notStarted.length) {
    return true;
  }

  throw new Error(
    "TITech critical infrastructure startup did not complete for: " +
      `${notStarted.join(", ")}.`,
  );
}

/* =============================================================================
 * PARTIAL STARTUP CLEANUP
 * =============================================================================
 */

async function cleanupPartialInfrastructure(
  context,
  originalError,
) {
  const activeSubsystems =
    Object.values(
      getInfrastructureStatus(),
    )
      .filter(
        entry =>
          entry.enabled &&
          entry.started,
      )
      .map(
        entry =>
          entry.subsystem,
      );

  if (!activeSubsystems.length) {
    return Object.freeze({
      attempted: false,
      cleaned: true,
      activeSubsystems: [],
    });
  }

  try {
    await executeRegisteredInfrastructureShutdown(
      {
        ...(isObjectLike(context)
          ? context
          : {}),

        reason:
          "infrastructure_startup_failure",

        startupError:
          originalError,

        partialStartup: true,
      },
    );

    for (
      const subsystem of
        activeSubsystems
    ) {
      markRegistrationStopped(
        subsystem,
      );
    }

    return Object.freeze({
      attempted: true,
      cleaned: true,
      activeSubsystems,
    });
  } catch (cleanupError) {
    for (
      const subsystem of
        activeSubsystems
    ) {
      const current =
        getRegistration(
          subsystem,
        );

      if (current?.started) {
        markRegistrationFailure(
          subsystem,
          cleanupError,
        );
      }
    }

    return Object.freeze({
      attempted: true,
      cleaned: false,
      activeSubsystems,

      error: {
        name:
          cleanupError?.name,

        code:
          cleanupError?.code,

        message:
          cleanupError?.message,
      },
    });
  }
}

/* =============================================================================
 * INITIALIZATION RESULT
 * =============================================================================
 */

function buildInitializationResult(
  context,
  startupResult,
) {
  const status =
    getInfrastructureStatus();

  const criticalUnavailable =
    getCriticalUnavailableSubsystems();

  const criticalNotStarted =
    getCriticalNotStartedSubsystems();

  return Object.freeze({
    ok:
      criticalUnavailable.length === 0 &&
      criticalNotStarted.length === 0,

    initialized: true,

    service:
      "titech-community-capital-backend",

    application:
      "TITech Community Capital",

    state:
      "initialized",

    subsystems:
      status,

    criticalUnavailable,

    criticalNotStarted,

    startupResult,

    context: {
      bootstrapContext:
        context,
    },

    timestamp:
      getNowIso(),
  });
}

/* =============================================================================
 * INITIALIZE INFRASTRUCTURE
 * =============================================================================
 */

async function initializeInfrastructure(
  context = {},
) {
  if (initialized) {
    return (
      initializationResult ||
      Object.freeze({
        ok: true,
        initialized: true,
        idempotent: true,
        subsystems:
          getInfrastructureStatus(),
        timestamp:
          getNowIso(),
      })
    );
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  if (shuttingDown) {
    throw new Error(
      "TITech infrastructure cannot initialize while shutdown is in progress.",
    );
  }

  initializationPromise =
    (async () => {
      initializing = true;
      startupAttempted = false;

      const effectiveContext =
        context || {};

      initializationContext =
        effectiveContext;

      try {
        registerInfrastructure(
          effectiveContext,
        );

        validateRegistrationsBeforeStart();

        startupAttempted = true;

        const startupResult =
          await executeRegisteredInfrastructure(
            effectiveContext,
          );

        validateStartedInfrastructure();

        initialized = true;

        initializationResult =
          buildInitializationResult(
            effectiveContext,
            startupResult,
          );

        if (
          !initializationResult.ok
        ) {
          throw new Error(
            "TITech infrastructure initialization completed with an invalid readiness state.",
          );
        }

        return initializationResult;
      } catch (error) {
        initialized = false;
        initializationResult = null;

        if (startupAttempted) {
          const cleanupResult =
            await cleanupPartialInfrastructure(
              effectiveContext,
              error,
            );

          if (
            error &&
            typeof error ===
              "object"
          ) {
            try {
              error.infrastructureCleanup =
                cleanupResult;
            } catch {
              // Diagnostic attachment is advisory only.
            }
          }
        }

        throw error;
      } finally {
        initializing = false;
        startupAttempted = false;
      }
    })();

  try {
    return await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

/* =============================================================================
 * BOOTSTRAP / START ALIASES
 * =============================================================================
 */

const bootstrapInfrastructure =
  initializeInfrastructure;

const startInfrastructure =
  initializeInfrastructure;

/* =============================================================================
 * SHUTDOWN INFRASTRUCTURE
 * =============================================================================
 */

async function shutdownInfrastructure(
  context =
    initializationContext ||
    {},
  options = {},
) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  if (shuttingDown) {
    return Object.freeze({
      ok: true,
      shutdown: false,
      idempotent: true,
      reason:
        "shutdown-already-in-progress",
    });
  }

  shutdownPromise =
    (async () => {
      shuttingDown = true;

      const effectiveContext = {
        ...(isObjectLike(context)
          ? context
          : {}),

        ...(isObjectLike(options)
          ? options
          : {}),
      };

      try {
        const activeSubsystems =
          Object.values(
            getInfrastructureStatus(),
          )
            .filter(
              entry =>
                entry.enabled &&
                entry.started,
            )
            .map(
              entry =>
                entry.subsystem,
            );

        if (!activeSubsystems.length) {
          initialized = false;
          initializationResult = null;

          return Object.freeze({
            ok: true,
            initialized: false,
            shutdown: true,
            idempotent: true,
            reason:
              "no-active-infrastructure",
            subsystems:
              getInfrastructureStatus(),
            timestamp:
              getNowIso(),
          });
        }

        const shutdownResult =
          await executeRegisteredInfrastructureShutdown(
            effectiveContext,
          );

        for (
          const [
            subsystem,
            registration,
          ] of registrationState
        ) {
          if (registration) {
            setRegistration(
              subsystem,
              {
                ...registration,
                started: false,
                state: "stopped",
                stoppedAt:
                  getNowIso(),
              },
            );
          }
        }

        initialized = false;
        initializationResult = null;

        return Object.freeze({
          ok: true,
          initialized: false,
          shutdown: true,
          shutdownResult,
          activeSubsystems,
          subsystems:
            getInfrastructureStatus(),
          timestamp:
            getNowIso(),
        });
      } catch (error) {
        for (
          const [
            subsystem,
            registration,
          ] of registrationState
        ) {
          if (
            registration?.started
          ) {
            markRegistrationFailure(
              subsystem,
              error,
            );
          }
        }

        throw error;
      } finally {
        shuttingDown = false;
        initializationContext = null;
      }
    })();

  try {
    return await shutdownPromise;
  } finally {
    shutdownPromise = null;
  }
}

/* =============================================================================
 * SHUTDOWN ALIASES
 * =============================================================================
 */

const stopInfrastructure =
  shutdownInfrastructure;

const closeInfrastructure =
  shutdownInfrastructure;

/* =============================================================================
 * BOOTSTRAP HOOK REGISTRATION
 * =============================================================================
 */

function registerBootstrapHooks(
  context = {},
) {
  return registerInfrastructure(
    context,
  );
}

/* =============================================================================
 * DIAGNOSTICS
 * =============================================================================
 */

function getInfrastructureSummary() {
  const status =
    getInfrastructureStatus();

  const values =
    Object.values(status);

  return Object.freeze({
    initialized,

    initializing,

    shuttingDown,

    registered:
      values.filter(
        value =>
          value.registered,
      ).length,

    available:
      values.filter(
        value =>
          value.available,
      ).length,

    started:
      values.filter(
        value =>
          value.started,
      ).length,

    enabled:
      values.filter(
        value =>
          value.enabled,
      ).length,

    failed:
      values.filter(
        value =>
          value.state === "failed",
      ).length,

    criticalUnavailable:
      getCriticalUnavailableSubsystems(),

    criticalNotStarted:
      getCriticalNotStartedSubsystems(),

    ready:
      isInfrastructureReady(),
  });
}

function isInfrastructureRegistered(
  subsystem,
) {
  return Boolean(
    registrationState.get(
      subsystem,
    )?.registered,
  );
}

function isInfrastructureAvailable(
  subsystem,
) {
  return Boolean(
    registrationState.get(
      subsystem,
    )?.available,
  );
}

function isInfrastructureStarted(
  subsystem,
) {
  return Boolean(
    registrationState.get(
      subsystem,
    )?.started,
  );
}

function isInfrastructureReady() {
  if (!initialized) {
    return false;
  }

  const status =
    getInfrastructureStatus();

  return !Object.values(status).some(
    entry =>
      entry.enabled &&
      entry.critical &&
      (
        !entry.available ||
        !entry.registered ||
        !entry.started
      ),
  );
}

/* =============================================================================
 * RESET — TEST SUPPORT
 * =============================================================================
 */

function resetInfrastructureRegistry() {
  if (
    initialized ||
    initializing ||
    shuttingDown
  ) {
    throw new Error(
      "TITech infrastructure registry cannot be reset while active.",
    );
  }

  registrationState.clear();

  initializationPromise = null;
  shutdownPromise = null;
  initializationContext = null;
  initializationResult = null;

  initialized = false;
  startupAttempted = false;
}

/* =============================================================================
 * DEVELOPMENT COMPOSITION SELF-CHECK
 * =============================================================================
 */

function validateExportContract() {
  const requiredFunctions = [
    "initialize",
    "bootstrap",
    "start",
    "shutdown",
    "stop",
    "close",
    "registerInfrastructure",
    "registerBootstrapHooks",
  ];

  for (
    const name of
      requiredFunctions
  ) {
    if (
      !isFunction(
        module.exports[name],
      )
    ) {
      throw new Error(
        `TITech infrastructure export contract is invalid: "${name}" must be callable.`,
      );
    }
  }

  return true;
}

/* =============================================================================
 * PUBLIC EXPORT
 * =============================================================================
 */

module.exports = Object.freeze({
  /* Primary lifecycle API */
  initialize:
    initializeInfrastructure,

  initializeInfrastructure,

  bootstrap:
    bootstrapInfrastructure,

  bootstrapInfrastructure,

  start:
    startInfrastructure,

  startInfrastructure,

  shutdown:
    shutdownInfrastructure,

  shutdownInfrastructure,

  stop:
    stopInfrastructure,

  stopInfrastructure,

  close:
    closeInfrastructure,

  closeInfrastructure,

  /* Hook / composition registration */
  registerBootstrapHooks,

  registerInfrastructure,

  /* Explicit infrastructure adapters */
  registerDatabase,

  registerRedis,

  registerQueue,

  registerEventBus,

  registerResilience,

  registerSocketIO,

  registerApiGateway,

  /* Diagnostics */
  getInfrastructureStatus,

  getInfrastructureSummary,

  isInfrastructureRegistered,

  isInfrastructureAvailable,

  isInfrastructureStarted,

  isInfrastructureReady,

  /* Test support */
  resetInfrastructureRegistry,

  /* Metadata */
  INFRASTRUCTURE_MODULES,

  DEPENDENCIES,

  PRIORITIES,

  ENABLE_FLAGS,

  DEFAULT_ENABLED,

  SUBSYSTEM_ORDER,

  START_METHODS,

  STOP_METHODS,
});

/* =============================================================================
 * DEVELOPMENT SELF-CHECK
 * =============================================================================
 */

if (
  process.env.NODE_ENV !==
  "production"
) {
  validateExportContract();
}