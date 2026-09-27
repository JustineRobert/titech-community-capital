'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/routes.js
 *
 * Purpose:
 *   Enterprise production-grade route bootstrap / composition adapter.
 *
 * Responsibilities:
 *   - Register the application routing lifecycle with bootstrap.
 *   - Resolve the canonical Express application.
 *   - Resolve authoritative application configuration.
 *   - Bind authentication configuration before loading route modules.
 *   - Load the canonical route registry deterministically.
 *   - Mount existing routes without replacing their implementation.
 *   - Prevent duplicate initialization / mounting.
 *   - Serialize concurrent start/stop operations.
 *   - Support multiple legacy route registration contracts.
 *   - Integrate readiness and observability safely.
 *   - Provide deterministic route diagnostics.
 *   - Support graceful logical shutdown and safe restart/resume.
 *
 * ESM COMPATIBILITY:
 *
 *   backend/package.json declares:
 *
 *       "type": "module"
 *
 *   Therefore native project-local modules are loaded through import()/static
 *   import declarations.
 *
 *   createRequire() exists ONLY as a narrow compatibility bridge for genuine
 *   legacy CommonJS route implementations.
 *
 * IMPORTANT:
 *
 *   This module is a COMPOSITION ADAPTER.
 *
 *   It does NOT:
 *     - implement business logic
 *     - implement controllers
 *     - implement financial operations
 *     - implement ledger operations
 *     - implement authentication logic
 *     - implement database queries
 *     - implement queue processing
 *     - replace existing route modules
 *
 * Existing route implementations remain authoritative.
 *
 * =============================================================================
 */

import { createRequire } from 'node:module';

import * as hooksModule from './hooks.js';

const require = createRequire(import.meta.url);

/**
 * =============================================================================
 * MODULE BINDINGS
 * =============================================================================
 *
 * hooks.js is a required bootstrap dependency.
 *
 * readinessState, observability and authentication remain dynamically resolved
 * because the adapter intentionally tolerates optional/migrating integrations.
 *
 * =============================================================================
 */

const hooks =
  hooksModule?.hooks ??
  hooksModule?.default?.hooks ??
  null;

const lifecycle =
  hooksModule?.lifecycle ??
  hooksModule?.default?.lifecycle ??
  null;

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const COMPONENT = 'routes';

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  'titech-community-capital-backend';

const DEFAULT_PRIORITY = 100;

const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_READINESS_TIMEOUT_MS = 5_000;

const DEFAULT_API_PREFIX = '/api';

const DEFAULT_HEALTH_PREFIX = '/health';

const DEFAULT_METRICS_PATH = '/metrics';

const DEFAULT_DEPENDENCIES = Object.freeze([
  'middleware',
]);

const ROUTE_MODULE_CANDIDATES = Object.freeze([
  /*
   * Native ESM candidates.
   *
   * Explicit filenames are preferred because native ESM does not perform the
   * same directory/index resolution as CommonJS.
   */
  '../routes/index.js',
  '../routes.js',
  '../routes/index',
  '../routes',

  '../api/routes/index.js',
  '../api/routes.js',
  '../api/routes/index',
  '../api/routes',

  '../api/index.js',
  '../api.js',
  '../api/index',
  '../api',
]);

const ROUTE_REGISTRATION_METHODS = Object.freeze([
  'registerRoutes',
  'mountRoutes',
  'configureRoutes',
  'initializeRoutes',
]);

const AUTH_CONFIGURATION_METHODS = Object.freeze([
  'configureAuth',
  'configureAuthentication',
  'initializeAuth',
]);

const ROUTE_LIFECYCLE_STATES = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  MOUNTED: 'mounted',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
});

/**
 * Module errors which indicate that attempting CommonJS compatibility is
 * meaningful.
 */
const COMMONJS_FALLBACK_ERROR_CODES = new Set([
  'ERR_REQUIRE_ESM',
  'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_UNSUPPORTED_DIR_IMPORT',
]);

/**
 * =============================================================================
 * ERROR
 * =============================================================================
 */

class RoutesBootstrapError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'RoutesBootstrapError';

    this.code =
      options.code ||
      'ROUTES_BOOTSTRAP_ERROR';

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
      RoutesBootstrapError,
    );
  }
}

/**
 * =============================================================================
 * INTERNAL STATE
 * =============================================================================
 */

let application = null;

let router = null;

let routeModule = null;

let routeModulePath = null;

let routeRegistrationMode = null;

let registered = false;

let lifecycleState =
  ROUTE_LIFECYCLE_STATES.IDLE;

let mounted = false;

let stopped = false;

let failed = false;

let registrationResult = null;

let startPromise = null;

let stopPromise = null;

let lastError = null;

let lastTransitionAt = null;

let routeCount = 0;

let mountedAt = null;

let stoppedAt = null;

let authenticationConfigured = false;

let authenticationConfigurationTarget = null;

let readinessModule = null;

let observabilityModule = null;

let authModule = null;

let authModuleLoadError = null;

/**
 * =============================================================================
 * UTILITY HELPERS
 * =============================================================================
 */

function nowIso() {
  return new Date().toISOString();
}

function isFunction(value) {
  return typeof value === 'function';
}

function isObjectLike(value) {
  return (
    value !== null &&
    typeof value === 'object'
  );
}

function isPromiseLike(value) {
  return Boolean(
    value &&
      typeof value.then === 'function',
  );
}

