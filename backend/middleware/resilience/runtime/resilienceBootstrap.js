"use strict";

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
 *   - Create the TITech resilience dependency container.
 *   - Register resilience dependencies deterministically.
 *   - Construct the resilience runtime.
 *   - Initialize the runtime exactly once per invocation.
 *   - Accept the canonical BootstrapContext contract.
 *   - Preserve compatibility with the legacy options contract.
 *   - Produce structured, actionable resilience bootstrap failures.
 *   - Never create a competing application lifecycle state.
 *
 * Canonical lifecycle:
 *
 *   BootstrapContext
 *         ↓
 *   Resilience dependency registration
 *         ↓
 *   ResilienceContainer
 *         ↓
 *   ResilienceRuntime
 *         ↓
 *   runtime.initialize()
 *         ↓
 *   initialized resilience runtime
 *
 * IMPORTANT:
 *
 *   BootstrapContext remains the ONE canonical application lifecycle context.
 *
 *   This module must NOT:
 *     - replace BootstrapContext.state;
 *     - create another application state object;
 *     - mutate runtime/state.js as lifecycle authority;
 *     - create global resilience lifecycle state;
 *     - silently swallow dependency-loading failures;
 *     - initialize HTTP servers;
 *     - initialize unrelated infrastructure.
 *
 * Runtime:
 *   Node.js 20+
 *
 * Module:
 *   CommonJS
 *
 * =============================================================================
 */

const ResilienceContainer = require("./resilienceContainer");

const {
  registerDependencies,
} = require("./resilienceDependencies");

const ResilienceRuntime = require("./resilienceRuntime");

/* =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const COMPONENT =
  "middleware/resilience/runtime";

const DEFAULT_SERVICE_NAME =
  "titech-community-capital-backend";

const ERROR_CODES = Object.freeze({
  INVALID_CONTEXT:
    "RESILIENCE_INVALID_CONTEXT",

  CONTAINER_CREATION_FAILED:
    "RESILIENCE_CONTAINER_CREATION_FAILED",

  DEPENDENCY_REGISTRATION_FAILED:
    "RESILIENCE_DEPENDENCY_REGISTRATION_FAILED",

  RUNTIME_CREATION_FAILED:
    "RESILIENCE_RUNTIME_CREATION_FAILED",

  INITIALIZATION_FAILED:
    "RESILIENCE_INITIALIZATION_FAILED",

  IMPLEMENTATION_UNAVAILABLE:
    "RESILIENCE_IMPLEMENTATION_UNAVAILABLE",

  ALREADY_INITIALIZED:
    "RESILIENCE_ALREADY_INITIALIZED",
});

/* =============================================================================
 * ERROR
 * =============================================================================
 */

class ResilienceBootstrapError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(
      typeof message === "string" &&
        message.trim()
        ? message
        : "TITech resilience bootstrap failed.",
    );

    this.name =
      options.name ||
      "ResilienceBootstrapError";

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
      "resilience";

    this.dependency =
      options.dependency ||
      null;

    this.cause =
      options.cause ||
      null;

    this.details =
      isPlainObject(options.details)
        ? {
            ...options.details,
          }
        : {};

    Error.captureStackTrace?.(
      this,
      ResilienceBootstrapError,
    );
  }

  toJSON() {
    return {
      name:
        this.name,

      code:
        this.code,

      message:
        this.message,

      component:
        this.component,

      service:
        this.service,

      operation:
        this.operation,

      phase:
        this.phase,

      dependency:
        this.dependency,

      details:
        {
          ...this.details,
        },

      cause:
        normalizeCause(
          this.cause,
        ),

      stack:
        this.stack,
    };
  }
}

/* =============================================================================
 * TYPE / NORMALIZATION HELPERS
 * =============================================================================
 */

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object"
  );
}

function isPlainObject(value) {
  if (!isObject(value)) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(value);

  return (
    prototype ===
      Object.prototype ||
    prototype === null
  );
}

/**
 * A BootstrapContext is a class instance, therefore it MUST NOT be tested with
 * isPlainObject().
 *
 * This structural test deliberately checks the canonical public lifecycle API.
 */
