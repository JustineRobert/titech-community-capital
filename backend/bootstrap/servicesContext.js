
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
 * Architecture:
 *   environment -> configuration -> logger -> observability -> readiness
 *   -> resilience -> infrastructure -> services context -> application services
 *   -> finance / ledger / payments / accounts -> routes
 *
 * Responsibilities:
 *   - Provide stable service-context identity.
 *   - Maintain a controlled, mutable private dependency registry.
 *   - Maintain one shared lifecycle state for contexts sharing the registry.
 *   - Propagate service dependencies to scoped contexts.
 *   - Propagate request, correlation, and tracing context through AsyncLocalStorage.
 *   - Provide bounded diagnostics and sensitive-value redaction.
 *   - Register the services-context bootstrap lifecycle hook.
 *
 * This module does NOT:
 *   - implement financial operations or business rules;
 *   - execute repository queries;
 *   - create database or Redis connections;
 *   - initialize queues or HTTP servers;
 *   - authorize financial transactions;
 *   - own application process termination.
 *
 * Module:
 *   Native ES modules. backend/package.json declares "type": "module".
 *
 * =============================================================================
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import * as loggerModule from './logger.js';
import * as observabilityModule from './observability.js';
import * as readinessModule from './readinessState.js';
import * as resilienceModule from './resilience.js';
import * as hooksModule from './hooks.js';

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const COMPONENT = 'services-context';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-community-capital-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'TITech Community Capital';

const DEFAULT_LIFECYCLE_STATE = 'initializing';

const DEFAULT_OPERATION = null;

const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 30_000;

const CONTEXT_MARKER = Symbol('TITechServicesContext');

const REGISTRY_MARKER = Symbol('TITechServicesContextRegistry');

const asyncContext = new AsyncLocalStorage();

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
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
  'credential',
]);

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|passcode|secret|token|authorization|cookie|credential|privatekey|encryptionkey|apikey|jwtsecret)/i;

/**
 * =============================================================================
 * ERRORS
 * =============================================================================
 */

function isObjectLike(value) {
  return (
    value !== null &&
    (
      typeof value === 'object' ||
      typeof value === 'function'
    )
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);

    return (
      prototype === Object.prototype ||
      prototype === null
    );
  } catch {
    return false;
  }
}

function isFunction(value) {
  return typeof value === 'function';
}

function normalizeName(value, field = 'name') {
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

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);

  return (
    Number.isSafeInteger(parsed) &&
    parsed > 0
  )
    ? parsed
    : fallback;
}

function elapsedMs(startedAt) {
  return (
    Number(
      process.hrtime.bigint() - startedAt,
    ) / 1_000_000
  );
}

function safeError(error, depth = 0, seen = new WeakSet()) {
  if (!error) {
    return null;
  }

  if (
    isObjectLike(error) &&
    seen.has(error)
  ) {
    return {
      name: 'Error',
      code: null,
      message: '[Circular error cause]',
    };
  }

  if (isObjectLike(error)) {
    seen.add(error);
  }

  const normalized = {
    name: error.name || 'Error',

    code: error.code ?? null,

    message:
      typeof error.message === 'string'
        ? error.message
        : String(error),
  };

  if (
    depth < 3 &&
    isObjectLike(error.cause) &&
    error.cause !== error
  ) {
    normalized.cause =
      safeError(
        error.cause,
        depth + 1,
        seen,
      );
  }

  return Object.freeze(normalized);
}

class ServicesContextError extends Error {
  constructor(message, options = {}) {
    super(
      typeof message === 'string' &&
      message.trim()
        ? message
        : 'TITech services context error.',
      options.cause
        ? { cause: options.cause }
        : undefined,
    );

    this.name = 'ServicesContextError';

    this.code =
      options.code ||
      'SERVICES_CONTEXT_ERROR';

    this.service =
      options.service ??
      null;

    this.dependency =
      options.dependency ??
      null;

    this.operation =
      options.operation ??
      null;

    this.cause =
      options.cause ??
      null;

    this.details = Object.freeze(
      isPlainObject(options.details)
        ? sanitize(options.details)
        : {},
    );

    Error.captureStackTrace?.(
      this,
      ServicesContextError,
    );
  }
}

class DependencyNotFoundError extends ServicesContextError {
  constructor(dependency, service = null) {
    super(
      `TITech service dependency "${dependency}" is not available.`,
      {
        code: 'SERVICE_DEPENDENCY_NOT_FOUND',
        dependency,
        service,
      },
    );

    this.name = 'DependencyNotFoundError';
  }
}

class ContextFrozenError extends ServicesContextError {
  constructor(
    message = 'TITech services context is immutable.',
  ) {
    super(
      message,
      {
        code: 'SERVICES_CONTEXT_IMMUTABLE',
      },
    );

    this.name = 'ContextFrozenError';
  }
}

class ContextLifecycleError extends ServicesContextError {
  constructor(message, options = {}) {
    super(
      message,
      {
        code:
          options.code ||
          'SERVICES_CONTEXT_LIFECYCLE_ERROR',

        ...options,
      },
    );

    this.name = 'ContextLifecycleError';
  }
}