function normalizeString(value, fallback = null) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const normalized = String(value).trim();

  return normalized || fallback;
}

function setLifecycleState(state) {
  lifecycleState = state;
  lastTransitionAt = nowIso();
}

function serializeSafeError(error) {
  if (!error) {
    return null;
  }

  return {
    name:
      error.name ||
      'Error',

    code:
      error.code ||
      null,

    message:
      error.message ||
      'Unknown error',

    phase:
      error.phase ||
      null,
  };
}

function getContextConfiguration(context = {}) {
  return (
    context?.configuration ??
    context?.config ??
    context?.servicesContext?.configuration ??
    context?.servicesContext?.config ??
    context?.serviceContext?.configuration ??
    context?.serviceContext?.config ??
    null
  );
}

function getContextEnvironment(context = {}) {
  return (
    context?.environment ??
    context?.configuration?.environment ??
    context?.config?.environment ??
    null
  );
}

function getContextLogger(context = {}) {
  return (
    context?.logger ??
    context?.servicesContext?.logger ??
    context?.serviceContext?.logger ??
    null
  );
}

function getContextApplication(context = {}) {
  return (
    context?.app ??
    context?.application ??
    context?.servicesContext?.app ??
    context?.serviceContext?.app ??
    null
  );
}

/**
 * =============================================================================
 * MODULE NORMALIZATION
 * =============================================================================
 */

function hasSupportedContract(
  value,
  methods = [],
) {
  if (!value) {
    return false;
  }

  if (
    isFunction(value) ||
    isExpressRouterLike(value)
  ) {
    return true;
  }

  return methods.some(
    method => isFunction(value?.[method]),
  );
}

function unwrapModule(
  value,
  methods = [],
) {
  if (!value) {
    return value;
  }

  const defaultExport = value.default;

  if (
    defaultExport !== undefined &&
    defaultExport !== null &&
    hasSupportedContract(
      defaultExport,
      methods,
    )
  ) {
    return defaultExport;
  }

  if (
    value.__esModule &&
    defaultExport !== undefined
  ) {
    return defaultExport;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      value,
      'default',
    ) &&
    Object.keys(value).length === 1
  ) {
    return defaultExport;
  }

  return value;
}

async function importModule(
  specifier,
  {
    required = false,
    label = specifier,
    methods = [],
  } = {},
) {
  try {
    const imported = await import(
      specifier
    );

    return unwrapModule(
      imported,
      methods,
    );
  } catch (error) {
    const code = error?.code;

    /*
     * Native ESM should be authoritative. CommonJS compatibility is attempted
     * only when Node explicitly reports a module-format incompatibility.
     */
    if (
      !COMMONJS_FALLBACK_ERROR_CODES.has(
        code,
      )
    ) {
      if (
        !required &&
        code ===
          'ERR_MODULE_NOT_FOUND'
      ) {
        return null;
      }

      throw error;
    }

    try {
      const legacy = require(
        specifier,
      );

      return unwrapModule(
        legacy,
        methods,
      );
    } catch (legacyError) {
      if (!required) {
        return null;
      }

      throw new RoutesBootstrapError(
        `Failed to load ${label}.`,
        {
          code:
            'ROUTES_DEPENDENCY_LOAD_FAILED',
          phase: 'routes',
          cause: legacyError,
          details: {
            specifier,
            importError:
              serializeSafeError(error),
          },
        },
      );
    }
  }
}

async function loadOptionalDependencies() {
  if (
    readinessModule === null
  ) {
    try {
      readinessModule =
        await importModule(
          './readinessState.js',
          {
            required: false,
            label:
              'TITech readiness integration',
            methods: [
              'register',
            ],
          },
        );
    } catch (error) {
      readinessModule = null;

      emitObservabilityEvent(
        'routes.readiness.load_failed',
        {
          error:
            serializeSafeError(error),
        },
      );
    }
  }

  if (
    observabilityModule === null
  ) {
    try {
      observabilityModule =
        await importModule(
          './observability.js',
          {
            required: false,
            label:
              'TITech observability integration',
            methods: [
              'emitEvent',
            ],
          },
        );
    } catch {
      observabilityModule = null;
    }
  }

  if (
    authModule === null &&
    authModuleLoadError === null
  ) {
    try {
      authModule =
        await importModule(
          '../middleware/auth.js',
          {
            required: true,
            label:
              'TITech authentication middleware',
            methods:
              AUTH_CONFIGURATION_METHODS,
          },
        );
    } catch (error) {
      /*
       * Preserve the exact dependency failure. Authentication is required
       * during route composition and will produce a deterministic bootstrap
       * failure when binding is attempted.
       */
      authModuleLoadError = error;
      authModule = null;
    }
  }
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
  const enriched = {
    component: COMPONENT,
    service: SERVICE_NAME,
    event,
    timestamp: nowIso(),
    ...payload,
  };

  try {
    let result = null;

    const emitter =
      observabilityModule?.observability
        ?.emitEvent ??
      observabilityModule?.emitEvent;

    if (isFunction(emitter)) {
      const target =
        observabilityModule?.observability &&
        isFunction(
          observabilityModule
            .observability
            .emitEvent,
        )
          ? observabilityModule
              .observability
              .emitEvent
          : observabilityModule.emitEvent;

      result = target(
        event,
        enriched,
      );
    }

    if (isPromiseLike(result)) {
      void Promise.resolve(result).catch(
        () => undefined,
      );
    }

    return result;
  } catch {
    /*
     * Telemetry must never break application startup/shutdown.
     */
    return null;
  }
}

