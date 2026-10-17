
'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/middleware/resilience/runtime/resilienceBootstrap.js
 *
 * Purpose:
 *   Canonical TITech resilience-runtime composition root.
 *
 * Responsibilities:
 *   - Resolve resilience implementation dependencies with actionable failures.
 *   - Create the TITech resilience dependency container.
 *   - Register dependencies deterministically and await registration.
 *   - Construct the resilience runtime.
 *   - Call runtime.initialize() exactly once per bootstrap invocation.
 *   - Accept the canonical BootstrapContext contract.
 *   - Preserve compatibility with the legacy options contract.
 *   - Preserve causal information in structured bootstrap errors.
 *   - Never create a competing application lifecycle state.
 *
 * Architecture:
 *
 *   BootstrapContext
 *         |
 *   Resilience dependency registration
 *         |
 *   ResilienceContainer
 *         |
 *   ResilienceRuntime
 *         |
 *   runtime.initialize()
 *         |
 *   Attach runtime to the canonical context
 *
 * IMPORTANT:
 *
 *   BootstrapContext remains the canonical application lifecycle authority.
 *
 *   This module must NOT:
 *     - replace BootstrapContext.state;
 *     - create a competing application state object;
 *     - mutate runtime/state.js as lifecycle authority;
 *     - create global resilience lifecycle state;
 *     - silently swallow dependency-loading failures;
 *     - initialize HTTP servers;
 *     - initialize unrelated infrastructure.
 *
 * Module contract:
 *   CommonJS
 *
 * =============================================================================
 */

/* =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const COMPONENT =
  'middleware/resilience/runtime';

const DEFAULT_SERVICE_NAME =
  'titech-community-capital-backend';

const ERROR_CODES = Object.freeze({
  INVALID_CONTEXT:
    'RESILIENCE_INVALID_CONTEXT',

  CONTAINER_CREATION_FAILED:
    'RESILIENCE_CONTAINER_CREATION_FAILED',

  DEPENDENCY_REGISTRATION_FAILED:
    'RESILIENCE_DEPENDENCY_REGISTRATION_FAILED',

  RUNTIME_CREATION_FAILED:
    'RESILIENCE_RUNTIME_CREATION_FAILED',

  INITIALIZATION_FAILED:
    'RESILIENCE_INITIALIZATION_FAILED',

  IMPLEMENTATION_UNAVAILABLE:
    'RESILIENCE_IMPLEMENTATION_UNAVAILABLE',

  ALREADY_INITIALIZED:
    'RESILIENCE_ALREADY_INITIALIZED',
});

/* =============================================================================
 * ERROR NORMALIZATION
 * =============================================================================
 */

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object'
  );
}

function isPlainObject(value) {
  if (!isObject(value)) {
    return false;
  }

  try {
    const prototype =
      Object.getPrototypeOf(value);

    return (
      prototype === Object.prototype ||
      prototype === null
    );
  } catch {
    return false;
  }
}

/**
 * Normalize error data without exposing an unbounded cause chain.
 *
 * Stack traces are intentionally excluded from ordinary nested causes.
 * The top-level bootstrap error retains its stack for server-side diagnostics.
 */
function normalizeCause(
  error,
  depth = 0,
) {
  if (
    error === null ||
    error === undefined
  ) {
    return null;
  }

  if (depth >= 4) {
    return {
      name: 'Error',
      code: null,
      message: 'Maximum nested cause depth reached.',
    };
  }

  const result = {
    name:
      typeof error.name === 'string'
        ? error.name
        : 'Error',

    code:
      error.code === null ||
      error.code === undefined
        ? null
        : String(error.code),

    message:
      typeof error.message === 'string'
        ? error.message
        : String(error),
  };

  if (
    isObject(error.cause) &&
    error.cause !== error
  ) {
    result.cause =
      normalizeCause(
        error.cause,
        depth + 1,
      );
  }

  return result;
}