function isBootstrapContext(value) {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.getState ===
      "function" &&
    (
      typeof value.startPhase ===
        "function" ||
      typeof value.setResilience ===
        "function"
    )
  );
}

function normalizeCause(error) {
  if (!error) {
    return null;
  }

  if (
    error instanceof
    ResilienceBootstrapError
  ) {
    return {
      name:
        error.name,

      code:
        error.code,

      message:
        error.message,

      phase:
        error.phase,
    };
  }

  if (error instanceof Error) {
    return {
      name:
        error.name,

      code:
        error.code ||
        null,

      message:
        error.message ||
        String(error),
    };
  }

  if (isObject(error)) {
    return {
      name:
        typeof error.name ===
        "string"
          ? error.name
          : "Error",

      code:
        typeof error.code ===
        "string"
          ? error.code
          : null,

      message:
        typeof error.message ===
        "string"
          ? error.message
          : "Unknown resilience bootstrap error.",
    };
  }

  return {
    name:
      "Error",

    code:
      null,

    message:
      String(error),
  };
}

/**
 * Read the canonical BootstrapContext state without ever replacing it.
 *
 * Expected:
 *
 *   "created"
 *   "starting"
 *   "ready"
 *   "failed"
 *   "shutting_down"
 *   "stopped"
 */
function getContextState(context) {
  if (!context) {
    return null;
  }

  if (
    typeof context.getState ===
    "function"
  ) {
    const state =
      context.getState();

    if (
      typeof state !==
      "string"
    ) {
      throw new ResilienceBootstrapError(
        "TITech BootstrapContext getState() must return a lifecycle-state string.",
        {
          code:
            ERROR_CODES.INVALID_CONTEXT,

          operation:
            "validate-context-state",
        },
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        context,
        "state",
      ) &&
      typeof context.state !==
        "string"
    ) {
      throw new ResilienceBootstrapError(
        "TITech BootstrapContext state must remain a lifecycle-state string.",
        {
          code:
            ERROR_CODES.INVALID_CONTEXT,

          operation:
            "validate-context-state",
        },
      );
    }

    if (
      typeof context.state ===
        "string" &&
      context.state !==
        state
    ) {
      throw new ResilienceBootstrapError(
        "TITech BootstrapContext state and getState() are inconsistent.",
        {
          code:
            ERROR_CODES.INVALID_CONTEXT,

          operation:
            "validate-context-state",

          details: {
            state:
              context.state,

            getterState:
              state,
          },
        },
      );
    }

    return state;
  }

  if (
    typeof context.state ===
    "string"
  ) {
    return context.state;
  }

  return null;
}

/* =============================================================================
 * BOOTSTRAP INPUT NORMALIZATION
 * =============================================================================
 *
 * Supported:
 *
 *   bootstrapResilience(context)
 *
 * and legacy:
 *
 *   bootstrapResilience({
 *     config,
 *     dependencies,
 *   })
 *
 * =============================================================================
 */