/**
 * =============================================================================
 * SAFE DIAGNOSTICS SANITIZATION
 * =============================================================================
 */

function normalizeSensitiveKey(key) {
  return String(key)
    .replace(/[_-]/g, '')
    .toLowerCase();
}

function isSensitiveKey(key) {
  const normalized = normalizeSensitiveKey(key);

  return (
    SENSITIVE_KEYS.has(normalized) ||
    SENSITIVE_KEY_PATTERN.test(normalized) ||
    normalized === 'pin' ||
    normalized === 'otp' ||
    normalized === 'jwt'
  );
}

function sanitizeString(value, options = {}) {
  if (options.maskCredentials === false) {
    return value;
  }

  return value
    .replace(
      /(mongodb(?:\+srv)?:\/\/)([^/\s:@]+)(?::[^@\s]*)?@/gi,
      '$1***:***@',
    )
    .replace(
      /([?&](?:password|passwd|pwd|secret|token|access_token|refresh_token|api_key|apikey|client_secret)=)[^&\s]*/gi,
      '$1***',
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

  if (typeof value === 'string') {
    return sanitizeString(value, options);
  }

  if (
    typeof value !== 'object' &&
    typeof value !== 'function'
  ) {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? '[Invalid Date]'
      : value.toISOString();
  }

  if (value instanceof Error) {
    seen.add(value);

    return safeError(value);
  }

  if (Array.isArray(value)) {
    seen.add(value);

    return value.map(entry =>
      sanitize(
        entry,
        options,
        seen,
      ),
    );
  }

  /*
   * Do not recursively inspect live infrastructure objects, database clients,
   * HTTP clients, sockets, class instances, or other arbitrary objects.
   */
  if (!isPlainObject(value)) {
    return `[${Object.prototype.toString.call(value)}]`;
  }

  seen.add(value);

  const result = {};

  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
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

function deepFreezeSanitized(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreezeSanitized(child);
  }

  return Object.freeze(value);
}

function createSafeMetadataObject(value) {
  if (!isPlainObject(value)) {
    return Object.freeze({});
  }

  return Object.freeze({
    ...value,
  });
}

/**
 * =============================================================================
 * REGISTRY
 * =============================================================================
 *
 * The public ServicesContext instance remains frozen.
 *
 * Its private registry is intentionally mutable. Contexts derived from the
 * same registry share both the same dependency registry and the same lifecycle
 * snapshot source.
 * =============================================================================
 */

class ServicesContextRegistry {
  constructor(options = {}) {
    this.services = new Map(
      Object.entries(
        isPlainObject(options.services)
          ? options.services
          : {},
      ),
    );

    this.infrastructure = new Map(
      Object.entries(
        isPlainObject(options.infrastructure)
          ? options.infrastructure
          : {},
      ),
    );

    this.container = new Map(
      Object.entries(
        isPlainObject(options.container)
          ? options.container
          : {},
      ),
    );

    this.revision = 0;

    this.updatedAt = new Date();

    this._lifecycle = {
      state:
        typeof options.lifecycleState === 'string'
          ? options.lifecycleState
          : DEFAULT_LIFECYCLE_STATE,

      ready:
        options.ready === true,

      degraded:
        options.degraded === true,

      updatedAt: new Date(),
    };
  }

  _touch() {
    this.revision += 1;

    this.updatedAt = new Date();
  }

  getLifecycle() {
    return Object.freeze({
      state: this._lifecycle.state,

      ready: this._lifecycle.ready,

      degraded: this._lifecycle.degraded,

      updatedAt: new Date(
        this._lifecycle.updatedAt.getTime(),
      ),
    });
  }

  setLifecycle(patch = {}) {
    if (!isPlainObject(patch)) {
      throw new ContextLifecycleError(
        'Lifecycle update must be a plain object.',
        {
          code: 'SERVICES_CONTEXT_LIFECYCLE_INVALID',
        },
      );
    }

    const previous = this._lifecycle;

    const state =
      patch.state ??
      previous.state;

    const ready =
      patch.ready ??
      previous.ready;

    const degraded =
      patch.degraded ??
      previous.degraded;

    if (
      typeof state !== 'string' ||
      state.trim() === ''
    ) {
      throw new ContextLifecycleError(
        'Lifecycle state must be a non-empty string.',
        {
          code: 'SERVICES_CONTEXT_LIFECYCLE_INVALID_STATE',
        },
      );
    }

    if (
      typeof ready !== 'boolean' ||
      typeof degraded !== 'boolean'
    ) {
      throw new ContextLifecycleError(
        'Lifecycle ready and degraded values must be booleans.',
        {
          code: 'SERVICES_CONTEXT_LIFECYCLE_INVALID_FLAGS',
        },
      );
    }

    this._lifecycle = {
      state: state.trim(),

      ready,

      degraded,

      updatedAt: new Date(),
    };

    this._touch();

    return this.getLifecycle();
  }

  setService(name, value) {
    this.services.set(
      normalizeName(name, 'service'),
      value,
    );

    this._touch();

    return value;
  }

  removeService(name) {
    const removed =
      this.services.delete(
        normalizeName(name, 'service'),
      );

    if (removed) {
      this._touch();
    }

    return removed;
  }

  setInfrastructure(name, value) {
    this.infrastructure.set(
      normalizeName(name, 'infrastructure'),
      value,
    );

    this._touch();

    return value;
  }

  removeInfrastructure(name) {
    const removed =
      this.infrastructure.delete(
        normalizeName(name, 'infrastructure'),
      );

    if (removed) {
      this._touch();
    }

    return removed;
  }

  setContainer(name, value) {
    this.container.set(
      normalizeName(name, 'container binding'),
      value,
    );

    this._touch();

    return value;
  }

  removeContainer(name) {
    const removed =
      this.container.delete(
        normalizeName(name, 'container binding'),
      );

    if (removed) {
      this._touch();
    }

    return removed;
  }

  has(dependency) {
    return (
      this.services.has(dependency) ||
      this.container.has(dependency) ||
      this.infrastructure.has(dependency)
    );
  }

  get(dependency) {
    if (this.services.has(dependency)) {
      return this.services.get(dependency);
    }

    if (this.container.has(dependency)) {
      return this.container.get(dependency);
    }

    if (this.infrastructure.has(dependency)) {
      return this.infrastructure.get(dependency);
    }

    return undefined;
  }

  snapshot(options = {}) {
    const snapshot = {
      revision: this.revision,

      updatedAt: new Date(
        this.updatedAt.getTime(),
      ),

      lifecycle: this.getLifecycle(),

      services: Object.freeze(
        Object.fromEntries(
          [...this.services.keys()].map(name => [
            name,
            true,
          ]),
        ),
      ),

      infrastructure: Object.freeze(
        Object.fromEntries(
          [...this.infrastructure.keys()].map(name => [
            name,
            true,
          ]),
        ),
      ),

      container: Object.freeze(
        Object.fromEntries(
          [...this.container.keys()].map(name => [
            name,
            true,
          ]),
        ),
      ),

      diagnostics: undefined,
    };

    if (options.includeValues === true) {
      snapshot.diagnostics =
        deepFreezeSanitized(
          sanitize({
            services: Object.fromEntries(this.services),

            infrastructure:
              Object.fromEntries(this.infrastructure),

            container:
              Object.fromEntries(this.container),
          }),
        );
    }

    return Object.freeze(snapshot);
  }
}

/**
 * =============================================================================
 * SERVICES CONTEXT
 * =============================================================================
 */

class ServicesContext {
  constructor(options = {}) {
    const registry =
      options.registry ||
      new ServicesContextRegistry({
        services: options.services,

        infrastructure: options.infrastructure,

        container: options.container,

        lifecycleState:
          options.lifecycleState,

        ready: options.ready,

        degraded: options.degraded,
      });

    if (
      !(registry instanceof ServicesContextRegistry)
    ) {
      throw new TypeError(
        'ServicesContext registry must be a ServicesContextRegistry instance.',
      );
    }

    Object.defineProperty(
      this,
      CONTEXT_MARKER,
      {
        value: true,

        enumerable: false,

        configurable: false,

        writable: false,
      },
    );

    Object.defineProperty(
      this,
      REGISTRY_MARKER,
      {
        value: registry,

        enumerable: false,

        configurable: false,

        writable: false,
      },
    );

    this.createdAt =
      options.createdAt instanceof Date
        ? new Date(options.createdAt.getTime())
        : new Date(
            options.createdAt ??
            Date.now(),
          );

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
        options.request || {},
      );

    this.correlation =
      createSafeMetadataObject(
        options.correlation || {},
      );

    this.trace =
      createSafeMetadataObject(
        options.trace || {},
      );

    this.signal =
      options.signal ??
      null;

    this.metadata =
      Object.freeze({
        ...(isPlainObject(options.metadata)
          ? options.metadata
          : {}),

        component:
          COMPONENT,

        service:
          options.metadata?.service ||
          SERVICE_NAME,

        application:
          options.metadata?.application ||
          APPLICATION_NAME,
      });

    /*
     * Lifecycle is exposed by a prototype getter below.
     *
     * It is deliberately NOT copied into a frozen own-property snapshot.
     * The getter reads the shared registry so updates are visible in existing
     * root and child contexts without replacing context identity.
     */

    Object.freeze(this);
  }

  get lifecycle() {
    return this[REGISTRY_MARKER].getLifecycle();
  }

  static isContext(value) {
    try {
      return Boolean(
        value &&
        value[CONTEXT_MARKER] === true,
      );
    } catch {
      return false;
    }
  }

  assert() {
    if (!ServicesContext.isContext(this)) {
      throw new ServicesContextError(
        'Invalid TITech services context.',
        {
          code: 'INVALID_SERVICES_CONTEXT',
        },
      );
    }

    return true;
  }

  get registryRevision() {
    return this[REGISTRY_MARKER].revision;
  }

  getRegistrySnapshot(options = {}) {
    return this[REGISTRY_MARKER].snapshot(options);
  }

  has(dependency) {
    return this[REGISTRY_MARKER].has(
      normalizeName(dependency, 'dependency'),
    );
  }

  get(dependency) {
    return this[REGISTRY_MARKER].get(
      normalizeName(dependency, 'dependency'),
    );
  }

  require(dependency) {
    const name =
      normalizeName(dependency, 'dependency');

    const value = this.get(name);

    if (
      value === undefined ||
      value === null
    ) {
      throw new DependencyNotFoundError(
        name,
        this.service,
      );
    }

    return value;
  }

  getOrDefault(dependency, fallback) {
    const value = this.get(dependency);

    return value === undefined
      ? fallback
      : value;
  }

  serviceByName(name) {
    return this[REGISTRY_MARKER].services.get(
      normalizeName(name, 'service'),
    );
  }

  requireService(name) {
    const normalized =
      normalizeName(name, 'service');

    const service =
      this[REGISTRY_MARKER].services.get(normalized);

    if (
      service === undefined ||
      service === null
    ) {
      throw new DependencyNotFoundError(
        normalized,
        this.service,
      );
    }

    return service;
  }

  hasService(name) {
    return this[REGISTRY_MARKER].services.has(
      normalizeName(name, 'service'),
    );
  }

  infrastructureService(name) {
    return this[REGISTRY_MARKER].infrastructure.get(
      normalizeName(name, 'infrastructure'),
    );
  }

  requireInfrastructure(name) {
    const normalized =
      normalizeName(name, 'infrastructure');

    const resource =
      this[REGISTRY_MARKER].infrastructure.get(
        normalized,
      );

    if (
      resource === undefined ||
      resource === null
    ) {
      throw new DependencyNotFoundError(
        normalized,
        this.service,
      );
    }

    return resource;
  }

  hasInfrastructure(name) {
    return this[REGISTRY_MARKER].infrastructure.has(
      normalizeName(name, 'infrastructure'),
    );
  }

  registerService(name, service) {
    if (
      service === undefined ||
      service === null
    ) {
      throw new ServicesContextError(
        `Cannot register empty TITech service "${name}".`,
        {
          code: 'SERVICE_REGISTRATION_INVALID',
          service: name,
        },
      );
    }

    this[REGISTRY_MARKER].setService(
      name,
      service,
    );

    return service;
  }

  unregisterService(name) {
    return this[REGISTRY_MARKER].removeService(name);
  }

  registerInfrastructure(name, resource) {
    if (
      resource === undefined ||
      resource === null
    ) {
      throw new ServicesContextError(
        `Cannot register empty TITech infrastructure resource "${name}".`,
        {
          code: 'INFRASTRUCTURE_REGISTRATION_INVALID',
          dependency: name,
        },
      );
    }

    this[REGISTRY_MARKER].setInfrastructure(
      name,
      resource,
    );

    return resource;
  }

  unregisterInfrastructure(name) {
    return this[REGISTRY_MARKER].removeInfrastructure(name);
  }

  registerContainerBinding(name, value) {
    if (
      value === undefined ||
      value === null
    ) {
      throw new ServicesContextError(
        `Cannot register empty TITech container binding "${name}".`,
        {
          code: 'CONTAINER_BINDING_INVALID',
          dependency: name,
        },
      );
    }

    this[REGISTRY_MARKER].setContainer(
      name,
      value,
    );

    return value;
  }

  unregisterContainerBinding(name) {
    return this[REGISTRY_MARKER].removeContainer(name);
  }

  forService(service, options = {}) {
    const name =
      normalizeName(service, 'service');

    return createServicesContext({
      parent: this,

      registry:
        this[REGISTRY_MARKER],

      service: name,

      operation:
        options.operation ??
        null,

      metadata: {
        ...this.metadata,

        service: name,

        operation:
          options.operation ??
          null,

        ...(isPlainObject(options.metadata)
          ? options.metadata
          : {}),
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

      signal:
        options.signal ??
        this.signal,
    });
  }

  forOperation(operation, options = {}) {
    const name =
      normalizeName(operation, 'operation');

    return this.forService(
      options.service ||
        this.service ||
        'application',
      {
        ...options,

        operation: name,
      },
    );
  }

  withRequest(request) {
    return createServicesContext({
      parent: this,

      registry:
        this[REGISTRY_MARKER],

      request,

      service: this.service,

      operation: this.operation,

      signal: this.signal,
    });
  }

  withCorrelation(correlation) {
    return createServicesContext({
      parent: this,

      registry:
        this[REGISTRY_MARKER],

      correlation,

      service: this.service,

      operation: this.operation,

      signal: this.signal,
    });
  }

  withTrace(trace) {
    return createServicesContext({
      parent: this,

      registry:
        this[REGISTRY_MARKER],

      trace,

      service: this.service,

      operation: this.operation,

      signal: this.signal,
    });
  }

  withSignal(signal) {
    return createServicesContext({
      parent: this,

      registry:
        this[REGISTRY_MARKER],

      signal,

      service: this.service,

      operation: this.operation,
    });
  }

  childLogger(bindings = {}) {
    if (!this.logger) {
      return null;
    }

    if (!isFunction(this.logger.child)) {
      return this.logger;
    }

    return this.logger.child({
      component: COMPONENT,

      service:
        this.service ||
        undefined,

      operation:
        this.operation ||
        undefined,

      requestId:
        this.request?.requestId,

      correlationId:
        this.correlation?.correlationId,

      traceId:
        this.trace?.traceId,

      spanId:
        this.trace?.spanId,

      ...bindings,
    });
  }

  emit(event, payload = {}) {
    if (!this.observability) {
      return null;
    }

    const normalizedEvent =
      normalizeName(event, 'event');

    const data = {
      ...payload,

      component: COMPONENT,

      service:
        this.service ||
        SERVICE_NAME,

      operation:
        this.operation ||
        undefined,

      requestId:
        this.request?.requestId,

      correlationId:
        this.correlation?.correlationId,

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
      /*
       * Observability must never become a business-operation failure.
       */
    }

    return null;
  }

  async instrument(operation, fn, options = {}) {
    if (!isFunction(fn)) {
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
      !isFunction(child.observability.instrument)
    ) {
      return fn(child);
    }

    return child.observability.instrument(
      operation,
      traceContext =>
        fn(
          child.withTrace(traceContext),
        ),
      options,
    );
  }

  getResiliencePolicy(name) {
    if (!this.resilience) {
      return undefined;
    }

    if (isFunction(this.resilience.get)) {
      return this.resilience.get(name);
    }

    if (this.resilience.policies) {
      return this.resilience.policies[name];
    }

    return undefined;
  }

  async executeResilient(operation, fn, options = {}) {
    if (!isFunction(fn)) {
      throw new TypeError(
        'ServicesContext.executeResilient() requires a callback.',
      );
    }

    const scoped =
      this.forOperation(
        operation,
        options,
      );

    if (!scoped.resilience) {
      if (options.requireResilience === true) {
        throw new ServicesContextError(
          `Resilience is required for operation "${operation}" but is unavailable.`,
          {
            code: 'SERVICE_RESILIENCE_REQUIRED',
            service: scoped.service,
            operation,
          },
        );
      }

      return fn(scoped);
    }

    if (
      isFunction(scoped.resilience.execute)
    ) {
      return scoped.resilience.execute(
        operation,
        () => fn(scoped),
        options,
      );
    }

    if (
      isFunction(scoped.resilience.run)
    ) {
      return scoped.resilience.run(
        operation,
        () => fn(scoped),
        options,
      );
    }

    if (
      isFunction(scoped.resilience.withResilience)
    ) {
      return scoped.resilience.withResilience(
        operation,
        () => fn(scoped),
        options,
      );
    }

    if (options.requireResilience === true) {
      throw new ServicesContextError(
        `Resilience is required for operation "${operation}" but the configured implementation exposes no supported execution method.`,
        {
          code: 'SERVICE_RESILIENCE_UNSUPPORTED',
          service: scoped.service,
          operation,
        },
      );
    }

    return fn(scoped);
  }

  isReady() {
    const readiness = this.readiness;

    if (readiness) {
      const check =
        isFunction(readiness.isReady)
          ? readiness.isReady
          : isFunction(readiness.readinessState?.isReady)
            ? readiness.readinessState.isReady
            : null;

      if (check) {
        try {
          const result =
            check.call(
              isFunction(readiness.isReady)
                ? readiness
                : readiness.readinessState,
            );

          /*
           * This is a synchronous API. A Promise must never count as ready.
           */
          if (
            result &&
            isFunction(result.then)
          ) {
            return false;
          }

          if (typeof result === 'boolean') {
            return result;
          }

          if (isPlainObject(result)) {
            if (
              typeof result.ready === 'boolean'
            ) {
              return result.ready;
            }

            if (
              typeof result.healthy === 'boolean'
            ) {
              return result.healthy;
            }

            const status =
              String(result.status || '')
                .trim()
                .toLowerCase();

            return (
              status === 'ready' ||
              status === 'healthy' ||
              status === 'ok' ||
              status === 'operational'
            );
          }

          return false;
        } catch {
          return false;
        }
      }
    }

    return this.lifecycle.ready === true;
  }

  async assertReady(
    operation =
      this.operation ||
      this.service ||
      'service-operation',
  ) {
    if (this.isReady()) {
      return true;
    }

    throw new ServicesContextError(
      `TITech service "${operation}" cannot execute because the application is not ready.`,
      {
        code: 'SERVICE_EXECUTION_NOT_READY',

        service: this.service,

        operation,

        details: {
          lifecycle: this.lifecycle,

          registryRevision:
            this.registryRevision,
        },
      },
    );
  }

  getConfig(path, fallback) {
    if (
      path === undefined ||
      path === null ||
      path === ''
    ) {
      return this.config;
    }

    const segments =
      String(path)
        .split('.')
        .filter(Boolean);

    let current = this.config;

    for (const segment of segments) {
      if (
        current === null ||
        current === undefined
      ) {
        return fallback;
      }

      current = current[segment];
    }

    return current === undefined
      ? fallback
      : current;
  }

  requireConfig(path) {
    const value = this.getConfig(path);

    if (
      value === undefined ||
      value === null
    ) {
      throw new ServicesContextError(
        `Required TITech service configuration "${path}" is unavailable.`,
        {
          code: 'SERVICE_CONFIGURATION_MISSING',

          service: this.service,

          details: {
            path,
          },
        },
      );
    }

    return value;
  }

  run(callback) {
    if (!isFunction(callback)) {
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

  extend(bindings = {}) {
    if (!isPlainObject(bindings)) {
      throw new TypeError(
        'ServicesContext.extend() requires a plain object.',
      );
    }

    return createServicesContext({
      parent: this,

      registry:
        this[REGISTRY_MARKER],

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

      signal:
        bindings.signal ??
        this.signal,

      metadata: {
        ...this.metadata,

        ...(isPlainObject(bindings.metadata)
          ? bindings.metadata
          : {}),
      },
    });
  }

  snapshot(options = {}) {
    return Object.freeze({
      component: COMPONENT,

      application: APPLICATION_NAME,

      service: this.service,

      operation: this.operation,

      createdAt: new Date(
        this.createdAt.getTime(),
      ),

      lifecycle: this.lifecycle,

      registry:
        this.getRegistrySnapshot(options),

      request:
        deepFreezeSanitized(
          sanitize(this.request),
        ),

      correlation:
        deepFreezeSanitized(
          sanitize(this.correlation),
        ),

      trace:
        deepFreezeSanitized(
          sanitize(this.trace),
        ),

      metadata:
        deepFreezeSanitized(
          sanitize(this.metadata),
        ),

      dependencies: Object.freeze({
        logger: Boolean(this.logger),

        observability: Boolean(this.observability),

        readiness: Boolean(this.readiness),

        resilience: Boolean(this.resilience),
      }),
    });
  }
}

/**
 * =============================================================================
 * REGISTRY FACADES
 * =============================================================================
 */

function createRegistryFacade(registry, type) {
  const facade = Object.create(null);

  Object.defineProperties(
    facade,
    {
      get: {
        value: name =>
          registry[type].get(
            normalizeName(name, type),
          ),

        enumerable: true,
      },

      has: {
        value: name =>
          registry[type].has(
            normalizeName(name, type),
          ),

        enumerable: true,
      },

      keys: {
        value: () =>
          Object.freeze([
            ...registry[type].keys(),
          ]),

        enumerable: true,
      },

      size: {
        get: () =>
          registry[type].size,

        enumerable: true,
      },
    },
  );

  return Object.freeze(facade);
}

/**
 * =============================================================================
 * INTEGRATION RESOLVERS
 * =============================================================================
 *
 * These resolvers support optional integrations. Resolution failures are
 * captured in bounded diagnostics rather than silently disappearing.
 *
 * The statically imported local modules must still load successfully at the
 * ESM module boundary.
 * =============================================================================
 */

const integrationResolutionErrors = new Map();

function recordIntegrationResolutionError(name, error) {
  integrationResolutionErrors.set(
    name,
    safeError(error),
  );
}

function clearIntegrationResolutionError(name) {
  integrationResolutionErrors.delete(name);
}

function resolveLogger() {
  try {
    const logger =
      loggerModule?.getLogger?.() ||
      loggerModule?.logger ||
      loggerModule?.default ||
      null;

    clearIntegrationResolutionError('logger');

    return logger;
  } catch (error) {
    recordIntegrationResolutionError('logger', error);

    return null;
  }
}

function resolveObservability() {
  try {
    const observability =
      observabilityModule?.observability ||
      observabilityModule?.default ||
      observabilityModule ||
      null;

    clearIntegrationResolutionError('observability');

    return observability;
  } catch (error) {
    recordIntegrationResolutionError(
      'observability',
      error,
    );

    return null;
  }
}

function resolveReadiness() {
  try {
    const readiness =
      readinessModule?.readinessState ||
      readinessModule?.default ||
      readinessModule ||
      null;

    clearIntegrationResolutionError('readiness');

    return readiness;
  } catch (error) {
    recordIntegrationResolutionError('readiness', error);

    return null;
  }
}

function resolveResilience() {
  try {
    const registeredResilience =
      resilienceModule?.getResilience?.();

    const resilience =
      registeredResilience ||
      resilienceModule?.resilience ||
      resilienceModule?.default ||
      resilienceModule ||
      null;

    clearIntegrationResolutionError('resilience');

    return resilience;
  } catch (error) {
    recordIntegrationResolutionError('resilience', error);

    return null;
  }
}

/**
 * =============================================================================
 * FACTORY
 * =============================================================================
 */

function createServicesContext(options = {}) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'createServicesContext() requires a plain options object.',
    );
  }

  if (options.parent) {
    const parent = options.parent;

    if (!ServicesContext.isContext(parent)) {
      throw new TypeError(
        'ServicesContext parent must be a valid ServicesContext.',
      );
    }

    return new ServicesContext({
      registry:
        options.registry ||
        parent[REGISTRY_MARKER],

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

      signal:
        options.signal ??
        parent.signal,

      metadata: {
        ...parent.metadata,

        ...(isPlainObject(options.metadata)
          ? options.metadata
          : {}),
      },

      createdAt:
        options.createdAt ||
        parent.createdAt,
    });
  }

  return new ServicesContext(options);
}