class ResilienceBootstrapError extends Error {
  constructor(
    message,
    options = {},
  ) {
    const normalizedMessage =
      typeof message === 'string' &&
      message.trim()
        ? message
        : 'TITech resilience bootstrap failed.';

    super(normalizedMessage);

    this.name =
      options.name ||
      'ResilienceBootstrapError';

    this.code =
      options.code ||
      ERROR_CODES.INITIALIZATION_FAILED;

    this.component =
      options.component ||
      COMPONENT;

    this.service =
      options.service ||
      DEFAULT_SERVICE_NAME;

    this.operation =
      options.operation ||
      null;

    this.phase =
      options.phase ||
      'resilience';

    this.dependency =
      options.dependency ||
      null;

    this.cause =
      options.cause ??
      null;

    this.details = Object.freeze(
      isPlainObject(options.details)
        ? { ...options.details }
        : {},
    );

    Error.captureStackTrace?.(
      this,
      ResilienceBootstrapError,
    );
  }

  toJSON() {
    return {
      name: this.name,

      code: this.code,

      message: this.message,

      component: this.component,

      service: this.service,

      operation: this.operation,

      phase: this.phase,

      dependency: this.dependency,

      details: {
        ...this.details,
      },

      cause:
        normalizeCause(this.cause),

      stack: this.stack,
    };
  }
}

/* =============================================================================
 * DEPENDENCY LOADING
 * =============================================================================
 *
 * Dependencies are loaded lazily when bootstrap begins.
 *
 * This allows failures inside these CommonJS dependencies to be wrapped with
 * the correct operation, dependency path, error code and original cause,
 * rather than escaping before the composition root can report them.
 *
 * Successfully resolved dependencies are cached for this module instance.
 * Failed attempts do not mark the dependency set as successfully loaded.
 * =============================================================================
 */

let ResilienceContainer = null;

let registerDependencies = null;

let ResilienceRuntime = null;

let dependenciesLoaded = false;

let dependencyLoadAttempted = false;

let lastDependencyLoadError = null;

function resolveCommonJsExport(
  moduleValue,
  namedExport,
) {
  if (
    typeof moduleValue === 'function'
  ) {
    return moduleValue;
  }

  if (
    typeof moduleValue?.[namedExport] ===
    'function'
  ) {
    return moduleValue[namedExport];
  }

  if (
    typeof moduleValue?.default ===
    'function'
  ) {
    return moduleValue.default;
  }

  if (
    typeof moduleValue?.default?.[namedExport] ===
    'function'
  ) {
    return moduleValue.default[namedExport];
  }

  return null;
}

function loadResilienceDependencies() {
  if (dependenciesLoaded) {
    return true;
  }

  dependencyLoadAttempted = true;

  let currentDependency = null;

  try {
    /*
     * Use local variables until the entire dependency set has been validated.
     * This avoids publishing a partially initialized dependency set.
     */
    currentDependency =
      './resilienceContainer';

    const containerModule =
      require(currentDependency);

    const resolvedContainer =
      resolveCommonJsExport(
        containerModule,
        'ResilienceContainer',
      );

    if (
      typeof resolvedContainer !==
      'function'
    ) {
      throw new TypeError(
        'The resilience container module does not export a constructor.',
      );
    }

    currentDependency =
      './resilienceDependencies';

    const dependencyModule =
      require(currentDependency);

    const resolvedRegistrar =
      typeof dependencyModule?.registerDependencies ===
      'function'
        ? dependencyModule.registerDependencies
        : typeof dependencyModule?.default?.registerDependencies ===
            'function'
          ? dependencyModule.default.registerDependencies
          : null;

    if (
      typeof resolvedRegistrar !==
      'function'
    ) {
      throw new TypeError(
        'The resilience dependency module does not export registerDependencies().',
      );
    }

    currentDependency =
      './resilienceRuntime';

    const runtimeModule =
      require(currentDependency);

    const resolvedRuntime =
      resolveCommonJsExport(
        runtimeModule,
        'ResilienceRuntime',
      );

    if (
      typeof resolvedRuntime !==
      'function'
    ) {
      throw new TypeError(
        'The resilience runtime module does not export a constructor.',
      );
    }

    /*
     * Publish the dependencies only after all three contracts have passed.
     */
    ResilienceContainer =
      resolvedContainer;

    registerDependencies =
      resolvedRegistrar;

    ResilienceRuntime =
      resolvedRuntime;

    dependenciesLoaded = true;

    lastDependencyLoadError = null;

    return true;
  } catch (error) {
    lastDependencyLoadError = error;

    if (
      error instanceof
      ResilienceBootstrapError
    ) {
      throw error;
    }

    throw new ResilienceBootstrapError(
      'A required TITech resilience dependency could not be loaded or validated.',
      {
        code:
          ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

        operation:
          'load-resilience-dependencies',

        dependency:
          currentDependency,

        cause:
          error,

        details: {
          dependenciesLoaded: false,
        },
      },
    );
  }
}

