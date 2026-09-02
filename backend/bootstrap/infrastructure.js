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
 * -----------------------------------------------------------------------------
 * ARCHITECTURE
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
 *       ↓
 *   runtimeReady
 *       ↓
 *   ready
 *
 * -----------------------------------------------------------------------------
 * LIFECYCLE AUTHORITY
 * -----------------------------------------------------------------------------
 *
 * Canonical lifecycle authority:
 *
 *   BootstrapContext
 *
 * Compatibility/read-model:
 *
 *   runtime/state.js
 *
 * This module NEVER replaces:
 *
 *   context.state
 *
 * with infrastructure runtime state.
 *
 * -----------------------------------------------------------------------------
 * RESPONSIBILITIES
 * -----------------------------------------------------------------------------
 *
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
 * ✓ Runtime initialization contract
 * ✓ Runtime shutdown contract
 * ✓ Partial-startup rollback
 * ✓ Failed-start cleanup
 * ✓ Started-state verification
 * ✓ Infrastructure diagnostics
 * ✓ Health/readiness-aware lifecycle context
 * ✓ Mutable execution context for runtime handles
 * ✓ Immutable infrastructure metadata namespace
 * ✓ BootstrapContext preservation
 * ✓ Single-flight startup
 * ✓ Single-flight shutdown
 * ✓ Runtime generation tracking
 * ✓ CommonJS compatibility
 *
 * -----------------------------------------------------------------------------
 * NON-RESPONSIBILITIES
 * -----------------------------------------------------------------------------
 *
 * This module does NOT implement:
 *
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
 * CONSTANTS
 * =============================================================================
 */

const SERVICE_NAME =
  "titech-community-capital-backend";

const APPLICATION_NAME =
  "TITech Community Capital";

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

const PRIORITIES = Object.freeze({
  resilience: -500,
  database: -400,
  redis: -300,
  eventBus: -200,
  queue: -100,
  socketIO: 0,
  apiGateway: 100,
});

const ENABLE_FLAGS = Object.freeze({
  database: "MONGODB_ENABLED",
  redis: "REDIS_ENABLED",
  resilience: "RESILIENCE_ENABLED",
  eventBus: "EVENT_BUS_ENABLED",
  queue: "QUEUE_ENABLED",
  socketIO: "SOCKET_IO_ENABLED",
  apiGateway: "API_GATEWAY_ENABLED",
});

const DEFAULT_ENABLED = Object.freeze({
  database: true,
  redis: true,
  resilience: true,
  eventBus: true,
  queue: true,
  socketIO: false,
  apiGateway: false,
});

const SUBSYSTEM_ORDER = Object.freeze([
  "resilience",
  "database",
  "redis",
  "eventBus",
  "queue",
  "socketIO",
  "apiGateway",
]);

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

const CONFIGURATION_MODULE_KEYS = Object.freeze([
  "module",
  "adapter",
  "implementation",
  "path",
  "modulePath",
  "require",
]);

const LIFECYCLE_STATES = Object.freeze({
  DISABLED: "disabled",
  UNAVAILABLE: "unavailable",
  INVALID: "invalid",
  REGISTERED: "registered",
  STARTING: "starting",
  STARTED: "started",
  STOPPED: "stopped",
  FAILED: "failed",
});

/* =============================================================================
 * INTERNAL STATE
 * =============================================================================
 *
 * These variables describe the infrastructure orchestrator itself.
 *
 * They are NOT a replacement for BootstrapContext.
 * =============================================================================
 */

const registrationState = new Map();

/**
 * Shared execution contexts by subsystem.
 *
 * A lifecycle hook may execute many times over the lifetime of the Node
 * process. Keeping the context object stable prevents adapters from retaining
 * stale references while still allowing the current BootstrapContext to be
 * refreshed for a new runtime generation.
 */
const executionContexts = new Map();

let initialized = false;
let initializing = false;
let shuttingDown = false;