/**
 * =============================================================================
 * APPLICATION VALIDATION
 * =============================================================================
 */

function assertApplication(value) {
  if (
    !value ||
    !isFunction(value.use)
  ) {
    throw new RoutesBootstrapError(
      'A valid Express-compatible application instance is required.',
      {
        code:
          'ROUTES_APPLICATION_INVALID',
        phase: 'routes',
      },
    );
  }
}

/**
 * =============================================================================
 * ROUTER DETECTION
 * =============================================================================
 */

function isExpressRouterLike(candidate) {
  if (!candidate) {
    return false;
  }

  return (
    isFunction(candidate.use) ||
    Array.isArray(candidate.stack)
  );
}

function findRouter(candidate) {
  if (!candidate) {
    return null;
  }

  if (
    isExpressRouterLike(candidate)
  ) {
    return candidate;
  }

  const candidates = [
    candidate.router,
    candidate.routes,
    candidate.apiRouter,
    candidate.httpRouter,
    candidate.default,
  ];

  for (const item of candidates) {
    if (
      isExpressRouterLike(item)
    ) {
      return item;
    }
  }

  return null;
}

/**
 * =============================================================================
 * ROUTE REGISTRATION CONTRACT
 * =============================================================================
 */

function findRegistrationFunction(
  candidate,
) {
  if (!candidate) {
    return null;
  }

  for (
    const method of
      ROUTE_REGISTRATION_METHODS
  ) {
    if (
      isFunction(
        candidate[method],
      )
    ) {
      return {
        name: method,
        fn: candidate[
          method
        ].bind(candidate),
      };
    }
  }

  return null;
}

function assertRouteContract(value) {
  if (!value) {
    throw new RoutesBootstrapError(
      'TITech route implementation is unavailable.',
      {
        code:
          'ROUTES_IMPLEMENTATION_UNAVAILABLE',
        phase: 'routes',
      },
    );
  }

  const registration =
    findRegistrationFunction(
      value,
    );

  const resolvedRouter =
    findRouter(value);

  const callable =
    isFunction(value);

  if (
    !registration &&
    !resolvedRouter &&
    !callable
  ) {
    throw new RoutesBootstrapError(
      'TITech route module does not expose a supported registration or router contract.',
      {
        code:
          'ROUTES_IMPLEMENTATION_INVALID',
        phase: 'routes',
        details: {
          supportedContracts: [
            'registerRoutes(app, context)',
            'mountRoutes(app, context)',
            'configureRoutes(app, context)',
            'initializeRoutes(app, context)',
            'Express Router export',
            'Callable route module(app, context)',
          ],
        },
      },
    );
  }
}

/**
 * =============================================================================
 * ROUTE MODULE RESOLUTION
 * =============================================================================
 */

