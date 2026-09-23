'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/resilience.js
 *
 * Purpose:
 *   Enterprise production-grade resilience bootstrap adapter.
 *
 * Architecture rule:
 *   This module owns lifecycle orchestration only.
 *
 *   The canonical resilience implementation remains authoritative for:
 *     - retries
 *     - circuit breakers
 *     - bulkheads
 *     - timeouts
 *     - rate limiting
 *     - fallback behavior
 *     - resilience policies
 *
 * ESM rule:
 *   backend/package.json declares:
 *
 *       "type": "module"
 *
 *   Therefore project-local modules are loaded through native ESM import().
 *
 *   createRequire() is used only as a narrow compatibility bridge for
 *   confirmed legacy CommonJS resilience implementations.
 *
 * =============================================================================
 */

import { createRequire } from 'node:module';

import * as hooksModule from './hooks.js';
import * as readinessModule from './readinessState.js';
import * as observabilityModule from './observability.js';

const require = createRequire(import.meta.url);

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const COMPONENT = 'resilience';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-community-capital-backend';

const DEFAULT_PRIORITY = -500;

const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_READINESS_TIMEOUT_MS = 5_000;

const DEFAULT_DEPENDENCIES = Object.freeze([
  'observability',
]);

const IMPLEMENTATION_CANDIDATES = Object.freeze([
  /*
   * Explicit native ESM paths first.
   */
  '../middleware/resilience.js',
  '../middleware/resilience/index.js',

  '../resilience.js',
  '../resilience/index.js',

  '../infrastructure/resilience.js',
  '../infrastructure/resilience/index.js',

  /*
   * Legacy directory contracts.
   *
   * These remain only for compatibility with existing CommonJS registries.
   */
  '../middleware/resilience',
  '../resilience',
  '../infrastructure/resilience',
]);

const TRUE_VALUES = new Set([
  '1',
  'true',
  'yes',
  'on',
  'enabled',
]);

const FALSE_VALUES = new Set([
  '0',
  'false',
  'no',
  'off',
  'disabled',
]);

const LIFECYCLE_STATES = Object.freeze({
  IDLE: 'idle',
  REGISTERED: 'registered',
  STARTING: 'starting',
  STARTED: 'started',
  DEGRADED: 'degraded',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
});

const START_METHODS = Object.freeze([
  'initialize',
  'init',
  'bootstrap',
  'start',
  'enable',
]);

const STOP_METHODS = Object.freeze([
  'shutdown',
  'close',
  'stop',
  'disable',
  'destroy',
]);

const READY_METHODS = Object.freeze([
  'isReady',
  'ready',
  'readiness',
]);

const HEALTH_METHODS = Object.freeze([
  'health',
  'getHealth',
  'healthCheck',
  'checkHealth',
]);

const MIDDLEWARE_METHODS = Object.freeze([
  'middleware',
  'getMiddleware',
  'createMiddleware',
]);

const SNAPSHOT_METHODS = Object.freeze([
  'snapshot',
  'getSnapshot',
  'diagnostics',
  'getDiagnostics',
]);

const CJS_FALLBACK_ERROR_CODES = new Set([
  'ERR_UNSUPPORTED_DIR_IMPORT',
  'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_REQUIRE_ESM',
]);

/**
 * =============================================================================
 * ERROR
 * =============================================================================
 */

class ResilienceBootstrapError extends Error {
  constructor(message, options = {}) {
    super(
      message ||
        'TITech resilience bootstrap operation failed.',
      options.cause
        ? { cause: options.cause }
        : undefined,
    );

    this.name =
      'ResilienceBootstrapError';

    this.code =
      options.code ||
      'RESILIENCE_BOOTSTRAP_ERROR';

    this.phase =
      options.phase ??
      null;

    this.component =
      options.component ??
      COMPONENT;

    this.service =
      options.service ??
      SERVICE_NAME;

    this.cause =
      options.cause ??
      null;

    this.details = Object.freeze({
      ...(options.details || {}),
    });

    Error.captureStackTrace?.(
      this,
      ResilienceBootstrapError,
    );
  }
}

/**
 * =============================================================================
 * INTERNAL STATE
 * =============================================================================
 */

let implementation = null;

let implementationPath = null;

let implementationFormat = null;

let lifecycleContract = null;

let registered = false;

let lifecycleState =
  LIFECYCLE_STATES.IDLE;

let enabled = true;

let degraded = false;

let failed = false;

let registrationResult = null;

let startPromise = null;

let stopPromise = null;

let lastError = null;

let lastTransitionAt = null;

let transitionSequence = 0;

let startedAt = null;

let stoppedAt = null;

/**
 * =============================================================================
 * GENERIC HELPERS
 * =============================================================================
 */

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object'
  );
}

function isFunction(value) {
  return typeof value === 'function';
}

function nowIso() {
  return new Date().toISOString();
}

function asPositiveInteger(
  value,
  fallback,
) {
  const parsed =
    value === undefined ||
    value === null
      ? fallback
      : Number(value);

  return (
    Number.isInteger(parsed) &&
    parsed > 0
  )
    ? parsed
    : fallback;
}

