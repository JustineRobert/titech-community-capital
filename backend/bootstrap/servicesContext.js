'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/servicesContext.js
 *
 * Purpose:
 *   Enterprise production-grade dependency context for TITech application
 *   services.
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
 *   servicesContext
 *       ↓
 *   application services
 *       ↓
 *   finance / ledger / payments / accounts
 *       ↓
 *   routes
 *
 * IMPORTANT:
 *
 *   This module provides DEPENDENCY CONTEXT.
 *
 *   It does NOT:
 *     - implement business rules;
 *     - implement financial operations;
 *     - execute repository queries;
 *     - create database connections;
 *     - create Redis connections;
 *     - initialize queues;
 *     - implement controllers;
 *     - authorize financial operations;
 *     - own application process termination.
 *
 * =============================================================================
 */

const {
  AsyncLocalStorage,
} = require('node:async_hooks');

/**
 * =============================================================================
 * Optional integrations
 * =============================================================================
 */

let loggerModule = null;

try {
  // eslint-disable-next-line global-require
  loggerModule =
    require('./logger');
} catch {
  loggerModule = null;
}

let observabilityModule = null;

try {
  // eslint-disable-next-line global-require
  observabilityModule =
    require('./observability');
} catch {
  observabilityModule = null;
}

let readinessModule = null;

try {
  // eslint-disable-next-line global-require
  readinessModule =
    require('./readinessState');
} catch {
  readinessModule = null;
}

let resilienceModule = null;

try {
  // eslint-disable-next-line global-require
  resilienceModule =
    require('./resilience');
} catch {
  resilienceModule = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
  'services-context';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-community-capital-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'TITech Community Capital';

const DEFAULT_LIFECYCLE_STATE =
  'initializing';

const DEFAULT_OPERATION =
  null;

const DEFAULT_BOOTSTRAP_TIMEOUT_MS =
  30_000;

/**
 * Private context marker.
 */
const CONTEXT_MARKER =
  Symbol('TITechServicesContext');

/**
 * Private registry marker.
 *
 * This registry is intentionally mutable internally while the public context
 * envelope remains immutable.
 */
const REGISTRY_MARKER =
  Symbol('TITechServicesContextRegistry');

/**
 * Per-async-operation service context.
 */
const asyncContext =
  new AsyncLocalStorage();

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class ServicesContextError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(
      typeof message ===
        'string' &&
      message.trim()
        ? message
        : 'TITech services context error.',
    );

    this.name =
      'ServicesContextError';

    this.code =
      options.code ||
      'SERVICES_CONTEXT_ERROR';

    this.service =
      options.service ||
      null;

    this.dependency =
      options.dependency ||
      null;

    this.operation =
      options.operation ||
      null;

    this.cause =
      options.cause ||
      null;

    this.details =
      Object.freeze({
        ...(options.details ||
          {}),
      });

    Error.captureStackTrace?.(
      this,
      ServicesContextError,
    );
  }
}

class DependencyNotFoundError
  extends ServicesContextError {
  constructor(
    dependency,
    service = null,
  ) {
    super(
      `TITech service dependency "${dependency}" is not available.`,
      {
        code:
          'SERVICE_DEPENDENCY_NOT_FOUND',

        dependency,

        service,
      },
    );
  }
}

class ContextFrozenError
  extends ServicesContextError {
  constructor(
    message =
      'TITech services context is immutable.',
  ) {
    super(
      message,
      {
        code:
          'SERVICES_CONTEXT_IMMUTABLE',
      },
    );
  }
}

class ContextLifecycleError
  extends ServicesContextError {
  constructor(
    message,
    options = {},
  ) {
    super(
      message,
      {
        code:
          options.code ||
          'SERVICES_CONTEXT_LIFECYCLE_ERROR',

        ...options,
      },
    );
  }
}

/**
 * =============================================================================
 * Utility
 * =============================================================================
 */

function normalizeName(
  value,
  field = 'name',
) {
  if (
    typeof value !== 'string' ||
    value.trim() === ''
  ) {
    throw new TypeError(
      `${field} must be a non-empty string.`,
    );
  }

  return value.trim();
}

function isObjectLike(
  value,
) {
  return (
    value !== null &&
    (
      typeof value === 'object' ||
      typeof value === 'function'
    )
  );
}

function isPlainObject(
  value,
) {
  if (
    !value ||
    Object.prototype.toString.call(
      value,
    ) !== '[object Object]'
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(
      value,
    );

  return (
    prototype ===
      Object.prototype ||
    prototype === null
  );
}

function isFunction(
  value,
) {
  return typeof value ===
    'function';
}

function toPositiveInteger(
  value,
  fallback,
) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(
      parsed,
    ) ||
    parsed <= 0
  ) {
    return fallback;
  }

  return parsed;
}

function elapsedMs(
  startedAt,
) {
  return (
    Number(
      process.hrtime.bigint() -
        startedAt,
    ) /
    1_000_000
  );
}

function safeError(
  error,
) {
  if (!error) {
    return null;
  }

  return Object.freeze({
    name:
      error.name ||
      'Error',

    code:
      error.code ||
      null,

    message:
      error.message ||
      String(error),
  });
}

/**
 * =============================================================================
 * Safe Diagnostics Sanitization
 * =============================================================================
 */

