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
 *   - Resolve the authoritative application configuration.
 *   - Bind authentication configuration before loading route modules.
 *   - Load the canonical route registry deterministically.
 *   - Mount existing routes without replacing their implementation.
 *   - Prevent duplicate initialization / mounting.
 *   - Support multiple legacy route registration contracts.
 *   - Integrate readiness.
 *   - Integrate observability without making startup dependent on telemetry.
 *   - Provide deterministic route diagnostics.
 *   - Support graceful shutdown semantics.
 *
 * Architecture:
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
 *   middleware
 *       ↓
 *   authentication configuration binding
 *       ↓
 *   routes
 *       ↓
 *   HTTP server
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

const {
  hooks,
  lifecycle,
} = require('./hooks');

/**
 * -----------------------------------------------------------------------------
 * Optional readiness dependency
 * -----------------------------------------------------------------------------
 */

let readinessModule = null;

try {
  // eslint-disable-next-line global-require
  readinessModule =
    require('./readinessState');
} catch {
  readinessModule = null;
}

/**
 * -----------------------------------------------------------------------------
 * Optional observability dependency
 * -----------------------------------------------------------------------------
 */

let observabilityModule = null;

try {
  // eslint-disable-next-line global-require
  observabilityModule =
    require('./observability');
} catch {
  observabilityModule = null;
}

/**
 * -----------------------------------------------------------------------------
 * Authentication composition dependency
 * -----------------------------------------------------------------------------
 *
 * IMPORTANT:
 *
 * This import is intentionally safe because the enhanced auth middleware no
 * longer performs module-load-time JWT secret validation.
 *
 * The resolved bootstrap configuration is explicitly bound before the route
 * registry is loaded.
 * -----------------------------------------------------------------------------
 */

let authModule = null;

try {
  // eslint-disable-next-line global-require
  authModule =
    require('../middleware/auth');
} catch (error) {
  /**
   * Keep route bootstrap load-safe.
   *
   * If authentication middleware itself becomes unavailable, the actual route
   * phase will surface a deterministic dependency error.
   */
  authModule = {
    __loadError: error,
  };
}

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const COMPONENT =
  'routes';

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  'titech-community-capital-backend';

const DEFAULT_PRIORITY =
  100;

const DEFAULT_TIMEOUT_MS =
  30_000;

const DEFAULT_READINESS_TIMEOUT_MS =
  5_000;

const DEFAULT_DEPENDENCIES =
  Object.freeze([
    'middleware',
  ]);

const DEFAULT_API_PREFIX =
  '/api';

const DEFAULT_HEALTH_PREFIX =
  '/health';

const DEFAULT_METRICS_PATH =
  '/metrics';

const ROUTE_MODULE_CANDIDATES =
  Object.freeze([
    '../routes',
    '../routes/index',
    '../api/routes',
    '../api',
  ]);

const ROUTE_REGISTRATION_METHODS =
  Object.freeze([
    'registerRoutes',
    'mountRoutes',
    'configureRoutes',
    'initializeRoutes',
  ]);

/**
 * =============================================================================
 * ERROR
 * =============================================================================
 */