/**
 * =============================================================================
 * ROOT CONTEXT
 * =============================================================================
 */

let rootContext = null;

function createRootContext(options = {}) {
  if (rootContext) {
    /*
     * Preserve root identity. Runtime dependency registration must use the
     * controlled registration methods rather than replacing the root object.
     */
    return rootContext;
  }

  if (!isPlainObject(options)) {
    throw new TypeError(
      'createRootContext() requires a plain options object.',
    );
  }

  rootContext =
    createServicesContext({
      ...options,

      service:
        options.service ||
        'application',

      metadata: {
        component: COMPONENT,

        service: SERVICE_NAME,

        application: APPLICATION_NAME,

        ...(isPlainObject(options.metadata)
          ? options.metadata
          : {}),
      },
    });

  lifecycleState =
    rootContext.lifecycle;

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
 * REQUEST CONTEXT
 * =============================================================================
 */

function createRequestContext(options = {}) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'createRequestContext() requires a plain options object.',
    );
  }

  const parent =
    options.parent ||
    getCurrentContext() ||
    getRootContext();

  if (!ServicesContext.isContext(parent)) {
    throw new TypeError(
      'createRequestContext() requires a valid parent ServicesContext.',
    );
  }

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

    signal:
      options.signal ??
      parent.signal,
  });
}