/* =============================================================================
 * BOOTSTRAP CONTEXT CONTRACT
 * =============================================================================
 */

/**
 * A BootstrapContext is normally a class instance.
 *
 * It must not be validated with isPlainObject().
 */
function isBootstrapContext(value) {
  if (!isObject(value)) {
    return false;
  }

  try {
    return (
      typeof value.getState === 'function' &&
      (
        typeof value.startPhase === 'function' ||
        typeof value.setResilience === 'function'
      )
    );
  } catch {
    return false;
  }
}

/**
 * Read the canonical BootstrapContext state without replacing it.
 *
 * Any state validation failure is reported explicitly.
 */
function getContextState(context) {
  if (!context) {
    return null;
  }

  try {
    if (
      typeof context.getState !== 'function'
    ) {
      if (
        typeof context.state === 'string'
      ) {
        return context.state;
      }

      return null;
    }

    const state =
      context.getState();

    if (
      typeof state !== 'string'
    ) {
      throw new ResilienceBootstrapError(
        'TITech BootstrapContext getState() must return a lifecycle-state string.',
        {
          code:
            ERROR_CODES.INVALID_CONTEXT,

          operation:
            'validate-context-state',
        },
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        context,
        'state',
      ) &&
      typeof context.state !== 'string'
    ) {
      throw new ResilienceBootstrapError(
        'TITech BootstrapContext state must remain a lifecycle-state string.',
        {
          code:
            ERROR_CODES.INVALID_CONTEXT,

          operation:
            'validate-context-state',
        },
      );
    }

    if (
      typeof context.state === 'string' &&
      context.state !== state
    ) {
      throw new ResilienceBootstrapError(
        'TITech BootstrapContext state and getState() are inconsistent.',
        {
          code:
            ERROR_CODES.INVALID_CONTEXT,

          operation:
            'validate-context-state',

          details: {
            state: context.state,

            getterState: state,
          },
        },
      );
    }

    return state;
  } catch (error) {
    if (
      error instanceof
      ResilienceBootstrapError
    ) {
      throw error;
    }

    throw new ResilienceBootstrapError(
      'TITech BootstrapContext state could not be read.',
      {
        code:
          ERROR_CODES.INVALID_CONTEXT,

        operation:
          'read-context-state',

        cause:
          error,
      },
    );
  }
}

/* =============================================================================
 * BOOTSTRAP INPUT NORMALIZATION
 * =============================================================================
 *
 * Supported canonical contract:
 *
 *   bootstrapResilience(context)
 *
 * Supported legacy contract:
 *
 *   bootstrapResilience({
 *     config,
 *     dependencies,
 *   })
 *
 * A missing legacy input is accepted for backward compatibility. It produces
 * an empty input object and does not imply that required application services
 * are available.
 * =============================================================================
 */