const SENSITIVE_KEYS =
  new Set([
    'password',
    'passcode',
    'pin',
    'otp',
    'token',
    'accesstoken',
    'refreshtoken',
    'authorization',
    'cookie',
    'secret',
    'apikey',
    'clientsecret',
    'privatekey',
    'encryptionkey',
    'jwt',
    'jwtsecret',
    'credentials',
  ]);

function isSensitiveKey(
  key,
) {
  return SENSITIVE_KEYS.has(
    String(key)
      .replace(/[_-]/g, '')
      .toLowerCase(),
  );
}

function sanitize(
  value,
  options = {},
  seen = new WeakSet(),
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value ===
    'string'
  ) {
    if (
      options.maskCredentials !==
      false
    ) {
      return value
        .replace(
          /(mongodb(?:\+srv)?:\/\/)([^/\s:@]+)(?::[^@\s]*)?@/gi,
          '$1***:***@',
        )
        .replace(
          /([?&](?:password|passwd|pwd|secret|token|access_token)=)[^&\s]*/gi,
          '$1***',
        );
    }

    return value;
  }

  if (
    typeof value !==
      'object' &&
    typeof value !==
      'function'
  ) {
    return value;
  }

  if (
    seen.has(value)
  ) {
    return '[Circular]';
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    value instanceof Error
  ) {
    return safeError(
      value,
    );
  }

  if (
    Array.isArray(value)
  ) {
    seen.add(value);

    return value.map(
      entry =>
        sanitize(
          entry,
          options,
          seen,
        ),
    );
  }

  /**
   * Never recursively inspect or clone live infrastructure objects in
   * diagnostics. This is intentionally conservative.
   */
  if (
    !isPlainObject(value)
  ) {
    return `[${Object.prototype.toString.call(
      value,
    )}]`;
  }

  seen.add(value);

  const result =
    {};

  for (
    const [
      key,
      child,
    ] of Object.entries(
      value,
    )
  ) {
    if (
      isSensitiveKey(
        key,
      )
    ) {
      result[key] =
        '[REDACTED]';

      continue;
    }

    result[key] =
      sanitize(
        child,
        options,
        seen,
      );
  }

  return result;
}

/**
 * =============================================================================
 * Registry
 * =============================================================================
 *
 * Critical design:
 *
 * The public ServicesContext is immutable.
 * The underlying dependency registry is intentionally mutable.
 *
 * This avoids replacing the root context object every time bootstrap registers
 * another service.
 *
 * Consumers therefore retain the same context identity while seeing newly
 * published dependencies.
 */

class ServicesContextRegistry {
  constructor(
    options = {},
  ) {
    this.services =
      new Map(
        Object.entries(
          options.services ||
            {},
        ),
      );

    this.infrastructure =
      new Map(
        Object.entries(
          options.infrastructure ||
            {},
        ),
      );

    this.container =
      new Map(
        Object.entries(
          options.container ||
            {},
        ),
      );

    this.revision =
      0;

    this.updatedAt =
      new Date();
  }

  _touch() {
    this.revision +=
      1;

    this.updatedAt =
      new Date();
  }

  setService(
    name,
    value,
  ) {
    this.services.set(
      normalizeName(
        name,
        'service',
      ),
      value,
    );

    this._touch();

    return value;
  }

  removeService(
    name,
  ) {
    const removed =
      this.services.delete(
        normalizeName(
          name,
          'service',
        ),
      );

    if (removed) {
      this._touch();
    }

    return removed;
  }

  setInfrastructure(
    name,
    value,
  ) {
    this.infrastructure.set(
      normalizeName(
        name,
        'infrastructure',
      ),
      value,
    );

    this._touch();

    return value;
  }

  removeInfrastructure(
    name,
  ) {
    const removed =
      this.infrastructure.delete(
        normalizeName(
          name,
          'infrastructure',
        ),
      );

    if (removed) {
      this._touch();
    }

    return removed;
  }

  setContainer(
    name,
    value,
  ) {
    this.container.set(
      normalizeName(
        name,
        'container binding',
      ),
      value,
    );

    this._touch();

    return value;
  }

  removeContainer(
    name,
  ) {
    const removed =
      this.container.delete(
        normalizeName(
          name,
          'container binding',
        ),
      );

    if (removed) {
      this._touch();
    }

    return removed;
  }

  has(
    dependency,
  ) {
    return (
      this.services.has(
        dependency,
      ) ||
      this.container.has(
        dependency,
      ) ||
      this.infrastructure.has(
        dependency,
      )
    );
  }

  get(
    dependency,
  ) {
    if (
      this.services.has(
        dependency,
      )
    ) {
      return this.services.get(
        dependency,
      );
    }

    if (
      this.container.has(
        dependency,
      )
    ) {
      return this.container.get(
        dependency,
      );
    }

    if (
      this.infrastructure.has(
        dependency,
      )
    ) {
      return this.infrastructure.get(
        dependency,
      );
    }

    return undefined;
  }