/**
 * =============================================================================
 * ASYNC CONTEXT
 * =============================================================================
 */

function runWithContext(context, callback) {
  if (!ServicesContext.isContext(context)) {
    throw new TypeError(
      'runWithContext() requires a valid ServicesContext instance.',
    );
  }

  if (!isFunction(callback)) {
    throw new TypeError(
      'runWithContext() requires a callback function.',
    );
  }

  return context.run(callback);
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
 * CONTROLLED RUNTIME BINDINGS
 * =============================================================================
 */

function addService(name, service) {
  const context = getRootContext();

  context.registerService(name, service);

  return context;
}

function removeService(name) {
  return getRootContext().unregisterService(name);
}

function addInfrastructure(name, resource) {
  const context = getRootContext();

  context.registerInfrastructure(name, resource);

  return context;
}

function removeInfrastructure(name) {
  return getRootContext().unregisterInfrastructure(name);
}

function addContainerBinding(name, value) {
  const context = getRootContext();

  context.registerContainerBinding(name, value);

  return context;
}

/**
 * =============================================================================
 * LIFECYCLE STATE
 * =============================================================================
 */

let lifecycleState = null;

function updateLifecycle(options = {}) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'updateLifecycle() requires a plain options object.',
    );
  }

  const context = getRootContext();

  const updated =
    context[REGISTRY_MARKER].setLifecycle({
      state:
        options.state ??
        context.lifecycle.state,

      ready:
        options.ready ??
        context.lifecycle.ready,

      degraded:
        options.degraded ??
        context.lifecycle.degraded,
    });

  lifecycleState = updated;

  return updated;
}

