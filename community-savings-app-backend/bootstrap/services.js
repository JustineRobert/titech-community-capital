'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/services.js
 *
 * Purpose:
 *   Enterprise production-grade application services bootstrap adapter.
 *
 * Responsibilities:
 *   - Compose application service lifecycle into the TITech bootstrap pipeline.
 *   - Initialize service registries/factories after infrastructure is ready.
 *   - Validate service contracts before the application accepts traffic.
 *   - Support dependency-aware service startup and shutdown.
 *   - Support service readiness and health reporting.
 *   - Prevent duplicate/concurrent service initialization.
 *   - Bound every externally controlled startup/shutdown operation with timeouts.
 *   - Roll back partially started services when startup fails.
 *   - Detect service dependency cycles before startup.
 *   - Preserve existing domain/service implementations.
 *   - Keep service composition out of app.js.
 *   - Provide safe diagnostics.
 *
 * Architectural position:
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
 *       ↓
 *   services
 *       ↓
 *   middleware
 *       ↓
 *   routes
 *       ↓
 *   HTTP server
 *
 * IMPORTANT:
 *
 *   This file is a SERVICE COMPOSITION ADAPTER.
 *
 *   It does NOT:
 *     - implement business rules
 *     - implement finance logic
 *     - implement ledger logic
 *     - execute database queries directly
 *     - implement payment providers
 *     - process queues directly
 *     - implement controllers
 *     - implement HTTP routes
 *
 * Existing services remain authoritative.
 *
 * Supported service module contracts:
 *
 *   registerServices(context)
 *   registerServices(container, context)
 *   initializeServices(context)
 *   createServices(context)
 *   start(context)
 *   stop(context)
 *
 * A service registry/container may additionally expose:
 *
 *   initialize()
 *   init()
 *   bootstrap()
 *   start()
 *   shutdown()
 *   close()
 *   stop()
 *   destroy()
 *   readiness()
 *   isReady()
 *   health()
 *   checkHealth()
 *
 * =============================================================================
 */

const {
  hooks,
  lifecycle,
} = require('./hooks');

/**
 * =============================================================================
 * Optional integrations
 * =============================================================================
 */

let readinessModule = null;

try {
  // eslint-disable-next-line global-require
  readinessModule =
    require('./readinessState');
} catch {
  readinessModule = null;
}

let observabilityModule = null;

try {
  // eslint-disable-next-line global-require
  observabilityModule =
    require('./observability');
} catch {
  observabilityModule = null;
}

let loggerModule = null;

try {
  /**
   * Canonical TITech application logger.
   *
   * Keeping this compatible with both:
   *
   *   backend/bootstrap/logger
   *   backend/utils/logger
   *
   * prevents bootstrap logger path differences from becoming service startup
   * failures.
   */
  try {
    // eslint-disable-next-line global-require
    loggerModule =
      require('../utils/logger');
  } catch {
    // eslint-disable-next-line global-require
    loggerModule =
      require('./logger');
  }
} catch {
  loggerModule = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
  'services';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-community-capital-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'TITech Community Capital';

const DEFAULT_PRIORITY =
  0;

const DEFAULT_TIMEOUT_MS =
  60_000;

const DEFAULT_EXTERNAL_INITIALIZE_TIMEOUT_MS =
  30_000;

const DEFAULT_EXTERNAL_START_TIMEOUT_MS =
  30_000;

const DEFAULT_EXTERNAL_STOP_TIMEOUT_MS =
  30_000;

const DEFAULT_READINESS_TIMEOUT_MS =
  10_000;

const DEFAULT_HEALTH_TIMEOUT_MS =
  5_000;

const DEFAULT_DEPENDENCIES =
  Object.freeze([
    'database',
    'redis',
    'resilience',
  ]);

const SERVICE_MODULE_CANDIDATES =
  Object.freeze([
    '../services',
    '../services/index',
    '../application/services',
    '../domain/services',
    '../service',
    '../service/index',
  ]);

const SERVICE_STATES =
  Object.freeze({
    REGISTERED:
      'registered',

    DISABLED:
      'disabled',

    INITIALIZING:
      'initializing',

    STARTING:
      'starting',

    STARTED:
      'started',

    READY:
      'ready',

    NOT_READY:
      'not_ready',

    STOPPING:
      'stopping',

    STOPPED:
      'stopped',

    FAILED:
      'failed',
  });

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class ServicesBootstrapError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(
      typeof message ===
        'string' &&
        message.trim()
        ? message
        : 'TITech services bootstrap error.',
    );

    this.name =
      'ServicesBootstrapError';

    this.code =
      options.code ||
      'SERVICES_BOOTSTRAP_ERROR';

    this.phase =
      options.phase ||
      null;

    this.service =
      options.service ||
      null;

    this.cause =
      options.cause ||
      null;

    this.retryable =
      options.retryable ??
      null;

    this.details =
      Object.freeze({
        ...(options.details || {}),
      });

    Error.captureStackTrace?.(
      this,
      ServicesBootstrapError,
    );
  }
}

/**
 * =============================================================================
 * Internal State
 * =============================================================================
 */

let servicesImplementation =
  null;

let servicesModulePath =
  null;

let servicesRegistry =
  null;

let externalServiceContract =
  null;

let registered =
  false;

let started =
  false;

let stopped =
  false;

let failed =
  false;

let degraded =
  false;

let registrationResult =
  null;

let startPromise =
  null;

let stopPromise =
  null;

let lastError =
  null;

let startedAt =
  null;

let stoppedAt =
  null;

let serviceCount =
  0;

let startupGeneration =
  0;

/**
 * Services successfully started during the current startup transaction.
 *
 * This is deliberately maintained separately from serviceDefinitions because
 * failed startup must be able to roll back only what was actually started.
 */
const startedServiceNames =
  new Set();

/**
 * Individual service registry.
 */
const serviceDefinitions =
  new Map();

const serviceStates =
  new Map();

/**
 * =============================================================================
 * Utility Helpers
 * =============================================================================
 */

function asPositiveInteger(
  value,
  fallback,
) {
  const resolved =
    value === undefined
      ? fallback
      : Number(value);

  if (
    !Number.isInteger(
      resolved,
    ) ||
    resolved <= 0
  ) {
    return fallback;
  }

  return resolved;
}

function normalizeName(
  value,
  field = 'name',
) {
  if (
    typeof value !==
      'string' ||
    value.trim() ===
      ''
  ) {
    throw new TypeError(
      `${field} must be a non-empty string.`,
    );
  }

  return value.trim();
}

function moduleExists(
  modulePath,
) {
  try {
    require.resolve(
      modulePath,
    );

    return true;
  } catch (error) {
    if (
      error?.code ===
      'MODULE_NOT_FOUND'
    ) {
      return false;
    }

    throw error;
  }
}

function unwrapModule(
  value,
) {
  if (
    value &&
    value.default &&
    typeof value.default ===
      'object'
  ) {
    return value.default;
  }

  return value;
}

function isFunction(
  value,
) {
  return (
    typeof value ===
    'function'
  );
}

function elapsedMs(
  startedAtNs,
) {
  return (
    Number(
      process.hrtime.bigint() -
        startedAtNs,
    ) / 1_000_000
  );
}

/**
 * =============================================================================
 * Safe Error Serialization
 * =============================================================================
 */

function sanitizeSensitiveText(
  value,
) {
  if (
    value ===
      undefined ||
    value === null
  ) {
    return value;
  }

  let text;

  try {
    text =
      String(value);
  } catch {
    return '[unserializable]';
  }

  /**
   * Hide common credentials.
   */
  text =
    text.replace(
      /(mongodb(?:\+srv)?:\/\/)([^/\s:@]+)(?::[^@\s]*)?@/gi,
      '$1***:***@',
    );

  text =
    text.replace(
      /([?&](?:password|passwd|pwd|secret|token|access_token)=)[^&\s]*/gi,
      '$1***',
    );

  return text;
}