  snapshot(
    options = {},
  ) {
    return Object.freeze({
      revision:
        this.revision,

      updatedAt:
        this.updatedAt,

      services:
        Object.freeze(
          Object.fromEntries(
            [
              ...this.services.keys(),
            ].map(
              name => [
                name,
                true,
              ],
            ),
          ),
        ),

      infrastructure:
        Object.freeze(
          Object.fromEntries(
            [
              ...this.infrastructure.keys(),
            ].map(
              name => [
                name,
                true,
              ],
            ),
          ),
        ),

      container:
        Object.freeze(
          Object.fromEntries(
            [
              ...this.container.keys(),
            ].map(
              name => [
                name,
                true,
              ],
            ),
          ),
        ),

      diagnostics:
        options.includeValues
          ? sanitize(
              {
                services:
                  Object.fromEntries(
                    this.services,
                  ),

                infrastructure:
                  Object.fromEntries(
                    this.infrastructure,
                  ),
              },
            )
          : undefined,
    });
  }
}

/**
 * =============================================================================
 * Services Context
 * =============================================================================
 */

class ServicesContext {
  constructor(
    options = {},
  ) {
    const registry =
      options.registry ||
      new ServicesContextRegistry({
        services:
          options.services,

        infrastructure:
          options.infrastructure,

        container:
          options.container,
      });

    Object.defineProperty(
      this,
      CONTEXT_MARKER,
      {
        value:
          true,

        enumerable:
          false,

        configurable:
          false,

        writable:
          false,
      },
    );

    Object.defineProperty(
      this,
      REGISTRY_MARKER,
      {
        value:
          registry,

        enumerable:
          false,

        configurable:
          false,

        writable:
          false,
      },
    );

    this.createdAt =
      options.createdAt ||
      new Date();

    this.service =
      options.service ||
      'application';

    this.operation =
      options.operation ??
      DEFAULT_OPERATION;

    this.config =
      options.config ??
      null;

    this.environment =
      options.environment ??
      null;

    this.logger =
      options.logger ??
      resolveLogger();

    this.observability =
      options.observability ??
      resolveObservability();

    this.readiness =
      options.readiness ??
      resolveReadiness();

    this.resilience =
      options.resilience ??
      resolveResilience();

    this.infrastructure =
      createRegistryFacade(
        registry,
        'infrastructure',
      );

    this.services =
      createRegistryFacade(
        registry,
        'services',
      );

    this.container =
      createRegistryFacade(
        registry,
        'container',
      );

    this.request =
      createSafeMetadataObject(
        options.request ||
          {},
      );

    this.correlation =
      createSafeMetadataObject(
        options.correlation ||
          {},
      );

    this.trace =
      createSafeMetadataObject(
        options.trace ||
          {},
      );

    this.metadata =
      Object.freeze({
        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        application:
          APPLICATION_NAME,

        ...(options.metadata ||
          {}),
      });

    this.lifecycle =
      Object.freeze({
        state:
          options.lifecycleState ||
          DEFAULT_LIFECYCLE_STATE,

        ready:
          options.ready ??
          false,

        degraded:
          options.degraded ??
          false,
      });

    /**
     * Public context is frozen.
     *
     * Live dependencies themselves are NOT recursively frozen.
     */
    Object.freeze(
      this,
    );
  }

  /* ===========================================================================
   * Validation
   * ========================================================================= */

  static isContext(
    value,
  ) {
    return Boolean(
      value &&
      value[CONTEXT_MARKER] ===
        true,
    );
  }

  assert() {
    if (
      !ServicesContext.isContext(
        this,
      )
    ) {
      throw new ServicesContextError(
        'Invalid TITech services context.',
        {
          code:
            'INVALID_SERVICES_CONTEXT',
        },
      );
    }

    return true;
  }

  /* ===========================================================================
   * Registry
   * ========================================================================= */

  get registryRevision() {
    return this[
      REGISTRY_MARKER
    ].revision;
  }

  getRegistrySnapshot(
    options = {},
  ) {
    return this[
      REGISTRY_MARKER
    ].snapshot(
      options,
    );
  }

  /* ===========================================================================
   * Dependency Lookup
   * ========================================================================= */

  has(
    dependency,
  ) {
    const name =
      normalizeName(
        dependency,
        'dependency',
      );

    return this[
      REGISTRY_MARKER
    ].has(
      name,
    );
  }

  get(
    dependency,
  ) {
    const name =
      normalizeName(
        dependency,
        'dependency',
      );

    return this[
      REGISTRY_MARKER
    ].get(
      name,
    );
  }

  require(
    dependency,
  ) {
    const name =
      normalizeName(
        dependency,
        'dependency',
      );

    const value =
      this.get(
        name,
      );

    if (
      value ===
        undefined ||
      value ===
        null
    ) {
      throw new DependencyNotFoundError(
        name,
        this.service,
      );
    }

    return value;
  }

  getOrDefault(
    dependency,
    fallback,
  ) {
    const value =
      this.get(
        dependency,
      );

    return value ===
      undefined
      ? fallback
      : value;
  }

  /* ===========================================================================
   * Service Lookup
   * ========================================================================= */

  service(
    name,
  ) {
    return this[
      REGISTRY_MARKER
    ].services.get(
      normalizeName(
        name,
        'service',
      ),
    );
  }

  requireService(
    name,
  ) {
    const normalized =
      normalizeName(
        name,
        'service',
      );

    const service =
      this[
        REGISTRY_MARKER
      ].services.get(
        normalized,
      );

    if (
      service ===
        undefined ||
      service ===
        null
    ) {
      throw new DependencyNotFoundError(
        normalized,
        this.service,
      );
    }

    return service;
  }

  hasService(
    name,
  ) {
    return this[
      REGISTRY_MARKER
    ].services.has(
      normalizeName(
        name,
        'service',
      ),
    );
  }