function getLifecycleState() {
  if (rootContext) {
    return rootContext.lifecycle;
  }

  if (lifecycleState) {
    return Object.freeze({
      ...lifecycleState,

      updatedAt:
        lifecycleState.updatedAt instanceof Date
          ? new Date(
              lifecycleState.updatedAt.getTime(),
            )
          : lifecycleState.updatedAt,
    });
  }

  return Object.freeze({
    state: DEFAULT_LIFECYCLE_STATE,

    ready: false,

    degraded: false,

    updatedAt: null,
  });
}

/**
 * =============================================================================
 * DIAGNOSTICS
 * =============================================================================
 */

function snapshot(options = {}) {
  return getRootContext().snapshot(options);
}

function getDiagnostics() {
  return Object.freeze({
    component: COMPONENT,

    service: SERVICE_NAME,

    application: APPLICATION_NAME,

    rootContextCreated:
      Boolean(rootContext),

    lifecycle:
      getLifecycleState(),

    integrations:
      Object.freeze(
        Object.fromEntries(
          integrationResolutionErrors,
        ),
      ),

    registry:
      rootContext
        ? rootContext.getRegistrySnapshot()
        : null,
  });
}

/**
 * =============================================================================
 * RESET
 * =============================================================================
 */

function resetRootContext(options = {}) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'resetRootContext() requires a plain options object.',
    );
  }

  const currentLifecycle =
    rootContext
      ? rootContext.lifecycle
      : lifecycleState;

  const activeStates = new Set([
    'starting',
    'running',
    'ready',
  ]);

  if (
    options.requireStopped !== false &&
    activeStates.has(currentLifecycle?.state)
  ) {
    throw new ContextLifecycleError(
      'Cannot reset the TITech services context while the application is active.',
      {
        code: 'SERVICES_CONTEXT_RESET_NOT_ALLOWED',

        details: {
          state:
            currentLifecycle?.state,
        },
      },
    );
  }

  rootContext = null;

  lifecycleState = null;

  integrationResolutionErrors.clear();

  return true;
}