function isCandidateMissing(
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
    String(error?.message || '');

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

async function resolveRouteModule() {
  if (routeModule) {
    return {
      module: routeModule,
      path: routeModulePath,
    };
  }

  const failures = [];

  for (
    const candidate of
      ROUTE_MODULE_CANDIDATES
  ) {
    let importError = null;

    try {
      const loaded =
        await import(candidate);

      const normalized =
        unwrapModule(
          loaded,
          ROUTE_REGISTRATION_METHODS,
        );

      if (!normalized) {
        throw new RoutesBootstrapError(
          'TITech route module resolved to an empty export.',
          {
            code:
              'ROUTES_MODULE_EMPTY',
            phase: 'routes',
            details: {
              candidate,
            },
          },
        );
      }

      assertRouteContract(
        normalized,
      );

      routeModule = normalized;

      routeModulePath = candidate;

      return {
        module: routeModule,
        path: routeModulePath,
      };
    } catch (error) {
      importError = error;

      if (
        isCandidateMissing(
          error,
          candidate,
        )
      ) {
        continue;
      }

      /*
       * Do not conceal real dependency/runtime errors behind route discovery.
       */
      if (
        !COMMONJS_FALLBACK_ERROR_CODES.has(
          error?.code,
        )
      ) {
        throw new RoutesBootstrapError(
          'Failed to import the TITech route module.',
          {
            code:
              'ROUTES_MODULE_IMPORT_FAILED',
            phase: 'routes',
            cause: error,
            details: {
              candidate,
            },
          },
        );
      }
    }

    /*
     * Genuine legacy CommonJS compatibility.
     */
    try {
      const legacyLoaded =
        require(candidate);

      const normalized =
        unwrapModule(
          legacyLoaded,
          ROUTE_REGISTRATION_METHODS,
        );

      if (!normalized) {
        throw new RoutesBootstrapError(
          'TITech legacy route module resolved to an empty export.',
          {
            code:
              'ROUTES_MODULE_EMPTY',
            phase: 'routes',
            details: {
              candidate,
            },
          },
        );
      }

      assertRouteContract(
        normalized,
      );

      routeModule = normalized;

      routeModulePath =
        `${candidate}:commonjs`;

      return {
        module: routeModule,
        path: routeModulePath,
      };
    } catch (requireError) {
      failures.push({
        candidate,
        importError:
          serializeSafeError(
            importError,
          ),
        requireError:
          serializeSafeError(
            requireError,
          ),
      });

      /*
       * A found module which fails evaluation must not be silently skipped.
       */
      if (
        !isCandidateMissing(
          requireError,
          candidate,
        ) &&
        requireError?.code !==
          'MODULE_NOT_FOUND'
      ) {
        throw new RoutesBootstrapError(
          'Failed to load the TITech legacy route module.',
          {
            code:
              'ROUTES_MODULE_LOAD_FAILED',
            phase: 'routes',
            cause: requireError,
            details: {
              candidate,
              importError:
                serializeSafeError(
                  importError,
                ),
            },
          },
        );
      }
    }
  }

  throw new RoutesBootstrapError(
    'No TITech route module could be resolved.',
    {
      code:
        'ROUTES_MODULE_NOT_FOUND',
      phase: 'routes',
      details: {
        candidates:
          ROUTE_MODULE_CANDIDATES,
        failures,
      },
    },
  );
}

/**
 * =============================================================================
 * ROUTE COUNT
 * =============================================================================
 */

function inspectRouteCount(target) {
  try {
    if (
      Array.isArray(
        target?.router?.stack,
      )
    ) {
      return target.router.stack.length;
    }

    if (
      Array.isArray(
        target?._router?.stack,
      )
    ) {
      return target._router.stack.length;
    }

    if (
      Array.isArray(target?.stack)
    ) {
      return target.stack.length;
    }
  } catch {
    /*
     * Diagnostics must never throw.
     */
  }

  return 0;
}

/**
 * =============================================================================
 * ROUTE CONFIGURATION
 * =============================================================================
 */

function resolveRouteConfiguration(
  context = {},
  options = {},
) {
  const config =
    getContextConfiguration(
      context,
    ) || {};

  const environment =
    getContextEnvironment(
      context,
    ) || {};

  const routeConfig =
    config.routes ??
    config.routing ??
    {};

  return Object.freeze({
    enabled:
      options.enabled !== undefined
        ? Boolean(options.enabled)
        : routeConfig.enabled !==
            undefined
          ? Boolean(
              routeConfig.enabled,
            )
          : true,

    apiPrefix:
      normalizeString(
        options.apiPrefix,
        normalizeString(
          routeConfig.apiPrefix,
          process.env.API_PREFIX ||
            DEFAULT_API_PREFIX,
        ),
      ),

    healthPrefix:
      normalizeString(
        options.healthPrefix,
        normalizeString(
          routeConfig.healthPrefix,
          process.env.HEALTH_PREFIX ||
            DEFAULT_HEALTH_PREFIX,
        ),
      ),

    metricsPath:
      normalizeString(
        options.metricsPath,
        normalizeString(
          routeConfig.metricsPath,
          process.env.METRICS_PATH ||
            DEFAULT_METRICS_PATH,
        ),
      ),

    versionPrefix:
      options.versionPrefix ??
      routeConfig.versionPrefix ??
      process.env.API_VERSION_PREFIX ??
      '',

    environment:
      environment?.runtime?.nodeEnv ??
      environment?.app?.nodeEnv ??
      environment?.app?.environment ??
      process.env.NODE_ENV ??
      'development',
  });
}

/**
 * =============================================================================
 * AUTHENTICATION CONFIGURATION
 * =============================================================================
 */

async function bindAuthenticationConfiguration(
  context = {},
) {
  await loadOptionalDependencies();

  const configuration =
    getContextConfiguration(
      context,
    );

  const environment =
    getContextEnvironment(
      context,
    );

  const logger =
    getContextLogger(context);

  if (!configuration) {
    throw new RoutesBootstrapError(
      'TITech application configuration is unavailable while composing authentication.',
      {
        code:
          'ROUTES_AUTH_CONFIGURATION_UNAVAILABLE',
        phase: 'routes',
      },
    );
  }

  if (!authModule) {
    throw new RoutesBootstrapError(
      'TITech authentication middleware is unavailable.',
      {
        code:
          'ROUTES_AUTH_MODULE_UNAVAILABLE',
        phase: 'routes',
        cause:
          authModuleLoadError,
      },
    );
  }

  const methodName =
    AUTH_CONFIGURATION_METHODS.find(
      name =>
        isFunction(
          authModule[name],
        ),
    );

  /*
   * Older authentication implementations may configure themselves and not
   * expose an explicit composition hook.
   */
  if (!methodName) {
    authenticationConfigured = false;
    authenticationConfigurationTarget =
      null;

    emitObservabilityEvent(
      'authentication.configuration.binding_skipped',
      {
        reason:
          'legacy_contract_not_supported',
      },
    );

    return false;
  }

  if (
    authenticationConfigured &&
    authenticationConfigurationTarget ===
      configuration
  ) {
    return true;
  }

  try {
    const result =
      authModule[methodName]({
        configuration,
        config: configuration,
        environment,
        logger,
      });

    if (isPromiseLike(result)) {
      throw new RoutesBootstrapError(
        'TITech authentication configuration binding must be synchronous.',
        {
          code:
            'ROUTES_AUTH_CONFIGURATION_BIND_ASYNC',
          phase: 'routes',
        },
      );
    }

    authenticationConfigured = true;

    authenticationConfigurationTarget =
      configuration;

    emitObservabilityEvent(
      'authentication.configuration.bound',
      {
        method: methodName,
        configured: true,
      },
    );

    return true;
  } catch (error) {
    authenticationConfigured = false;

    authenticationConfigurationTarget =
      null;

    if (
      error instanceof
      RoutesBootstrapError
    ) {
      throw error;
    }

    throw new RoutesBootstrapError(
      'Failed to bind TITech authentication configuration during route composition.',
      {
        code:
          'ROUTES_AUTH_CONFIGURATION_BIND_FAILED',
        phase: 'routes',
        cause: error,
      },
    );
  }
}

/**
 * =============================================================================
 * READINESS
 * =============================================================================
 */

async function registerReadinessDependency(
  context = {},
  options = {},
) {
  await loadOptionalDependencies();

  if (
    !readinessModule ||
    !isFunction(
      readinessModule.register,
    )
  ) {
    return null;
  }

  if (
    isFunction(readinessModule.has) &&
    readinessModule.has(COMPONENT)
  ) {
    return null;
  }

  try {
    return readinessModule.register({
      name: COMPONENT,

      severity:
        options.readinessSeverity ||
        'required',

      enabled:
        options.enabled !== false,

      timeoutMs:
        Number.isInteger(
          options.readinessTimeoutMs,
        ) &&
        options.readinessTimeoutMs > 0
          ? options.readinessTimeoutMs
          : DEFAULT_READINESS_TIMEOUT_MS,

      readiness: async () => ({
        ready: isReady(),
        routes: routeCount,
      }),

      health: async () =>
        health(),

      metadata: {
        component: COMPONENT,
        service: SERVICE_NAME,
      },
    });
  } catch (error) {
    lastError = error;

    emitObservabilityEvent(
      'routes.readiness_registration_failed',
      {
        error:
          serializeSafeError(
            error,
          ),
      },
    );

    /*
     * Readiness integration is auxiliary. The route lifecycle itself remains
     * authoritative.
     */
    return null;
  }
}

/**
 * =============================================================================
 * APPLICATION / ROUTE INJECTION
 * =============================================================================
 */

function setApplication(app) {
  assertApplication(app);

  if (
    mounted &&
    application &&
    application !== app
  ) {
    throw new RoutesBootstrapError(
      'Cannot replace the application after routes have been mounted.',
      {
        code:
          'ROUTES_APPLICATION_LOCKED',
        phase: 'routes',
      },
    );
  }

  application = app;

  return application;
}

function setRouteModule(
  value,
  options = {},
) {
  if (mounted) {
    throw new RoutesBootstrapError(
      'Cannot replace the route module after routes have been mounted.',
      {
        code:
          'ROUTES_MODULE_LOCKED',
        phase: 'routes',
      },
    );
  }

  const normalized =
    unwrapModule(
      value,
      ROUTE_REGISTRATION_METHODS,
    );

  assertRouteContract(
    normalized,
  );

  routeModule = normalized;

  routeModulePath =
    options.path ||
    'provided:route-module';

  routeRegistrationMode = null;

  return routeModule;
}

/**
 * =============================================================================
 * APPLICATION/CONTEXT SAFETY
 * =============================================================================
 */

function buildRouteContext(
  context = {},
  app,
  routeConfig,
) {
  return Object.freeze({
    ...context,

    application: app,

    app,

    configuration:
      getContextConfiguration(
        context,
      ),

    config:
      getContextConfiguration(
        context,
      ),

    environment:
      getContextEnvironment(
        context,
      ),

    logger:
      getContextLogger(context),

    routes: routeConfig,
  });
}

/**
 * =============================================================================
 * ROUTE MOUNTING
 * =============================================================================
 */

async function mountRoutes(
  app,
  context = {},
  options = {},
) {
  assertApplication(app);

  const routeConfig =
    resolveRouteConfiguration(
      context,
      options,
    );

  if (!routeConfig.enabled) {
    return {
      enabled: false,
      mounted: false,
      reason: 'disabled',
      path: routeModulePath,
      routeCount: 0,
    };
  }

  /*
   * Critical ordering:
   *
   *   configuration
   *        ↓
   *   authentication binding
   *        ↓
   *   route module import
   *        ↓
   *   route registration
   */
  await bindAuthenticationConfiguration(
    context,
  );

  const resolved =
    routeModule
      ? {
          module: routeModule,
          path: routeModulePath,
        }
      : await resolveRouteModule();

  const module =
    resolved.module;

  assertRouteContract(module);

  const routeContext =
    buildRouteContext(
      context,
      app,
      routeConfig,
    );

  const registration =
    findRegistrationFunction(module);

  if (registration) {
    const result =
      await registration.fn(
        app,
        routeContext,
      );

    router =
      findRouter(result) ||
      findRouter(module) ||
      router;

    routeRegistrationMode =
      registration.name;

    routeCount = Math.max(
      inspectRouteCount(app),
      inspectRouteCount(result),
      inspectRouteCount(router),
      routeCount,
    );

    return {
      enabled: true,
      mounted: true,
      mode: registration.name,
      path: resolved.path,
      routeCount,
      result,
    };
  }

  /*
   * Direct Express Router.
   */
  const resolvedRouter =
    findRouter(module);

  if (resolvedRouter) {
    const mountPath =
      normalizeString(
        options.mountPath,
        routeConfig.apiPrefix ||
          '/',
      );

    app.use(
      mountPath,
      resolvedRouter,
    );

    router =
      resolvedRouter;

    routeRegistrationMode =
      'router';

    routeCount = Math.max(
      inspectRouteCount(
        resolvedRouter,
      ),
      inspectRouteCount(app),
      routeCount,
    );

    return {
      enabled: true,
      mounted: true,
      mode: 'router',
      mountPath,
      path: resolved.path,
      routeCount,
    };
  }

  /*
   * Callable route module.
   */
  if (isFunction(module)) {
    const result =
      await module(
        app,
        routeContext,
      );

    router =
      findRouter(result) ||
      findRouter(module) ||
      router;

    routeRegistrationMode =
      'function';

    routeCount = Math.max(
      inspectRouteCount(app),
      inspectRouteCount(result),
      inspectRouteCount(router),
      routeCount,
    );

    return {
      enabled: true,
      mounted: true,
      mode: 'function',
      path: resolved.path,
      routeCount,
      result,
    };
  }

  throw new RoutesBootstrapError(
    'TITech route module could not be mounted using a supported contract.',
    {
      code:
        'ROUTES_MOUNT_CONTRACT_FAILED',
      phase: 'routes',
    },
  );
}

/**
 * =============================================================================
 * LIFECYCLE START
 * =============================================================================
 *
 * Safe restart semantics:
 *
 *   A route tree cannot be generically "unmounted" from Express.
 *
 *   Therefore:
 *
 *     start → mount
 *     stop  → logical stop
 *     start → resume existing mounted tree
 *
 * This prevents accidental duplicate app.use()/router mounting.
 */

async function ensureStarted(
  context = {},
  options = {},
) {
  if (
    mounted &&
    !stopped &&
    !failed
  ) {
    return {
      app: application,
      router,
      routeCount,
      authenticationConfigured,
      resumed: false,
    };
  }

  if (
    mounted &&
    stopped &&
    !failed
  ) {
    stopped = false;
    failed = false;

    stoppedAt = null;

    setLifecycleState(
      ROUTE_LIFECYCLE_STATES.MOUNTED,
    );

    emitObservabilityEvent(
      'routes.resumed',
      {
        routeCount,
        modulePath:
          routeModulePath,
        registrationMode:
          routeRegistrationMode,
        authenticationConfigured,
      },
    );

    return {
      app: application,
      router,
      routeCount,
      authenticationConfigured,
      resumed: true,
    };
  }

  if (startPromise) {
    return startPromise;
  }

  if (stopPromise) {
    await stopPromise;
  }

  startPromise = (async () => {
    setLifecycleState(
      ROUTE_LIFECYCLE_STATES.STARTING,
    );

    failed = false;

    try {
      const targetApp =
        getContextApplication(
          context,
        ) ||
        options.app ||
        application;

      assertApplication(targetApp);

      application = targetApp;

      const result =
        await mountRoutes(
          targetApp,
          context,
          options,
        );

      mounted =
        result.mounted === true;

      stopped = false;

      failed = false;

      registered = true;

      stoppedAt = null;

      mountedAt = mounted
        ? new Date()
        : null;

      routeCount = Math.max(
        routeCount,
        result.routeCount || 0,
        inspectRouteCount(
          targetApp,
        ),
      );

      lastError = null;

      setLifecycleState(
        mounted
          ? ROUTE_LIFECYCLE_STATES.MOUNTED
          : ROUTE_LIFECYCLE_STATES.STOPPED,
      );

      emitObservabilityEvent(
        'routes.mounted',
        {
          routeCount,
          modulePath:
            routeModulePath,
          registrationMode:
            routeRegistrationMode,
          authenticationConfigured,
        },
      );

      return result;
    } catch (error) {
      mounted = false;

      failed = true;

      lastError = error;

      setLifecycleState(
        ROUTE_LIFECYCLE_STATES.FAILED,
      );

      emitObservabilityEvent(
        'routes.mount_failed',
        {
          error:
            serializeSafeError(
              error,
            ),
          modulePath:
            routeModulePath,
        },
      );

      throw wrapError(
        error,
        'ROUTES_MOUNT_FAILED',
        'startup',
        'TITech route mounting failed.',
      );
    } finally {
      startPromise = null;
    }
  })();

  return startPromise;
}

/**
 * =============================================================================
 * LIFECYCLE STOP
 * =============================================================================
 *
 * Express has no safe generic public API for removing arbitrary route trees.
 *
 * Therefore this adapter performs a logical stop/readiness transition rather
 * than physically deleting route registrations.
 *
 * The mounted tree is preserved so a later start can resume it safely without
 * duplicating routes.
 */

async function ensureStopped() {
  if (
    stopped &&
    mounted &&
    !failed
  ) {
    return true;
  }

  if (
    stopPromise
  ) {
    return stopPromise;
  }

  if (startPromise) {
    try {
      await startPromise;
    } catch {
      /*
       * Preserve the startup failure while completing shutdown bookkeeping.
       */
    }
  }

  stopPromise = (async () => {
    setLifecycleState(
      ROUTE_LIFECYCLE_STATES.STOPPING,
    );

    try {
      if (!mounted) {
        stopped = true;

        failed = false;

        stoppedAt = new Date();

        setLifecycleState(
          ROUTE_LIFECYCLE_STATES.STOPPED,
        );

        return true;
      }

      /*
       * Do not remove Express route registrations.
       *
       * The HTTP server owns actual socket lifecycle.
       */
      stopped = true;

      failed = false;

      stoppedAt = new Date();

      setLifecycleState(
        ROUTE_LIFECYCLE_STATES.STOPPED,
      );

      emitObservabilityEvent(
        'routes.unmounted',
        {
          routeCount,
          note:
            'logical_route_shutdown',
        },
      );

      return true;
    } catch (error) {
      failed = true;

      stopped = false;

      lastError = error;

      setLifecycleState(
        ROUTE_LIFECYCLE_STATES.FAILED,
      );

      emitObservabilityEvent(
        'routes.stop_failed',
        {
          error:
            serializeSafeError(error),
        },
      );

      throw wrapError(
        error,
        'ROUTES_STOP_FAILED',
        'shutdown',
        'TITech routes shutdown failed.',
      );
    } finally {
      stopPromise = null;
    }
  })();

  return stopPromise;
}

/**
 * =============================================================================
 * BOOTSTRAP HOOK REGISTRATION
 * =============================================================================
 */

function registerRoutesHooks(
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
        : null;

    return registrationResult;
  }

  const contextApp =
    getContextApplication(
      context,
    );

  if (options.app) {
    setApplication(options.app);
  } else if (contextApp) {
    setApplication(contextApp);
  }

  /*
   * Authentication and readiness are intentionally resolved during the async
   * start phase. This keeps hook registration synchronous and avoids hidden
   * promise work during module/bootstrap discovery.
   */
  if (!isFunction(lifecycle)) {
    throw new RoutesBootstrapError(
      'TITech bootstrap lifecycle registrar is unavailable.',
      {
        code:
          'ROUTES_LIFECYCLE_UNAVAILABLE',
        phase: 'routes',
      },
    );
  }

  /*
   * Readiness registration is optional and asynchronous. It is deliberately
   * initiated without making hook registration itself asynchronous.
   */
  void registerReadinessDependency(
    context,
    options,
  ).catch(error => {
    lastError = error;

    emitObservabilityEvent(
      'routes.readiness_registration_failed',
      {
        error:
          serializeSafeError(error),
      },
    );
  });

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
          Number.isInteger(
            options.timeoutMs,
          ) &&
          options.timeoutMs > 0
            ? options.timeoutMs
            : DEFAULT_TIMEOUT_MS,

        critical:
          options.critical !== false,

        enabled:
          options.enabled !== false,

        metadata: {
          component: COMPONENT,
          service: SERVICE_NAME,
          implementation:
            routeModulePath ||
            'backend/routes',
        },

        start: async hookContext =>
          ensureStarted(
            hookContext || context,
            options,
          ),

        ready: async () =>
          isReady(),

        health: async () =>
          health(),

        stop: async () =>
          ensureStopped(),
      },
    );

  registered = true;

  return registrationResult;
}