  /* ===========================================================================
   * Infrastructure
   * ========================================================================= */

  infrastructureService(
    name,
  ) {
    return this[
      REGISTRY_MARKER
    ].infrastructure.get(
      normalizeName(
        name,
        'infrastructure',
      ),
    );
  }

  requireInfrastructure(
    name,
  ) {
    const normalized =
      normalizeName(
        name,
        'infrastructure',
      );

    const resource =
      this[
        REGISTRY_MARKER
      ].infrastructure.get(
        normalized,
      );

    if (
      resource ===
        undefined ||
      resource ===
        null
    ) {
      throw new DependencyNotFoundError(
        normalized,
        this.service,
      );
    }

    return resource;
  }

  hasInfrastructure(
    name,
  ) {
    return this[
      REGISTRY_MARKER
    ].infrastructure.has(
      normalizeName(
        name,
        'infrastructure',
      ),
    );
  }

  /* ===========================================================================
   * Controlled Runtime Registration
   * ===========================================================================
   *
   * These methods mutate only the private dependency registry.
   * The ServicesContext identity remains stable.
   * ========================================================================= */

  registerService(
    name,
    service,
  ) {
    if (
      service ===
        undefined ||
      service ===
        null
    ) {
      throw new ServicesContextError(
        `Cannot register empty TITech service "${name}".`,
        {
          code:
            'SERVICE_REGISTRATION_INVALID',

          service:
            name,
        },
      );
    }

    this[
      REGISTRY_MARKER
    ].setService(
      name,
      service,
    );

    return service;
  }

  unregisterService(
    name,
  ) {
    return this[
      REGISTRY_MARKER
    ].removeService(
      name,
    );
  }

  registerInfrastructure(
    name,
    resource,
  ) {
    if (
      resource ===
        undefined ||
      resource ===
        null
    ) {
      throw new ServicesContextError(
        `Cannot register empty TITech infrastructure resource "${name}".`,
        {
          code:
            'INFRASTRUCTURE_REGISTRATION_INVALID',

          dependency:
            name,
        },
      );
    }

    this[
      REGISTRY_MARKER
    ].setInfrastructure(
      name,
      resource,
    );

    return resource;
  }

  unregisterInfrastructure(
    name,
  ) {
    return this[
      REGISTRY_MARKER
    ].removeInfrastructure(
      name,
    );
  }

  registerContainerBinding(
    name,
    value,
  ) {
    this[
      REGISTRY_MARKER
    ].setContainer(
      name,
      value,
    );

    return value;
  }

  unregisterContainerBinding(
    name,
  ) {
    return this[
      REGISTRY_MARKER
    ].removeContainer(
      name,
    );
  }

  /* ===========================================================================
   * Service-Scoped Context
   * ========================================================================= */

  forService(
    service,
    options = {},
  ) {
    const name =
      normalizeName(
        service,
        'service',
      );

    return createServicesContext({
      parent:
        this,

      registry:
        this[
          REGISTRY_MARKER
        ],

      service:
        name,

      operation:
        options.operation ??
        null,

      metadata: {
        ...this.metadata,

        service:
          name,

        operation:
          options.operation ??
          null,
      },

      request:
        options.request ??
        this.request,

      correlation:
        options.correlation ??
        this.correlation,

      trace:
        options.trace ??
        this.trace,

      lifecycleState:
        options.lifecycleState ??
        this.lifecycle.state,

      ready:
        options.ready ??
        this.lifecycle.ready,

      degraded:
        options.degraded ??
        this.lifecycle.degraded,
    });
  }

  forOperation(
    operation,
    options = {},
  ) {
    const name =
      normalizeName(
        operation,
        'operation',
      );

    return this.forService(
      options.service ||
        this.service ||
        'application',
      {
        ...options,

        operation:
          name,
      },
    );
  }

  /* ===========================================================================
   * Request / Correlation / Trace
   * ========================================================================= */

  withRequest(
    request,
  ) {
    return createServicesContext({
      parent:
        this,

      registry:
        this[
          REGISTRY_MARKER
        ],

      service:
        this.service,

      operation:
        this.operation,

      request,

      correlation:
        this.correlation,

      trace:
        this.trace,

      metadata: {
        ...this.metadata,
      },

      lifecycleState:
        this.lifecycle.state,

      ready:
        this.lifecycle.ready,

      degraded:
        this.lifecycle.degraded,
    });
  }

  withCorrelation(
    correlation,
  ) {
    return createServicesContext({
      parent:
        this,

      registry:
        this[
          REGISTRY_MARKER
        ],

      service:
        this.service,

      operation:
        this.operation,

      request:
        this.request,

      correlation,

      trace:
        this.trace,

      metadata: {
        ...this.metadata,
      },

      lifecycleState:
        this.lifecycle.state,

      ready:
        this.lifecycle.ready,

      degraded:
        this.lifecycle.degraded,
    });
  }

  withTrace(
    trace,
  ) {
    return createServicesContext({
      parent:
        this,

      registry:
        this[
          REGISTRY_MARKER
        ],

      service:
        this.service,

      operation:
        this.operation,

      request:
        this.request,

      correlation:
        this.correlation,

      trace,

      metadata: {
        ...this.metadata,
      },

      lifecycleState:
        this.lifecycle.state,

      ready:
        this.lifecycle.ready,

      degraded:
        this.lifecycle.degraded,
    });
  }