function normalizeBootstrapInput(
  input = {},
) {
  /**
   * Canonical BootstrapContext.
   */
  if (
    isBootstrapContext(input)
  ) {
    const context =
      input;

    const configuration =
      context.configuration ||
      context.config ||
      null;

    const dependencies =
      isPlainObject(
        context.dependencies,
      )
        ? context.dependencies
        : isPlainObject(
            context.container,
          )
          ? context.container
          : {};

    return {
      context,

      configuration,

      config:
        configuration,

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
        isPlainObject(
          context.metadata,
        )
          ? {
              ...context.metadata,
            }
          : {},
    };
  }

  /**
   * null/undefined is accepted for compatibility but produces an intentionally
   * empty dependency graph.
   */
  if (
    input === null ||
    input === undefined
  ) {
    return {
      context:
        null,

      configuration:
        null,

      config:
        null,

      dependencies:
        {},

      logger:
        null,

      observability:
        null,

      readiness:
        null,

      resilience:
        null,

      infrastructure:
        null,

      services:
        null,

      application:
        null,

      environment:
        null,

      runtime:
        null,

      metadata:
        {},
    };
  }

  /**
   * Legacy options contract.
   */
  if (
    !isPlainObject(input)
  ) {
    throw new ResilienceBootstrapError(
      "TITech resilience bootstrap requires a BootstrapContext or options object.",
      {
        code:
          ERROR_CODES.INVALID_CONTEXT,

        operation:
          "normalize-bootstrap-input",

        details: {
          receivedType:
            typeof input,

          receivedConstructor:
            input?.constructor?.name ||
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
    isPlainObject(
      input.dependencies,
    )
      ? input.dependencies
      : isPlainObject(
          input.container,
        )
        ? input.container
        : {};

  return {
    context:
      isBootstrapContext(
        input.context,
      )
        ? input.context
        : null,

    configuration,

    config:
      configuration,

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
      isPlainObject(
        input.metadata,
      )
        ? {
            ...input.metadata,
          }
        : {},
  };
}

/* =============================================================================
 * IMPLEMENTATION CONTRACT VALIDATION
 * =============================================================================
 */

function assertDependencyRegistrar() {
  if (
    typeof registerDependencies !==
    "function"
  ) {
    throw new ResilienceBootstrapError(
      "TITech resilience dependency registrar is unavailable.",
      {
        code:
          ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

        operation:
          "resolve-dependency-registrar",

        dependency:
          "./resilienceDependencies",
      },
    );
  }
}

function assertContainerConstructor() {
  if (
    typeof ResilienceContainer !==
    "function"
  ) {
    throw new ResilienceBootstrapError(
      "TITech resilience container implementation is unavailable.",
      {
        code:
          ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

        operation:
          "resolve-container",

        dependency:
          "./resilienceContainer",
      },
    );
  }
}

function assertRuntimeConstructor() {
  if (
    typeof ResilienceRuntime !==
    "function"
  ) {
    throw new ResilienceBootstrapError(
      "TITech resilience runtime implementation is unavailable.",
      {
        code:
          ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

        operation:
          "resolve-runtime",

        dependency:
          "./resilienceRuntime",
      },
    );
  }
}

function assertInitializedRuntime(
  runtime,
) {
  if (
    !runtime ||
    typeof runtime !== "object"
  ) {
    throw new ResilienceBootstrapError(
      "TITech resilience runtime initialization returned an invalid runtime object.",
      {
        code:
          ERROR_CODES.INITIALIZATION_FAILED,

        operation:
          "validate-initialized-runtime",

        details: {
          receivedType:
            runtime === null
              ? "null"
              : typeof runtime,
        },
      },
    );
  }

  return runtime;
}

/* =============================================================================
 * CONTEXT INTEGRATION
 * =============================================================================
 */

function attachRuntimeToContext(
  context,
  resilienceRuntime,
) {
  if (!context) {
    return;
  }

  try {
    if (
      typeof context.setResilience ===
      "function"
    ) {
      context.setResilience(
        resilienceRuntime,
      );
    } else {
      context.resilience =
        resilienceRuntime;
    }
  } catch (error) {
    throw new ResilienceBootstrapError(
      "TITech resilience runtime could not be attached to the canonical BootstrapContext.",
      {
        code:
          ERROR_CODES.INITIALIZATION_FAILED,

        operation:
          "attach-runtime-to-bootstrap-context",

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
    normalizeBootstrapInput(
      input,
    );

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

  /**
   * Validate the canonical lifecycle contract before doing any resilience work.
   */
  if (context) {
    getContextState(context);
  }

  const service =
    configuration?.serviceName ||
    metadata?.service ||
    DEFAULT_SERVICE_NAME;

  let container;
  let resilienceRuntime;

  /* ---------------------------------------------------------------------------
   * Container
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
      "TITech resilience container could not be created.",
      {
        code:
          ERROR_CODES.CONTAINER_CREATION_FAILED,

        operation:
          "create-resilience-container",

        service,

        cause:
          error,
      },
    );
  }

  /* ---------------------------------------------------------------------------
   * Dependencies
   * ------------------------------------------------------------------------- */

  try {
    assertDependencyRegistrar();

    registerDependencies(
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
      "TITech resilience dependencies could not be registered.",
      {
        code:
          ERROR_CODES.DEPENDENCY_REGISTRATION_FAILED,

        operation:
          "register-resilience-dependencies",

        service,

        dependency:
          "./resilienceDependencies",

        cause:
          error,

        details: {
          dependencyCount:
            Object.keys(
              dependencies,
            ).length,
        },
      },
    );
  }

  /* ---------------------------------------------------------------------------
   * Runtime
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

        /**
         * Canonical lifecycle context.
         *
         * This is the same object received by bootstrap/app.js.
         */
        context,

        bootstrapContext:
          context,

        metadata: {
          component:
            COMPONENT,

          service,

          ...metadata,
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
      "TITech resilience runtime could not be constructed.",
      {
        code:
          ERROR_CODES.RUNTIME_CREATION_FAILED,

        operation:
          "create-resilience-runtime",

        service,

        dependency:
          "./resilienceRuntime",

        cause:
          error,
      },
    );
  }

  /* ---------------------------------------------------------------------------
   * Initialization
   * ------------------------------------------------------------------------- */

  try {
    if (
      typeof resilienceRuntime.initialize !==
      "function"
    ) {
      throw new ResilienceBootstrapError(
        "TITech resilience runtime does not expose initialize().",
        {
          code:
            ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

          operation:
            "validate-runtime-initializer",

          service,

          dependency:
            "./resilienceRuntime",
        },
      );
    }

    await resilienceRuntime.initialize();
  } catch (error) {
    if (
      error instanceof
      ResilienceBootstrapError
    ) {
      throw error;
    }

    throw new ResilienceBootstrapError(
      "TITech resilience runtime initialization failed.",
      {
        code:
          ERROR_CODES.INITIALIZATION_FAILED,

        operation:
          "initialize-resilience-runtime",

        service,

        cause:
          error,
      },
    );
  }

  /* ---------------------------------------------------------------------------
   * Final validation
   * ------------------------------------------------------------------------- */

  try {
    assertInitializedRuntime(
      resilienceRuntime,
    );

    attachRuntimeToContext(
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
      "TITech resilience runtime failed final bootstrap validation.",
      {
        code:
          ERROR_CODES.INITIALIZATION_FAILED,

        operation:
          "validate-resilience-runtime",

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
    component:
      COMPONENT,

    containerAvailable:
      typeof ResilienceContainer ===
      "function",

    dependencyRegistrarAvailable:
      typeof registerDependencies ===
      "function",

    runtimeAvailable:
      typeof ResilienceRuntime ===
      "function",

    bootstrapAvailable:
      typeof bootstrapResilience ===
      "function",
  });
}

function assertResilienceImplementation() {
  const info =
    getResilienceImplementationInfo();

  if (
    !info.containerAvailable
  ) {
    throw new ResilienceBootstrapError(
      "TITech resilience container implementation could not be resolved.",
      {
        code:
          ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

        operation:
          "assert-resilience-implementation",

        dependency:
          "./resilienceContainer",
      },
    );
  }

  if (
    !info.dependencyRegistrarAvailable
  ) {
    throw new ResilienceBootstrapError(
      "TITech resilience dependency registrar could not be resolved.",
      {
        code:
          ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

        operation:
          "assert-resilience-implementation",

        dependency:
          "./resilienceDependencies",
      },
    );
  }

  if (
    !info.runtimeAvailable
  ) {
    throw new ResilienceBootstrapError(
      "TITech resilience runtime implementation could not be resolved.",
      {
        code:
          ERROR_CODES.IMPLEMENTATION_UNAVAILABLE,

        operation:
          "assert-resilience-implementation",

        dependency:
          "./resilienceRuntime",
      },
    );
  }

  return true;
}

/* =============================================================================
 * MODULE EXPORTS
 * =============================================================================
 */

module.exports = Object.freeze({
  bootstrapResilience,

  ResilienceBootstrapError,

  ERROR_CODES,

  getResilienceImplementationInfo,

  assertResilienceImplementation,
});