function registerBootstrapHooks(
  context = {},
  options = {},
) {
  return registerRoutesHooks(
    context,
    options,
  );
}

/**
 * =============================================================================
 * EXPLICIT INITIALIZATION
 * =============================================================================
 */

async function initialize(
  app,
  context = {},
  options = {},
) {
  /*
   * initialize(context, options)
   */
  if (
    app &&
    !isFunction(app.use) &&
    isObjectLike(app)
  ) {
    options = context || {};

    context = app;

    app =
      getContextApplication(
        context,
      );
  }

  if (app) {
    setApplication(app);
  }

  if (!application) {
    const contextApp =
      getContextApplication(
        context,
      );

    if (contextApp) {
      setApplication(contextApp);
    }
  }

  assertApplication(application);

  const effectiveContext = {
    ...context,

    app: application,

    application,

    configuration:
      getContextConfiguration(
        context,
      ),

    config:
      getContextConfiguration(
        context,
      ),
  };

  const effectiveOptions = {
    ...options,
    app: application,
  };

  return ensureStarted(
    effectiveContext,
    effectiveOptions,
  );
}

async function start(
  app,
  context = {},
  options = {},
) {
  return initialize(
    app,
    context,
    options,
  );
}

/**
 * =============================================================================
 * SHUTDOWN
 * =============================================================================
 */