  withSignal(
    signal,
  ) {
    return createServicesContext({
      parent:
        this,

      registry:
        this[
          REGISTRY_MARKER
        ],

      service:
        this.service,

      operation:
        this.operation,

      request:
        this.request,

      correlation:
        this.correlation,

      trace:
        this.trace,

      metadata: {
        ...this.metadata,
      },

      lifecycleState:
        this.lifecycle.state,

      ready:
        this.lifecycle.ready,

      degraded:
        this.lifecycle.degraded,

      signal,
    });
  }

  /* ===========================================================================
   * Logger
   * ========================================================================= */

  childLogger(
    bindings = {},
  ) {
    if (
      !this.logger
    ) {
      return null;
    }

    if (
      typeof this.logger.child !==
      'function'
    ) {
      return this.logger;
    }

    return this.logger.child({
      component:
        COMPONENT,

      service:
        this.service ||
        undefined,

      operation:
        this.operation ||
        undefined,

      requestId:
        this.request?.requestId,

      correlationId:
        this.correlation
          ?.correlationId,

      traceId:
        this.trace?.traceId,

      spanId:
        this.trace?.spanId,

      ...bindings,
    });
  }

  /* ===========================================================================
   * Observability
   * ========================================================================= */

  emit(
    event,
    payload = {},
  ) {
    if (
      !this.observability
    ) {
      return null;
    }

    const normalizedEvent =
      normalizeName(
        event,
        'event',
      );

    const data = {
      ...payload,

      component:
        COMPONENT,

      service:
        this.service ||
        SERVICE_NAME,

      operation:
        this.operation ||
        undefined,

      requestId:
        this.request?.requestId,

      correlationId:
        this.correlation
          ?.correlationId,

      traceId:
        this.trace?.traceId,

      spanId:
        this.trace?.spanId,

      registryRevision:
        this.registryRevision,
    };

    try {
      if (
        isFunction(
          this.observability.emitEvent,
        )
      ) {
        return this.observability.emitEvent(
          normalizedEvent,
          data,
        );
      }

      if (
        isFunction(
          this.observability.emit,
        )
      ) {
        return this.observability.emit(
          normalizedEvent,
          data,
        );
      }
    } catch {
      /**
       * Observability must never become a business-operation failure.
       */
    }

    return null;
  }

  async instrument(
    operation,
    fn,
    options = {},
  ) {
    if (
      !isFunction(fn)
    ) {
      throw new TypeError(
        'ServicesContext.instrument() requires a callback.',
      );
    }

    const child =
      this.forOperation(
        operation,
        options,
      );

    if (
      !child.observability ||
      !isFunction(
        child.observability.instrument,
      )
    ) {
      return fn(
        child,
      );
    }

    return child.observability.instrument(
      operation,
      traceContext =>
        fn(
          child.withTrace(
            traceContext,
          ),
        ),
      options,
    );
  }

  /* ===========================================================================
   * Resilience
   * ========================================================================= */

  getResiliencePolicy(
    name,
  ) {
    if (
      !this.resilience
    ) {
      return undefined;
    }

    if (
      isFunction(
        this.resilience.get,
      )
    ) {
      return this.resilience.get(
        name,
      );
    }

    if (
      this.resilience.policies
    ) {
      return this.resilience.policies[
        name
      ];
    }

    return undefined;
  }

  async executeResilient(
    operation,
    fn,
    options = {},
  ) {
    if (
      !isFunction(fn)
    ) {
      throw new TypeError(
        'ServicesContext.executeResilient() requires a callback.',
      );
    }

    const scoped =
      this.forOperation(
        operation,
        options,
      );

    if (
      !scoped.resilience
    ) {
      return fn(
        scoped,
      );
    }

    if (
      isFunction(
        scoped.resilience.execute,
      )
    ) {
      return scoped.resilience.execute(
        operation,
        () =>
          fn(scoped),
        options,
      );
    }

    if (
      isFunction(
        scoped.resilience.run,
      )
    ) {
      return scoped.resilience.run(
        operation,
        () =>
          fn(scoped),
        options,
      );
    }

    if (
      isFunction(
        scoped.resilience.withResilience,
      )
    ) {
      return scoped.resilience.withResilience(
        operation,
        () =>
          fn(scoped),
        options,
      );
    }

    return fn(
      scoped,
    );
  }

  /* ===========================================================================
   * Readiness
   * ========================================================================= */

  isReady() {
    if (
      this.readiness
    ) {
      if (
        isFunction(
          this.readiness.isReady,
        )
      ) {
        return Boolean(
          this.readiness.isReady(),
        );
      }

      if (
        this.readiness.readinessState &&
        isFunction(
          this.readiness
            .readinessState
            .isReady,
        )
      ) {
        return Boolean(
          this.readiness
            .readinessState
            .isReady(),
        );
      }
    }

    return Boolean(
      this.lifecycle.ready,
    );
  }

  async assertReady(
    operation =
      this.operation ||
      this.service ||
      'service-operation',
  ) {
    if (
      this.isReady()
    ) {
      return true;
    }

    throw new ServicesContextError(
      `TITech service "${operation}" cannot execute because the application is not ready.`,
      {
        code:
          'SERVICE_EXECUTION_NOT_READY',

        service:
          this.service,

        operation,

        details: {
          lifecycle:
            this.lifecycle,

          registryRevision:
            this.registryRevision,
        },
      },
    );
  }