class RoutesBootstrapError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'RoutesBootstrapError';

    this.code =
      options.code ||
      'ROUTES_BOOTSTRAP_ERROR';

    this.phase =
      options.phase ||
      null;

    this.cause =
      options.cause ||
      null;

    this.details =
      Object.freeze({
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

let application =
  null;

let router =
  null;

let routeModule =
  null;

let routeModulePath =
  null;

let registered =
  false;

let mounted =
  false;

let stopped =
  false;

let failed =
  false;

let registrationResult =
  null;

let startPromise =
  null;

let stopPromise =
  null;

let lastError =
  null;

let routeCount =
  0;

let mountedAt =
  null;

let stoppedAt =
  null;

let authenticationConfigured =
  false;

/**
 * =============================================================================
 * UTILITY HELPERS
 * =============================================================================
 */

function isObjectLike(
  value,
) {
  return (
    value !== null &&
    typeof value === 'object'
  );
}

function isFunction(
  value,
) {
  return typeof value === 'function';
}

function normalizeString(
  value,
  fallback = null,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const normalized =
    String(value).trim();

  return (
    normalized ||
    fallback
  );
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
    Object.keys(value).length === 1
  ) {
    return value.default;
  }

  return value;
}

function getContextConfiguration(
  context = {},
) {
  return (
    context?.configuration ??
    context?.config ??
    context?.servicesContext?.config ??
    context?.serviceContext?.config ??
    null
  );
}

function getContextEnvironment(
  context = {},
) {
  return (
    context?.environment ??
    context?.configuration?.environment ??
    context?.config?.environment ??
    null
  );
}

function getContextLogger(
  context = {},
) {
  return (
    context?.logger ??
    context?.servicesContext?.logger ??
    context?.serviceContext?.logger ??
    null
  );
}

function getContextApplication(
  context = {},
) {
  return (
    context?.app ??
    context?.application ??
    null
  );
}

/**
 * =============================================================================
 * SAFE ERROR DIAGNOSTICS
 * =============================================================================
 *
 * Authentication tokens, JWT secrets, cookies and request headers are never
 * included here.
 */

function serializeSafeError(
  error,
) {
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
    const enriched =
      {
        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        event,

        ...payload,
      };

    if (
      observabilityModule
        ?.observability
        ?.emitEvent &&
      isFunction(
        observabilityModule
          .observability
          .emitEvent,
      )
    ) {
      return observabilityModule
        .observability
        .emitEvent(
          event,
          enriched,
        );
    }

    if (
      isFunction(
        observabilityModule?.emitEvent,
      )
    ) {
      return observabilityModule.emitEvent(
        event,
        enriched,
      );
    }
  } catch {
    /*
     * Observability must never block application startup/shutdown.
     */
  }

  return null;
}

/**
 * =============================================================================
 * ROUTE MODULE RESOLUTION
 * =============================================================================
 */

function resolveRouteModule() {
  if (
    routeModule
  ) {
    return {
      module:
        routeModule,

      path:
        routeModulePath,
    };
  }

  for (
    const candidate of
      ROUTE_MODULE_CANDIDATES
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

      const normalized =
        unwrapModule(
          loaded,
        );

      if (
        !normalized
      ) {
        throw new RoutesBootstrapError(
          'TITech route module resolved to an empty export.',
          {
            code:
              'ROUTES_MODULE_EMPTY',

            details: {
              candidate,
            },
          },
        );
      }

      routeModule =
        normalized;

      routeModulePath =
        candidate;

      return {
        module:
          routeModule,

        path:
          routeModulePath,
      };
    } catch (error) {
      /*
       * IMPORTANT:
       *
       * Preserve the original error as cause.
       *
       * This prevents the old "Failed to load route module" diagnostic
       * black-box problem where the useful dependency exception was lost.
       */

      throw new RoutesBootstrapError(
        'Failed to load the TITech route module.',
        {
          code:
            'ROUTES_MODULE_LOAD_FAILED',

          phase:
            'routes',

          cause:
            error,

          details: {
            candidate,
          },
        },
      );
    }
  }

  return {
    module:
      null,

    path:
      null,
  };
}

/**
 * =============================================================================
 * ROUTE CONTRACT DISCOVERY
 * =============================================================================
 */

function findRegistrationFunction(
  candidate,
) {
  if (
    !candidate
  ) {
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
        name:
          method,

        fn:
          candidate[method].bind(
            candidate,
          ),
      };
    }
  }

  return null;
}

function isExpressRouterLike(
  candidate,
) {
  if (
    !candidate
  ) {
    return false;
  }

  if (
    typeof candidate !==
    'function'
  ) {
    return (
      isFunction(
        candidate.use,
      ) ||
      Array.isArray(
        candidate.stack,
      )
    );
  }

  return (
    isFunction(
      candidate.use,
    ) ||
    Array.isArray(
      candidate.stack,
    )
  );
}

function findRouter(
  candidate,
) {
  if (
    !candidate
  ) {
    return null;
  }

  /*
   * Direct router export.
   */
  if (
    isExpressRouterLike(
      candidate,
    )
  ) {
    return candidate;
  }

  /*
   * Common named exports.
   */
  const candidates = [
    candidate.router,
    candidate.routes,
    candidate.apiRouter,
    candidate.httpRouter,
    candidate.default,
  ];

  for (
    const item of
      candidates
  ) {
    if (
      isExpressRouterLike(
        item,
      )
    ) {
      return item;
    }
  }

  return null;
}