function normalizeBootstrapInput(
  input = {},
) {
  /*
   * Canonical BootstrapContext.
   */
  if (
    isBootstrapContext(input)
  ) {
    const context = input;

    const configuration =
      context.configuration ||
      context.config ||
      null;

    const dependencies =
      isPlainObject(context.dependencies)
        ? context.dependencies
        : isPlainObject(context.container)
          ? context.container
          : {};

    return {
      context,

      configuration,

      config: configuration,

      dependencies,

      logger:
        context.logger ||
        null,

      observability:
        context.observability ||
        null,

      readiness:
        context.readiness ||
        null,

      resilience:
        context.resilience ||
        null,

      infrastructure:
        context.infrastructure ||
        null,

      services:
        context.services ||
        null,

      application:
        context.application ||
        context.app ||
        null,

      environment:
        context.environment ||
        null,

      runtime:
        context.runtime ||
        null,

      metadata:
        isPlainObject(context.metadata)
          ? { ...context.metadata }
          : {},
    };
  }

  /*
   * Preserve the explicitly supported null-input compatibility contract.
   */
  if (
    input === null ||
    input === undefined
  ) {
    return {
      context: null,

      configuration: null,

      config: null,

      dependencies: {},

      logger: null,

      observability: null,

      readiness: null,

      resilience: null,

      infrastructure: null,

      services: null,

      application: null,

      environment: null,

      runtime: null,

      metadata: {},
    };
  }

  if (!isPlainObject(input)) {
    throw new ResilienceBootstrapError(
      'TITech resilience bootstrap requires a BootstrapContext or options object.',
      {
        code:
          ERROR_CODES.INVALID_CONTEXT,

        operation:
          'normalize-bootstrap-input',

        details: {
          receivedType: typeof input,

          receivedConstructor:
            input?.constructor?.name ||
            null,
        },
      },
    );
  }

  /*
   * Do not silently discard a supplied but invalid context.
   */
  if (
    input.context !== undefined &&
    input.context !== null &&
    !isBootstrapContext(input.context)
  ) {
    throw new ResilienceBootstrapError(
      'The supplied context is not a valid TITech BootstrapContext.',
      {
        code:
          ERROR_CODES.INVALID_CONTEXT,

        operation:
          'validate-supplied-context',

        details: {
          receivedConstructor:
            input.context?.constructor?.name ||
            null,
        },
      },
    );
  }

  const configuration =
    input.configuration ||
    input.config ||
    null;

  const dependencies =
    isPlainObject(input.dependencies)
      ? input.dependencies
      : isPlainObject(input.container)
        ? input.container
        : {};

  return {
    context:
      input.context || null,

    configuration,

    config: configuration,

    dependencies,

    logger:
      input.logger ||
      null,

    observability:
      input.observability ||
      null,

    readiness:
      input.readiness ||
      null,

    resilience:
      input.resilience ||
      null,

    infrastructure:
      input.infrastructure ||
      null,

    services:
      input.services ||
      null,

    application:
      input.application ||
      input.app ||
      null,

    environment:
      input.environment ||
      null,

    runtime:
      input.runtime ||
      null,

    metadata:
      isPlainObject(input.metadata)
        ? { ...input.metadata }
        : {},
  };
}

/* =============================================================================
 * IMPLEMENTATION CONTRACT VALIDATION
 * =============================================================================
 */

function assertDependencyRegistrar() {
  loadResilienceDependencies();

  if (
    typeof registerDependencies !== 'function'
  ) {
    throw new ResilienceBootstrapError(
      'TITech resilience dependency registrar is unavailable.',
      {
        code:
          ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

        operation:
          'resolve-dependency-registrar',

        dependency:
          './resilienceDependencies',
      },
    );
  }
}

function assertContainerConstructor() {
  loadResilienceDependencies();

  if (
    typeof ResilienceContainer !== 'function'
  ) {
    throw new ResilienceBootstrapError(
      'TITech resilience container implementation is unavailable.',
      {
        code:
          ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

        operation:
          'resolve-container',

        dependency:
          './resilienceContainer',
      },
    );
  }
}

function assertRuntimeConstructor() {
  loadResilienceDependencies();

  if (
    typeof ResilienceRuntime !== 'function'
  ) {
    throw new ResilienceBootstrapError(
      'TITech resilience runtime implementation is unavailable.',
      {
        code:
          ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

        operation:
          'resolve-runtime',

        dependency:
          './resilienceRuntime',
      },
    );
  }
}

function assertInitializedRuntime(runtime) {
  if (
    !runtime ||
    typeof runtime !== 'object'
  ) {
    throw new ResilienceBootstrapError(
      'TITech resilience runtime initialization returned an invalid runtime object.',
      {
        code:
          ERROR_CODES.INITIALIZATION_FAILED,

        operation:
          'validate-initialized-runtime',

        details: {
          receivedType:
            runtime === null
              ? 'null'
              : typeof runtime,
        },
      },
    );
  }

  return runtime;
}

/* =============================================================================
 * CANONICAL CONTEXT INTEGRATION
 * =============================================================================
 */