  /* ===========================================================================
   * Configuration
   * ========================================================================= */

  getConfig(
    path,
    fallback,
  ) {
    if (
      path ===
        undefined ||
      path ===
        null ||
      path ===
        ''
    ) {
      return this.config;
    }

    const segments =
      String(path)
        .split('.')
        .filter(Boolean);

    let current =
      this.config;

    for (
      const segment of
        segments
    ) {
      if (
        current === null ||
        current ===
          undefined
      ) {
        return fallback;
      }

      current =
        current[
          segment
        ];
    }

    return current ===
      undefined
      ? fallback
      : current;
  }

  requireConfig(
    path,
  ) {
    const value =
      this.getConfig(
        path,
      );

    if (
      value ===
        undefined ||
      value ===
        null
    ) {
      throw new ServicesContextError(
        `Required TITech service configuration "${path}" is unavailable.`,
        {
          code:
            'SERVICE_CONFIGURATION_MISSING',

          service:
            this.service,

          details: {
            path,
          },
        },
      );
    }

    return value;
  }

  /* ===========================================================================
   * Async Context
   * ========================================================================= */

  run(
    callback,
  ) {
    if (
      !isFunction(
        callback,
      )
    ) {
      throw new TypeError(
        'ServicesContext.run() requires a callback function.',
      );
    }

    return asyncContext.run(
      this,
      callback,
    );
  }

  getCurrent() {
    return (
      asyncContext.getStore() ||
      this
    );
  }

  /* ===========================================================================
   * Context Extension
   * ========================================================================= */

  extend(
    bindings = {},
  ) {
    if (
      !isPlainObject(
        bindings,
      )
    ) {
      throw new TypeError(
        'ServicesContext.extend() requires a plain object.',
      );
    }

    return createServicesContext({
      parent:
        this,

      registry:
        this[
          REGISTRY_MARKER
        ],

      service:
        bindings.service ??
        this.service,

      operation:
        bindings.operation ??
        this.operation,

      config:
        bindings.config ??
        this.config,

      environment:
        bindings.environment ??
        this.environment,

      logger:
        bindings.logger ??
        this.logger,

      observability:
        bindings.observability ??
        this.observability,

      readiness:
        bindings.readiness ??
        this.readiness,

      resilience:
        bindings.resilience ??
        this.resilience,

      request:
        bindings.request ??
        this.request,

      correlation:
        bindings.correlation ??
        this.correlation,

      trace:
        bindings.trace ??
        this.trace,

      metadata: {
        ...this.metadata,
        ...(bindings.metadata ||
          {}),
      },

      lifecycleState:
        bindings.lifecycleState ??
        this.lifecycle.state,

      ready:
        bindings.ready ??
        this.lifecycle.ready,

      degraded:
        bindings.degraded ??
        this.lifecycle.degraded,

      signal:
        bindings.signal ??
        this.signal,
    });
  }

  /* ===========================================================================
   * Diagnostics
   * ========================================================================= */

  snapshot(
    options = {},
  ) {
    return Object.freeze({
      component:
        COMPONENT,

      application:
        APPLICATION_NAME,

      service:
        this.service,

      operation:
        this.operation,

      createdAt:
        this.createdAt,

      lifecycle:
        Object.freeze({
          ...this.lifecycle,
        }),

      registry:
        this.getRegistrySnapshot(
          options,
        ),

      request:
        sanitize(
          this.request,
        ),

      correlation:
        sanitize(
          this.correlation,
        ),

      trace:
        sanitize(
          this.trace,
        ),

      metadata:
        sanitize(
          this.metadata,
        ),

      dependencies:
        Object.freeze({
          logger:
            Boolean(
              this.logger,
            ),

          observability:
            Boolean(
              this.observability,
            ),

          readiness:
            Boolean(
              this.readiness,
            ),

          resilience:
            Boolean(
              this.resilience,
            ),
        }),
    });
  }
}

/**
 * =============================================================================
 * Registry Facades
 * =============================================================================
 *
 * These facades expose controlled access to live dependency registries without
 * exposing Map mutation APIs directly.
 */

function createRegistryFacade(
  registry,
  type,
) {
  const facade =
    Object.create(
      null,
    );

  Object.defineProperties(
    facade,
    {
      get: {
        value:
          name =>
            registry[
              type
            ].get(
              normalizeName(
                name,
                type,
              ),
            ),

        enumerable:
          true,
      },

      has: {
        value:
          name =>
            registry[
              type
            ].has(
              normalizeName(
                name,
                type,
              ),
            ),

        enumerable:
          true,
      },

      keys: {
        value:
          () =>
            Object.freeze([
              ...registry[
                type
              ].keys(),
            ]),

        enumerable:
          true,
      },

      size: {
        get:
          () =>
            registry[
              type
            ].size,

        enumerable:
          true,
      },
    },
  );

  return Object.freeze(
    facade,
  );
}

/**
 =============================================================================
 * Metadata Object
 * =============================================================================
 *
 * We shallow-copy and freeze application metadata.
 *
 * We do NOT recursively freeze arbitrary request/infrastructure objects.
 */

function createSafeMetadataObject(
  value,
) {
  if (
    !isPlainObject(
      value,
    )
  ) {
    return Object.freeze(
      {},
    );
  }

  return Object.freeze({
    ...value,
  });
}