/**
 * =============================================================================
 * VALIDATION
 * =============================================================================
 */

function assertApplication(
  value,
) {
  if (
    !value ||
    !isFunction(
      value.use,
    )
  ) {
    throw new RoutesBootstrapError(
      'A valid Express-compatible application instance is required.',
      {
        code:
          'ROUTES_APPLICATION_INVALID',

        phase:
          'routes',
      },
    );
  }
}

function assertRouteContract(
  value,
) {
  if (
    !value
  ) {
    throw new RoutesBootstrapError(
      'TITech route implementation is unavailable.',
      {
        code:
          'ROUTES_IMPLEMENTATION_UNAVAILABLE',

        phase:
          'routes',
      },
    );
  }

  const registration =
    findRegistrationFunction(
      value,
    );

  const resolvedRouter =
    findRouter(
      value,
    );

  const callable =
    isFunction(
      value,
    );

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

        phase:
          'routes',

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
 * ROUTE COUNT
 * =============================================================================
 */

function inspectRouteCount(
  target,
) {
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
      Array.isArray(
        target?.stack,
      )
    ) {
      return target.stack.length;
    }
  } catch {
    /*
     * Diagnostics only.
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
    config.routes ||
    config.routing ||
    {};

  const nodeEnv =
    normalizeString(
      process.env.NODE_ENV,
      'development',
    );

  return Object.freeze({
    enabled:
      options.enabled !== undefined
        ? Boolean(
            options.enabled,
          )
        : routeConfig.enabled !== undefined
          ? Boolean(
              routeConfig.enabled,
            )
          : true,

    apiPrefix:
      options.apiPrefix ||
      routeConfig.apiPrefix ||
      process.env.API_PREFIX ||
      DEFAULT_API_PREFIX,

    healthPrefix:
      options.healthPrefix ||
      routeConfig.healthPrefix ||
      process.env.HEALTH_PREFIX ||
      DEFAULT_HEALTH_PREFIX,

    metricsPath:
      options.metricsPath ||
      routeConfig.metricsPath ||
      process.env.METRICS_PATH ||
      DEFAULT_METRICS_PATH,

    versionPrefix:
      options.versionPrefix ??
      routeConfig.versionPrefix ??
      process.env.API_VERSION_PREFIX ??
      '',

    environment:
      environment?.runtime?.nodeEnv ||
      environment?.app?.nodeEnv ||
      environment?.app?.environment ||
      nodeEnv,
  });
}

/**
 * =============================================================================
 * AUTHENTICATION CONFIGURATION BINDING
 * =============================================================================
 *
 * This is the critical fix for the route startup failure discovered in:
 *
 *   routes/index.js
 *       ↓
 *   ../middleware/auth
 *       ↓
 *   JWT configuration
 *
 * The authoritative configuration is already available from bootstrap.
 *
 * We bind it into the auth module BEFORE require('../routes') is executed.
 *
 * The enhanced auth middleware still remains lazy and safe when imported
 * independently.
 * =============================================================================
 */

function bindAuthenticationConfiguration(
  context = {},
) {
  if (
    authenticationConfigured
  ) {
    return true;
  }

  if (
    !authModule
  ) {
    throw new RoutesBootstrapError(
      'TITech authentication middleware is unavailable.',
      {
        code:
          'ROUTES_AUTH_MODULE_UNAVAILABLE',

        phase:
          'routes',

        cause:
          authModule?.__loadError ||
          null,
      },
    );
  }

  const configuration =
    getContextConfiguration(
      context,
    );

  if (
    !configuration
  ) {
    throw new RoutesBootstrapError(
      'TITech application configuration is unavailable while composing authentication.',
      {
        code:
          'ROUTES_AUTH_CONFIGURATION_UNAVAILABLE',

        phase:
          'routes',
      },
    );
  }

  if (
    !isFunction(
      authModule.configureAuth,
    )
  ) {
    /*
     * Backward compatibility:
     *
     * The enhanced auth middleware makes configuration injection available,
     * but older auth modules can still be used if they resolve configuration
     * themselves.
     *
     * Do not silently mark the module configured in the modern path unless it
     * actually supports the contract.
     */
    authenticationConfigured =
      false;

    return false;
  }

  try {
    authModule.configureAuth({
      configuration,
      config:
        configuration,

      environment:
        getContextEnvironment(
          context,
        ),

      logger:
        getContextLogger(
          context,
        ),
    });

    authenticationConfigured =
      true;

    emitObservabilityEvent(
      'authentication.configuration.bound',
      {
        configured:
          true,

        /*
         * No secret values.
         */
        component:
          COMPONENT,
      },
    );

    return true;
  } catch (error) {
    throw new RoutesBootstrapError(
      'Failed to bind TITech authentication configuration during route composition.',
      {
        code:
          'ROUTES_AUTH_CONFIGURATION_BIND_FAILED',

        phase:
          'routes',

        cause:
          error,
      },
    );
  }
}

/**
 * =============================================================================
 * READINESS
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

  const register =
    readinessModule.register;

  const has =
    readinessModule.has;

  if (
    !isFunction(
      register,
    )
  ) {
    return null;
  }

  if (
    isFunction(has) &&
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
        'required',

      enabled:
        options.enabled !==
        false,

      readiness:
        async () => ({
          ready:
            mounted &&
            !failed &&
            !stopped,

          routes:
            routeCount,
        }),

      health:
        async () => ({
          status:
            failed
              ? 'unhealthy'
              : stopped
                ? 'stopped'
                : mounted
                  ? 'healthy'
                  : 'not_ready',

          ready:
            mounted &&
            !failed &&
            !stopped,

          routes:
            routeCount,

          implementation:
            routeModulePath,

          authenticationConfigured,
        }),

      timeoutMs:
        Number.isInteger(
          options.readinessTimeoutMs,
        )
          ? options.readinessTimeoutMs
          : DEFAULT_READINESS_TIMEOUT_MS,

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

    emitObservabilityEvent(
      'routes.readiness_registration_failed',
      {
        error:
          serializeSafeError(
            error,
          ),
      },
    );

    return null;
  }
}

/**
 * =============================================================================
 * APPLICATION INJECTION
 * =============================================================================
 */

function setApplication(
  app,
) {
  assertApplication(
    app,
  );

  if (
    mounted
  ) {
    throw new RoutesBootstrapError(
      'Cannot replace the application after routes have been mounted.',
      {
        code:
          'ROUTES_APPLICATION_LOCKED',

        phase:
          'routes',
      },
    );
  }

  application =
    app;

  return application;
}

/**
 * =============================================================================
 * ROUTE MODULE INJECTION
 * =============================================================================
 */

function setRouteModule(
  value,
  options = {},
) {
  if (
    mounted
  ) {
    throw new RoutesBootstrapError(
      'Cannot replace the route module after routes have been mounted.',
      {
        code:
          'ROUTES_MODULE_LOCKED',

        phase:
          'routes',
      },
    );
  }

  assertRouteContract(
    value,
  );

  routeModule =
    unwrapModule(
      value,
    );

  routeModulePath =
    options.path ||
    'provided:route-module';

  return routeModule;
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
  assertApplication(
    app,
  );

  /*
   * Bind the authoritative authentication configuration BEFORE loading the
   * route registry.
   *
   * This is the important composition-order guarantee.
   */
  bindAuthenticationConfiguration(
    context,
  );

  const resolved =
    routeModule
      ? {
          module:
            routeModule,

          path:
            routeModulePath,
        }
      : resolveRouteModule();

  const module =
    resolved.module;

  if (
    !module
  ) {
    throw new RoutesBootstrapError(
      'No TITech route module could be resolved.',
      {
        code:
          'ROUTES_MODULE_NOT_FOUND',

        phase:
          'routes',

        details: {
          candidates:
            ROUTE_MODULE_CANDIDATES,
        },
      },
    );
  }

  assertRouteContract(
    module,
  );

  const routeConfig =
    resolveRouteConfiguration(
      context,
      options,
    );

  if (
    !routeConfig.enabled
  ) {
    return {
      enabled:
        false,

      mounted:
        false,

      reason:
        'disabled',

      path:
        resolved.path,
    };
  }

  const routeContext =
    Object.freeze({
      ...context,

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
        getContextLogger(
          context,
        ),

      routes:
        routeConfig,

      application:
        app,
    });

  const registration =
    findRegistrationFunction(
      module,
    );

  /**
   * ---------------------------------------------------------------------------
   * Preferred registration contract
   * ---------------------------------------------------------------------------
   */

  if (
    registration
  ) {
    const result =
      await registration.fn(
        app,
        routeContext,
      );

    router =
      findRouter(
        result,
      );

    routeCount =
      Math.max(
        inspectRouteCount(
          app,
        ),
        inspectRouteCount(
          result,
        ),
      );

    return {
      enabled:
        true,

      mounted:
        true,

      mode:
        registration.name,

      path:
        resolved.path,

      routeCount,

      result,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Direct Express Router contract
   * ---------------------------------------------------------------------------
   */

  const resolvedRouter =
    findRouter(
      module,
    );

  if (
    resolvedRouter
  ) {
    const mountPath =
      options.mountPath ||
      routeConfig.apiPrefix ||
      '/';

    app.use(
      mountPath,
      resolvedRouter,
    );

    router =
      resolvedRouter;

    routeCount =
      inspectRouteCount(
        resolvedRouter,
      );

    return {
      enabled:
        true,

      mounted:
        true,

      mode:
        'router',

      mountPath,

      path:
        resolved.path,

      routeCount,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Callable route module contract
   * ---------------------------------------------------------------------------
   */

  if (
    isFunction(
      module,
    )
  ) {
    const result =
      await module(
        app,
        routeContext,
      );

    router =
      findRouter(
        result,
      );

    routeCount =
      Math.max(
        inspectRouteCount(
          app,
        ),
        inspectRouteCount(
          result,
        ),
      );

    return {
      enabled:
        true,

      mounted:
        true,

      mode:
        'function',

      path:
        resolved.path,

      routeCount,

      result,
    };
  }

  throw new RoutesBootstrapError(
    'TITech route module could not be mounted using a supported contract.',
    {
      code:
        'ROUTES_MOUNT_CONTRACT_FAILED',

      phase:
        'routes',
    },
  );
}

/**
 * =============================================================================
 * HOOK REGISTRATION
 * =============================================================================
 */

function registerRoutesHooks(
  context = {},
  options = {},
) {
  /*
   * Duplicate protection.
   */
  if (
    hooks &&
    isFunction(
      hooks.has,
    ) &&
    hooks.has(
      COMPONENT,
    )
  ) {
    registered =
      true;

    registrationResult =
      isFunction(
        hooks.get,
      )
        ? hooks.get(
            COMPONENT,
          )
        : null;

    return registrationResult;
  }

  const contextApp =
    getContextApplication(
      context,
    );

  if (
    options.app
  ) {
    setApplication(
      options.app,
    );
  } else if (
    contextApp
  ) {
    setApplication(
      contextApp,
    );
  }

  /*
   * Bind authentication immediately when configuration is already available.
   *
   * If the route hook is registered earlier than configuration resolution,
   * mountRoutes() repeats the binding safely.
   */
  if (
    getContextConfiguration(
      context,
    )
  ) {
    bindAuthenticationConfiguration(
      context,
    );
  }

  registerReadinessDependency(
    context,
    options,
  );

  if (
    !isFunction(
      lifecycle,
    )
  ) {
    throw new RoutesBootstrapError(
      'TITech bootstrap lifecycle registrar is unavailable.',
      {
        code:
          'ROUTES_LIFECYCLE_UNAVAILABLE',

        phase:
          'routes',
      },
    );
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
            routeModulePath ||
            'backend/routes',
        },

        /**
         * ---------------------------------------------------------------------
         * START
         * ---------------------------------------------------------------------
         */

        start:
          async hookContext => {
            if (
              startPromise
            ) {
              return startPromise;
            }

            startPromise =
              (async () => {
                try {
                  const runtimeContext =
                    hookContext ||
                    context ||
                    {};

                  const targetApp =
                    options.app ||
                    getContextApplication(
                      runtimeContext,
                    ) ||
                    application;

                  assertApplication(
                    targetApp,
                  );

                  application =
                    targetApp;

                  /*
                   * The definitive auth configuration bind occurs immediately
                   * before route loading.
                   */
                  bindAuthenticationConfiguration(
                    runtimeContext,
                  );

                  const result =
                    await mountRoutes(
                      targetApp,
                      runtimeContext,
                      options,
                    );

                  mounted =
                    result.mounted ===
                    true;

                  stopped =
                    false;

                  failed =
                    false;

                  registered =
                    true;

                  stoppedAt =
                    null;

                  mountedAt =
                    mounted
                      ? new Date()
                      : null;

                  lastError =
                    null;

                  routeCount =
                    Math.max(
                      routeCount,
                      result.routeCount ||
                        0,
                      inspectRouteCount(
                        targetApp,
                      ),
                    );

                  if (
                    isObjectLike(
                      runtimeContext,
                    )
                  ) {
                    runtimeContext.routes =
                      {
                        app:
                          application,

                        router,

                        count:
                          routeCount,

                        module:
                          routeModule,

                        modulePath:
                          routeModulePath,

                        authenticationConfigured,
                      };
                  }

                  emitObservabilityEvent(
                    'routes.mounted',
                    {
                      routeCount,

                      modulePath:
                        routeModulePath,

                      authenticationConfigured,
                    },
                  );

                  return result;
                } catch (error) {
                  mounted =
                    false;

                  failed =
                    true;

                  lastError =
                    error;

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
                }
              })();

            try {
              return await startPromise;
            } finally {
              if (
                failed
              ) {
                startPromise =
                  null;
              }
            }
          },

        /**
         * ---------------------------------------------------------------------
         * READY
         * ---------------------------------------------------------------------
         */

        ready:
          async () => {
            return (
              mounted &&
              !failed &&
              !stopped
            );
          },

        /**
         * ---------------------------------------------------------------------
         * HEALTH
         * ---------------------------------------------------------------------
         */

        health:
          async () => ({
            status:
              failed
                ? 'unhealthy'
                : stopped
                  ? 'stopped'
                  : mounted
                    ? 'healthy'
                    : 'not_ready',

            ready:
              mounted &&
              !failed &&
              !stopped,

            component:
              COMPONENT,

            service:
              SERVICE_NAME,

            routeCount,

            modulePath:
              routeModulePath,

            authenticationConfigured,
          }),

        /**
         * ---------------------------------------------------------------------
         * STOP
         * ---------------------------------------------------------------------
         */

        stop:
          async () => {
            mounted =
              false;

            stopped =
              true;

            stoppedAt =
              new Date();

            emitObservabilityEvent(
              'routes.unmounted',
              {
                routeCount,
              },
            );

            return true;
          },
      },
    );

  registered =
    true;

  return registrationResult;
}

/**
 * =============================================================================
 * BOOTSTRAP COMPATIBILITY
 * =============================================================================
 */

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
  if (
    app
  ) {
    setApplication(
      app,
    );
  }

  if (
    context?.app ||
    context?.application
  ) {
    setApplication(
      getContextApplication(
        context,
      ),
    );
  }

  const target =
    application;

  assertApplication(
    target,
  );

  if (
    mounted &&
    !stopped &&
    !failed
  ) {
    return {
      app:
        target,

      router,

      routeCount,

      authenticationConfigured,
    };
  }

  if (
    startPromise
  ) {
    return startPromise;
  }

  /*
   * Configuration may be available here even when route hooks have not been
   * registered. Bind it before require('../routes').
   */
  bindAuthenticationConfiguration(
    context,
  );

  startPromise =
    mountRoutes(
      target,
      {
        ...context,

        app:
          target,

        configuration:
          getContextConfiguration(
            context,
          ),

        config:
          getContextConfiguration(
            context,
          ),
      },
      options,
    )
      .then(
        result => {
          mounted =
            result.mounted ===
            true;

          registered =
            true;

          stopped =
            false;

          failed =
            false;

          mountedAt =
            mounted
              ? new Date()
              : null;

          routeCount =
            Math.max(
              routeCount,
              result.routeCount ||
                0,
              inspectRouteCount(
                target,
              ),
            );

          emitObservabilityEvent(
            'routes.initialized',
            {
              routeCount,

              modulePath:
                routeModulePath,

              authenticationConfigured,
            },
          );

          return {
            app:
              target,

            router,

            routeCount,

            authenticationConfigured,

            ...result,
          };
        },
      )
      .catch(
        error => {
          failed =
            true;

          mounted =
            false;

          lastError =
            error;

          emitObservabilityEvent(
            'routes.initialization_failed',
            {
              error:
                serializeSafeError(
                  error,
                ),
            },
          );

          throw wrapError(
            error,
            'ROUTES_INITIALIZATION_FAILED',
            'initialization',
            'TITech route initialization failed.',
          );
        },
      );

  try {
    return await startPromise;
  } finally {
    /*
     * A successful initialization must not retain a resolved promise forever.
     */
    if (
      !failed
    ) {
      startPromise =
        null;
    }
  }
}

/**
 * =============================================================================
 * SHUTDOWN
 * =============================================================================
 */

async function shutdown() {
  if (
    stopped
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
      try {
        mounted =
          false;

        stopped =
          true;

        stoppedAt =
          new Date();

        emitObservabilityEvent(
          'routes.shutdown',
          {
            routeCount,
          },
        );

        return true;
      } catch (error) {
        failed =
          true;

        stopped =
          false;

        lastError =
          error;

        throw wrapError(
          error,
          'ROUTES_SHUTDOWN_FAILED',
          'shutdown',
          'TITech routes shutdown failed.',
        );
      } finally {
        stopPromise =
          null;
      }
    })();

  return stopPromise;
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

function getState() {
  return Object.freeze({
    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    registered,

    mounted,

    stopped,

    failed,

    ready:
      mounted &&
      !stopped &&
      !failed,

    routeCount,

    modulePath:
      routeModulePath,

    authenticationConfigured,

    mountedAt,

    stoppedAt,

    lastError:
      serializeSafeError(
        lastError,
      ),
  });
}

function isRegistered() {
  return registered;
}

function isMounted() {
  return mounted;
}

function isStopped() {
  return stopped;
}

function isFailed() {
  return failed;
}

function isReady() {
  return (
    mounted &&
    !stopped &&
    !failed
  );
}

/**
 * =============================================================================
 * DIAGNOSTICS
 * =============================================================================
 */

function snapshot() {
  return Object.freeze({
    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    registered,

    mounted,

    stopped,

    failed,

    ready:
      isReady(),

    routeCount,

    modulePath:
      routeModulePath,

    authenticationConfigured,

    applicationAvailable:
      Boolean(
        application,
      ),

    routerAvailable:
      Boolean(
        router,
      ),

    mountedAt,

    stoppedAt,

    lastError:
      serializeSafeError(
        lastError,
      ),
  });
}

/**
 * =============================================================================
 * RESET
 * =============================================================================
 *
 * Intended for tests / process-isolated bootstrap resets.
 */

function reset() {
  if (
    mounted
  ) {
    throw new RoutesBootstrapError(
      'Cannot reset route bootstrap while routes are mounted.',
      {
        code:
          'ROUTES_RESET_NOT_ALLOWED',

        phase:
          'routes',
      },
    );
  }

  application =
    null;

  router =
    null;

  routeModule =
    null;

  routeModulePath =
    null;

  registered =
    false;

  mounted =
    false;

  stopped =
    false;

  failed =
    false;

  registrationResult =
    null;

  startPromise =
    null;

  stopPromise =
    null;

  lastError =
    null;

  routeCount =
    0;

  mountedAt =
    null;

  stoppedAt =
    null;

  authenticationConfigured =
    false;

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
    RoutesBootstrapError
  ) {
    return error;
  }

  return new RoutesBootstrapError(
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
 * EXPORTS
 * =============================================================================
 */

module.exports =
  Object.freeze({
    /*
     * Registration.
     */
    registerRoutesHooks,

    registerBootstrapHooks,

    bootstrap:
      registerBootstrapHooks,

    /*
     * Application / route injection.
     */
    setApplication,

    setRouteModule,

    mountRoutes,

    /*
     * Explicit lifecycle.
     */
    initialize,

    start:
      initialize,

    shutdown,

    stop,

    /*
     * Runtime access.
     */
    getApplication,

    getRouter,

    getRouteModule,

    getRouteCount,

    /*
     * State.
     */
    getState,

    snapshot,

    isRegistered,

    isMounted,

    isStopped,

    isFailed,

    isReady,

    /*
     * Testing/process reset.
     */
    reset,

    /*
     * Diagnostics/configuration.
     */
    resolveRouteConfiguration,

    bindAuthenticationConfiguration,

    /*
     * Constants/errors.
     */
    RoutesBootstrapError,

    COMPONENT,

    SERVICE_NAME,

    ROUTE_MODULE_CANDIDATES,
  });