let initializationPromise = null;
let shutdownPromise = null;

let initializationContext = null;
let initializationResult = null;

let startupAttempted = false;

let runtimeGeneration = 0;

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

function createErrorDescriptor(error) {
  if (!error) {
    return null;
  }

  return Object.freeze({
    name:
      error.name ??
      "Error",

    code:
      error.code ??
      null,

    message:
      error.message ??
      String(error),
  });
}

function normalizeBoolean(value, fallback = null) {
  const parsed =
    parseBooleanFlag(value);

  return parsed === null
    ? fallback
    : parsed;
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

  const normalized =
    String(value)
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

      module:
        require(modulePath),

      source:
        "repository",
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

function getRootDirectory() {
  return path.resolve(
    __dirname,
    "..",
  );
}

/* =============================================================================
 * CONFIGURATION RESOLUTION
 * =============================================================================
 */

function getSubsystemConfiguration(
  context,
  subsystem,
) {
  const configuration =
    context?.configuration ??
    context?.config ??
    null;

  if (!configuration) {
    return null;
  }

  return (
    configuration?.infrastructure?.[
      subsystem
    ] ??
    configuration?.[
      subsystem
    ] ??
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
        isFunction(configuration.init) ||
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
    const key of
      CONFIGURATION_MODULE_KEYS
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
      source:
        `configuration.${key}`,
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
    typeof definition.value !==
    "string"
  ) {
    return {
      modulePath:
        `configured:${subsystem}`,

      module:
        definition.value,

      source:
        definition.source,
    };
  }

  const configuredPath =
    definition.value.trim();

  if (!configuredPath) {
    return null;
  }

  const backendRoot =
    getRootDirectory();

  const absolutePath =
    path.isAbsolute(
      configuredPath,
    )
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
    modulePath:
      absolutePath,

    module:
      require(absolutePath),

    source:
      definition.source,
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
    INFRASTRUCTURE_MODULES[
      subsystem
    ] ?? [],
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
        fn:
          target[name],
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

  if (
    !isFunction(
      lifecycleMethod.fn,
    )
  ) {
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
 * EXECUTION CONTEXT
 * =============================================================================
 */

function createInfrastructureContext(
  context,
  subsystem = null,
) {
  const bootstrapContext =
    context ??
    null;

  const configuration =
    bootstrapContext?.configuration ??
    bootstrapContext?.config ??
    null;

  /**
   * ---------------------------------------------------------------------------
   * Immutable metadata namespace
   * ---------------------------------------------------------------------------
   *
   * This namespace intentionally contains no mutable runtime handles.
   */
  const infrastructure = {
    rootDirectory:
      getRootDirectory(),

    service:
      SERVICE_NAME,

    application:
      APPLICATION_NAME,

    subsystem,

    generation:
      runtimeGeneration,

    environment:
      bootstrapContext?.environment ??
      null,

    configuration,

    config:
      configuration,

    logger:
      bootstrapContext?.logger ??
      null,

    observability:
      bootstrapContext?.observability ??
      null,

    readiness:
      bootstrapContext?.readiness ??
      null,

    resilience:
      bootstrapContext?.resilience ??
      null,

    hooks:
      bootstrapContext?.hooks ??
      hooks ??
      null,

    bootstrapContext,
  };

  Object.freeze(
    infrastructure,
  );

  /**
   * ---------------------------------------------------------------------------
   * Mutable lifecycle execution context
   * ---------------------------------------------------------------------------
   *
   * Runtime adapters may attach their handles here:
   *
   *   executionContext.database
   *   executionContext.redis
   *   executionContext.eventBus
   *   executionContext.queue
   *   executionContext.socketIO
   *   executionContext.apiGateway
   *
   * These handles MUST NOT be written into BootstrapContext.state.
   */
  return {
    bootstrapContext,

    service:
      SERVICE_NAME,

    application:
      APPLICATION_NAME,

    subsystem,

    generation:
      runtimeGeneration,

    environment:
      bootstrapContext?.environment ??
      null,

    configuration,

    config:
      configuration,

    logger:
      bootstrapContext?.logger ??
      null,

    observability:
      bootstrapContext?.observability ??
      null,

    readiness:
      bootstrapContext?.readiness ??
      null,

    resilience:
      bootstrapContext?.resilience ??
      null,

    infrastructure,

    hook:
      null,
  };
}

/**
 * Get or create the stable execution context for a subsystem.
 *
 * This is important because hook registration can happen once while the
 * runtime itself may be initialized more than once during the life of the
 * Node.js process, especially in tests or controlled restart scenarios.
 */
function getOrCreateExecutionContext(
  subsystem,
  context,
) {
  const existing =
    executionContexts.get(
      subsystem,
    );

  if (existing) {
    refreshExecutionContext(
      existing,
      context,
      subsystem,
    );

    return existing;
  }

  const created =
    createInfrastructureContext(
      context,
      subsystem,
    );

  executionContexts.set(
    subsystem,
    created,
  );

  return created;
}

function refreshExecutionContext(
  executionContext,
  context,
  subsystem,
) {
  if (!executionContext) {
    return;
  }

  const bootstrapContext =
    context ??
    null;

  const configuration =
    bootstrapContext?.configuration ??
    bootstrapContext?.config ??
    null;

  executionContext.bootstrapContext =
    bootstrapContext;

  executionContext.subsystem =
    subsystem;

  executionContext.generation =
    runtimeGeneration;

  executionContext.environment =
    bootstrapContext?.environment ??
    null;

  executionContext.configuration =
    configuration;

  executionContext.config =
    configuration;

  executionContext.logger =
    bootstrapContext?.logger ??
    null;

  executionContext.observability =
    bootstrapContext?.observability ??
    null;

  executionContext.readiness =
    bootstrapContext?.readiness ??
    null;

  executionContext.resilience =
    bootstrapContext?.resilience ??
    null;

  executionContext.infrastructure =
    Object.freeze({
      rootDirectory:
        getRootDirectory(),

      service:
        SERVICE_NAME,

      application:
        APPLICATION_NAME,

      subsystem,

      generation:
        runtimeGeneration,

      environment:
        bootstrapContext?.environment ??
        null,

      configuration,

      config:
        configuration,

      logger:
        bootstrapContext?.logger ??
        null,

      observability:
        bootstrapContext?.observability ??
        null,

      readiness:
        bootstrapContext?.readiness ??
        null,

      resilience:
        bootstrapContext?.resilience ??
        null,

      hooks:
        bootstrapContext?.hooks ??
        hooks ??
        null,

      bootstrapContext,
    });
}

function createLifecycleExecutionContext(
  executionContext,
  hookContext,
) {
  if (
    !executionContext ||
    typeof executionContext !==
      "object"
  ) {
    throw new TypeError(
      "TITech infrastructure execution context must be an object.",
    );
  }

  executionContext.hook =
    hookContext ??
    null;

  return executionContext;
}

/* =============================================================================
 * ENABLEMENT
 * =============================================================================
 */

function readEnabledFlag(
  context,
  subsystem,
) {
  const configuration =
    context?.configuration ??
    context?.config ??
    null;

  const environment =
    context?.environment ??
    null;

  const configCandidates = [
    configuration?.infrastructure?.[
      subsystem
    ]?.enabled,

    configuration?.infrastructure
      ?.enabled?.[
        subsystem
      ],

    configuration?.[
      subsystem
    ]?.enabled,

    configuration?.services?.[
      subsystem
    ]?.enabled,
  ];

  for (
    const candidate of
      configCandidates
  ) {
    const parsed =
      parseBooleanFlag(
        candidate,
      );

    if (parsed !== null) {
      return parsed;
    }
  }

  const environmentCandidates = [
    environment?.[
      subsystem
    ]?.enabled,

    environment?.infrastructure?.[
      subsystem
    ]?.enabled,

    environment?.infrastructure
      ?.enabled?.[
        subsystem
      ],

    process.env[
      ENABLE_FLAGS[
        subsystem
      ]
    ],
  ];

  for (
    const candidate of
      environmentCandidates
  ) {
    const parsed =
      parseBooleanFlag(
        candidate,
      );

    if (parsed !== null) {
      return parsed;
    }
  }

  return Boolean(
    DEFAULT_ENABLED[
      subsystem
    ],
  );
}

function isCriticalSubsystem(
  subsystem,
  context,
) {
  const configuration =
    context?.configuration ??
    context?.config ??
    null;

  const configuredCritical =
    parseBooleanFlag(
      configuration?.infrastructure?.[
        subsystem
      ]?.critical,
    );

  if (
    configuredCritical !==
    null
  ) {
    return configuredCritical;
  }

  return [
    "database",
    "redis",
    "resilience",
  ].includes(
    subsystem,
  );
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

      generation:
        runtimeGeneration,

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

      started:
        false,

      state:
        LIFECYCLE_STATES.FAILED,

      lastError:
        createErrorDescriptor(
          error,
        ),

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

      started:
        false,

      state:
        LIFECYCLE_STATES.STOPPED,

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
    existing.state !==
      LIFECYCLE_STATES.FAILED
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
        enabled:
          false,

        available:
          false,

        registered:
          false,

        started:
          false,

        state:
          LIFECYCLE_STATES.DISABLED,

        critical,

        reason:
          "disabled",
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
    const registration =
      markRegistrationFailure(
        subsystem,
        error,
      );

    if (critical) {
      return registration;
    }

    return registration;
  }

  if (!loaded) {
    return setRegistration(
      subsystem,
      {
        enabled:
          true,

        available:
          false,

        registered:
          false,

        started:
          false,

        state:
          LIFECYCLE_STATES.UNAVAILABLE,

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
        enabled:
          true,

        available:
          true,

        registered:
          false,

        started:
          false,

        state:
          LIFECYCLE_STATES.INVALID,

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
          resolvedLifecycle
            ?.stop
            ?.name ??
          null,
      },
    );
  }

  /**
   * Keep one stable mutable execution context for the registered subsystem.
   */
  const executionContext =
    getOrCreateExecutionContext(
      subsystem,
      context,
    );

  const dependencies =
    [
      ...(DEPENDENCIES[
        subsystem
      ] ?? []),
    ];

  const priority =
    Number.isFinite(
      PRIORITIES[subsystem],
    )
      ? PRIORITIES[subsystem]
      : 0;

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
          .start
          .name,

      shutdownMethod:
        resolvedLifecycle
          .stop
          ?.name ??
        null,

      dependencies,

      priority,

      critical,
    });

  const hookAlreadyRegistered =
    Boolean(
      hooks &&
      typeof hooks.has ===
        "function" &&
      hooks.has(subsystem),
    );

  if (!hookAlreadyRegistered) {
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
                enabled:
                  true,

                available:
                  true,

                registered:
                  true,

                started:
                  false,

                state:
                  LIFECYCLE_STATES.STARTING,

                critical,

                modulePath:
                  loaded.modulePath,

                resolutionSource:
                  loaded.source ??
                  "unknown",

                startupMethod:
                  resolvedLifecycle
                    .start
                    .name,

                shutdownMethod:
                  resolvedLifecycle
                    .stop
                    ?.name ??
                  null,

                dependencies,

                priority,
              },
            );

            try {
              const result =
                await invokeLifecycleMethod(
                  resolvedLifecycle.start,
                  executionContext,
                );

              setRegistration(
                subsystem,
                {
                  enabled:
                    true,

                  available:
                    true,

                  registered:
                    true,

                  started:
                    true,

                  state:
                    LIFECYCLE_STATES.STARTED,

                  critical,

                  modulePath:
                    loaded.modulePath,

                  resolutionSource:
                    loaded.source ??
                    "unknown",

                  startupMethod:
                    resolvedLifecycle
                      .start
                      .name,

                  shutdownMethod:
                    resolvedLifecycle
                      .stop
                      ?.name ??
                    null,

                  dependencies,

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

            /**
             * A subsystem may legitimately expose no shutdown method.
             *
             * In that case the hook itself remains lifecycle-safe and the
             * subsystem is marked stopped after startup resources have ceased
             * to be authoritative.
             */
            if (
              !resolvedLifecycle.stop
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
      enabled:
        true,

      available:
        true,

      registered:
        true,

      started:
        false,

      state:
        LIFECYCLE_STATES.REGISTERED,

      critical,

      modulePath:
        loaded.modulePath,

      resolutionSource:
        loaded.source ??
        "unknown",

      startupMethod:
        resolvedLifecycle
          .start
          .name,

      shutdownMethod:
        resolvedLifecycle
          .stop
          ?.name ??
        null,

      dependencies,

      priority,

      reason:
        hookAlreadyRegistered
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

    generation:
      runtimeGeneration,

    registeredAt:
      getNowIso(),
  });
}

/* =============================================================================
 * EXPLICIT / PROVIDED INFRASTRUCTURE
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

  const existing =
    getRegistration(
      subsystem,
    );

  if (
    existing &&
    existing.state !==
      LIFECYCLE_STATES.FAILED
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
          target:
            exported,

          name:
            "explicit-start",

          fn:
            options.start,
        }
      : null;

  const explicitStop =
    isFunction(options.stop)
      ? {
          target:
            exported,

          name:
            "explicit-stop",

          fn:
            options.stop,
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
    getOrCreateExecutionContext(
      subsystem,
      context,
    );

  const critical =
    normalizeBoolean(
      options.critical,
      isCriticalSubsystem(
        subsystem,
        context,
      ),
    );

  const dependencies =
    Array.isArray(
      options.dependencies,
    )
      ? [
          ...options.dependencies,
        ]
      : [
          ...(DEPENDENCIES[
            subsystem
          ] ?? []),
        ];

  const priority =
    Number.isFinite(
      options.priority,
    )
      ? options.priority
      : (
          Number.isFinite(
            PRIORITIES[
              subsystem
            ],
          )
            ? PRIORITIES[
                subsystem
              ]
            : 0
        );

  const modulePath =
    options.modulePath ??
    `provided:${subsystem}`;

  const hookAlreadyRegistered =
    Boolean(
      hooks &&
      typeof hooks.has ===
        "function" &&
      hooks.has(subsystem),
    );

  if (!hookAlreadyRegistered) {
    lifecycle(
      subsystem,
      {
        priority,

        dependencies,

        critical,

        metadata:
          Object.freeze({
            subsystem,

            explicit:
              true,

            critical,

            priority,

            dependencies: [
              ...dependencies,
            ],

            modulePath,
          }),

        start:
          async hookContext => {
            createLifecycleExecutionContext(
              executionContext,
              hookContext,
            );

            setRegistration(
              subsystem,
              {
                enabled:
                  true,

                available:
                  true,

                registered:
                  true,

                started:
                  false,

                state:
                  LIFECYCLE_STATES.STARTING,

                explicit:
                  true,

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
                  enabled:
                    true,

                  available:
                    true,

                  registered:
                    true,

                  started:
                    true,

                  state:
                    LIFECYCLE_STATES.STARTED,

                  explicit:
                    true,

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

            if (!resolvedStop) {
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
      enabled:
        true,

      available:
        true,

      registered:
        true,

      started:
        false,

      state:
        LIFECYCLE_STATES.REGISTERED,

      explicit:
        true,

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

      reason:
        hookAlreadyRegistered
          ? "already-registered"
          : undefined,
    },
  );
}

/* =============================================================================
 * EXPLICIT ADAPTER API
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
 * HOOK ENGINE EXECUTOR RESOLUTION
 * =============================================================================
 */

function resolveHookStartupExecutor() {
  if (typeof startup === "function") {
    return {
      target:
        null,

      method:
        "startup",

      execute:
        startup,
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
    const [
      target,
      method,
    ] of candidates
  ) {
    if (
      target &&
      isFunction(
        target[method],
      )
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
    const [
      target,
      method,
    ] of candidates
  ) {
    if (
      target &&
      isFunction(
        target[method],
      )
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
  for (
    const subsystem of
      SUBSYSTEM_ORDER
  ) {
    const executionContext =
      executionContexts.get(
        subsystem,
      );

    if (executionContext) {
      refreshExecutionContext(
        executionContext,
        context,
        subsystem,
      );
    }
  }

  const executor =
    resolveHookStartupExecutor();

  if (!executor) {
    throw new Error(
      "TITech infrastructure hook startup engine is unavailable.",
    );
  }

  const executionContext =
    createInfrastructureContext(
      context,
      "infrastructure",
    );

  return executor.execute.call(
    executor.target,
    executionContext,
  );
}

/* =============================================================================
 * EXECUTE REGISTERED SHUTDOWN
 * ============================================================================= */

async function executeRegisteredInfrastructureShutdown(
  context = {},
) {
  for (
    const subsystem of
      SUBSYSTEM_ORDER
  ) {
    const executionContext =
      executionContexts.get(
        subsystem,
      );

    if (executionContext) {
      refreshExecutionContext(
        executionContext,
        context,
        subsystem,
      );
    }
  }

  const executor =
    resolveHookShutdownExecutor();

  if (!executor) {
    throw new Error(
      "TITech infrastructure hook shutdown engine is unavailable.",
    );
  }

  const executionContext =
    createInfrastructureContext(
      context,
      "infrastructure",
    );

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

function getFailedSubsystems() {
  return Object.values(
    getInfrastructureStatus(),
  )
    .filter(
      entry =>
        entry.state ===
        LIFECYCLE_STATES.FAILED,
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
            entry.state ||
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
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 *
 * This function is used after a startup failure.
 *
 * It does not call initializeInfrastructure() or shutdownInfrastructure()
 * recursively. That prevents lifecycle deadlocks caused by waiting on the
 * currently executing initialization/shutdown promise.
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
      attempted:
        false,

      cleaned:
        true,

      activeSubsystems: [],

      generation:
        runtimeGeneration,
    });
  }

  try {
    const cleanupContext = {
      ...(isObjectLike(context)
        ? context
        : {}),

      reason:
        "infrastructure_startup_failure",

      startupError:
        originalError,

      partialStartup:
        true,

      generation:
        runtimeGeneration,
    };

    await executeRegisteredInfrastructureShutdown(
      cleanupContext,
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
      attempted:
        true,

      cleaned:
        true,

      activeSubsystems,

      generation:
        runtimeGeneration,
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
      attempted:
        true,

      cleaned:
        false,

      activeSubsystems,

      generation:
        runtimeGeneration,

      error:
        createErrorDescriptor(
          cleanupError,
        ),
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

  const failedSubsystems =
    getFailedSubsystems();

  return Object.freeze({
    ok:
      criticalUnavailable.length === 0 &&
      criticalNotStarted.length === 0,

    initialized:
      true,

    service:
      SERVICE_NAME,

    application:
      APPLICATION_NAME,

    state:
      "initialized",

    generation:
      runtimeGeneration,

    subsystems:
      status,

    criticalUnavailable,

    criticalNotStarted,

    failedSubsystems,

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
      initializationResult ??
      Object.freeze({
        ok:
          true,

        initialized:
          true,

        idempotent:
          true,

        generation:
          runtimeGeneration,

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

  /**
   * New runtime generation.
   *
   * A generation identifies one complete startup lifecycle.
   */
  runtimeGeneration += 1;

  initializationPromise =
    (async () => {
      initializing =
        true;

      startupAttempted =
        false;

      const effectiveContext =
        context || {};

      initializationContext =
        effectiveContext;

      try {
        /**
         * Registration is deliberately performed before lifecycle execution.
         */
        registerInfrastructure(
          effectiveContext,
        );

        /**
         * Critical infrastructure must be structurally valid before any
         * startup lifecycle is executed.
         */
        validateRegistrationsBeforeStart();

        startupAttempted =
          true;

        const startupResult =
          await executeRegisteredInfrastructure(
            effectiveContext,
          );

        /**
         * Runtime startup is not considered successful until all critical
         * infrastructure is actually started.
         */
        validateStartedInfrastructure();

        initialized =
          true;

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
        initialized =
          false;

        initializationResult =
          null;

        if (startupAttempted) {
          const cleanupResult =
            await cleanupPartialInfrastructure(
              effectiveContext,
              error,
            );

          /**
           * Diagnostics are advisory and must never hide the original
           * startup failure.
           */
          if (
            error &&
            typeof error ===
              "object"
          ) {
            try {
              Object.defineProperty(
                error,
                "infrastructureCleanup",
                {
                  value:
                    cleanupResult,

                  enumerable:
                    false,

                  configurable:
                    true,

                  writable:
                    true,
                },
              );
            } catch {
              // Diagnostic attachment is advisory only.
            }
          }
        }

        throw error;
      } finally {
        initializing =
          false;

        startupAttempted =
          false;
      }
    })();

  try {
    return await initializationPromise;
  } finally {
    initializationPromise =
      null;
  }
}

/* =============================================================================
 * STARTUP ALIASES
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
      ok:
        true,

      shutdown:
        false,

      idempotent:
        true,

      reason:
        "shutdown-already-in-progress",

      generation:
        runtimeGeneration,
    });
  }

  /**
   * Do not start a shutdown concurrently with initialization.
   *
   * The normal startup failure path performs its own rollback rather than
   * entering this public shutdown function recursively.
   */
  if (initializing) {
    throw new Error(
      "TITech infrastructure cannot shutdown while initialization is in progress.",
    );
  }

  shutdownPromise =
    (async () => {
      shuttingDown =
        true;

      const effectiveContext = {
        ...(isObjectLike(context)
          ? context
          : {}),

        ...(isObjectLike(options)
          ? options
          : {}),

        generation:
          runtimeGeneration,
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

        if (
          !activeSubsystems.length
        ) {
          initialized =
            false;

          initializationResult =
            null;

          return Object.freeze({
            ok:
              true,

            initialized:
              false,

            shutdown:
              true,

            idempotent:
              true,

            reason:
              "no-active-infrastructure",

            generation:
              runtimeGeneration,

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

                started:
                  false,

                state:
                  LIFECYCLE_STATES.STOPPED,

                stoppedAt:
                  getNowIso(),
              },
            );
          }
        }

        initialized =
          false;

        initializationResult =
          null;

        return Object.freeze({
          ok:
            true,

          initialized:
            false,

          shutdown:
            true,

          shutdownResult,

          activeSubsystems,

          generation:
            runtimeGeneration,

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
        shuttingDown =
          false;

        initializationContext =
          null;
      }
    })();

  try {
    return await shutdownPromise;
  } finally {
    shutdownPromise =
      null;
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
    service:
      SERVICE_NAME,

    application:
      APPLICATION_NAME,

    generation:
      runtimeGeneration,

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
          value.state ===
          LIFECYCLE_STATES.FAILED,
      ).length,

    disabled:
      values.filter(
        value =>
          value.state ===
          LIFECYCLE_STATES.DISABLED,
      ).length,

    unavailable:
      values.filter(
        value =>
          value.state ===
          LIFECYCLE_STATES.UNAVAILABLE,
      ).length,

    criticalUnavailable:
      getCriticalUnavailableSubsystems(),

    criticalNotStarted:
      getCriticalNotStartedSubsystems(),

    failedSubsystems:
      getFailedSubsystems(),

    ready:
      isInfrastructureReady(),

    timestamp:
      getNowIso(),
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

  return !Object.values(
    status,
  ).some(
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
 * RUNTIME GENERATION / STATE INFORMATION
 * =============================================================================
 */

function getRuntimeGeneration() {
  return runtimeGeneration;
}

function getLifecycleState() {
  if (shuttingDown) {
    return "shutting_down";
  }

  if (initializing) {
    return "starting";
  }

  if (initialized) {
    return "ready";
  }

  return "stopped";
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

  executionContexts.clear();

  initializationPromise =
    null;

  shutdownPromise =
    null;

  initializationContext =
    null;

  initializationResult =
    null;

  initialized =
    false;

  startupAttempted =
    false;

  runtimeGeneration =
    0;
}

/* =============================================================================
 * DEVELOPMENT COMPOSITION SELF-CHECK
 * =============================================================================
 */

function validateInfrastructureDefinitionContract() {
  for (
    const subsystem of
      SUBSYSTEM_ORDER
  ) {
    if (
      !Object.prototype.hasOwnProperty.call(
        INFRASTRUCTURE_MODULES,
        subsystem,
      )
    ) {
      throw new Error(
        `TITech infrastructure definition contract is invalid: "${subsystem}" has no module candidates.`,
      );
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        ENABLE_FLAGS,
        subsystem,
      )
    ) {
      throw new Error(
        `TITech infrastructure definition contract is invalid: "${subsystem}" has no enablement flag.`,
      );
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        DEFAULT_ENABLED,
        subsystem,
      )
    ) {
      throw new Error(
        `TITech infrastructure definition contract is invalid: "${subsystem}" has no default enablement.`,
      );
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        PRIORITIES,
        subsystem,
      )
    ) {
      throw new Error(
        `TITech infrastructure definition contract is invalid: "${subsystem}" has no priority.`,
      );
    }
  }

  return true;
}

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
    "getInfrastructureStatus",
    "getInfrastructureSummary",
    "isInfrastructureReady",
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
  /* ---------------------------------------------------------------------------
   * Primary lifecycle API
   * ------------------------------------------------------------------------- */

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

  /* ---------------------------------------------------------------------------
   * Composition / registration
   * ------------------------------------------------------------------------- */

  registerBootstrapHooks,

  registerInfrastructure,

  /* ---------------------------------------------------------------------------
   * Explicit infrastructure adapters
   * ------------------------------------------------------------------------- */

  registerDatabase,

  registerRedis,

  registerQueue,

  registerEventBus,

  registerResilience,

  registerSocketIO,

  registerApiGateway,

  /* ---------------------------------------------------------------------------
   * Diagnostics
   * ------------------------------------------------------------------------- */

  getInfrastructureStatus,

  getInfrastructureSummary,

  getRuntimeGeneration,

  getLifecycleState,

  isInfrastructureRegistered,

  isInfrastructureAvailable,

  isInfrastructureStarted,

  isInfrastructureReady,

  /* ---------------------------------------------------------------------------
   * Test support
   * ------------------------------------------------------------------------- */

  resetInfrastructureRegistry,

  /* ---------------------------------------------------------------------------
   * Metadata
   * ------------------------------------------------------------------------- */

  SERVICE_NAME,

  APPLICATION_NAME,

  INFRASTRUCTURE_MODULES,

  DEPENDENCIES,

  PRIORITIES,

  ENABLE_FLAGS,

  DEFAULT_ENABLED,

  SUBSYSTEM_ORDER,

  START_METHODS,

  STOP_METHODS,

  LIFECYCLE_STATES,
});

/* =============================================================================
 * DEVELOPMENT SELF-CHECK
 * =============================================================================
 */

if (
  process.env.NODE_ENV !==
  "production"
) {
  validateInfrastructureDefinitionContract();
  validateExportContract();
}