function normalizeDependencies(
  value,
) {
  if (!Array.isArray(value)) {
    return [
      ...DEFAULT_DEPENDENCIES,
    ];
  }

  const dependencies = [
    ...new Set(
      value
        .map(String)
        .map(entry => entry.trim())
        .filter(Boolean),
    ),
  ];

  return dependencies.length > 0
    ? dependencies
    : [
        ...DEFAULT_DEPENDENCIES,
      ];
}

function safeError(error) {
  if (!error) {
    return null;
  }

  return {
    name:
      error.name ||
      'Error',

    code:
      error.code ??
      null,

    message:
      typeof error.message ===
      'string'
        ? error.message
        : String(error),

    phase:
      error.phase ??
      null,
  };
}

function setState(nextState) {
  lifecycleState =
    nextState;

  lastTransitionAt =
    nowIso();

  transitionSequence +=
    1;
}

/**
 * =============================================================================
 * MODULE NORMALIZATION
 * =============================================================================
 */

function unwrapModule(
  value,
) {
  if (!value) {
    return null;
  }

  const defaultExport =
    value.default;

  /*
   * Prefer default exports only when they actually look like the canonical
   * implementation.
   */
  if (
    defaultExport !== undefined &&
    defaultExport !== null
  ) {
    return defaultExport;
  }

  return value;
}

function getNamedOrDefault(
  moduleValue,
  names = [],
) {
  if (!moduleValue) {
    return null;
  }

  for (const name of names) {
    if (
      moduleValue[name] !==
      undefined
    ) {
      return moduleValue[name];
    }
  }

  const defaultExport =
    moduleValue.default;

  if (
    defaultExport &&
    typeof defaultExport ===
      'object'
  ) {
    for (const name of names) {
      if (
        defaultExport[name] !==
        undefined
      ) {
        return defaultExport[name];
      }
    }
  }

  return null;
}

const hooks =
  getNamedOrDefault(
    hooksModule,
    ['hooks'],
  ) ??
  hooksModule?.default?.hooks ??
  null;

const lifecycle =
  getNamedOrDefault(
    hooksModule,
    ['lifecycle'],
  ) ??
  hooksModule?.default?.lifecycle ??
  null;

const readinessBootstrapModule =
  getNamedOrDefault(
    readinessModule,
    ['readiness'],
  ) ??
  readinessModule?.default ??
  null;

const observability =
  getNamedOrDefault(
    observabilityModule,
    ['observability'],
  ) ??
  observabilityModule?.default?.observability ??
  observabilityModule?.default ??
  null;

/**
 * =============================================================================
 * TIMEOUT
 * =============================================================================
 */