async function attachRuntimeToContext(
  context,
  resilienceRuntime,
) {
  if (!context) {
    return;
  }

  try {
    if (
      typeof context.setResilience === 'function'
    ) {
      await context.setResilience(
        resilienceRuntime,
      );
    } else {
      /*
       * Compatibility for BootstrapContext implementations that expose a
       * lifecycle API but do not expose setResilience().
       */
      context.resilience =
        resilienceRuntime;
    }
  } catch (error) {
    throw new ResilienceBootstrapError(
      'TITech resilience runtime could not be attached to the canonical BootstrapContext.',
      {
        code:
          ERROR_CODES.INITIALIZATION_FAILED,

        operation:
          'attach-runtime-to-bootstrap-context',

        cause:
          error,
      },
    );
  }
}

/* =============================================================================
 * CANONICAL BOOTSTRAP
 * =============================================================================
 */

async function bootstrapResilience(
  input = {},
) {
  const normalized =
    normalizeBootstrapInput(input);

  const {
    context,
    configuration,
    config,
    dependencies,
    logger,
    observability,
    readiness,
    infrastructure,
    services,
    application,
    environment,
    runtime: runtimeContext,
    metadata,
  } = normalized;

  /*
   * Validate the canonical context before creating resilience resources.
   * This module observes its lifecycle; it does not replace or own it.
   */
  if (context) {
    getContextState(context);
  }

  const configuredService =
    configuration?.serviceName ||
    metadata?.service;

  const service =
    typeof configuredService === 'string' &&
    configuredService.trim()
      ? configuredService.trim()
      : DEFAULT_SERVICE_NAME;

  let container;
  let resilienceRuntime;

  /* ---------------------------------------------------------------------------
   * Container creation
   * ------------------------------------------------------------------------- */

  try {
    assertContainerConstructor();

    container =
      new ResilienceContainer();
  } catch (error) {
    if (
      error instanceof
      ResilienceBootstrapError
    ) {
      throw error;
    }

    throw new ResilienceBootstrapError(
      'TITech resilience container could not be created.',
      {
        code:
          ERROR_CODES.CONTAINER_CREATION_FAILED,

        operation:
          'create-resilience-container',

        service,

        dependency:
          './resilienceContainer',

        cause:
          error,
      },
    );
  }

  /* ---------------------------------------------------------------------------
   * Dependency registration
   * ------------------------------------------------------------------------- */

  try {
    assertDependencyRegistrar();

    /*
     * Await supports both synchronous and asynchronous registrars.
     * Dependencies are registered before runtime construction begins.
     */
    await registerDependencies(
      container,
      dependencies,
    );
  } catch (error) {
    if (
      error instanceof
      ResilienceBootstrapError
    ) {
      throw error;
    }

    throw new ResilienceBootstrapError(
      'TITech resilience dependencies could not be registered.',
      {
        code:
          ERROR_CODES.DEPENDENCY_REGISTRATION_FAILED,

        operation:
          'register-resilience-dependencies',

        service,

        dependency:
          './resilienceDependencies',

        cause:
          error,

        details: {
          dependencyCount:
            Object.keys(dependencies).length,
        },
      },
    );
  }

  /* ---------------------------------------------------------------------------
   * Runtime construction
   * ------------------------------------------------------------------------- */

  try {
    assertRuntimeConstructor();

    resilienceRuntime =
      new ResilienceRuntime({
        container,

        config,

        configuration,

        logger,

        observability,

        readiness,

        infrastructure,

        services,

        application,

        environment,

        runtime:
          runtimeContext,

        /*
         * Both names refer to the same canonical lifecycle context.
         * Neither property contains a replacement context.
         */
        context,

        bootstrapContext:
          context,

        metadata: {
          ...metadata,

          /*
           * The composition root owns these canonical identifiers.
           * Caller-supplied metadata cannot override them.
           */
          component:
            COMPONENT,

          service,
        },
      });
  } catch (error) {
    if (
      error instanceof
      ResilienceBootstrapError
    ) {
      throw error;
    }

    throw new ResilienceBootstrapError(
      'TITech resilience runtime could not be constructed.',
      {
        code:
          ERROR_CODES.RUNTIME_CREATION_FAILED,

        operation:
          'create-resilience-runtime',

        service,

        dependency:
          './resilienceRuntime',

        cause:
          error,
      },
    );
  }

  /* ---------------------------------------------------------------------------
   * Runtime initialization
   * ------------------------------------------------------------------------- */

  try {
    if (
      typeof resilienceRuntime?.initialize !==
      'function'
    ) {
      throw new ResilienceBootstrapError(
        'TITech resilience runtime does not expose initialize().',
        {
          code:
            ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

          operation:
            'validate-runtime-initializer',

          service,

          dependency:
            './resilienceRuntime',
        },
      );
    }

    /*
     * Exactly one initialize() invocation is made by this composition-root
     * call. Any internal retries or lifecycle management remain the runtime's
     * responsibility.
     */
    await resilienceRuntime.initialize();
  } catch (error) {
    if (
      error instanceof
      ResilienceBootstrapError
    ) {
      throw error;
    }

    throw new ResilienceBootstrapError(
      'TITech resilience runtime initialization failed.',
      {
        code:
          ERROR_CODES.INITIALIZATION_FAILED,

        operation:
          'initialize-resilience-runtime',

        service,

        dependency:
          './resilienceRuntime',

        cause:
          error,
      },
    );
  }

  /* ---------------------------------------------------------------------------
   * Final validation and context attachment
   * ------------------------------------------------------------------------- */

  try {
    assertInitializedRuntime(
      resilienceRuntime,
    );

    /*
     * Revalidate the same context immediately before attachment. The adapter
     * never constructs a competing state object or assigns context.state.
     */
    if (context) {
      getContextState(context);
    }

    await attachRuntimeToContext(
      context,
      resilienceRuntime,
    );
  } catch (error) {
    if (
      error instanceof
      ResilienceBootstrapError
    ) {
      throw error;
    }

    throw new ResilienceBootstrapError(
      'TITech resilience runtime failed final bootstrap validation.',
      {
        code:
          ERROR_CODES.INITIALIZATION_FAILED,

        operation:
          'validate-resilience-runtime',

        service,

        cause:
          error,
      },
    );
  }

  return resilienceRuntime;
}