async function shutdown() {
  return ensureStopped();
}

async function stop() {
  return shutdown();
}

/**
 * =============================================================================
 * RUNTIME ACCESS
 * =============================================================================
 */

function getApplication() {
  return application;
}

function getRouter() {
  return router;
}

function getRouteModule() {
  return routeModule;
}

function getRouteCount() {
  return routeCount;
}

function isRegistered() {
  return registered;
}

function isMounted() {
  return mounted && !stopped;
}

function isStopped() {
  return stopped;
}

function isFailed() {
  return (
    failed ||
    lifecycleState ===
      ROUTE_LIFECYCLE_STATES.FAILED
  );
}

function isReady() {
  return (
    lifecycleState ===
      ROUTE_LIFECYCLE_STATES.MOUNTED &&
    mounted &&
    !stopped &&
    !failed
  );
}

/**
 * =============================================================================
 * HEALTH / READINESS
 * =============================================================================
 */

async function readiness() {
  const ready = isReady();

  return {
    ready,

    status:
      ready
        ? 'ready'
        : failed
          ? 'not_ready'
          : stopped
            ? 'stopped'
            : 'not_ready',

    routes: routeCount,

    component: COMPONENT,

    service: SERVICE_NAME,

    state: lifecycleState,

    modulePath: routeModulePath,

    registrationMode:
      routeRegistrationMode,

    authenticationConfigured,
  };
}