async function withTimeout(
  operation,
  timeoutMs,
  label,
) {
  const normalizedTimeout =
    asPositiveInteger(
      timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );

  let timer = null;

  const operationPromise =
    Promise.resolve().then(
      operation,
    );

  const timeoutPromise =
    new Promise(
      (_resolve, reject) => {
        timer =
          setTimeout(
            () => {
              reject(
                new ResilienceBootstrapError(
                  `${label} timed out after ${normalizedTimeout}ms.`,
                  {
                    code:
                      'RESILIENCE_OPERATION_TIMEOUT',
                    phase:
                      'lifecycle',
                    details: {
                      timeoutMs:
                        normalizedTimeout,
                    },
                  },
                ),
              );
            },
            normalizedTimeout,
          );

        timer.unref?.();
      },
    );

  try {
    return await Promise.race([
      operationPromise,
      timeoutPromise,
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }
}

/**
 * =============================================================================
 * IMPLEMENTATION RESOLUTION
 * =============================================================================
 *
 * Native ESM is authoritative.
 *
 * CommonJS fallback is attempted only when the ESM loader reports a genuine
 * format/resolution incompatibility.
 *
 * Import/runtime errors from an existing ESM implementation are NEVER silently
 * converted into CommonJS discovery failures.
 */

function isMissingModuleError(
  error,
  candidate,
) {
  if (
    error?.code !==
    'ERR_MODULE_NOT_FOUND'
  ) {
    return false;
  }

  const message =
    String(
      error?.message || '',
    );

  return (
    message.includes(candidate) ||
    message.includes(
      candidate.replace(
        /^\.\//,
        '',
      ),
    )
  );
}

function isCjsFallbackEligible(
  error,
) {
  if (
    CJS_FALLBACK_ERROR_CODES.has(
      error?.code,
    )
  ) {
    return true;
  }

  // Node treats legacy .js CommonJS files as ESM when the package declares
  // "type": "module". Dynamic import() may therefore throw a narrowly
  // identifiable ReferenceError before the existing require() compatibility
  // path can run. Only recognize those CJS-in-ESM diagnostics here.
  const message =
    String(
      error?.message ??
        '',
    ).toLowerCase();

  return (
    error?.name === 'ReferenceError' &&
    (
      message.includes('module is not defined in es module scope') ||
      message.includes('exports is not defined in es module scope') ||
      message.includes('require is not defined in es module scope')
    )
  );
}

async function loadImplementationCandidate(
  candidate,
) {
  let importError = null;

  /**
   * ---------------------------------------------------------------------------
   * Native ESM
   * ---------------------------------------------------------------------------
   */

  try {
    const loaded =
      await import(candidate);

    const normalized =
      unwrapModule(
        loaded,
      );

    if (!normalized) {
      throw new ResilienceBootstrapError(
        'TITech resilience implementation exported an empty value.',
        {
          code:
            'RESILIENCE_IMPLEMENTATION_EMPTY',
          phase:
            'resolution',
          details: {
            candidate,
            format: 'esm',
          },
        },
      );
    }

    return {
      implementation:
        normalized,

      format:
        'esm',

      path:
        candidate,
    };
  } catch (error) {
    importError = error;

    /*
     * Candidate does not exist. Discovery should continue.
     */
    if (
      isMissingModuleError(
        error,
        candidate,
      )
    ) {
      return null;
    }

    /*
     * Real syntax/runtime/dependency failures must surface immediately.
     */
    if (
      !isCjsFallbackEligible(error)
    ) {
      throw new ResilienceBootstrapError(
        'Failed to import a TITech resilience implementation.',
        {
          code:
            'RESILIENCE_IMPLEMENTATION_IMPORT_FAILED',
          phase:
            'resolution',
          cause:
            error,
          details: {
            candidate,
            importError:
              safeError(error),
          },
        },
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Legacy CommonJS compatibility
   * ---------------------------------------------------------------------------
   */

  try {
    const resolvedPath =
      require.resolve(
        candidate,
      );

    const loaded =
      require(
        resolvedPath,
      );

    const normalized =
      unwrapModule(
        loaded,
      );

    if (!normalized) {
      throw new ResilienceBootstrapError(
        'TITech legacy CommonJS resilience implementation exported an empty value.',
        {
          code:
            'RESILIENCE_IMPLEMENTATION_EMPTY',
          phase:
            'resolution',
          details: {
            candidate,
            format:
              'commonjs',
          },
        },
      );
    }

    return {
      implementation:
        normalized,

      format:
        'commonjs',

      path:
        candidate,

      importError,
    };
  } catch (requireError) {
    /*
     * A missing CommonJS candidate is still just a discovery miss.
     */
    if (
      requireError?.code ===
        'MODULE_NOT_FOUND' ||
      requireError?.code ===
        'ERR_MODULE_NOT_FOUND'
    ) {
      return null;
    }

    throw new ResilienceBootstrapError(
      'Failed to load a legacy CommonJS TITech resilience implementation.',
      {
        code:
          'RESILIENCE_IMPLEMENTATION_LOAD_FAILED',
        phase:
          'resolution',
        cause:
          requireError,
        details: {
          candidate,

          importError:
            safeError(
              importError,
            ),

          requireError:
            safeError(
              requireError,
            ),
        },
      },
    );
  }
}

async function resolveResilienceImplementation() {
  if (implementation) {
    return {
      implementation,

      path:
        implementationPath,

      format:
        implementationFormat,
    };
  }

  for (
    const candidate of
      IMPLEMENTATION_CANDIDATES
  ) {
    const resolved =
      await loadImplementationCandidate(
        candidate,
      );

    if (!resolved) {
      continue;
    }

    implementation =
      resolved.implementation;

    implementationPath =
      resolved.path;

    implementationFormat =
      resolved.format;

    lifecycleContract =
      resolveLifecycleContract(
        implementation,
      );

    return {
      implementation,

      path:
        implementationPath,

      format:
        implementationFormat,
    };
  }

  throw new ResilienceBootstrapError(
    'No TITech resilience implementation could be resolved.',
    {
      code:
        'RESILIENCE_IMPLEMENTATION_UNAVAILABLE',
      phase:
        'resolution',
      details: {
        candidates:
          IMPLEMENTATION_CANDIDATES,
      },
    },
  );
}

/**
 * =============================================================================
 * METHOD DISCOVERY
 * =============================================================================
 */

function findMethod(
  target,
  methodNames,
) {
  if (!target) {
    return null;
  }

  for (
    const methodName of
      methodNames
  ) {
    if (
      isFunction(
        target[methodName],
      )
    ) {
      return {
        name:
          methodName,

        fn:
          target[
            methodName
          ].bind(target),
      };
    }
  }

  return null;
}

function resolveLifecycleContract(
  value,
) {
  const candidates = [
    value,
    value?.resilience,
    value?.manager,
    value?.service,
    value?.instance,
    value?.default,
  ].filter(Boolean);

  let start = null;
  let stop = null;
  let ready = null;
  let health = null;
  let middleware = null;
  let snapshot = null;

  for (
    const candidate of
      candidates
  ) {
    start ||=
      findMethod(
        candidate,
        START_METHODS,
      );

    stop ||=
      findMethod(
        candidate,
        STOP_METHODS,
      );

    ready ||=
      findMethod(
        candidate,
        READY_METHODS,
      );

    health ||=
      findMethod(
        candidate,
        HEALTH_METHODS,
      );

    middleware ||=
      findMethod(
        candidate,
        MIDDLEWARE_METHODS,
      );

    snapshot ||=
      findMethod(
        candidate,
        SNAPSHOT_METHODS,
      );

    if (
      start &&
      stop &&
      ready &&
      health &&
      middleware &&
      snapshot
    ) {
      break;
    }
  }

  return {
    target:
      candidates[0] ||
      value,

    start,

    stop,

    ready,

    health,

    middleware,

    snapshot,
  };
}

function assertImplementation(
  contract,
) {
  if (!contract?.target) {
    throw new ResilienceBootstrapError(
      'TITech resilience implementation could not be resolved.',
      {
        code:
          'RESILIENCE_IMPLEMENTATION_UNAVAILABLE',
        phase:
          'resolution',
        details: {
          candidates:
            IMPLEMENTATION_CANDIDATES,
        },
      },
    );
  }

  if (!contract.start) {
    throw new ResilienceBootstrapError(
      'TITech resilience implementation does not expose a supported startup API.',
      {
        code:
          'RESILIENCE_IMPLEMENTATION_START_UNSUPPORTED',
        phase:
          'resolution',
        details: {
          supported:
            START_METHODS,
        },
      },
    );
  }
}

/**
 * =============================================================================
 * ENABLE / DISABLE
 * =============================================================================
 */

function resolveEnabled(
  context = {},
  options = {},
) {
  if (
    typeof options.enabled ===
    'boolean'
  ) {
    return options.enabled;
  }

  const configuration =
    context?.configuration ||
    context?.config ||
    {};

  const environment =
    context?.environment ||
    {};

  const candidates = [
    configuration?.resilience
      ?.enabled,

    configuration?.infrastructure
      ?.resilience
      ?.enabled,

    environment?.resilience
      ?.enabled,

    process.env
      .RESILIENCE_ENABLED,
  ];

  for (
    const candidate of
      candidates
  ) {
    if (
      typeof candidate ===
      'boolean'
    ) {
      return candidate;
    }

    if (
      candidate ===
        undefined ||
      candidate === null
    ) {
      continue;
    }

    const normalized =
      String(candidate)
        .trim()
        .toLowerCase();

    if (
      TRUE_VALUES.has(
        normalized,
      )
    ) {
      return true;
    }

    if (
      FALSE_VALUES.has(
        normalized,
      )
    ) {
      return false;
    }
  }

  return true;
}

/**
 * =============================================================================
 * READINESS / HEALTH NORMALIZATION
 * =============================================================================
 */

function normalizeReadinessResult(
  result,
) {
  if (
    typeof result ===
    'boolean'
  ) {
    return {
      ready:
        result,

      status:
        result
          ? 'ready'
          : 'not_ready',
    };
  }

  if (
    result === null ||
    result === undefined
  ) {
    return {
      ready:
        false,

      status:
        'not_ready',
    };
  }

  if (
    typeof result ===
    'object'
  ) {
    const explicitReady =
      typeof result.ready ===
      'boolean'
        ? result.ready
        : null;

    const status =
      String(
        result.status ||
          '',
      ).toLowerCase();

    const notReady =
      new Set([
        'unhealthy',
        'not_ready',
        'not-ready',
        'failed',
        'stopped',
        'disabled',
      ]).has(status);

    return {
      ...result,

      ready:
        explicitReady ??
        !notReady,

      status:
        result.status ||
        (
          explicitReady ===
          true
            ? 'ready'
            : 'not_ready'
        ),
    };
  }

  return {
    ready:
      Boolean(result),

    status:
      Boolean(result)
        ? 'ready'
        : 'not_ready',
  };
}

async function readinessCheck(
  timeoutMs =
    DEFAULT_READINESS_TIMEOUT_MS,
) {
  if (!enabled) {
    return {
      ready:
        false,

      status:
        'disabled',
    };
  }

  if (
    lifecycleState ===
    LIFECYCLE_STATES.FAILED
  ) {
    return {
      ready:
        false,

      status:
        'not_ready',
    };
  }

  if (
    lifecycleState !==
    LIFECYCLE_STATES.STARTED
  ) {
    return {
      ready:
        false,

      status:
        'not_ready',
    };
  }

  const contract =
    lifecycleContract ||
    resolveLifecycleContract(
      implementation,
    );

  if (!contract?.ready) {
    return {
      ready:
        isReady(),

      status:
        isReady()
          ? 'ready'
          : degraded
            ? 'degraded'
            : 'not_ready',
    };
  }

  const result =
    await withTimeout(
      () =>
        contract.ready.fn(),
      asPositiveInteger(
        timeoutMs,
        DEFAULT_READINESS_TIMEOUT_MS,
      ),
      'TITech resilience readiness',
    );

  return normalizeReadinessResult(
    result,
  );
}

/**
 * =============================================================================
 * OBSERVABILITY
 * =============================================================================
 */

function emitObservabilityEvent(
  event,
  payload = {},
) {
  try {
    const emitter =
      observability?.emitEvent;

    if (
      !isFunction(emitter)
    ) {
      return null;
    }

    const result =
      emitter.call(
        observability,
        event,
        {
          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          state:
            lifecycleState,

          timestamp:
            nowIso(),

          ...payload,
        },
      );

    if (
      isFunction(
        result?.catch,
      )
    ) {
      void result.catch(
        () => undefined,
      );
    }

    return result;
  } catch {
    /*
     * Observability must never break resilience lifecycle operations.
     */
    return null;
  }
}

/**
 * =============================================================================
 * START / STOP INVOCATION
 * =============================================================================
 */

async function invokeStart(
  context = {},
  timeoutMs =
    DEFAULT_TIMEOUT_MS,
) {
  const resolved =
    await resolveResilienceImplementation();

  const contract =
    lifecycleContract ||
    resolveLifecycleContract(
      resolved.implementation,
    );

  assertImplementation(
    contract,
  );

  lifecycleContract =
    contract;

  return withTimeout(
    () =>
      contract.start.fn({
        ...context,

        resilience:
          implementation,

        component:
          COMPONENT,

        service:
          SERVICE_NAME,
      }),
    timeoutMs,
    'TITech resilience startup',
  );
}

async function invokeStop(
  context = {},
  timeoutMs =
    DEFAULT_TIMEOUT_MS,
) {
  const contract =
    lifecycleContract ||
    resolveLifecycleContract(
      implementation,
    );

  /*
   * Stop is intentionally optional for compatibility with simple resilience
   * implementations.
   */
  if (!contract?.stop) {
    return true;
  }

  return withTimeout(
    () =>
      contract.stop.fn({
        ...context,

        resilience:
          implementation,

        component:
          COMPONENT,

        service:
          SERVICE_NAME,
      }),
    timeoutMs,
    'TITech resilience shutdown',
  );
}

/**
 * =============================================================================
 * START
 * =============================================================================
 */

async function ensureStarted(
  context = {},
  options = {},
) {
  if (!enabled) {
    registered = true;
    degraded = false;
    failed = false;

    setState(
      LIFECYCLE_STATES.STOPPED,
    );

    return {
      enabled: false,
      resilience: null,
    };
  }

  if (
    lifecycleState ===
      LIFECYCLE_STATES.STARTED &&
    !failed
  ) {
    return implementation;
  }

  if (startPromise) {
    return startPromise;
  }

  if (stopPromise) {
    await stopPromise;
  }

  const timeoutMs =
    asPositiveInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );

  startPromise =
    (async () => {
      setState(
        LIFECYCLE_STATES.STARTING,
      );

      failed = false;

      try {
        const result =
          await invokeStart(
            context,
            timeoutMs,
          );

        registered = true;

        degraded = false;

        failed = false;

        enabled = true;

        startedAt =
          nowIso();

        stoppedAt = null;

        lastError = null;

        setState(
          LIFECYCLE_STATES.STARTED,
        );

        if (
          isObject(context)
        ) {
          context.resilience =
            implementation;
        }

        emitObservabilityEvent(
          'resilience.started',
          {
            implementation:
              implementationPath,

            format:
              implementationFormat,
          },
        );

        return (
          result ??
          implementation
        );
      } catch (error) {
        failed = true;

        degraded = true;

        lastError = error;

        setState(
          LIFECYCLE_STATES.FAILED,
        );

        emitObservabilityEvent(
          'resilience.start_failed',
          {
            error:
              safeError(error),
          },
        );

        throw wrapError(
          error,
          'RESILIENCE_START_FAILED',
          'startup',
          'TITech resilience subsystem startup failed.',
        );
      }
    })();

  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

/**
 * =============================================================================
 * STOP
 * =============================================================================
 */

async function ensureStopped(
  context = {},
  options = {},
) {
  if (
    lifecycleState ===
    LIFECYCLE_STATES.STOPPED
  ) {
    return true;
  }

  if (stopPromise) {
    return stopPromise;
  }

  if (startPromise) {
    try {
      await startPromise;
    } catch {
      /*
       * Preserve startup failure while allowing shutdown bookkeeping.
       */
    }
  }

  if (!implementation) {
    degraded = false;

    failed = false;

    stoppedAt =
      nowIso();

    setState(
      LIFECYCLE_STATES.STOPPED,
    );

    return true;
  }

  const timeoutMs =
    asPositiveInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );

  stopPromise =
    (async () => {
      setState(
        LIFECYCLE_STATES.STOPPING,
      );

      try {
        await invokeStop(
          context,
          timeoutMs,
        );

        degraded = false;

        failed = false;

        lastError = null;

        stoppedAt =
          nowIso();

        setState(
          LIFECYCLE_STATES.STOPPED,
        );

        emitObservabilityEvent(
          'resilience.stopped',
        );

        return true;
      } catch (error) {
        failed = true;

        degraded = true;

        lastError = error;

        setState(
          LIFECYCLE_STATES.FAILED,
        );

        emitObservabilityEvent(
          'resilience.stop_failed',
          {
            error:
              safeError(error),
          },
        );

        throw wrapError(
          error,
          'RESILIENCE_STOP_FAILED',
          'shutdown',
          'TITech resilience subsystem shutdown failed.',
        );
      }
    })();

  try {
    return await stopPromise;
  } finally {
    stopPromise = null;
  }
}

/**
 * =============================================================================
 * READINESS REGISTRATION
 * =============================================================================
 */

function registerReadinessDependency(
  context = {},
  options = {},
) {
  const register =
    readinessBootstrapModule?.register;

  if (
    !isFunction(register)
  ) {
    return null;
  }

  try {
    if (
      isFunction(
        readinessBootstrapModule.has,
      ) &&
      readinessBootstrapModule.has(
        COMPONENT,
      )
    ) {
      return null;
    }
  } catch {
    /*
     * Continue with best-effort registration.
     */
  }

  try {
    return register.call(
      readinessBootstrapModule,
      {
        name:
          COMPONENT,

        severity:
          options.readinessSeverity ||
          'required',

        enabled:
          options.enabled !== false,

        timeoutMs:
          asPositiveInteger(
            options.readinessTimeoutMs,
            DEFAULT_READINESS_TIMEOUT_MS,
          ),

        readiness:
          async () =>
            readiness({
              timeoutMs:
                options.readinessTimeoutMs,
            }),

        health:
          async () =>
            health({
              timeoutMs:
                options.readinessTimeoutMs,
            }),

        metadata: {
          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          implementation:
            implementationPath ||
            'pending-resolution',

          bootstrap:
            'backend/bootstrap/resilience.js',
        },
      },
    );
  } catch (error) {
    /*
     * Readiness integration is auxiliary. The core resilience lifecycle should
     * not fail because the readiness registry is unavailable.
     */
    emitObservabilityEvent(
      'resilience.readiness_registration_failed',
      {
        error:
          safeError(error),
      },
    );

    return null;
  }
}

/**
 * =============================================================================
 * LIFECYCLE REGISTRATION
 * =============================================================================
 */

function registerResilienceHooks(
  context = {},
  options = {},
) {
  if (
    hooks &&
    isFunction(hooks.has) &&
    hooks.has(COMPONENT)
  ) {
    registered = true;

    registrationResult =
      isFunction(hooks.get)
        ? hooks.get(COMPONENT)
        : registrationResult;

    if (
      lifecycleState ===
      LIFECYCLE_STATES.IDLE
    ) {
      setState(
        LIFECYCLE_STATES.REGISTERED,
      );
    }

    return registrationResult;
  }

  if (
    !isFunction(lifecycle)
  ) {
    throw new ResilienceBootstrapError(
      'TITech lifecycle registration function is unavailable.',
      {
        code:
          'RESILIENCE_LIFECYCLE_UNAVAILABLE',

        phase:
          'registration',
      },
    );
  }

  enabled =
    resolveEnabled(
      context,
      options,
    );

  const dependencies =
    normalizeDependencies(
      options.dependencies,
    );

  const timeoutMs =
    asPositiveInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );

  /*
   * Resolution is intentionally speculative and non-blocking here.
   *
   * The authoritative failure still occurs in ensureStarted().
   */
  if (enabled) {
    void resolveResilienceImplementation()
      .catch(error => {
        lastError = error;
        degraded = true;

        emitObservabilityEvent(
          'resilience.resolution_failed',
          {
            error:
              safeError(error),
          },
        );
      });
  }

  registrationResult =
    lifecycle(
      COMPONENT,
      {
        priority:
          Number.isInteger(
            options.priority,
          )
            ? options.priority
            : DEFAULT_PRIORITY,

        dependencies,

        timeoutMs,

        enabled,

        critical:
          options.critical !== false,

        metadata: {
          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          implementation:
            implementationPath ||
            'pending-resolution',

          bootstrap:
            'backend/bootstrap/resilience.js',

          subsystem:
            'resilience',
        },

        start:
          async (
            hookContext = {},
          ) => {
            /*
             * Always resolve effective enabled state from the context that
             * reaches the lifecycle manager.
             */
            const lifecycleEnabled =
              resolveEnabled(
                hookContext ||
                  context,
                options,
              );

            enabled =
              lifecycleEnabled;

            if (!lifecycleEnabled) {
              registered = true;
              degraded = false;
              failed = false;

              stoppedAt =
                nowIso();

              setState(
                LIFECYCLE_STATES.STOPPED,
              );

              emitObservabilityEvent(
                'resilience.disabled',
                {
                  reason:
                    'configuration',
                },
              );

              return {
                enabled: false,
                resilience: null,
              };
            }

            return ensureStarted(
              hookContext ||
                context,
              options,
            );
          },

        ready:
          async () => {
            if (!enabled) {
              return false;
            }

            try {
              const result =
                await readinessCheck(
                  options.readinessTimeoutMs,
                );

              /*
               * Do not mark a healthy running subsystem as degraded merely
               * because an external readiness probe transiently reports false.
               */
              degraded =
                result.ready
                  ? false
                  : lifecycleState !==
                      LIFECYCLE_STATES.STARTED;

              return result.ready;
            } catch (error) {
              lastError = error;
              degraded = true;

              return false;
            }
          },

        health:
          async () =>
            health({
              timeoutMs,
            }),

        stop:
          async (
            hookContext = {},
          ) =>
            ensureStopped(
              hookContext ||
                context,
              options,
            ),
      },
    );

  registered = true;

  if (
    lifecycleState ===
    LIFECYCLE_STATES.IDLE
  ) {
    setState(
      LIFECYCLE_STATES.REGISTERED,
    );
  }

  if (enabled) {
    registerReadinessDependency(
      context,
      options,
    );
  }

  return registrationResult;
}

function registerBootstrapHooks(
  context = {},
  options = {},
) {
  return registerResilienceHooks(
    context,
    options,
  );
}

/**
 * =============================================================================
 * EXPLICIT LIFECYCLE API
 * =============================================================================
 */

async function initialize(
  context = {},
  options = {},
) {
  enabled =
    resolveEnabled(
      context,
      options,
    );

  registered = true;

  if (!enabled) {
    degraded = false;
    failed = false;

    stoppedAt =
      nowIso();

    setState(
      LIFECYCLE_STATES.STOPPED,
    );

    registerReadinessDependency(
      context,
      options,
    );

    emitObservabilityEvent(
      'resilience.disabled',
      {
        reason:
          'configuration',
      },
    );

    return {
      enabled: false,
      resilience: null,
    };
  }

  const result =
    await ensureStarted(
      context,
      options,
    );

  registerReadinessDependency(
    context,
    options,
  );

  return result;
}

async function start(
  context = {},
  options = {},
) {
  return initialize(
    context,
    options,
  );
}

async function shutdown(
  context = {},
  options = {},
) {
  return ensureStopped(
    context,
    options,
  );
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
 * HEALTH / READINESS
 * =============================================================================
 */

async function readiness(
  options = {},
) {
  try {
    const result =
      await readinessCheck(
        options.timeoutMs,
      );

    return Object.freeze({
      ...result,

      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      enabled,

      implementation:
        implementationPath,

      implementationFormat,

      state:
        lifecycleState,

      degraded,

      failed,
    });
  } catch (error) {
    lastError = error;
    degraded = true;

    return Object.freeze({
      ready: false,

      status:
        'unhealthy',

      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      enabled,

      implementation:
        implementationPath,

      implementationFormat,

      state:
        lifecycleState,

      degraded: true,

      failed,

      error:
        safeError(error),
    });
  }
}

async function health(
  options = {},
) {
  const timeoutMs =
    asPositiveInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
    );

  try {
    const contract =
      lifecycleContract ||
      resolveLifecycleContract(
        implementation,
      );

    if (
      contract?.health
    ) {
      const result =
        await withTimeout(
          () =>
            contract.health.fn(),
          timeoutMs,
          'TITech resilience health',
        );

      return Object.freeze({
        ...(
          isObject(result)
            ? result
            : {
                healthy:
                  Boolean(
                    result,
                  ),
              }
        ),

        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        state:
          lifecycleState,

        enabled,

        degraded,

        failed,

        ready:
          isReady(),
      });
    }

    return Object.freeze({
      status:
        !enabled
          ? 'disabled'
          : failed
            ? 'unhealthy'
            : degraded
              ? 'degraded'
              : isStarted()
                ? 'healthy'
                : isStopped()
                  ? 'stopped'
                  : 'unknown',

      healthy:
        enabled &&
        isStarted() &&
        !failed &&
        !degraded,

      ready:
        isReady(),

      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      implementation:
        implementationPath,

      implementationFormat,

      state:
        lifecycleState,

      enabled,

      degraded,

      failed,
    });
  } catch (error) {
    lastError = error;
    degraded = true;

    return Object.freeze({
      status:
        'unhealthy',

      healthy: false,

      ready: false,

      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      implementation:
        implementationPath,

      implementationFormat,

      state:
        lifecycleState,

      enabled,

      degraded: true,

      failed,

      error:
        safeError(error),
    });
  }
}

/**
 * =============================================================================
 * MIDDLEWARE
 * =============================================================================
 */

function middleware(
  ...args
) {
  const contract =
    lifecycleContract ||
    resolveLifecycleContract(
      implementation,
    );

  if (
    !contract?.middleware
  ) {
    return null;
  }

  return contract
    .middleware
    .fn(...args);
}

/**
 * =============================================================================
 * SNAPSHOT / DIAGNOSTICS
 * =============================================================================
 */

function snapshot() {
  const contract =
    lifecycleContract ||
    resolveLifecycleContract(
      implementation,
    );

  let implementationState =
    null;

  if (
    contract?.snapshot
  ) {
    try {
      const result =
        contract
          .snapshot
          .fn();

      /*
       * Snapshots exposed by the canonical implementation should preferably
       * remain synchronous for diagnostics.
       */
      if (
        isFunction(
          result?.then,
        )
      ) {
        implementationState = {
          status:
            'unavailable',

          reason:
            'async_snapshot_not_supported',
        };
      } else {
        implementationState =
          result;
      }
    } catch (error) {
      implementationState = {
        status:
          'unavailable',

        error:
          safeError(error),
      };
    }
  }

  return Object.freeze({
    ...getState(),

    implementationState,
  });
}

function getState() {
  return Object.freeze({
    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    registered,

    enabled,

    state:
      lifecycleState,

    started:
      isStarted(),

    stopped:
      isStopped(),

    degraded,

    failed,

    ready:
      isReady(),

    implementation:
      implementationPath,

    implementationFormat,

    startedAt,

    stoppedAt,

    lastTransitionAt,

    transitionSequence,

    lastError:
      safeError(
        lastError,
      ),
  });
}

function getDiagnostics() {
  return Object.freeze({
    ...getState(),

    implementationContract:
      lifecycleContract
        ? Object.freeze({
            start:
              lifecycleContract
                .start
                ?.name ||
              null,

            stop:
              lifecycleContract
                .stop
                ?.name ||
              null,

            ready:
              lifecycleContract
                .ready
                ?.name ||
              null,

            health:
              lifecycleContract
                .health
                ?.name ||
              null,

            middleware:
              lifecycleContract
                .middleware
                ?.name ||
              null,

            snapshot:
              lifecycleContract
                .snapshot
                ?.name ||
              null,
          })
        : null,
  });
}

/**
 * =============================================================================
 * STATE ACCESSORS
 * =============================================================================
 */

function isRegistered() {
  return registered;
}

function isStarted() {
  return (
    lifecycleState ===
    LIFECYCLE_STATES.STARTED
  );
}

function isStopped() {
  return (
    lifecycleState ===
    LIFECYCLE_STATES.STOPPED
  );
}

function isFailed() {
  return (
    failed ||
    lifecycleState ===
      LIFECYCLE_STATES.FAILED
  );
}

function isDegraded() {
  return degraded;
}

function isReady() {
  return (
    enabled &&
    lifecycleState ===
      LIFECYCLE_STATES.STARTED &&
    !failed &&
    !degraded
  );
}

function getResilience() {
  return implementation;
}

/**
 * =============================================================================
 * RESET
 * =============================================================================
 */

function reset() {
  if (
    startPromise ||
    stopPromise ||
    lifecycleState ===
      LIFECYCLE_STATES.STARTING ||
    lifecycleState ===
      LIFECYCLE_STATES.STARTED ||
    lifecycleState ===
      LIFECYCLE_STATES.STOPPING
  ) {
    throw new ResilienceBootstrapError(
      'Cannot reset an active TITech resilience bootstrap.',
      {
        code:
          'RESILIENCE_RESET_NOT_ALLOWED',

        phase:
          'reset',
      },
    );
  }

  implementation = null;

  implementationPath = null;

  implementationFormat = null;

  lifecycleContract = null;

  registered = false;

  lifecycleState =
    LIFECYCLE_STATES.IDLE;

  enabled = true;

  degraded = false;

  failed = false;

  registrationResult = null;

  startPromise = null;

  stopPromise = null;

  lastError = null;

  lastTransitionAt = null;

  transitionSequence = 0;

  startedAt = null;

  stoppedAt = null;

  return true;
}

/**
 * =============================================================================
 * ERROR WRAPPER
 * =============================================================================
 */

function wrapError(
  error,
  code,
  phase,
  message,
) {
  if (
    error instanceof
    ResilienceBootstrapError
  ) {
    return error;
  }

  return new ResilienceBootstrapError(
    message,
    {
      code,
      phase,
      cause:
        error,
    },
  );
}

/**
 * =============================================================================
 * PUBLIC API
 * =============================================================================
 */

const resilienceBootstrap =
  Object.freeze({
    registerResilienceHooks,

    registerBootstrapHooks,

    bootstrap:
      registerBootstrapHooks,

    initialize,

    start,

    shutdown,

    stop,

    getResilience,

    getState,

    getDiagnostics,

    snapshot,

    isRegistered,

    isStarted,

    isStopped,

    isFailed,

    isDegraded,

    isReady,

    readiness,

    health,

    middleware,

    reset,

    ResilienceBootstrapError,

    COMPONENT,

    SERVICE_NAME,

    IMPLEMENTATION_CANDIDATES,

    LIFECYCLE_STATES,

    START_METHODS,

    STOP_METHODS,

    READY_METHODS,

    HEALTH_METHODS,

    MIDDLEWARE_METHODS,

    SNAPSHOT_METHODS,
  });

/**
 * =============================================================================
 * EXPORTS
 * =============================================================================
 */

export {
  resilienceBootstrap,

  registerResilienceHooks,

  registerBootstrapHooks,

  initialize,

  start,

  shutdown,

  stop,

  getResilience,

  getState,

  getDiagnostics,

  snapshot,

  isRegistered,

  isStarted,

  isStopped,

  isFailed,

  isDegraded,

  isReady,

  readiness,

  health,

  middleware,

  reset,

  ResilienceBootstrapError,

  COMPONENT,

  SERVICE_NAME,

  IMPLEMENTATION_CANDIDATES,

  LIFECYCLE_STATES,

  START_METHODS,

  STOP_METHODS,

  READY_METHODS,

  HEALTH_METHODS,

  MIDDLEWARE_METHODS,

  SNAPSHOT_METHODS,
};

export default resilienceBootstrap;