function safeError(
  error,
  options = {},
) {
  try {
    if (
      error ===
        null ||
      error ===
        undefined
    ) {
      return null;
    }

    if (
      typeof error ===
        'object'
    ) {
      return Object.freeze({
        name:
          sanitizeSensitiveText(
            error.name ||
              'Error',
          ),

        code:
          error.code ??
          null,

        message:
          sanitizeSensitiveText(
            error.message ||
              String(error),
          ),

        service:
          options.service ??
          error.service ??
          null,

        phase:
          options.phase ??
          error.phase ??
          null,

        retryable:
          options.retryable ??
          error.retryable ??
          null,

        ...(options.includeStack &&
        error.stack
          ? {
              stack:
                sanitizeSensitiveText(
                  error.stack,
                ),
            }
          : {}),
      });
    }

    return Object.freeze({
      name:
        'Error',

      code:
        null,

      message:
        sanitizeSensitiveText(
          String(error),
        ),

      service:
        options.service ??
        null,

      phase:
        options.phase ??
        null,

      retryable:
        options.retryable ??
        null,
    });
  } catch {
    return Object.freeze({
      name:
        'Error',

      code:
        'SERVICE_ERROR_SERIALIZATION_FAILED',

      message:
        'Unable to serialize a service error.',

      service:
        options.service ??
        null,

      phase:
        options.phase ??
        null,

      retryable:
        null,
    });
  }
}

/**
 * =============================================================================
 * Logger
 * =============================================================================
 */

function resolveLogger() {
  try {
    return (
      loggerModule?.getLogger?.() ||
      loggerModule?.logger ||
      loggerModule?.default ||
      loggerModule ||
      null
    );
  } catch {
    return null;
  }
}