async function health() {
  return {
    status:
      failed
        ? 'unhealthy'
        : stopped
          ? 'stopped'
          : mounted
            ? 'healthy'
            : 'not_ready',

    ready: isReady(),

    component: COMPONENT,

    service: SERVICE_NAME,

    state: lifecycleState,

    routeCount,

    modulePath: routeModulePath,

    registrationMode:
      routeRegistrationMode,

    authenticationConfigured,

    applicationAvailable:
      Boolean(application),

    routerAvailable:
      Boolean(router),
  };
}

/**
 * =============================================================================
 * DIAGNOSTICS
 * =============================================================================
 */

function getState() {
  return Object.freeze({
    component: COMPONENT,

    service: SERVICE_NAME,

    state: lifecycleState,

    registered,

    mounted,

    stopped,

    failed,

    ready: isReady(),

    routeCount,

    modulePath:
      routeModulePath,

    registrationMode:
      routeRegistrationMode,

    authenticationConfigured,

    applicationAvailable:
      Boolean(application),

    routerAvailable:
      Boolean(router),

    mountedAt,

    stoppedAt,

    lastTransitionAt,

    lastError:
      serializeSafeError(lastError),
  });
}

function snapshot() {
  return Object.freeze({
    ...getState(),

    lifecycle:
      ROUTE_LIFECYCLE_STATES,

    routeCandidates:
      ROUTE_MODULE_CANDIDATES,
  });
}