/**
 * =============================================================================
 * Integration Resolvers
 * =============================================================================
 */

function resolveLogger() {
  try {
    return (
      loggerModule?.getLogger?.() ||
      loggerModule?.logger ||
      loggerModule?.default ||
      null
    );
  } catch {
    return null;
  }
}

function resolveObservability() {
  try {
    return (
      observabilityModule?.observability ||
      observabilityModule?.default ||
      observabilityModule ||
      null
    );
  } catch {
    return null;
  }
}

function resolveReadiness() {
  try {
    return (
      readinessModule?.readinessState ||
      readinessModule?.default ||
      readinessModule ||
      null
    );
  } catch {
    return null;
  }
}

function resolveResilience() {
  try {
    return (
      resilienceModule?.getResilience?.() ||
      resilienceModule?.resilience ||
      resilienceModule?.default ||
      resilienceModule ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * =============================================================================
 * Factory
 * =============================================================================
 */

function createServicesContext(
  options = {},
) {
  if (
    options.parent
  ) {
    const parent =
      options.parent;

    if (
      !ServicesContext.isContext(
        parent,
      )
    ) {
      throw new TypeError(
        'ServicesContext parent must be a valid ServicesContext.',
      );
    }

    return new ServicesContext({
      registry:
        options.registry ||
        parent[
          REGISTRY_MARKER
        ],

      config:
        options.config ??
        parent.config,

      environment:
        options.environment ??
        parent.environment,

      logger:
        options.logger ??
        parent.logger,

      observability:
        options.observability ??
        parent.observability,

      readiness:
        options.readiness ??
        parent.readiness,

      resilience:
        options.resilience ??
        parent.resilience,

      service:
        options.service ??
        parent.service,

      operation:
        options.operation ??
        parent.operation,

      request:
        options.request ??
        parent.request,

      correlation:
        options.correlation ??
        parent.correlation,

      trace:
        options.trace ??
        parent.trace,

      metadata: {
        ...parent.metadata,
        ...(options.metadata ||
          {}),
      },

      lifecycleState:
        options.lifecycleState ??
        parent.lifecycle.state,

      ready:
        options.ready ??
        parent.lifecycle.ready,

      degraded:
        options.degraded ??
        parent.lifecycle.degraded,

      createdAt:
        options.createdAt ||
        parent.createdAt,
    });
  }

  return new ServicesContext(
    options,
  );
}

/**
 * =============================================================================
 * Root Context
 * =============================================================================
 */

let rootContext =
  null;

/**
 * The root context is created once and retains its identity.
 */
function createRootContext(
  options = {},
) {
  if (
    rootContext
  ) {
    return rootContext;
  }

  rootContext =
    createServicesContext({
      ...options,

      service:
        options.service ||
        'application',

      metadata: {
        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        application:
          APPLICATION_NAME,

        ...(options.metadata ||
          {}),
      },
    });

  return rootContext;
}

function getRootContext() {
  return (
    rootContext ||
    createRootContext()
  );
}

/**
 * =============================================================================
 * Request Context
 * =============================================================================
 */

function createRequestContext(
  options = {},
) {
  const parent =
    options.parent ||
    getCurrentContext() ||
    getRootContext();

  return createServicesContext({
    parent,

    request:
      options.request ||
      {},

    correlation:
      options.correlation ||
      {},

    trace:
      options.trace ||
      {},

    service:
      options.service ||
      parent.service,

    operation:
      options.operation ||
      null,
  });
}

/**
 * =============================================================================
 * Async Context
 * =============================================================================
 */

function runWithContext(
  context,
  callback,
) {
  if (
    !ServicesContext.isContext(
      context,
    )
  ) {
    throw new TypeError(
      'runWithContext() requires a valid ServicesContext instance.',
    );
  }

  return context.run(
    callback,
  );
}

function getCurrentContext() {
  return (
    asyncContext.getStore() ||
    rootContext ||
    null
  );
}

/**
 * =============================================================================
 * Controlled Runtime Bindings
 * =============================================================================
 */

function addService(
  name,
  service,
) {
  const context =
    getRootContext();

  context.registerService(
    name,
    service,
  );

  return context;
}

function removeService(
  name,
) {
  const context =
    getRootContext();

  return context.unregisterService(
    name,
  );
}

function addInfrastructure(
  name,
  resource,
) {
  const context =
    getRootContext();

  context.registerInfrastructure(
    name,
    resource,
  );

  return context;
}

function removeInfrastructure(
  name,
) {
  const context =
    getRootContext();

  return context.unregisterInfrastructure(
    name,
  );
}

function addContainerBinding(
  name,
  value,
) {
  const context =
    getRootContext();

  context.registerContainerBinding(
    name,
    value,
  );

  return context;
}

/**
 * =============================================================================
 * Lifecycle State
 * =============================================================================
 */

function updateLifecycle(
  options = {},
) {
  const context =
    getRootContext();

  /**
   * Public context identity remains stable.
   *
   * We update lifecycle through a private descriptor replacement approach:
   * since the public object itself is frozen, lifecycle is represented through
   * an internal runtime binding.
   *
   * For child contexts created after this operation, the latest lifecycle state
   * can be requested via getLifecycleState().
   */

  lifecycleState =
    {
      state:
        options.state ||
        context.lifecycle.state,

      ready:
        options.ready ??
        context.lifecycle.ready,

      degraded:
        options.degraded ??
        context.lifecycle.degraded,

      updatedAt:
        new Date(),
    };

  return Object.freeze({
    ...lifecycleState,
  });
}

let lifecycleState =
  null;

function getLifecycleState() {
  if (
    lifecycleState
  ) {
    return Object.freeze({
      ...lifecycleState,
    });
  }

  return getRootContext()
    .lifecycle;
}

/**
 * =============================================================================
 * Diagnostics
 * =============================================================================
 */

function snapshot(
  options = {},
) {
  return getRootContext()
    .snapshot(
      options,
    );
}

/**
 * =============================================================================
 * Reset
 * =============================================================================
 */

function resetRootContext(
  options = {},
) {
  if (
    options.requireStopped !==
      false &&
    lifecycleState?.state ===
      'running'
  ) {
    throw new ContextLifecycleError(
      'Cannot reset the TITech services context while the application is running.',
      {
        code:
          'SERVICES_CONTEXT_RESET_NOT_ALLOWED',
      },
    );
  }

  rootContext =
    null;

  lifecycleState =
    null;

  return true;
}

/**
 * =============================================================================
 * Bootstrap Lifecycle Integration
 * =============================================================================
 */

function registerBootstrapHooks(
  context = {},
  options = {},
) {
  const {
    hooks,
    lifecycle,
  } =
    require('./hooks');

  if (
    hooks.has(
      COMPONENT,
    )
  ) {
    return hooks.get(
      COMPONENT,
    );
  }

  return lifecycle(
    COMPONENT,
    {
      priority:
        options.priority ??
        -100,

      dependencies:
        options.dependencies ||
        [
          'configuration',
          'logger',
          'observability',
          'readiness',
          'resilience',
        ],

      critical:
        options.critical !==
        false,

      fatal:
        options.fatal !==
        false,

      timeoutMs:
        toPositiveInteger(
          options.timeoutMs,
          DEFAULT_BOOTSTRAP_TIMEOUT_MS,
        ),

      start:
        async hookContext => {
          const runtime =
            hookContext ||
            context ||
            {};

          const created =
            createRootContext({
              config:
                runtime.config,

              environment:
                runtime.environment,

              logger:
                runtime.logger ||
                resolveLogger(),

              observability:
                runtime.observability ||
                resolveObservability(),

              readiness:
                runtime.readiness ||
                resolveReadiness(),

              resilience:
                runtime.resilience ||
                resolveResilience(),

              infrastructure:
                runtime.infrastructure ||
                {},

              services:
                runtime.services ||
                runtime.serviceRegistry ||
                {},

              container:
                runtime.container ||
                {},

              metadata: {
                bootstrap:
                  true,
              },
            });

          lifecycleState =
            {
              state:
                'ready',

              ready:
                false,

              degraded:
                false,

              updatedAt:
                new Date(),
            };

          created.emit(
            'services-context.created',
            {
              registryRevision:
                created.registryRevision,
            },
          );

          /**
           * Publish stable context references into bootstrap context.
           */
          if (
            runtime &&
            typeof runtime ===
              'object'
          ) {
            runtime.servicesContext =
              created;

            runtime.serviceContext =
              created;

            runtime.servicesRegistry =
              created[
                REGISTRY_MARKER
              ];
          }

          return created;
        },

      ready:
        async () => {
          return Boolean(
            rootContext,
          );
        },

      health:
        async () => ({
          status:
            rootContext
              ? 'healthy'
              : 'unhealthy',

          healthy:
            Boolean(
              rootContext,
            ),

          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          registryRevision:
            rootContext
              ? rootContext.registryRevision
              : null,

          context:
            rootContext
              ? rootContext.snapshot()
              : null,
        }),

      stop:
        async () => {
          /**
           * servicesContext owns dependency publication, not service shutdown.
           *
           * services.js remains the authority for application service
           * shutdown.
           */
          lifecycleState =
            {
              state:
                'stopped',

              ready:
                false,

              degraded:
                false,

              updatedAt:
                new Date(),
            };

          rootContext?.emit(
            'services-context.stopped',
          );

          /**
           * Deliberately do NOT destroy the root context object here before
           * services.js has completed its own shutdown sequence.
           */
          return true;
        },

      metadata: {
        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        implementation:
          'backend/bootstrap/servicesContext.js',
      },
    },
  );
}

/**
 * =============================================================================
 * Export Contract
 * =============================================================================
 */

module.exports =
  Object.freeze({
    /* Classes */
    ServicesContext,

    ServicesContextRegistry,

    ServicesContextError,

    DependencyNotFoundError,

    ContextFrozenError,

    ContextLifecycleError,

    /* Factory */
    createServicesContext,

    createRootContext,

    getRootContext,

    createRequestContext,

    /* Async context */
    runWithContext,

    getCurrentContext,

    /* Runtime service bindings */
    addService,

    removeService,

    addInfrastructure,

    removeInfrastructure,

    addContainerBinding,

    /* Lifecycle */
    registerBootstrapHooks,

    updateLifecycle,

    getLifecycleState,

    /* Diagnostics */
    snapshot,

    /* Test/reset support */
    resetRootContext,

    /* Metadata */
    COMPONENT,

    SERVICE_NAME,

    APPLICATION_NAME,
  });