/**
 * =============================================================================
 * BOOTSTRAP LIFECYCLE INTEGRATION
 * =============================================================================
 */

function registerBootstrapHooks(
  context = {},
  options = {},
) {
  const hooks =
    hooksModule?.hooks ||
    hooksModule?.default?.hooks ||
    null;

  const lifecycle =
    hooksModule?.lifecycle ||
    hooksModule?.default?.lifecycle ||
    null;

  if (
    !hooks ||
    !isFunction(hooks.has) ||
    !isFunction(lifecycle)
  ) {
    throw new ContextLifecycleError(
      'TITech bootstrap lifecycle integration is unavailable.',
      {
        code: 'SERVICES_CONTEXT_HOOKS_UNAVAILABLE',
      },
    );
  }

  try {
    if (hooks.has(COMPONENT)) {
      return isFunction(hooks.get)
        ? hooks.get(COMPONENT)
        : null;
    }
  } catch (error) {
    throw new ContextLifecycleError(
      'TITech services-context hook registry could not be inspected.',
      {
        code: 'SERVICES_CONTEXT_HOOK_REGISTRY_FAILED',

        cause: error,
      },
    );
  }

  return lifecycle(
    COMPONENT,
    {
      priority:
        Number.isInteger(options.priority)
          ? options.priority
          : -100,

      dependencies:
        Array.isArray(options.dependencies)
          ? [...options.dependencies]
          : [
              'configuration',
              'logger',
              'observability',
              'readiness',
              'resilience',
            ],

      critical:
        options.critical !== false,

      fatal:
        options.fatal !== false,

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
                runtime.configuration ||
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
                bootstrap: true,
              },

              lifecycleState:
                DEFAULT_LIFECYCLE_STATE,

              ready: false,

              degraded: false,
            });

          /*
           * This component has successfully created its dependency context.
           * Application readiness remains false until the application lifecycle
           * explicitly updates it.
           */
          updateLifecycle({
            state: 'ready',

            ready: false,

            degraded: false,
          });

          created.emit(
            'services-context.created',
            {
              registryRevision:
                created.registryRevision,
            },
          );

          /*
           * Publish references to the existing runtime context when possible.
           * The BootstrapContext itself remains the lifecycle authority.
           */
          if (
            runtime &&
            typeof runtime === 'object'
          ) {
            try {
              if (
                isFunction(runtime.setServicesContext)
              ) {
                runtime.setServicesContext(created);
              } else {
                runtime.servicesContext = created;
              }

              runtime.serviceContext = created;

              runtime.servicesRegistry =
                created[REGISTRY_MARKER];
            } catch (error) {
              throw new ContextLifecycleError(
                'TITech services context could not be published to the bootstrap runtime.',
                {
                  code: 'SERVICES_CONTEXT_PUBLICATION_FAILED',

                  cause: error,
                },
              );
            }
          }

          return created;
        },

      /*
       * This is the readiness of the services-context component itself.
       * It must not depend on global application readiness, which could create
       * a circular readiness dependency.
       */
      ready:
        async () =>
          Boolean(rootContext),

      health:
        async () => {
          const current =
            getLifecycleState();

          const stopped =
            current.state === 'stopped';

          const failed =
            current.state === 'failed';

          const healthy =
            Boolean(rootContext) &&
            !stopped &&
            !failed;

          return Object.freeze({
            status:
              !rootContext
                ? 'unhealthy'
                : failed
                  ? 'unhealthy'
                  : stopped
                    ? 'stopped'
                    : current.degraded
                      ? 'degraded'
                      : 'healthy',

            healthy,

            ready:
              Boolean(rootContext),

            component: COMPONENT,

            service: SERVICE_NAME,

            registryRevision:
              rootContext
                ? rootContext.registryRevision
                : null,

            lifecycle: current,

            context:
              rootContext
                ? rootContext.snapshot()
                : null,
          });
        },

      stop:
        async () => {
          /*
           * ServicesContext owns dependency publication, not application
           * service shutdown. services.js remains the service-shutdown
           * authority.
           *
           * Do not destroy the root context here; other shutdown participants
           * may still need it.
           */
          updateLifecycle({
            state: 'stopped',

            ready: false,

            degraded: false,
          });

          rootContext?.emit(
            'services-context.stopped',
          );

          return true;
        },

      metadata: {
        component: COMPONENT,

        service: SERVICE_NAME,

        implementation:
          'backend/bootstrap/servicesContext.js',
      },
    },
  );
}

/**
 * =============================================================================
 * EXPORT CONTRACT
 * =============================================================================
 */

const servicesContextModule = Object.freeze({
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

  getDiagnostics,

  /* Test/reset support */
  resetRootContext,

  /* Metadata */
  COMPONENT,

  SERVICE_NAME,

  APPLICATION_NAME,
});

export default servicesContextModule;

export {
  ServicesContext,

  ServicesContextRegistry,

  ServicesContextError,

  DependencyNotFoundError,

  ContextFrozenError,

  ContextLifecycleError,

  createServicesContext,

  createRootContext,

  getRootContext,

  createRequestContext,

  runWithContext,

  getCurrentContext,

  addService,

  removeService,

  addInfrastructure,

  removeInfrastructure,

  addContainerBinding,

  registerBootstrapHooks,

  updateLifecycle,

  getLifecycleState,

  snapshot,

  getDiagnostics,

  resetRootContext,

  COMPONENT,

  SERVICE_NAME,

  APPLICATION_NAME,
};