function getDiagnostics() {
  return snapshot();
}

/**
 * =============================================================================
 * RESET
 * =============================================================================
 *
 * reset() is a local adapter-state reset.
 *
 * It must never be used while the route lifecycle is active.
 *
 * If the external bootstrap hook registry supports unregister/remove semantics,
 * that should be performed by the lifecycle manager itself.
 */

function reset() {
  if (
    mounted ||
    lifecycleState ===
      ROUTE_LIFECYCLE_STATES.STARTING ||
    lifecycleState ===
      ROUTE_LIFECYCLE_STATES.STOPPING
  ) {
    throw new RoutesBootstrapError(
      'Cannot reset route bootstrap while routes are active or transitioning.',
      {
        code:
          'ROUTES_RESET_NOT_ALLOWED',
        phase: 'routes',
      },
    );
  }

  application = null;

  router = null;

  routeModule = null;

  routeModulePath = null;

  routeRegistrationMode = null;

  registered = false;

  lifecycleState =
    ROUTE_LIFECYCLE_STATES.IDLE;

  mounted = false;

  stopped = false;

  failed = false;

  registrationResult = null;

  startPromise = null;

  stopPromise = null;

  lastError = null;

  lastTransitionAt = null;

  routeCount = 0;

  mountedAt = null;

  stoppedAt = null;

  authenticationConfigured = false;

  authenticationConfigurationTarget =
    null;

  readinessModule = null;

  observabilityModule = null;

  authModule = null;

  authModuleLoadError = null;

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
    error instanceof RoutesBootstrapError
  ) {
    return error;
  }

  return new RoutesBootstrapError(
    message,
    {
      code,
      phase,
      cause: error,
    },
  );
}

/**
 * =============================================================================
 * EXPORTS
 * =============================================================================
 */

const routesModule = Object.freeze({
  registerRoutesHooks,
  registerBootstrapHooks,
  bootstrap:
    registerBootstrapHooks,

  setApplication,
  setRouteModule,
  mountRoutes,

  initialize,
  start,
  shutdown,
  stop,

  getApplication,
  getRouter,
  getRouteModule,
  getRouteCount,

  getState,
  getDiagnostics,
  snapshot,

  isRegistered,
  isMounted,
  isStopped,
  isFailed,
  isReady,

  readiness,
  health,

  resolveRouteConfiguration,
  bindAuthenticationConfiguration,

  reset,

  RoutesBootstrapError,

  COMPONENT,
  SERVICE_NAME,

  DEFAULT_API_PREFIX,
  DEFAULT_HEALTH_PREFIX,
  DEFAULT_METRICS_PATH,

  ROUTE_MODULE_CANDIDATES,
  ROUTE_REGISTRATION_METHODS,
  AUTH_CONFIGURATION_METHODS,

  ROUTE_LIFECYCLE_STATES,
});

export {
  routesModule,
  RoutesBootstrapError,

  registerRoutesHooks,
  registerBootstrapHooks,

  setApplication,
  setRouteModule,
  mountRoutes,

  initialize,
  start,
  shutdown,
  stop,

  getApplication,
  getRouter,
  getRouteModule,
  getRouteCount,

  getState,
  getDiagnostics,
  snapshot,

  isRegistered,
  isMounted,
  isStopped,
  isFailed,
  isReady,

  readiness,
  health,

  resolveRouteConfiguration,
  bindAuthenticationConfiguration,

  reset,

  COMPONENT,
  SERVICE_NAME,

  DEFAULT_API_PREFIX,
  DEFAULT_HEALTH_PREFIX,
  DEFAULT_METRICS_PATH,

  ROUTE_MODULE_CANDIDATES,
  ROUTE_REGISTRATION_METHODS,
  AUTH_CONFIGURATION_METHODS,

  ROUTE_LIFECYCLE_STATES,
};

export default routesModule;