/* =============================================================================
 * IMPLEMENTATION DIAGNOSTICS
 * =============================================================================
 */

function getResilienceImplementationInfo() {
  return Object.freeze({
    component: COMPONENT,

    dependenciesLoaded,

    dependencyLoadAttempted:
      dependencyLoadAttempted,

    containerAvailable:
      typeof ResilienceContainer === 'function',

    dependencyRegistrarAvailable:
      typeof registerDependencies === 'function',

    runtimeAvailable:
      typeof ResilienceRuntime === 'function',

    bootstrapAvailable:
      typeof bootstrapResilience === 'function',

    dependencyLoadError:
      normalizeCause(
        lastDependencyLoadError,
      ),
  });
}

function assertResilienceImplementation() {
  loadResilienceDependencies();

  const info =
    getResilienceImplementationInfo();

  if (!info.containerAvailable) {
    throw new ResilienceBootstrapError(
      'TITech resilience container implementation could not be resolved.',
      {
        code:
          ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

        operation:
          'assert-resilience-implementation',

        dependency:
          './resilienceContainer',
      },
    );
  }

  if (!info.dependencyRegistrarAvailable) {
    throw new ResilienceBootstrapError(
      'TITech resilience dependency registrar could not be resolved.',
      {
        code:
          ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

        operation:
          'assert-resilience-implementation',

        dependency:
          './resilienceDependencies',
      },
    );
  }

  if (!info.runtimeAvailable) {
    throw new ResilienceBootstrapError(
      'TITech resilience runtime implementation could not be resolved.',
      {
        code:
          ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

        operation:
          'assert-resilience-implementation',

        dependency:
          './resilienceRuntime',
      },
    );
  }

  return true;
}

/* =============================================================================
 * COMMONJS EXPORTS
 * =============================================================================
 */

module.exports = Object.freeze({
  bootstrapResilience,

  ResilienceBootstrapError,

  ERROR_CODES,

  getResilienceImplementationInfo,

  assertResilienceImplementation,
});