function log(
  level,
  payload = {},
  message = undefined,
) {
  const logger =
    resolveLogger();

  const metadata = {
    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    application:
      APPLICATION_NAME,

    ...(payload &&
    typeof payload ===
      'object' &&
    !Array.isArray(payload)
      ? payload
      : {}),
  };

  try {
    if (
      logger &&
      typeof logger[level] ===
        'function'
    ) {
      if (
        message !==
        undefined
      ) {
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
    // Logging must never break service lifecycle.
  }

  try {
    const output =
      message !==
      undefined
        ? message
        : metadata;

    if (
      level === 'error' ||
      level === 'fatal'
    ) {
      console.error(
        output,
        message !==
          undefined
          ? metadata
          : '',
      );
    } else if (
      level === 'warn'
    ) {
      console.warn(
        output,
        message !==
          undefined
          ? metadata
          : '',
      );
    } else {
      console.log(
        output,
        message !==
          undefined
          ? metadata
          : '',
      );
    }
  } catch {
    // Final logging fallback is intentionally best-effort.
  }
}

/**
 * =============================================================================
 * Observability
 * =============================================================================
 */

function emitObservabilityEvent(
  event,
  payload = {},
) {
  try {
    const data = {
      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      ...payload,
    };

    if (
      typeof observabilityModule
        ?.emitEvent ===
      'function'
    ) {
      return observabilityModule.emitEvent(
        event,
        data,
      );
    }

    if (
      typeof observabilityModule
        ?.observability
        ?.emitEvent ===
      'function'
    ) {
      return observabilityModule.observability.emitEvent(
        event,
        data,
      );
    }
  } catch {
    /**
     * Telemetry must never become the reason the TITech application fails.
     */
  }

  return null;
}

/**
 * =============================================================================
 * Dependency Normalization
 * =============================================================================
 */

function normalizeDependencies(
  dependencies,
) {
  if (
    dependencies ===
      undefined ||
    dependencies ===
      null
  ) {
    return [];
  }

  if (
    !Array.isArray(
      dependencies,
    )
  ) {
    throw new TypeError(
      'Service dependencies must be an array.',
    );
  }

  return [
    ...new Set(
      dependencies.map(
        dependency =>
          normalizeName(
            dependency,
            'dependency',
          ),
      ),
    ),
  ];
}

/**
 * =============================================================================
 * Service Definition
 * =============================================================================
 */

function normalizeServiceDefinition(
  options = {},
) {
  const name =
    normalizeName(
      options.name,
    );

  if (
    serviceDefinitions.has(
      name,
    )
  ) {
    throw new ServicesBootstrapError(
      `Service "${name}" is already registered.`,
      {
        code:
          'SERVICE_DUPLICATE_REGISTRATION',

        service:
          name,
      },
    );
  }

  const definition =
    Object.freeze({
      name,

      description:
        options.description ||
        null,

      version:
        options.version ||
        null,

      enabled:
        options.enabled !==
        false,

      critical:
        options.critical !==
        false,

      priority:
        Number.isInteger(
          options.priority,
        )
          ? options.priority
          : DEFAULT_PRIORITY,

      dependencies:
        Object.freeze(
          normalizeDependencies(
            options.dependencies,
          ),
        ),

      timeoutMs:
        asPositiveInteger(
          options.timeoutMs,
          DEFAULT_TIMEOUT_MS,
        ),

      readinessTimeoutMs:
        asPositiveInteger(
          options.readinessTimeoutMs,
          DEFAULT_READINESS_TIMEOUT_MS,
        ),

      healthTimeoutMs:
        asPositiveInteger(
          options.healthTimeoutMs,
          DEFAULT_HEALTH_TIMEOUT_MS,
        ),

      initialize:
        options.initialize ||
        options.init ||
        null,

      start:
        options.start ||
        null,

      stop:
        options.stop ||
        null,

      shutdown:
        options.shutdown ||
        null,

      destroy:
        options.destroy ||
        null,

      readiness:
        options.readiness ||
        options.ready ||
        null,

      health:
        options.health ||
        options.checkHealth ||
        null,

      metadata:
        Object.freeze({
          ...(options.metadata ||
            {}),
        }),

      registeredAt:
        new Date(),
    });

  for (
    const [
      field,
      value,
    ] of Object.entries(
      definition,
    )
  ) {
    if (
      [
        'initialize',
        'start',
        'stop',
        'shutdown',
        'destroy',
        'readiness',
        'health',
      ].includes(
        field,
      ) &&
      value !== null &&
      !isFunction(value)
    ) {
      throw new ServicesBootstrapError(
        `Service "${name}" field "${field}" must be a function.`,
        {
          code:
            'SERVICE_LIFECYCLE_CONTRACT_INVALID',

          service:
            name,

          details: {
            field,
          },
        },
      );
    }
  }

  /**
   * Prevent a service from depending on itself.
   */
  if (
    definition.dependencies.includes(
      definition.name,
    )
  ) {
    throw new ServicesBootstrapError(
      `Service "${name}" cannot depend on itself.`,
      {
        code:
          'SERVICE_SELF_DEPENDENCY',

        service:
          name,
      },
    );
  }

  return definition;
}

/**
 * =============================================================================
 * Register Individual Service
 * =============================================================================
 */

function registerService(
  options = {},
) {
  const definition =
    normalizeServiceDefinition(
      options,
    );

  serviceDefinitions.set(
    definition.name,
    definition,
  );

  serviceStates.set(
    definition.name,
    {
      state:
        definition.enabled
          ? SERVICE_STATES.REGISTERED
          : SERVICE_STATES.DISABLED,

      started:
        false,

      ready:
        false,

      failed:
        false,

      startedAt:
        null,

      readyAt:
        null,

      stoppedAt:
        null,

      lastError:
        null,

      durationMs:
        null,

      generation:
        null,
    },
  );

  serviceCount =
    serviceDefinitions.size;

  emitObservabilityEvent(
    'service.registered',
    {
      serviceName:
        definition.name,

      enabled:
        definition.enabled,

      critical:
        definition.critical,

      dependencies:
        [
          ...definition.dependencies,
        ],
    },
  );

  return definition;
}

/**
 * =============================================================================
 * Service Lookup
 * =============================================================================
 */

function hasService(
  name,
) {
  return serviceDefinitions.has(
    name,
  );
}

function getService(
  name,
) {
  const definition =
    serviceDefinitions.get(
      name,
    );

  if (!definition) {
    return null;
  }

  return {
    definition,

    state:
      serviceStates.get(
        name,
      ),
  };
}

function listServices({
  enabledOnly = false,
} = {}) {
  return [
    ...serviceDefinitions.values(),
  ].filter(
    definition =>
      !enabledOnly ||
      definition.enabled,
  );
}

/**
 * =============================================================================
 * Service Dependency Ordering
 * =============================================================================
 */

function compareServices(
  a,
  b,
) {
  if (
    a.priority !==
    b.priority
  ) {
    return (
      a.priority -
      b.priority
    );
  }

  return a.name.localeCompare(
    b.name,
  );
}

function resolveServiceOrder(
  direction = 'startup',
) {
  const services =
    listServices({
      enabledOnly:
        true,
    });

  if (
    services.length ===
    0
  ) {
    return [];
  }

  const serviceMap =
    new Map(
      services.map(
        service => [
          service.name,
          service,
        ],
      ),
    );

  const incoming =
    new Map();

  const outgoing =
    new Map();

  for (
    const service of
      services
  ) {
    incoming.set(
      service.name,
      0,
    );

    outgoing.set(
      service.name,
      new Set(),
    );
  }

  for (
    const service of
      services
  ) {
    for (
      const dependency of
        service.dependencies
    ) {
      /**
       * Dependencies such as database/redis/resilience are usually owned by
       * the infrastructure lifecycle and therefore do not belong to this
       * local service graph.
       */
      if (
        !serviceMap.has(
          dependency,
        )
      ) {
        continue;
      }

      incoming.set(
        service.name,
        incoming.get(
          service.name,
        ) + 1,
      );

      outgoing
        .get(
          dependency,
        )
        .add(
          service.name,
        );
    }
  }

  const queue =
    services
      .filter(
        service =>
          incoming.get(
            service.name,
          ) === 0,
      )
      .sort(
        compareServices,
      );

  const order = [];

  while (
    queue.length >
    0
  ) {
    const current =
      queue.shift();

    order.push(
      current,
    );

    for (
      const dependent of
        outgoing.get(
          current.name,
        )
    ) {
      const remaining =
        incoming.get(
          dependent,
        ) - 1;

      incoming.set(
        dependent,
        remaining,
      );

      if (
        remaining ===
        0
      ) {
        queue.push(
          serviceMap.get(
            dependent,
          ),
        );

        queue.sort(
          compareServices,
        );
      }
    }
  }

  if (
    order.length !==
    services.length
  ) {
    const cyclic =
      services
        .filter(
          service =>
            incoming.get(
              service.name,
            ) > 0,
        )
        .map(
          service =>
            service.name,
        );

    emitObservabilityEvent(
      'services.dependency_cycle_detected',
      {
        services:
          cyclic,
      },
    );

    throw new ServicesBootstrapError(
      'Circular TITech service dependency detected.',
      {
        code:
          'SERVICE_DEPENDENCY_CYCLE',

        details: {
          direction,

          services:
            cyclic,
        },
      },
    );
  }

  return direction ===
    'shutdown'
    ? order.reverse()
    : order;
}

/**
 * =============================================================================
 * Timeout Helper
 * =============================================================================
 */

async function withTimeout(
  fn,
  timeoutMs,
  operation,
  options = {},
) {
  const boundedTimeout =
    asPositiveInteger(
      timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );

  let timer =
    null;

  let timedOut =
    false;

  const work =
    Promise.resolve().then(
      fn,
    );

  const timeout =
    new Promise(
      (_, reject) => {
        timer =
          setTimeout(
            () => {
              timedOut =
                true;

              reject(
                new ServicesBootstrapError(
                  `TITech ${operation} timed out after ${boundedTimeout}ms.`,
                  {
                    code:
                      'SERVICE_LIFECYCLE_TIMEOUT',

                    service:
                      options.service ||
                      null,

                    phase:
                      options.phase ||
                      null,

                    retryable:
                      true,

                    details: {
                      timeoutMs:
                        boundedTimeout,
                    },
                  },
                ),
              );
            },
            boundedTimeout,
          );

        timer.unref?.();
      },
    );

  try {
    return await Promise.race([
      work,
      timeout,
    ]);
  } finally {
    if (
      timer
    ) {
      clearTimeout(
        timer,
      );
    }

    /**
     * If the operation timed out, its underlying promise may still reject
     * later. Attach a terminal rejection handler so its rejection cannot become
     * an unhandled rejection at process level.
     */
    if (
      timedOut
    ) {
      void work.catch(
        () => undefined,
      );
    }
  }
}

/**
 * =============================================================================
 * Generic Service Method Discovery
 * =============================================================================
 */

function findLifecycleMethod(
  target,
  candidates,
) {
  if (
    !target
  ) {
    return null;
  }

  for (
    const name of
      candidates
  ) {
    if (
      typeof target[name] ===
      'function'
    ) {
      return target[name].bind(
        target,
      );
    }
  }

  return null;
}

/**
 * =============================================================================
 * External Service Module Resolution
 * =============================================================================
 */

function resolveServicesImplementation() {
  if (
    servicesImplementation
  ) {
    return {
      implementation:
        servicesImplementation,

      path:
        servicesModulePath,
    };
  }

  for (
    const candidate of
      SERVICE_MODULE_CANDIDATES
  ) {
    if (
      !moduleExists(
        candidate,
      )
    ) {
      continue;
    }

    try {
      const loaded =
        require(candidate);

      servicesImplementation =
        unwrapModule(
          loaded,
        );

      servicesModulePath =
        candidate;

      log(
        'debug',
        {
          event:
            'services.module.resolved',

          modulePath:
            candidate,
        },
        'TITech service implementation module resolved.',
      );

      return {
        implementation:
          servicesImplementation,

        path:
          servicesModulePath,
      };
    } catch (error) {
      throw new ServicesBootstrapError(
        'Failed to load the TITech service module.',
        {
          code:
            'SERVICES_MODULE_LOAD_FAILED',

          cause:
            error,

          details: {
            candidate,
          },
        },
      );
    }
  }

  /**
   * No external service registry is not automatically fatal.
   *
   * The locally registered serviceDefinitions map may still be authoritative.
   */
  return {
    implementation:
      null,

    path:
      null,
  };
}

/**
 * =============================================================================
 * External Service Contract
 * =============================================================================
 */

function resolveExternalServiceContract(
  implementation,
) {
  if (
    !implementation
  ) {
    return null;
  }

  const candidates = [
    implementation,
    implementation.services,
    implementation.registry,
    implementation.container,
    implementation.manager,
    implementation.default,
  ].filter(Boolean);

  const target =
    candidates[0] ||
    implementation;

  return {
    target,

    initialize:
      findLifecycleMethod(
        target,
        [
          'registerServices',
          'initializeServices',
          'createServices',
          'initialize',
          'init',
          'bootstrap',
        ],
      ),

    start:
      findLifecycleMethod(
        target,
        [
          'startServices',
          'start',
        ],
      ),

    stop:
      findLifecycleMethod(
        target,
        [
          'shutdown',
          'stopServices',
          'stop',
          'close',
          'destroy',
        ],
      ),

    readiness:
      findLifecycleMethod(
        target,
        [
          'readiness',
          'ready',
        ],
      ),

    isReady:
      findLifecycleMethod(
        target,
        [
          'isReady',
        ],
      ),

    health:
      findLifecycleMethod(
        target,
        [
          'health',
          'checkHealth',
          'getHealth',
        ],
      ),
  };
}

/**
 * =============================================================================
 * External Registry Initialization
 * =============================================================================
 */

async function initializeExternalServiceRegistry(
  context,
  options = {},
) {
  const resolved =
    resolveServicesImplementation();

  if (
    !resolved.implementation
  ) {
    externalServiceContract =
      null;

    servicesRegistry =
      null;

    return null;
  }

  const contract =
    resolveExternalServiceContract(
      resolved.implementation,
    );

  if (
    !contract
  ) {
    return null;
  }

  servicesModulePath =
    resolved.path;

  const startedNs =
    process.hrtime.bigint();

  log(
    'info',
    {
      event:
        'services.registry.initializing',

      modulePath:
        resolved.path,

      hasInitialize:
        Boolean(
          contract.initialize,
        ),

      hasStart:
        Boolean(
          contract.start,
        ),
    },
    'TITech external service registry initialization started.',
  );

  try {
    if (
      contract.initialize
    ) {
      const initializeResult =
        await withTimeout(
          () =>
            contract.initialize({
              ...context,

              services:
                servicesRegistry,

              component:
                COMPONENT,

              serviceRegistry:
                servicesRegistry,
            }),
          options.initializeTimeoutMs ||
            DEFAULT_EXTERNAL_INITIALIZE_TIMEOUT_MS,
          'external service registry initialization',
          {
            phase:
              'initialization',
          },
        );

      servicesRegistry =
        initializeResult ||
        contract.target;
    } else {
      servicesRegistry =
        contract.target;
    }

    externalServiceContract =
      {
        ...contract,

        implementation:
          servicesRegistry,

        path:
          resolved.path,
      };

    const durationMs =
      elapsedMs(
        startedNs,
      );

    emitObservabilityEvent(
      'services.registry.initialized',
      {
        modulePath:
          resolved.path,

        durationMs,
      },
    );

    log(
      'info',
      {
        event:
          'services.registry.initialized',

        modulePath:
          resolved.path,

        durationMs,
      },
      'TITech external service registry initialized.',
    );

    return externalServiceContract;
  } catch (error) {
    const wrapped =
      wrapError(
        error,
        'SERVICES_REGISTRY_INITIALIZATION_FAILED',
        'initialization',
        'TITech external service registry initialization failed.',
      );

    emitObservabilityEvent(
      'services.registry.initialization_failed',
      {
        modulePath:
          resolved.path,

        error:
          safeError(
            wrapped,
            {
              phase:
                'initialization',
            },
          ),
      },
    );

    log(
      'error',
      {
        event:
          'services.registry.initialization_failed',

        modulePath:
          resolved.path,

        error:
          safeError(
            wrapped,
            {
              phase:
                'initialization',

              includeStack:
                true,
            },
          ),
      },
      'TITech external service registry initialization failed.',
    );

    throw wrapped;
  }
}

/**
 * =============================================================================
 * External Registry Lifecycle
 * =============================================================================
 */

async function startExternalRegistry(
  contract,
  context,
  options = {},
) {
  if (
    !contract
  ) {
    return null;
  }

  if (
    !contract.start
  ) {
    log(
      'debug',
      {
        event:
          'services.registry.start_not_defined',
      },
      'TITech external service registry does not expose a start operation.',
    );

    return null;
  }

  const startedNs =
    process.hrtime.bigint();

  log(
    'info',
    {
      event:
        'services.registry.starting',
    },
    'TITech external service registry startup started.',
  );

  try {
    const result =
      await withTimeout(
        () =>
          contract.start({
            ...context,

            services:
              servicesRegistry,

            component:
              COMPONENT,

            serviceRegistry:
              servicesRegistry,
          }),
        options.startTimeoutMs ||
          DEFAULT_EXTERNAL_START_TIMEOUT_MS,
        'external service registry startup',
        {
          phase:
            'startup',
        },
      );

    const durationMs =
      elapsedMs(
        startedNs,
      );

    emitObservabilityEvent(
      'services.registry.started',
      {
        durationMs,
      },
    );

    log(
      'info',
      {
        event:
          'services.registry.started',

        durationMs,
      },
      'TITech external service registry started.',
    );

    return result;
  } catch (error) {
    const wrapped =
      wrapError(
        error,
        'SERVICES_REGISTRY_START_FAILED',
        'startup',
        'TITech external service registry startup failed.',
      );

    log(
      'error',
      {
        event:
          'services.registry.start_failed',

        error:
          safeError(
            wrapped,
            {
              phase:
                'startup',

              includeStack:
                true,
            },
          ),
      },
      'TITech external service registry startup failed.',
    );

    throw wrapped;
  }
}

async function stopExternalRegistry(
  contract,
  context,
  options = {},
) {
  if (
    !contract?.stop
  ) {
    return null;
  }

  return withTimeout(
    () =>
      contract.stop({
        ...context,

        services:
          servicesRegistry,

        component:
          COMPONENT,

        serviceRegistry:
          servicesRegistry,
      }),
    options.stopTimeoutMs ||
      DEFAULT_EXTERNAL_STOP_TIMEOUT_MS,
    'external service registry shutdown',
    {
      phase:
        'shutdown',
    },
  );
}

/**
 * =============================================================================
 * Service Preconditions
 * =============================================================================
 */

function validateServiceDependencies() {
  const knownServices =
    new Set(
      listServices({
        enabledOnly:
          true,
      }).map(
        service =>
          service.name,
      ),
    );

  for (
    const definition of
      listServices({
        enabledOnly:
          true,
      })
  ) {
    for (
      const dependency of
        definition.dependencies
    ) {
      if (
        DEFAULT_DEPENDENCIES.includes(
          dependency,
        )
      ) {
        continue;
      }

      if (
        knownServices.has(
          dependency,
        )
      ) {
        continue;
      }

      /**
       * Unknown service dependencies are not automatically fatal because the
       * service may refer to an external lifecycle owner.
       *
       * Emit diagnostics rather than silently hiding the dependency.
       */
      log(
        'warn',
        {
          event:
            'service.external_dependency_unresolved',

          serviceName:
            definition.name,

          dependency,
        },
        'TITech service dependency is not locally registered; treating it as externally managed.',
      );
    }
  }

  /**
   * Resolve order here so dependency cycles fail BEFORE any service starts.
   */
  resolveServiceOrder(
    'startup',
  );

  return true;
}

/**
 * =============================================================================
 * Start Individual Service
 * =============================================================================
 */

async function startRegisteredService(
  definition,
  context,
  generation,
) {
  const state =
    serviceStates.get(
      definition.name,
    );

  if (
    !state ||
    !definition.enabled
  ) {
    return;
  }

  if (
    state.started &&
    state.generation ===
      generation
  ) {
    return;
  }

  const timer =
    process.hrtime.bigint();

  state.state =
    definition.initialize
      ? SERVICE_STATES.INITIALIZING
      : SERVICE_STATES.STARTING;

  state.startedAt =
    new Date();

  state.failed =
    false;

  state.lastError =
    null;

  state.generation =
    generation;

  log(
    'info',
    {
      event:
        'service.starting',

      serviceName:
        definition.name,

      generation,

      dependencies:
        [
          ...definition.dependencies,
        ],

      timeoutMs:
        definition.timeoutMs,
    },
    `TITech service "${definition.name}" startup started.`,
  );

  emitObservabilityEvent(
    'service.starting',
    {
      serviceName:
        definition.name,

      generation,
    },
  );

  try {
    const lifecycleHandler =
      definition.initialize ||
      definition.start;

    if (
      lifecycleHandler
    ) {
      await withTimeout(
        () =>
          lifecycleHandler({
            ...context,

            services:
              servicesRegistry,

            service:
              definition,

            serviceRegistry:
              servicesRegistry,

            generation,
          }),
        definition.timeoutMs,
        `service "${definition.name}" startup`,
        {
          service:
            definition.name,

          phase:
            'startup',
        },
      );
    }

    state.state =
      SERVICE_STATES.STARTED;

    state.started =
      true;

    state.ready =
      false;

    state.durationMs =
      elapsedMs(
        timer,
      );

    startedServiceNames.add(
      definition.name,
    );

    emitObservabilityEvent(
      'service.started',
      {
        serviceName:
          definition.name,

        generation,

        durationMs:
          state.durationMs,
      },
    );

    log(
      'info',
      {
        event:
          'service.started',

        serviceName:
          definition.name,

        generation,

        durationMs:
          state.durationMs,
      },
      `TITech service "${definition.name}" started.`,
    );
  } catch (error) {
    state.state =
      SERVICE_STATES.FAILED;

    state.failed =
      true;

    state.started =
      false;

    state.ready =
      false;

    state.durationMs =
      elapsedMs(
        timer,
      );

    state.lastError =
      safeError(
        error,
        {
          service:
            definition.name,

          phase:
            'startup',

          includeStack:
            true,
        },
      );

    emitObservabilityEvent(
      'service.start_failed',
      {
        serviceName:
          definition.name,

        generation,

        durationMs:
          state.durationMs,

        error:
          state.lastError,
      },
    );

    log(
      'error',
      {
        event:
          'service.start_failed',

        serviceName:
          definition.name,

        generation,

        durationMs:
          state.durationMs,

        error:
          state.lastError,
      },
      `TITech service "${definition.name}" failed during startup.`,
    );

    throw new ServicesBootstrapError(
      `TITech service "${definition.name}" failed during startup.`,
      {
        code:
          error?.code ===
          'SERVICE_LIFECYCLE_TIMEOUT'
            ? 'SERVICE_START_TIMEOUT'
            : 'SERVICE_START_FAILED',

        service:
          definition.name,

        phase:
          'startup',

        cause:
          error,

        retryable:
          error?.retryable ??
          null,

        details: {
          generation,

          durationMs:
            state.durationMs,

          timeoutMs:
            definition.timeoutMs,
        },
      },
    );
  }
}

/**
 * =============================================================================
 * Stop Individual Service
 * =============================================================================
 */

async function stopRegisteredService(
  definition,
  context,
  options = {},
) {
  const state =
    serviceStates.get(
      definition.name,
    );

  if (
    !state ||
    !definition.enabled ||
    !state.started
  ) {
    return;
  }

  const timer =
    process.hrtime.bigint();

  state.state =
    SERVICE_STATES.STOPPING;

  log(
    'info',
    {
      event:
        'service.stopping',

      serviceName:
        definition.name,

      timeoutMs:
        definition.timeoutMs,
    },
    `TITech service "${definition.name}" shutdown started.`,
  );

  try {
    const stopHandler =
      definition.stop ||
      definition.shutdown ||
      definition.destroy;

    if (
      stopHandler
    ) {
      await withTimeout(
        () =>
          stopHandler({
            ...context,

            services:
              servicesRegistry,

            service:
              definition,

            serviceRegistry:
              servicesRegistry,
          }),
        definition.timeoutMs,
        `service "${definition.name}" shutdown`,
        {
          service:
            definition.name,

          phase:
            'shutdown',
        },
      );
    }

    state.state =
      SERVICE_STATES.STOPPED;

    state.started =
      false;

    state.ready =
      false;

    state.stoppedAt =
      new Date();

    state.durationMs =
      elapsedMs(
        timer,
      );

    startedServiceNames.delete(
      definition.name,
    );

    emitObservabilityEvent(
      'service.stopped',
      {
        serviceName:
          definition.name,

        durationMs:
          state.durationMs,
      },
    );

    log(
      'info',
      {
        event:
          'service.stopped',

        serviceName:
          definition.name,

        durationMs:
          state.durationMs,
      },
      `TITech service "${definition.name}" stopped.`,
    );
  } catch (error) {
    state.state =
      SERVICE_STATES.FAILED;

    state.failed =
      true;

    state.ready =
      false;

    state.lastError =
      safeError(
        error,
        {
          service:
            definition.name,

          phase:
            'shutdown',

          includeStack:
            true,
        },
      );

    state.durationMs =
      elapsedMs(
        timer,
      );

    emitObservabilityEvent(
      'service.stop_failed',
      {
        serviceName:
          definition.name,

        durationMs:
          state.durationMs,

        error:
          state.lastError,
      },
    );

    log(
      'error',
      {
        event:
          'service.stop_failed',

        serviceName:
          definition.name,

        durationMs:
          state.durationMs,

        error:
          state.lastError,
      },
      `TITech service "${definition.name}" failed during shutdown.`,
    );

    throw new ServicesBootstrapError(
      `TITech service "${definition.name}" failed during shutdown.`,
      {
        code:
          error?.code ===
          'SERVICE_LIFECYCLE_TIMEOUT'
            ? 'SERVICE_STOP_TIMEOUT'
            : 'SERVICE_STOP_FAILED',

        service:
          definition.name,

        phase:
          'shutdown',

        cause:
          error,

        details: {
          durationMs:
            state.durationMs,
        },
      },
    );
  }
}

/**
 * =============================================================================
 * Readiness
 * =============================================================================
 */

async function checkRegisteredServiceReadiness(
  definition,
  context,
) {
  const state =
    serviceStates.get(
      definition.name,
    );

  if (
    !state
  ) {
    return {
      ready:
        false,

      state:
        SERVICE_STATES.FAILED,

      error: {
        code:
          'SERVICE_STATE_MISSING',

        message:
          'Service runtime state is missing.',
      },
    };
  }

  if (
    !definition.enabled
  ) {
    state.ready =
      true;

    state.state =
      SERVICE_STATES.DISABLED;

    return {
      ready:
        true,

      state:
        SERVICE_STATES.DISABLED,
    };
  }

  if (
    !state.started
  ) {
    state.ready =
      false;

    state.state =
      SERVICE_STATES.NOT_READY;

    return {
      ready:
        false,

      state:
        SERVICE_STATES.NOT_READY,

      error: {
        code:
          'SERVICE_NOT_STARTED',

        message:
          'Service has not completed startup.',
      },
    };
  }

  try {
    let ready =
      state.started;

    if (
      definition.readiness
    ) {
      const result =
        await withTimeout(
          () =>
            definition.readiness({
              ...context,

              service:
                definition,

              services:
                servicesRegistry,

              serviceRegistry:
                servicesRegistry,
            }),
          definition.readinessTimeoutMs,
          `service "${definition.name}" readiness check`,
          {
            service:
              definition.name,

            phase:
              'readiness',
          },
        );

      ready =
        normalizeReadiness(
          result,
        );
    }

    state.ready =
      ready;

    state.state =
      ready
        ? SERVICE_STATES.READY
        : SERVICE_STATES.NOT_READY;

    if (
      ready &&
      !state.readyAt
    ) {
      state.readyAt =
        new Date();
    }

    return {
      ready,

      state:
        state.state,
    };
  } catch (error) {
    state.ready =
      false;

    state.state =
      SERVICE_STATES.NOT_READY;

    state.lastError =
      safeError(
        error,
        {
          service:
            definition.name,

          phase:
            'readiness',
        },
      );

    return {
      ready:
        false,

      state:
        SERVICE_STATES.NOT_READY,

      error:
        state.lastError,
    };
  }
}

function normalizeReadiness(
  result,
) {
  if (
    typeof result ===
    'boolean'
  ) {
    return result;
  }

  if (
    result ===
      null ||
    result ===
      undefined
  ) {
    /**
     * A successfully resolved readiness method with no explicit value is
     * treated as ready for compatibility.
     */
    return true;
  }

  if (
    typeof result ===
    'object'
  ) {
    return (
      result.ready !==
        false &&
      result.status !==
        'not_ready' &&
      result.status !==
        'unhealthy'
    );
  }

  return Boolean(
    result,
  );
}

async function checkExternalRegistryReadiness(
  context,
  options = {},
) {
  const contract =
    externalServiceContract;

  if (
    !contract
  ) {
    return {
      ready:
        true,

      status:
        'not_configured',
    };
  }

  try {
    let result =
      true;

    if (
      contract.readiness
    ) {
      result =
        await withTimeout(
          () =>
            contract.readiness({
              ...context,

              services:
                servicesRegistry,

              component:
                COMPONENT,
            }),
          options.readinessTimeoutMs ||
            DEFAULT_READINESS_TIMEOUT_MS,
          'external service registry readiness check',
          {
            phase:
              'readiness',
          },
        );
    } else if (
      contract.isReady
    ) {
      result =
        await withTimeout(
          () =>
            contract.isReady({
              ...context,

              services:
                servicesRegistry,

              component:
                COMPONENT,
            }),
          options.readinessTimeoutMs ||
            DEFAULT_READINESS_TIMEOUT_MS,
          'external service registry readiness check',
          {
            phase:
              'readiness',
          },
        );
    }

    return {
      ready:
        normalizeReadiness(
          result,
        ),

      status:
        'checked',
    };
  } catch (error) {
    return {
      ready:
        false,

      status:
        'not_ready',

      error:
        safeError(
          error,
          {
            phase:
              'readiness',
          },
        ),
    };
  }
}

/**
 * =============================================================================
 * Health
 * =============================================================================
 */

async function checkExternalRegistryHealth(
  context,
  options = {},
) {
  const contract =
    externalServiceContract;

  if (
    !contract?.health
  ) {
    return {
      status:
        'unknown',

      healthy:
        true,
    };
  }

  try {
    const result =
      await withTimeout(
        () =>
          contract.health({
            ...context,

            services:
              servicesRegistry,

            component:
              COMPONENT,
          }),
        options.healthTimeoutMs ||
          DEFAULT_HEALTH_TIMEOUT_MS,
        'external service registry health check',
        {
          phase:
            'health',
        },
      );

    const normalized =
      normalizeHealth(
        result,
      );

    return normalized;
  } catch (error) {
    return {
      status:
        'unhealthy',

      healthy:
        false,

      error:
        safeError(
          error,
          {
            phase:
              'health',
          },
        ),
    };
  }
}

function normalizeHealth(
  result,
) {
  if (
    typeof result ===
    'boolean'
  ) {
    return {
      status:
        result
          ? 'healthy'
          : 'unhealthy',

      healthy:
        result,
    };
  }

  if (
    !result ||
    typeof result !==
      'object'
  ) {
    return {
      status:
        'unknown',

      healthy:
        true,
    };
  }

  return {
    ...result,

    healthy:
      result.healthy !==
        undefined
        ? Boolean(
            result.healthy,
          )
        : result.status ===
            'healthy' ||
          result.ready ===
            true,
  };
}

/**
 * =============================================================================
 * Check All Services
 * =============================================================================
 */

async function checkAllServices(
  context = {},
  options = {},
) {
  const enabled =
    listServices({
      enabledOnly:
        true,
    });

  const results =
    {};

  const requiredFailures =
    [];

  const optionalFailures =
    [];

  /**
   * External registry is checked separately because it may have its own
   * internal service graph.
   */
  const external =
    await checkExternalRegistryReadiness(
      context,
      options,
    );

  if (
    !external.ready &&
    external.status !==
      'not_configured'
  ) {
    requiredFailures.push(
      '$external-registry',
    );
  }

  for (
    const definition of
      enabled
  ) {
    const result =
      await checkRegisteredServiceReadiness(
        definition,
        context,
      );

    results[
      definition.name
    ] = {
      ...result,

      critical:
        definition.critical,

      dependencies:
        [
          ...definition.dependencies,
        ],
    };

    if (
      !result.ready
    ) {
      if (
        definition.critical
      ) {
        requiredFailures.push(
          definition.name,
        );
      } else {
        optionalFailures.push(
          definition.name,
        );
      }
    }
  }

  return {
    external,

    services:
      results,

    requiredFailures,

    optionalFailures,
  };
}

/**
 * =============================================================================
 * Rollback Partial Startup
 * =============================================================================
 */

async function rollbackStartedServices(
  context = {},
  generation,
  options = {},
) {
  const rollbackErrors =
    [];

  const startedDefinitions =
    listServices({
      enabledOnly:
        true,
    })
      .filter(
        definition =>
          startedServiceNames.has(
            definition.name,
          ),
      )
      .sort(
        compareServices,
      )
      .reverse();

  /**
   * Stop external registry before locally registered services.
   */
  if (
    externalServiceContract
  ) {
    try {
      await stopExternalRegistry(
        externalServiceContract,
        context,
        {
          stopTimeoutMs:
            options.externalStopTimeoutMs ||
            DEFAULT_EXTERNAL_STOP_TIMEOUT_MS,
        },
      );
    } catch (error) {
      rollbackErrors.push(
        error,
      );
    }
  }

  for (
    const definition of
      startedDefinitions
  ) {
    try {
      await stopRegisteredService(
        definition,
        context,
      );
    } catch (error) {
      rollbackErrors.push(
        error,
      );
    }
  }

  startedServiceNames.clear();

  emitObservabilityEvent(
    'services.rollback.completed',
    {
      generation,

      rollbackErrorCount:
        rollbackErrors.length,
    },
  );

  return rollbackErrors;
}

/**
 * =============================================================================
 * Readiness Registration
 * =============================================================================
 */

function registerReadinessDependency(
  context = {},
  options = {},
) {
  if (
    !readinessModule
  ) {
    return null;
  }

  const {
    register,
    has,
  } =
    readinessModule;

  if (
    typeof register !==
    'function'
  ) {
    return null;
  }

  if (
    typeof has ===
      'function' &&
    has(COMPONENT)
  ) {
    return null;
  }

  try {
    return register({
      name:
        COMPONENT,

      severity:
        options.readinessSeverity ||
        (
          options.critical ===
          false
            ? 'required'
            : 'critical'
        ),

      enabled:
        options.enabled !==
        false,

      readiness:
        async () => {
          const result =
            await checkAllServices(
              context,
              options,
            );

          return {
            ready:
              started &&
              !stopped &&
              !failed &&
              result.requiredFailures
                .length ===
                0,

            degraded:
              result.optionalFailures
                .length >
              0,

            services:
              result.services,

            external:
              result.external,
          };
        },

      health:
        async () =>
          health(
            context,
            options,
          ),

      timeoutMs:
        options.readinessTimeoutMs ||
        DEFAULT_READINESS_TIMEOUT_MS,

      metadata: {
        component:
          COMPONENT,

        service:
          SERVICE_NAME,
      },
    });
  } catch (error) {
    lastError =
      error;

    log(
      'warn',
      {
        event:
          'services.readiness_registration_failed',

        error:
          safeError(
            error,
            {
              phase:
                'readiness',
            },
          ),
      },
      'TITech services readiness registration failed; continuing without readiness registration.',
    );

    return null;
  }
}

/**
 * =============================================================================
 * Bootstrap Registration
 * =============================================================================
 */

function registerServicesHooks(
  context = {},
  options = {},
) {
  if (
    hooks.has(
      COMPONENT,
    )
  ) {
    registered =
      true;

    registrationResult =
      hooks.get(
        COMPONENT,
      );

    return registrationResult;
  }

  registerReadinessDependency(
    context,
    options,
  );

  registrationResult =
    lifecycle(
      COMPONENT,
      {
        priority:
          options.priority ??
          DEFAULT_PRIORITY,

        dependencies:
          Array.isArray(
            options.dependencies,
          )
            ? [
                ...options.dependencies,
              ]
            : [
                ...DEFAULT_DEPENDENCIES,
              ],

        timeoutMs:
          asPositiveInteger(
            options.timeoutMs,
            DEFAULT_TIMEOUT_MS,
          ),

        critical:
          options.critical !==
          false,

        enabled:
          options.enabled !==
          false,

        metadata: {
          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          implementation:
            'backend/bootstrap/services.js',
        },

        /**
         * =====================================================================
         * START
         * =====================================================================
         */

        start:
          async hookContext => {
            if (
              startPromise
            ) {
              return startPromise;
            }

            const runtimeContext =
              hookContext ||
              context ||
              {};

            const generation =
              ++startupGeneration;

            startPromise =
              (async () => {
                const timer =
                  process.hrtime.bigint();

                try {
                  log(
                    'info',
                    {
                      event:
                        'services.bootstrap.starting',

                      generation,
                    },
                    'TITech application services bootstrap started.',
                  );

                  /**
                   * Validate the local service graph BEFORE executing any
                   * service startup logic.
                   */
                  validateServiceDependencies();

                  /**
                   * Initialize the external service registry with a bounded
                   * operation.
                   */
                  const externalContract =
                    await initializeExternalServiceRegistry(
                      runtimeContext,
                      {
                        initializeTimeoutMs:
                          options.externalInitializeTimeoutMs ||
                          DEFAULT_EXTERNAL_INITIALIZE_TIMEOUT_MS,
                      },
                    );

                  externalServiceContract =
                    externalContract;

                  /**
                   * Resolve deterministic startup order.
                   */
                  const order =
                    resolveServiceOrder(
                      'startup',
                    );

                  log(
                    'debug',
                    {
                      event:
                        'services.startup_order_resolved',

                      generation,

                      serviceCount:
                        order.length,

                      order:
                        order.map(
                          service =>
                            service.name,
                        ),
                    },
                    'TITech service startup order resolved.',
                  );

                  /**
                   * Start every local service sequentially.
                   *
                   * This intentionally favors deterministic dependency-safe
                   * startup over unrestricted parallelism.
                   */
                  for (
                    const definition of
                      order
                  ) {
                    await startRegisteredService(
                      definition,
                      runtimeContext,
                      generation,
                    );
                  }

                  /**
                   * Start external registry only after local services are
                   * successfully initialized.
                   *
                   * This prevents registry start from hiding a failed local
                   * service and also avoids circular lifecycle behavior.
                   */
                  if (
                    externalContract
                      ?.start
                  ) {
                    await startExternalRegistry(
                      externalContract,
                      runtimeContext,
                      {
                        startTimeoutMs:
                          options.externalStartTimeoutMs ||
                          DEFAULT_EXTERNAL_START_TIMEOUT_MS,
                      },
                    );
                  }

                  /**
                   * Verify readiness before declaring the phase complete.
                   */
                  const readinessResult =
                    await checkAllServices(
                      runtimeContext,
                      options,
                    );

                  if (
                    readinessResult
                      .requiredFailures
                      .length >
                    0
                  ) {
                    throw new ServicesBootstrapError(
                      'One or more required TITech application services are not ready.',
                      {
                        code:
                          'SERVICES_REQUIRED_NOT_READY',

                        phase:
                          'readiness',

                        details: {
                          generation,

                          requiredFailures:
                            readinessResult
                              .requiredFailures,

                          optionalFailures:
                            readinessResult
                              .optionalFailures,
                        },
                      },
                    );
                  }

                  serviceCount =
                    serviceDefinitions.size;

                  started =
                    true;

                  stopped =
                    false;

                  failed =
                    false;

                  degraded =
                    readinessResult
                      .optionalFailures
                      .length >
                    0;

                  startedAt =
                    new Date();

                  lastError =
                    null;

                  if (
                    runtimeContext &&
                    typeof runtimeContext ===
                      'object'
                  ) {
                    runtimeContext.services =
                      servicesRegistry;

                    runtimeContext.serviceRegistry =
                      servicesRegistry;

                    runtimeContext.serviceStartupGeneration =
                      generation;
                  }

                  const durationMs =
                    elapsedMs(
                      timer,
                    );

                  emitObservabilityEvent(
                    'services.started',
                    {
                      generation,

                      serviceCount,

                      durationMs,

                      degraded,

                      externalRegistry:
                        Boolean(
                          externalContract,
                        ),
                    },
                  );

                  log(
                    'info',
                    {
                      event:
                        'services.bootstrap.completed',

                      generation,

                      serviceCount,

                      durationMs,

                      degraded,

                      externalRegistry:
                        Boolean(
                          externalContract,
                        ),
                    },
                    'TITech application services started successfully.',
                  );

                  return {
                    services:
                      servicesRegistry,

                    serviceCount,

                    generation,

                    durationMs,

                    degraded,

                    readiness:
                      readinessResult,
                  };
                } catch (error) {
                  failed =
                    true;

                  started =
                    false;

                  degraded =
                    true;

                  lastError =
                    error;

                  const normalized =
                    safeError(
                      error,
                      {
                        phase:
                          'startup',

                        includeStack:
                          true,
                      },
                    );

                  emitObservabilityEvent(
                    'services.start_failed',
                    {
                      generation,

                      error:
                        normalized,
                    },
                  );

                  log(
                    'error',
                    {
                      event:
                        'services.bootstrap.failed',

                      generation,

                      error:
                        normalized,
                    },
                    'TITech application services bootstrap failed; rolling back partial startup.',
                  );

                  /**
                   * Critical improvement:
                   *
                   * If service N fails after services 1..N-1 started, those
                   * services are stopped before the failure escapes into the
                   * global bootstrap pipeline.
                   */
                  const rollbackErrors =
                    await rollbackStartedServices(
                      runtimeContext,
                      generation,
                      {
                        externalStopTimeoutMs:
                          options.externalStopTimeoutMs ||
                          DEFAULT_EXTERNAL_STOP_TIMEOUT_MS,
                      },
                    );

                  if (
                    rollbackErrors.length >
                    0
                  ) {
                    log(
                      'error',
                      {
                        event:
                          'services.rollback.partial_failure',

                        generation,

                        rollbackErrorCount:
                          rollbackErrors.length,

                        primaryError:
                          normalized,

                        rollbackErrors:
                          rollbackErrors.map(
                            rollbackError =>
                              safeError(
                                rollbackError,
                                {
                                  phase:
                                    'rollback',

                                  includeStack:
                                    false,
                                },
                              ),
                          ),
                      },
                      'TITech service startup rollback encountered one or more failures.',
                    );
                  }

                  throw wrapError(
                    error,
                    'SERVICES_START_FAILED',
                    'startup',
                    'TITech application services startup failed.',
                    {
                      generation,

                      rollbackErrorCount:
                        rollbackErrors.length,
                    },
                  );
                }
              })();

            try {
              return await startPromise;
            } finally {
              /**
               * A successful startPromise is cleared after completion so a
               * later explicit lifecycle call can proceed safely.
               */
              startPromise =
                null;
            }
          },

        /**
         * =====================================================================
         * READY
         * =====================================================================
         */

        ready:
          async hookContext => {
            try {
              const result =
                await checkAllServices(
                  hookContext ||
                    context ||
                    {},
                  options,
                );

              if (
                result.requiredFailures
                  .length >
                0
              ) {
                return false;
              }

              degraded =
                result.optionalFailures
                  .length >
                0;

              return true;
            } catch (error) {
              lastError =
                error;

              log(
                'error',
                {
                  event:
                    'services.readiness_check_failed',

                  error:
                    safeError(
                      error,
                      {
                        phase:
                          'readiness',
                      },
                    ),
                },
                'TITech services readiness check failed.',
              );

              return false;
            }
          },

        /**
         * =====================================================================
         * HEALTH
         * =====================================================================
         */

        health:
          async hookContext =>
            health(
              hookContext ||
                context ||
                {},
              options,
            ),

        /**
         * =====================================================================
         * STOP
         * =====================================================================
         */

        stop:
          async hookContext =>
            shutdown(
              hookContext ||
                context ||
                {},
              options,
            ),
      },
    );

  registered =
    true;

  return registrationResult;
}

/**
 * =============================================================================
 * Compatibility Adapter
 * =============================================================================
 */

function registerBootstrapHooks(
  context = {},
  options = {},
) {
  return registerServicesHooks(
    context,
    options,
  );
}

/**
 * =============================================================================
 * Explicit Initialization
 * =============================================================================
 */

async function initialize(
  context = {},
  options = {},
) {
  if (
    started &&
    !stopped &&
    !failed
  ) {
    return servicesRegistry;
  }

  if (
    startPromise
  ) {
    return startPromise;
  }

  const generation =
    ++startupGeneration;

  startPromise =
    (async () => {
      const timer =
        process.hrtime.bigint();

      try {
        validateServiceDependencies();

        const externalContract =
          await initializeExternalServiceRegistry(
            context,
            {
              initializeTimeoutMs:
                options.externalInitializeTimeoutMs ||
                DEFAULT_EXTERNAL_INITIALIZE_TIMEOUT_MS,
            },
          );

        externalServiceContract =
          externalContract;

        const order =
          resolveServiceOrder(
            'startup',
          );

        for (
          const definition of
            order
        ) {
          await startRegisteredService(
            definition,
            context,
            generation,
          );
        }

        if (
          externalContract?.start
        ) {
          await startExternalRegistry(
            externalContract,
            context,
            {
              startTimeoutMs:
                options.externalStartTimeoutMs ||
                DEFAULT_EXTERNAL_START_TIMEOUT_MS,
            },
          );
        }

        const readinessResult =
          await checkAllServices(
            context,
            options,
          );

        if (
          readinessResult
            .requiredFailures
            .length >
          0
        ) {
          throw new ServicesBootstrapError(
            'One or more required TITech application services are not ready.',
            {
              code:
                'SERVICES_REQUIRED_NOT_READY',

              phase:
                'readiness',

              details: {
                requiredFailures:
                  readinessResult
                    .requiredFailures,

                optionalFailures:
                  readinessResult
                    .optionalFailures,
              },
            },
          );
        }

        started =
          true;

        stopped =
          false;

        failed =
          false;

        degraded =
          readinessResult
            .optionalFailures
            .length >
          0;

        startedAt =
          new Date();

        serviceCount =
          serviceDefinitions.size;

        if (
          context &&
          typeof context ===
            'object'
        ) {
          context.services =
            servicesRegistry;

          context.serviceRegistry =
            servicesRegistry;

          context.serviceStartupGeneration =
            generation;
        }

        emitObservabilityEvent(
          'services.initialized',
          {
            generation,

            serviceCount,

            durationMs:
              elapsedMs(
                timer,
              ),
          },
        );

        return servicesRegistry;
      } catch (error) {
        failed =
          true;

        started =
          false;

        degraded =
          true;

        lastError =
          error;

        const rollbackErrors =
          await rollbackStartedServices(
            context,
            generation,
            {
              externalStopTimeoutMs:
                options.externalStopTimeoutMs ||
                DEFAULT_EXTERNAL_STOP_TIMEOUT_MS,
            },
          );

        const wrapped =
          wrapError(
            error,
            'SERVICES_INITIALIZATION_FAILED',
            'initialization',
            'TITech application service initialization failed.',
            {
              generation,

              rollbackErrorCount:
                rollbackErrors.length,
            },
          );

        lastError =
          wrapped;

        throw wrapped;
      } finally {
        startPromise =
          null;
      }
    })();

  return startPromise;
}

/**
 * =============================================================================
 * Shutdown
 * =============================================================================
 */

async function shutdown(
  context = {},
  options = {},
) {
  if (
    stopped &&
    !started
  ) {
    return true;
  }

  if (
    stopPromise
  ) {
    return stopPromise;
  }

  stopPromise =
    (async () => {
      const errors =
        [];

      try {
        /**
         * External registry must be stopped first because it may depend on the
         * local services that are about to be shut down.
         */
        if (
          externalServiceContract
        ) {
          try {
            await stopExternalRegistry(
              externalServiceContract,
              context,
              {
                stopTimeoutMs:
                  options.externalStopTimeoutMs ||
                  DEFAULT_EXTERNAL_STOP_TIMEOUT_MS,
              },
            );
          } catch (error) {
            errors.push(
              error,
            );
          }
        }

        /**
         * Then stop locally registered services in reverse dependency order.
         */
        const order =
          resolveServiceOrder(
            'shutdown',
          );

        for (
          const definition of
            order
        ) {
          try {
            await stopRegisteredService(
              definition,
              context,
              options,
            );
          } catch (error) {
            errors.push(
              error,
            );
          }
        }

        started =
          false;

        stopped =
          errors.length ===
          0;

        failed =
          errors.length >
          0;

        degraded =
          false;

        stoppedAt =
          new Date();

        if (
          errors.length >
          0
        ) {
          lastError =
            errors[0];

          emitObservabilityEvent(
            'services.stop_failed',
            {
              errorCount:
                errors.length,

              error:
                safeError(
                  errors[0],
                  {
                    phase:
                      'shutdown',
                  },
                ),
            },
          );

          throw new ServicesBootstrapError(
            'One or more TITech application services failed during shutdown.',
            {
              code:
                'SERVICES_STOP_PARTIAL_FAILURE',

              phase:
                'shutdown',

              cause:
                errors[0],

              details: {
                errorCount:
                  errors.length,
              },
            },
          );
        }

        startedServiceNames.clear();

        emitObservabilityEvent(
          'services.stopped',
          {
            serviceCount,
          },
        );

        log(
          'info',
          {
            event:
              'services.stopped',

            serviceCount,
          },
          'TITech application services stopped.',
        );

        return true;
      } catch (error) {
        failed =
          true;

        lastError =
          error;

        throw (
          error instanceof
          ServicesBootstrapError
            ? error
            : wrapError(
                error,
                'SERVICES_SHUTDOWN_FAILED',
                'shutdown',
                'TITech application service shutdown failed.',
              )
        );
      } finally {
        stopPromise =
          null;
      }
    })();

  return stopPromise;
}

async function stop(
  context = {},
  options = {},
) {
  return shutdown(
    context,
    options,
  );
}

/**
 * =============================================================================
 * Readiness
 * =============================================================================
 */

async function readiness(
  context = {},
  options = {},
) {
  const results =
    await checkAllServices(
      context,
      options,
    );

  const ready =
    started &&
    !stopped &&
    !failed &&
    results.requiredFailures
      .length ===
    0;

  degraded =
    results.optionalFailures
      .length >
    0;

  return {
    status:
      ready
        ? degraded
          ? 'degraded'
          : 'ready'
        : 'not_ready',

    ready,

    degraded,

    service:
      SERVICE_NAME,

    component:
      COMPONENT,

    serviceCount,

    services:
      results.services,

    external:
      results.external,

    requiredFailures:
      results.requiredFailures,

    optionalFailures:
      results.optionalFailures,

    generation:
      startupGeneration,

    timestamp:
      new Date().toISOString(),
  };
}

/**
 * =============================================================================
 * Health
 * =============================================================================
 */

async function health(
  context = {},
  options = {},
) {
  const result =
    await readiness(
      context,
      options,
    );

  const externalHealth =
    await checkExternalRegistryHealth(
      context,
      options,
    );

  const healthy =
    result.ready &&
    externalHealth.healthy !==
      false;

  return {
    status:
      healthy
        ? result.degraded
          ? 'degraded'
          : 'healthy'
        : 'unhealthy',

    healthy,

    ready:
      result.ready,

    degraded:
      result.degraded,

    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    serviceCount,

    services:
      result.services,

    external:
      {
        readiness:
          result.external,

        health:
          externalHealth,
      },

    requiredFailures:
      result.requiredFailures,

    optionalFailures:
      result.optionalFailures,

    implementation:
      servicesModulePath,

    generation:
      startupGeneration,

    timestamp:
      new Date().toISOString(),
  };
}

/**
 * =============================================================================
 * State
 * =============================================================================
 */

function isReady() {
  return (
    started &&
    !stopped &&
    !failed
  );
}

function isStarted() {
  return started;
}

function isStopped() {
  return stopped;
}

function isFailed() {
  return failed;
}

function isDegraded() {
  return degraded;
}

/**
 * =============================================================================
 * Runtime Access
 * =============================================================================
 */

function getServices() {
  return servicesRegistry;
}

function getServiceRegistry() {
  return servicesRegistry;
}

function getImplementation() {
  return servicesImplementation;
}

/**
 * =============================================================================
 * Snapshot
 * =============================================================================
 */

function snapshot() {
  const services =
    {};

  for (
    const [
      name,
      definition,
    ] of serviceDefinitions
  ) {
    const state =
      serviceStates.get(
        name,
      );

    services[name] =
      {
        name,

        description:
          definition.description,

        version:
          definition.version,

        enabled:
          definition.enabled,

        critical:
          definition.critical,

        priority:
          definition.priority,

        dependencies:
          [
            ...definition.dependencies,
          ],

        state:
          state?.state ||
          'unknown',

        started:
          state?.started ||
          false,

        ready:
          state?.ready ||
          false,

        failed:
          state?.failed ||
          false,

        generation:
          state?.generation ||
          null,

        startedAt:
          state?.startedAt ||
          null,

        readyAt:
          state?.readyAt ||
          null,

        stoppedAt:
          state?.stoppedAt ||
          null,

        durationMs:
          state?.durationMs ||
          null,

        lastError:
          state?.lastError ||
          null,

        metadata:
          definition.metadata,
      };
  }

  return Object.freeze({
    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    registered,

    started,

    stopped,

    failed,

    degraded,

    ready:
      isReady(),

    serviceCount,

    generation:
      startupGeneration,

    implementation:
      servicesModulePath,

    externalRegistry:
      Boolean(
        servicesRegistry,
      ),

    services:
      Object.freeze(
        services,
      ),

    lastError:
      safeError(
        lastError,
        {
          phase:
            'state',
        },
      ),

    startedAt,

    stoppedAt,
  });
}

/**
 * =============================================================================
 * Context Registration
 * =============================================================================
 */

function registerIntoContext(
  context = {},
) {
  if (
    !context ||
    typeof context !==
      'object'
  ) {
    throw new TypeError(
      'A bootstrap context object is required.',
    );
  }

  context.services =
    servicesRegistry;

  context.serviceRegistry =
    servicesRegistry;

  context.serviceStartupGeneration =
    startupGeneration;

  return context;
}

/**
 * =============================================================================
 * Reset
 * =============================================================================
 *
 * Intended for isolated tests/process reinitialization.
 */

function reset() {
  if (
    started
  ) {
    throw new ServicesBootstrapError(
      'Cannot reset active TITech services.',
      {
        code:
          'SERVICES_RESET_NOT_ALLOWED',
      },
    );
  }

  servicesImplementation =
    null;

  servicesModulePath =
    null;

  servicesRegistry =
    null;

  externalServiceContract =
    null;

  registered =
    false;

  started =
    false;

  stopped =
    false;

  failed =
    false;

  degraded =
    false;

  registrationResult =
    null;

  startPromise =
    null;

  stopPromise =
    null;

  lastError =
    null;

  startedAt =
    null;

  stoppedAt =
    null;

  serviceCount =
    0;

  startupGeneration =
    0;

  startedServiceNames.clear();

  serviceDefinitions.clear();

  serviceStates.clear();

  return true;
}

/**
 * =============================================================================
 * Error Wrapper
 * =============================================================================
 */

function wrapError(
  error,
  code,
  phase,
  message,
  details = {},
) {
  if (
    error instanceof
      ServicesBootstrapError
  ) {
    return error;
  }

  return new ServicesBootstrapError(
    message,
    {
      code,

      phase,

      cause:
        error,

      retryable:
        error?.retryable ??
        null,

      details,
    },
  );
}

/**
 * =============================================================================
 * Export
 * =============================================================================
 */

module.exports =
  Object.freeze({
    /**
     * Registration.
     */
    registerService,

    registerServicesHooks,

    registerBootstrapHooks,

    bootstrap:
      registerBootstrapHooks,

    /**
     * Explicit lifecycle.
     */
    initialize,

    start:
      initialize,

    shutdown,

    stop,

    /**
     * Service registry.
     */
    hasService,

    getService,

    listServices,

    resolveServiceOrder,

    getServices,

    getServiceRegistry,

    getImplementation,

    registerIntoContext,

    /**
     * Operational.
     */
    readiness,

    health,

    snapshot,

    /**
     * State.
     */
    isReady,

    isStarted,

    isStopped,

    isFailed,

    isDegraded,

    /**
     * Diagnostics.
     */
    safeError,

    /**
     * Testing.
     */
    reset,

    /**
     * Constants.
     */
    COMPONENT,

    SERVICE_NAME,

    APPLICATION_NAME,

    SERVICE_STATES,

    SERVICE_MODULE_CANDIDATES,

    /**
     * Error.
     */
    ServicesBootstrapError,
  });