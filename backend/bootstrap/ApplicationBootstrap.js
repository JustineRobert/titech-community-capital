/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/ApplicationBootstrap.js
 *
 * Purpose:
 *   Canonical enterprise application bootstrap orchestrator.
 *
 * Architectural responsibility:
 * -----------------------------------------------------------------------------
 *
 *   backend/server.js
 *          │
 *          ▼
 *   ApplicationBootstrap
 *          │
 *          ├── environment
 *          ├── configuration
 *          ├── logger
 *          ├── observability
 *          ├── readiness
 *          ├── resilience
 *          ├── infrastructure
 *          ├── services
 *          ├── middleware
 *          ├── routes
 *          └── HTTP server adapter
 *                         │
 *                         ▼
 *                      READY
 *
 * This module is the canonical application composition and lifecycle
 * orchestrator.
 *
 * It does NOT:
 *   - implement Express routes;
 *   - implement controllers;
 *   - implement financial logic;
 *   - implement ledger logic;
 *   - implement authentication;
 *   - implement database drivers;
 *   - implement Redis;
 *   - implement queues;
 *   - implement resilience algorithms;
 *   - implement HTTP transport internals.
 *
 * Those responsibilities remain owned by their respective modules.
 *
 * IMPORTANT:
 * -----------------------------------------------------------------------------
 *
 * `backend/bootstrap/server.js` is the canonical HTTP transport adapter.
 *
 * ApplicationBootstrap prepares the application and delegates network startup
 * and shutdown to that adapter.
 *
 * Runtime:
 *   Node.js 20+
 *
 * Module System:
 *   ES Modules (ESM)
 *
 * =============================================================================
 */

import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

/* =============================================================================
 * MODULE IDENTITY
 * =============================================================================
 */

const CURRENT_FILE =
  fileURLToPath(
    import.meta.url,
  );

const CURRENT_DIRECTORY =
  path.dirname(
    CURRENT_FILE,
  );

/* =============================================================================
 * METADATA
 * =============================================================================
 */

const COMPONENT =
  "application-bootstrap";

const APPLICATION_NAME =
  process.env.APPLICATION_NAME ||
  "TITech Community Capital";

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  "titech-community-capital-backend";

const VERSION =
  process.env.APP_BOOTSTRAP_VERSION ||
  "2026.1";

/* =============================================================================
 * DEFAULTS
 * =============================================================================
 */

const DEFAULTS =
  Object.freeze({
    startupTimeoutMs:
      120_000,

    shutdownTimeoutMs:
      30_000,

    phaseTimeoutMs:
      60_000,

    requireApplication:
      true,

    autoDiscoverPhases:
      true,

    startServer:
      true,

    registerServerHooks:
      true,

    failOnOptionalPhaseError:
      false,

    allowPartialShutdown:
      true,

    allowRestart:
      false,

    maxEventListeners:
      50,
  });

/* =============================================================================
 * CANONICAL PHASE DEFINITIONS
 * =============================================================================
 */

const DEFAULT_PHASES =
  Object.freeze([
    Object.freeze({
      name:
        "environment",

      priority:
        100,

      required:
        true,

      dependencies:
        [],
    }),

    Object.freeze({
      name:
        "configuration",

      priority:
        200,

      required:
        true,

      dependencies:
        ["environment"],
    }),

    Object.freeze({
      name:
        "logger",

      priority:
        300,

      required:
        true,

      dependencies:
        ["configuration"],
    }),

    Object.freeze({
      name:
        "observability",

      priority:
        400,

      required:
        false,

      dependencies:
        ["logger"],
    }),

    Object.freeze({
      name:
        "readiness",

      priority:
        500,

      required:
        true,

      dependencies:
        ["configuration"],
    }),

    Object.freeze({
      name:
        "resilience",

      priority:
        600,

      required:
        false,

      dependencies:
        ["configuration"],
    }),

    Object.freeze({
      name:
        "infrastructure",

      priority:
        700,

      required:
        true,

      dependencies:
        ["configuration"],
    }),

    Object.freeze({
      name:
        "services",

      priority:
        800,

      required:
        true,

      dependencies:
        ["infrastructure"],
    }),

    Object.freeze({
      name:
        "middleware",

      priority:
        900,

      required:
        true,

      dependencies:
        ["services"],
    }),

    Object.freeze({
      name:
        "routes",

      priority:
        950,

      required:
        true,

      dependencies:
        ["middleware"],
    }),

    Object.freeze({
      name:
        "server",

      priority:
        1000,

      required:
        true,

      dependencies:
        ["routes"],
    }),
  ]);

/* =============================================================================
 * PHASE MODULE CANDIDATES
 * =============================================================================
 *
 * Discovery supports:
 *
 *   .js
 *   .mjs
 *   .cjs
 *   /index.js
 *   /index.mjs
 *   /index.cjs
 *
 * This permits controlled migration of legacy CommonJS modules while keeping
 * the canonical bootstrap layer fully ESM.
 * =============================================================================
 */

const PHASE_MODULE_CANDIDATES =
  Object.freeze({
    environment:
      Object.freeze([
        "./environment",
        "./environmentLoader",
        "../config/environment",
        "../config/env",
      ]),

    configuration:
      Object.freeze([
        "./configuration",
        "./config",
        "../config",
        "../config/index",
      ]),

    logger:
      Object.freeze([
        "./logger",
        "../utils/logger",
        "../utils/logger/index",
      ]),

    observability:
      Object.freeze([
        "./observability",
        "../observability",
        "../monitoring/observability",
      ]),

    readiness:
      Object.freeze([
        "./readinessState",
        "./readiness",
      ]),

    resilience:
      Object.freeze([
        "./resilience",
        "../resilience",
      ]),

    infrastructure:
      Object.freeze([
        "./infrastructure",
        "../infrastructure",
      ]),

    services:
      Object.freeze([
        "./services",
        "../services",
      ]),

    middleware:
      Object.freeze([
        "./middleware",
        "../middleware",
      ]),

    routes:
      Object.freeze([
        "./routes",
        "../routes",
      ]),

    server:
      Object.freeze([
        "./server",
      ]),
  });

/* =============================================================================
 * ERRORS
 * =============================================================================
 */

class ApplicationBootstrapError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(
      message,
      {
        cause:
          options.cause,
      },
    );

    this.name =
      "ApplicationBootstrapError";

    this.code =
      options.code ||
      "APPLICATION_BOOTSTRAP_ERROR";

    this.phase =
      options.phase ||
      null;

    this.component =
      options.component ||
      COMPONENT;

    this.cause =
      options.cause ||
      null;

    this.details =
      Object.freeze({
        ...(options.details || {}),
      });

    Error.captureStackTrace?.(
      this,
      ApplicationBootstrapError,
    );
  }
}

/* =============================================================================
 * UTILITY FUNCTIONS
 * =============================================================================
 */

function asBoolean(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  if (
    typeof value === "boolean"
  ) {
    return value;
  }

  return [
    "1",
    "true",
    "yes",
    "on",
    "enabled",
  ].includes(
    String(value)
      .trim()
      .toLowerCase(),
  );
}

function asPositiveInteger(
  value,
  fallback,
) {
  const parsed =
    value === undefined ||
    value === null ||
    value === ""
      ? fallback
      : Number(value);

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

function now() {
  return new Date();
}

function elapsedMs(
  startedAt,
) {
  if (
    !startedAt
  ) {
    return 0;
  }

  const timestamp =
    startedAt instanceof Date
      ? startedAt.getTime()
      : Number(
          startedAt,
        );

  if (
    !Number.isFinite(
      timestamp,
    )
  ) {
    return 0;
  }

  return Math.max(
    0,
    Date.now() -
      timestamp,
  );
}

function freezeCopy(
  value,
) {
  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return value;
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return Object.freeze([
      ...value,
    ]);
  }

  return Object.freeze({
    ...value,
  });
}

function safeError(
  error,
) {
  if (
    !error
  ) {
    return null;
  }

  return {
    name:
      error.name ||
      "Error",

    code:
      error.code ||
      null,

    message:
      error.message ||
      String(error),

    phase:
      error.phase ||
      null,

    component:
      error.component ||
      null,

    details:
      error.details ||
      null,

    cause:
      error.cause
        ? safeError(
            error.cause,
          )
        : null,
  };
}

/* =============================================================================
 * MODULE RESOLUTION
 * =============================================================================
 */

/**
 * Resolve a local module candidate without using CommonJS require.resolve().
 *
 * @param {string} candidate
 * @param {string} baseDirectory
 * @returns {string|null}
 */
function resolveLocalModulePath(
  candidate,
  baseDirectory =
    CURRENT_DIRECTORY,
) {
  if (
    typeof candidate !==
      "string" ||
    !candidate.trim()
  ) {
    return null;
  }

  const normalizedCandidate =
    candidate.trim();

  const absolute =
    path.isAbsolute(
      normalizedCandidate,
    )
      ? normalizedCandidate
      : path.resolve(
          baseDirectory,
          normalizedCandidate,
        );

  const candidates =
    [
      absolute,

      `${absolute}.js`,

      `${absolute}.mjs`,

      `${absolute}.cjs`,

      path.join(
        absolute,
        "index.js",
      ),

      path.join(
        absolute,
        "index.mjs",
      ),

      path.join(
        absolute,
        "index.cjs",
      ),
    ];

  for (
    const filePath of
      candidates
  ) {
    try {
      if (
        fs.existsSync(
          filePath,
        ) &&
        fs.statSync(
          filePath,
        ).isFile()
      ) {
        return filePath;
      }
    } catch {
      // Continue candidate resolution.
    }
  }

  return null;
}

/**
 * Load an ESM or CommonJS-compatible local module through native import().
 *
 * @param {string} modulePath
 * @returns {Promise<*>}
 */
async function importModule(
  modulePath,
) {
  const resolved =
    resolveLocalModulePath(
      modulePath,
      CURRENT_DIRECTORY,
    );

  if (
    !resolved
  ) {
    throw new ApplicationBootstrapError(
      `Bootstrap module does not exist: ${modulePath}`,
      {
        code:
          "BOOTSTRAP_MODULE_NOT_FOUND",

        details: {
          modulePath,
        },
      },
    );
  }

  try {
    return await import(
      pathToFileURL(
        resolved,
      ).href
    );
  } catch (error) {
    throw new ApplicationBootstrapError(
      `Unable to load bootstrap module: ${resolved}`,
      {
        code:
          "BOOTSTRAP_MODULE_LOAD_FAILED",

        cause:
          error,

        details: {
          requestedPath:
            modulePath,

          resolvedPath:
            resolved,
        },
      },
    );
  }
}

/**
 * Normalize imported module shapes.
 *
 * Supports:
 *
 *   export default function ...
 *   export default { ... }
 *   export function ...
 *
 * @param {*} value
 * @returns {*}
 */
function unwrapModule(
  value,
) {
  if (
    value &&
    typeof value ===
      "object" &&
    "default" in value
  ) {
    const namedExports =
      Object.keys(
        value,
      ).filter(
        key =>
          key !==
          "default",
      );

    if (
      namedExports.length ===
      0
    ) {
      return value.default;
    }

    return value;
  }

  return value;
}

/* =============================================================================
 * FALLBACK LOGGER
 * =============================================================================
 */

function createFallbackLogger() {
  const prefix =
    `[${COMPONENT}]`;

  return Object.freeze({
    debug(
      message,
      metadata,
    ) {
      if (
        process.env.NODE_ENV !==
        "test"
      ) {
        console.debug(
          prefix,
          message,
          metadata || "",
        );
      }
    },

    info(
      message,
      metadata,
    ) {
      console.info(
        prefix,
        message,
        metadata || "",
      );
    },

    warn(
      message,
      metadata,
    ) {
      console.warn(
        prefix,
        message,
        metadata || "",
      );
    },

    error(
      message,
      metadata,
    ) {
      console.error(
        prefix,
        message,
        metadata || "",
      );
    },
  });
}

/* =============================================================================
 * TIMEOUT / CANCELLATION
 * =============================================================================
 */

function withTimeout(
  operation,
  timeoutMs,
  phase,
  options = {},
) {
  const timeout =
    asPositiveInteger(
      timeoutMs,
      DEFAULTS.phaseTimeoutMs,
    );

  const parentSignal =
    options.signal ||
    null;

  const controller =
    new AbortController();

  const signal =
    controller.signal;

  let abortParent =
    null;

  let parentListenerInstalled =
    false;

  return new Promise(
    (
      resolve,
      reject,
    ) => {
      let settled =
        false;

      let timer =
        null;

      const cleanup =
        () => {
          if (
            timer
          ) {
            clearTimeout(
              timer,
            );

            timer =
              null;
          }

          if (
            parentSignal &&
            abortParent &&
            parentListenerInstalled
          ) {
            parentSignal.removeEventListener(
              "abort",
              abortParent,
            );

            parentListenerInstalled =
              false;
          }
        };

      abortParent =
        () => {
          if (
            settled
          ) {
            return;
          }

          controller.abort(
            parentSignal?.reason,
          );

          settled =
            true;

          cleanup();

          reject(
            new ApplicationBootstrapError(
              `Bootstrap phase "${phase}" was aborted.`,
              {
                code:
                  "BOOTSTRAP_PHASE_ABORTED",

                phase,

                cause:
                  parentSignal?.reason,
              },
            ),
          );
        };

      timer =
        setTimeout(
          () => {
            if (
              settled
            ) {
              return;
            }

            controller.abort();

            settled =
              true;

            cleanup();

            reject(
              new ApplicationBootstrapError(
                `Bootstrap phase "${phase}" exceeded its ${timeout}ms timeout.`,
                {
                  code:
                    "BOOTSTRAP_PHASE_TIMEOUT",

                  phase,

                  details: {
                    timeoutMs:
                      timeout,
                  },
                },
              ),
            );
          },
          timeout,
        );

      timer.unref?.();

      if (
        parentSignal?.aborted
      ) {
        queueMicrotask(
          abortParent,
        );
      } else if (
        parentSignal
      ) {
        parentSignal.addEventListener(
          "abort",
          abortParent,
          {
            once:
              true,
          },
        );

        parentListenerInstalled =
          true;
      }

      Promise.resolve()
        .then(
          () =>
            operation(
              signal,
            ),
        )
        .then(
          value => {
            if (
              settled
            ) {
              return;
            }

            settled =
              true;

            cleanup();

            resolve(
              value,
            );
          },
        )
        .catch(
          error => {
            if (
              settled
            ) {
              return;
            }

            settled =
              true;

            cleanup();

            reject(
              error,
            );
          },
        );
    },
  );
}

/* =============================================================================
 * APPLICATION BOOTSTRAP
 * =============================================================================
 */

class ApplicationBootstrap {
  constructor(
    options = {},
  ) {
    this.options =
      this.normalizeOptions(
        options,
      );

    this.events =
      new EventEmitter();

    this.events.setMaxListeners(
      this.options.maxEventListeners,
    );

    this.logger =
      createFallbackLogger();

    this.context =
      null;

    this.application =
      null;

    this.server =
      null;

    this.serverModule =
      null;

    this.phaseDefinitions =
      new Map();

    this.phaseStates =
      new Map();

    this.phaseImplementations =
      new Map();

    this.completedPhases =
      [];

    this.startPromise =
      null;

    this.stopPromise =
      null;

    this.starting =
      false;

    this.started =
      false;

    this.stopping =
      false;

    this.stopped =
      false;

    this.failed =
      false;

    this.lastError =
      null;

    this.startedAt =
      null;

    this.stoppedAt =
      null;

    this.initialized =
      false;

    this.initializedAt =
      null;

    this.destroyed =
      false;

    this.bootstrapId =
      this.createBootstrapId();

    this.lifecycleAbortController =
      new AbortController();

    this.registerDefaultPhases();

    this.registerCustomPhases(
      this.options.phases,
    );
  }

  /* ===========================================================================
   * OPTIONS
   * ===========================================================================
   */

  normalizeOptions(
    options,
  ) {
    const source =
      options &&
      typeof options ===
        "object"
        ? options
        : {};

    return Object.freeze({
      ...source,

      startupTimeoutMs:
        asPositiveInteger(
          source.startupTimeoutMs,
          DEFAULTS.startupTimeoutMs,
        ),

      shutdownTimeoutMs:
        asPositiveInteger(
          source.shutdownTimeoutMs,
          DEFAULTS.shutdownTimeoutMs,
        ),

      phaseTimeoutMs:
        asPositiveInteger(
          source.phaseTimeoutMs,
          DEFAULTS.phaseTimeoutMs,
        ),

      requireApplication:
        source.requireApplication !==
        undefined
          ? asBoolean(
              source.requireApplication,
              DEFAULTS.requireApplication,
            )
          : DEFAULTS.requireApplication,

      autoDiscoverPhases:
        source.autoDiscoverPhases !==
        undefined
          ? asBoolean(
              source.autoDiscoverPhases,
              DEFAULTS.autoDiscoverPhases,
            )
          : DEFAULTS.autoDiscoverPhases,

      startServer:
        source.startServer !==
        undefined
          ? asBoolean(
              source.startServer,
              DEFAULTS.startServer,
            )
          : DEFAULTS.startServer,

      registerServerHooks:
        source.registerServerHooks !==
        undefined
          ? asBoolean(
              source.registerServerHooks,
              DEFAULTS.registerServerHooks,
            )
          : DEFAULTS.registerServerHooks,

      failOnOptionalPhaseError:
        source.failOnOptionalPhaseError !==
        undefined
          ? asBoolean(
              source.failOnOptionalPhaseError,
              DEFAULTS.failOnOptionalPhaseError,
            )
          : DEFAULTS.failOnOptionalPhaseError,

      allowPartialShutdown:
        source.allowPartialShutdown !==
        undefined
          ? asBoolean(
              source.allowPartialShutdown,
              DEFAULTS.allowPartialShutdown,
            )
          : DEFAULTS.allowPartialShutdown,

      allowRestart:
        source.allowRestart !==
        undefined
          ? asBoolean(
              source.allowRestart,
              DEFAULTS.allowRestart,
            )
          : DEFAULTS.allowRestart,

      maxEventListeners:
        asPositiveInteger(
          source.maxEventListeners,
          DEFAULTS.maxEventListeners,
        ),
    });
  }

  createBootstrapId() {
    let entropy;

    try {
      entropy =
        crypto.randomUUID();
    } catch {
      entropy =
        Math.random()
          .toString(36)
          .slice(2);
    }

    return [
      SERVICE_NAME,
      process.pid,
      Date.now().toString(36),
      entropy,
    ].join(
      "-",
    );
  }

  /* ===========================================================================
   * INITIALIZATION
   * ===========================================================================
   */

  initialize(
    suppliedContext = {},
  ) {
    if (
      this.destroyed
    ) {
      throw new ApplicationBootstrapError(
        "Cannot initialize a destroyed TITech application bootstrap.",
        {
          code:
            "BOOTSTRAP_DESTROYED",
        },
      );
    }

    if (
      this.started ||
      this.starting
    ) {
      throw new ApplicationBootstrapError(
        "Cannot initialize application bootstrap after startup has begun.",
        {
          code:
            "BOOTSTRAP_INITIALIZATION_LOCKED",
        },
      );
    }

    const incoming =
      suppliedContext &&
      typeof suppliedContext ===
        "object"
        ? {
            ...suppliedContext,
          }
        : {};

    if (
      incoming.application
    ) {
      this.setApplication(
        incoming.application,
      );
    }

    this.context =
      this.createContext(
        incoming,
      );

    if (
      this.context.logger
    ) {
      this.setLogger(
        this.context.logger,
      );
    }

    this.initialized =
      true;

    this.initializedAt =
      now();

    this.emit(
      "initialized",
      {
        applicationAvailable:
          Boolean(
            this.application ||
              this.context.application,
          ),
      },
    );

    return this.context;
  }

  /* ===========================================================================
   * CONTEXT
   * ===========================================================================
   */

  createContext(
    suppliedContext = {},
  ) {
    const context =
      suppliedContext &&
      typeof suppliedContext ===
        "object"
        ? {
            ...suppliedContext,
          }
        : {};

    if (
      !context.environment
    ) {
      context.environment =
        this.resolveEnvironment();
    }

    if (
      !context.config
    ) {
      context.config =
        this.resolveConfiguration();
    }

    if (
      !context.application &&
      this.application
    ) {
      context.application =
        this.application;
    }

    context.bootstrap =
      this;

    context.bootstrapId =
      this.bootstrapId;

    context.applicationName =
      APPLICATION_NAME;

    context.serviceName =
      SERVICE_NAME;

    context.component =
      COMPONENT;

    context.version =
      VERSION;

    context.signal =
      this.lifecycleAbortController
        .signal;

    return context;
  }

  /* ===========================================================================
   * ENVIRONMENT
   * ===========================================================================
   */

  resolveEnvironment() {
    return Object.freeze({
      nodeEnv:
        process.env.NODE_ENV ||
        "development",

      serviceName:
        SERVICE_NAME,

      applicationName:
        APPLICATION_NAME,

      nodeVersion:
        process.version,

      platform:
        process.platform,

      architecture:
        process.arch,

      pid:
        process.pid,

      ppid:
        process.ppid,

      hostname:
        os.hostname(),

      cpuCount:
        os.cpus()?.length ||
        1,
    });
  }

  /* ===========================================================================
   * CONFIGURATION
   * ===========================================================================
   */

  resolveConfiguration() {
    return Object.freeze({
      environment:
        process.env.NODE_ENV ||
        "development",

      serviceName:
        SERVICE_NAME,

      applicationName:
        APPLICATION_NAME,

      port:
        asPositiveInteger(
          process.env.PORT,
          3000,
        ),

      host:
        process.env.HOST ||
        "0.0.0.0",
    });
  }

  /* ===========================================================================
   * APPLICATION
   * ===========================================================================
   */

  setApplication(
    application,
  ) {
    this.assertApplication(
      application,
    );

    if (
      this.started ||
      this.starting ||
      this.stopping
    ) {
      throw new ApplicationBootstrapError(
        "The Express application cannot be replaced while the application lifecycle is active.",
        {
          code:
            "APPLICATION_LOCKED",
        },
      );
    }

    this.application =
      application;

    if (
      this.context
    ) {
      this.context.application =
        application;
    }

    return application;
  }

  getApplication() {
    return (
      this.application ||
      this.context?.application ||
      null
    );
  }

  assertApplication(
    application,
  ) {
    if (
      !application ||
      typeof application !==
        "function"
    ) {
      throw new ApplicationBootstrapError(
        "A valid Express-compatible application is required.",
        {
          code:
            "APPLICATION_INVALID",
        },
      );
    }
  }

  /* ===========================================================================
   * LOGGER
   * ===========================================================================
   */

  setLogger(
    logger,
  ) {
    if (
      !logger ||
      typeof logger !==
        "object"
    ) {
      return this.logger;
    }

    this.logger =
      Object.freeze({
        ...createFallbackLogger(),
        ...logger,
      });

    return this.logger;
  }

  log(
    level,
    message,
    metadata = {},
  ) {
    try {
      const target =
        this.logger ||
        createFallbackLogger();

      if (
        typeof target[level] ===
        "function"
      ) {
        target[level](
          message,
          {
            component:
              COMPONENT,

            service:
              SERVICE_NAME,

            bootstrapId:
              this.bootstrapId,

            ...metadata,
          },
        );

        return;
      }
    } catch {
      // Logging must never break lifecycle execution.
    }

    try {
      const fallback =
        createFallbackLogger();

      fallback[level]?.(
        message,
        metadata,
      );
    } catch {
      // Deliberately ignored.
    }
  }

  /* ===========================================================================
   * PHASE REGISTRATION
   * ===========================================================================
   */

  registerDefaultPhases() {
    for (
      const definition of
        DEFAULT_PHASES
    ) {
      this.registerPhase(
        definition,
      );
    }

    return this;
  }

  registerCustomPhases(
    phases,
  ) {
    if (
      !Array.isArray(
        phases,
      )
    ) {
      return this;
    }

    for (
      const phase of
        phases
    ) {
      this.registerPhase(
        phase,
      );
    }

    return this;
  }

  registerPhase(
    definition,
  ) {
    if (
      !definition ||
      typeof definition !==
        "object"
    ) {
      throw new ApplicationBootstrapError(
        "Bootstrap phase definition must be an object.",
        {
          code:
            "BOOTSTRAP_PHASE_INVALID",
        },
      );
    }

    const name =
      String(
        definition.name ||
          "",
      ).trim();

    if (
      !name
    ) {
      throw new ApplicationBootstrapError(
        "Bootstrap phase requires a name.",
        {
          code:
            "BOOTSTRAP_PHASE_NAME_REQUIRED",
        },
      );
    }

    const priority =
      Number(
        definition.priority,
      );

    const dependencies =
      Array.isArray(
        definition.dependencies,
      )
        ? [
            ...new Set(
              definition.dependencies
                .map(
                  dependency =>
                    String(
                      dependency,
                    ).trim(),
                )
                .filter(
                  Boolean,
                ),
            ),
          ]
        : [];

    const normalized =
      {
        name,

        priority:
          Number.isFinite(
            priority,
          )
            ? priority
            : 500,

        required:
          definition.required !==
          false,

        enabled:
          definition.enabled !==
          false,

        dependencies,

        timeoutMs:
          asPositiveInteger(
            definition.timeoutMs,
            this.options
              .phaseTimeoutMs,
          ),

        start:
          typeof definition.start ===
          "function"
            ? definition.start
            : null,

        stop:
          typeof definition.stop ===
          "function"
            ? definition.stop
            : null,

        health:
          typeof definition.health ===
          "function"
            ? definition.health
            : null,

        readiness:
          typeof definition.readiness ===
          "function"
            ? definition.readiness
            : null,

        modulePath:
          definition.modulePath ||
          null,

        module:
          definition.module ||
          null,

        metadata:
          freezeCopy(
            definition.metadata ||
              {},
          ),
      };

    this.phaseDefinitions.set(
      name,
      Object.freeze(
        normalized,
      ),
    );

    this.phaseStates.set(
      name,
      this.createPhaseState(
        normalized,
      ),
    );

    /**
     * Replace cached implementation if the phase is re-registered.
     */
    this.phaseImplementations.delete(
      name,
    );

    return this;
  }

  unregisterPhase(
    name,
  ) {
    const phaseName =
      String(
        name || "",
      ).trim();

    if (
      !phaseName
    ) {
      return false;
    }

    const state =
      this.phaseStates.get(
        phaseName,
      );

    if (
      state &&
      (
        state.status ===
          "starting" ||
        state.status ===
          "started"
      )
    ) {
      throw new ApplicationBootstrapError(
        `Cannot unregister active bootstrap phase "${phaseName}".`,
        {
          code:
            "BOOTSTRAP_ACTIVE_PHASE",

          phase:
            phaseName,
        },
      );
    }

    this.phaseDefinitions.delete(
      phaseName,
    );

    this.phaseStates.delete(
      phaseName,
    );

    this.phaseImplementations.delete(
      phaseName,
    );

    return true;
  }

  createPhaseState(
    definition,
  ) {
    return {
      name:
        definition.name,

      priority:
        definition.priority,

      required:
        definition.required !==
        false,

      enabled:
        definition.enabled !==
        false,

      status:
        "pending",

      startedAt:
        null,

      completedAt:
        null,

      durationMs:
        0,

      error:
        null,

      module:
        null,

      result:
        null,

      rollbackAttempted:
        false,

      rollbackCompleted:
        false,

      rollbackError:
        null,

      skippedReason:
        null,
    };
  }

  /* ===========================================================================
   * MODULE DISCOVERY
   * ===========================================================================
   */

  resolveCandidate(
    candidate,
  ) {
    return resolveLocalModulePath(
      candidate,
      CURRENT_DIRECTORY,
    );
  }

  async discoverPhaseModule(
    phaseName,
    definition,
  ) {
    if (
      definition.module
    ) {
      return unwrapModule(
        definition.module,
      );
    }

    if (
      definition.modulePath
    ) {
      const resolved =
        this.resolveCandidate(
          definition.modulePath,
        );

      if (
        !resolved
      ) {
        throw new ApplicationBootstrapError(
          `Configured module path for phase "${phaseName}" does not exist.`,
          {
            code:
              "BOOTSTRAP_PHASE_MODULE_NOT_FOUND",

            phase:
              phaseName,

            details: {
              modulePath:
                definition.modulePath,
            },
          },
        );
      }

      const loaded =
        await importModule(
          resolved,
        );

      return unwrapModule(
        loaded,
      );
    }

    if (
      !this.options
        .autoDiscoverPhases
    ) {
      return null;
    }

    const candidates =
      PHASE_MODULE_CANDIDATES[
        phaseName
      ] || [];

    for (
      const candidate of
        candidates
    ) {
      const resolved =
        this.resolveCandidate(
          candidate,
        );

      if (
        !resolved
      ) {
        continue;
      }

      const loaded =
        await importModule(
          resolved,
        );

      return unwrapModule(
        loaded,
      );
    }

    return null;
  }

  resolveModuleFunction(
    module,
    names,
  ) {
    for (
      const name of
        names
    ) {
      if (
        typeof module?.[name] ===
        "function"
      ) {
        return module[name].bind(
          module,
        );
      }
    }

    if (
      typeof module ===
      "function"
    ) {
      return module;
    }

    return null;
  }

  async resolvePhaseImplementation(
    phaseName,
    definition,
  ) {
    if (
      this.phaseImplementations.has(
        phaseName,
      )
    ) {
      return this.phaseImplementations.get(
        phaseName,
      );
    }

    const explicit =
      {
        start:
          definition.start,

        stop:
          definition.stop,

        health:
          definition.health,

        readiness:
          definition.readiness,
      };

    const needsModule =
      !explicit.start ||
      !explicit.stop ||
      !explicit.health ||
      !explicit.readiness;

    if (
      !needsModule
    ) {
      const implementation =
        Object.freeze({
          module:
            null,

          ...explicit,
        });

      this.phaseImplementations.set(
        phaseName,
        implementation,
      );

      return implementation;
    }

    const module =
      await this.discoverPhaseModule(
        phaseName,
        definition,
      );

    if (
      !module
    ) {
      const implementation =
        Object.freeze({
          module:
            null,

          ...explicit,
        });

      this.phaseImplementations.set(
        phaseName,
        implementation,
      );

      return implementation;
    }

    const implementation =
      Object.freeze({
        module,

        start:
          explicit.start ||
          this.resolveModuleFunction(
            module,
            [
              "initialize",
              "init",
              "start",
              "bootstrap",
              "setup",
            ],
          ),

        stop:
          explicit.stop ||
          this.resolveModuleFunction(
            module,
            [
              "shutdown",
              "stop",
              "close",
              "dispose",
            ],
          ),

        health:
          explicit.health ||
          this.resolveModuleFunction(
            module,
            [
              "health",
              "getHealth",
            ],
          ),

        readiness:
          explicit.readiness ||
          this.resolveModuleFunction(
            module,
            [
              "readiness",
              "isReady",
            ],
          ),
      });

    this.phaseImplementations.set(
      phaseName,
      implementation,
    );

    return implementation;
  }

  /* ===========================================================================
   * PHASE ORDER
   * ===========================================================================
   */

  resolvePhaseOrder() {
    const definitions =
      Array.from(
        this.phaseDefinitions.values(),
      ).filter(
        definition =>
          definition.enabled,
      );

    const byName =
      new Map(
        definitions.map(
          definition => [
            definition.name,
            definition,
          ],
        ),
      );

    const visiting =
      new Set();

    const visited =
      new Set();

    const ordered =
      [];

    const visit =
      name => {
        if (
          visited.has(
            name,
          )
        ) {
          return;
        }

        if (
          visiting.has(
            name,
          )
        ) {
          throw new ApplicationBootstrapError(
            `Circular bootstrap phase dependency detected at "${name}".`,
            {
              code:
                "BOOTSTRAP_PHASE_CYCLE",

              phase:
                name,
            },
          );
        }

        const definition =
          byName.get(
            name,
          );

        if (
          !definition
        ) {
          throw new ApplicationBootstrapError(
            `Bootstrap phase dependency "${name}" is unavailable.`,
            {
              code:
                "BOOTSTRAP_PHASE_DEPENDENCY_MISSING",

              phase:
                name,
            },
          );
        }

        visiting.add(
          name,
        );

        for (
          const dependency of
            definition.dependencies
        ) {
          if (
            !byName.has(
              dependency,
            )
          ) {
            throw new ApplicationBootstrapError(
              `Bootstrap phase "${name}" depends on unknown phase "${dependency}".`,
              {
                code:
                  "BOOTSTRAP_PHASE_DEPENDENCY_MISSING",

                phase:
                  name,

                details: {
                  dependency,
                },
              },
            );
          }

          visit(
            dependency,
          );
        }

        visiting.delete(
          name,
        );

        visited.add(
          name,
        );

        ordered.push(
          definition,
        );
      };

    const sorted =
      [...definitions].sort(
        (
          left,
          right,
        ) =>
          left.priority -
            right.priority ||
          left.name.localeCompare(
            right.name,
          ),
      );

    for (
      const definition of
        sorted
    ) {
      visit(
        definition.name,
      );
    }

    return ordered;
  }

  /* ===========================================================================
   * PHASE EXECUTION
   * ===========================================================================
   */

  async executePhase(
    definition,
  ) {
    const state =
      this.phaseStates.get(
        definition.name,
      ) ||
      this.createPhaseState(
        definition,
      );

    this.phaseStates.set(
      definition.name,
      state,
    );

    state.status =
      "starting";

    state.startedAt =
      now();

    state.completedAt =
      null;

    state.durationMs =
      0;

    state.error =
      null;

    state.result =
      null;

    state.skippedReason =
      null;

    state.rollbackAttempted =
      false;

    state.rollbackCompleted =
      false;

    state.rollbackError =
      null;

    this.emit(
      "phase.starting",
      {
        phase:
          definition.name,
      },
    );

    const phaseStart =
      Date.now();

    try {
      const implementation =
        await this.resolvePhaseImplementation(
          definition.name,
          definition,
        );

      state.module =
        implementation.module;

      if (
        !implementation.start
      ) {
        if (
          definition.required &&
          !this.canSatisfyPhaseWithoutImplementation(
            definition.name,
          )
        ) {
          throw new ApplicationBootstrapError(
            `Required bootstrap phase "${definition.name}" is not available.`,
            {
              code:
                "BOOTSTRAP_REQUIRED_PHASE_UNAVAILABLE",

              phase:
                definition.name,
            },
          );
        }

        state.status =
          "skipped";

        state.skippedReason =
          "no_implementation";

        state.completedAt =
          now();

        state.durationMs =
          elapsedMs(
            phaseStart,
          );

        this.emit(
          "phase.skipped",
          {
            phase:
              definition.name,

            reason:
              state.skippedReason,
          },
        );

        return null;
      }

      const result =
        await withTimeout(
          signal =>
            implementation.start(
              this.context,
              this,
              signal,
            ),
          definition.timeoutMs,
          definition.name,
          {
            signal:
              this.lifecycleAbortController
                .signal,
          },
        );

      if (
        result &&
        typeof result ===
          "object"
      ) {
        if (
          result.application &&
          !this.application
        ) {
          this.setApplication(
            result.application,
          );
        }

        if (
          result.logger
        ) {
          this.setLogger(
            result.logger,
          );
        }

        if (
          result.context &&
          typeof result.context ===
            "object"
        ) {
          Object.assign(
            this.context,
            result.context,
          );
        }

        if (
          result.server
        ) {
          this.server =
            result.server;
        }

        if (
          result.serverModule
        ) {
          this.serverModule =
            result.serverModule;
        }
      }

      if (
        this.context?.application &&
        !this.application
      ) {
        this.application =
          this.context.application;
      }

      if (
        this.context?.logger
      ) {
        this.setLogger(
          this.context.logger,
        );
      }

      state.result =
        result;

      state.status =
        "started";

      state.completedAt =
        now();

      state.durationMs =
        elapsedMs(
          phaseStart,
        );

      this.completedPhases.push(
        definition.name,
      );

      this.emit(
        "phase.completed",
        {
          phase:
            definition.name,

          durationMs:
            state.durationMs,
        },
      );

      return result;
    } catch (error) {
      state.status =
        "failed";

      state.error =
        safeError(
          error,
        );

      state.completedAt =
        now();

      state.durationMs =
        elapsedMs(
          phaseStart,
        );

      this.emit(
        "phase.failed",
        {
          phase:
            definition.name,

          error:
            safeError(
              error,
            ),
        },
      );

      throw this.wrapPhaseError(
        error,
        definition.name,
      );
    }
  }

  canSatisfyPhaseWithoutImplementation(
    phaseName,
  ) {
    switch (
      phaseName
    ) {
      case "environment":
        return Boolean(
          this.context?.environment,
        );

      case "configuration":
        return Boolean(
          this.context?.config,
        );

      case "logger":
        return Boolean(
          this.logger,
        );

      case "readiness":
        return true;

      case "infrastructure":
      case "services":
      case "middleware":
      case "routes":
        return Boolean(
          this.context?.application ||
            this.application,
        );

      case "server":
        return Boolean(
          this.context?.server ||
            this.server,
        );

      default:
        return false;
    }
  }

  wrapPhaseError(
    error,
    phase,
  ) {
    if (
      error instanceof
      ApplicationBootstrapError
    ) {
      if (
        !error.phase
      ) {
        error.phase =
          phase;
      }

      return error;
    }

    return new ApplicationBootstrapError(
      `Application bootstrap phase "${phase}" failed.`,
      {
        code:
          "BOOTSTRAP_PHASE_FAILED",

        phase,

        cause:
          error,
      },
    );
  }

  /* ===========================================================================
   * SERVER ADAPTER
   * ===========================================================================
   */

  async resolveServerModule(
    context,
  ) {
    if (
      context?.serverModule
    ) {
      return unwrapModule(
        context.serverModule,
      );
    }

    if (
      this.options.serverModule
    ) {
      return unwrapModule(
        this.options.serverModule,
      );
    }

    const resolved =
      this.resolveCandidate(
        "./server",
      );

    if (
      !resolved
    ) {
      return null;
    }

    const loaded =
      await importModule(
        resolved,
      );

    return unwrapModule(
      loaded,
    );
  }

  async startServer() {
    if (
      !this.options.startServer
    ) {
      return null;
    }

    if (
      !this.application
    ) {
      throw new ApplicationBootstrapError(
        "Cannot start the TITech HTTP server before an application has been composed.",
        {
          code:
            "SERVER_APPLICATION_UNAVAILABLE",

          phase:
            "server",
        },
      );
    }

    const serverModule =
      this.serverModule ||
      (await this.resolveServerModule(
        this.context,
      ));

    if (
      !serverModule
    ) {
      throw new ApplicationBootstrapError(
        "HTTP server bootstrap adapter is unavailable.",
        {
          code:
            "SERVER_BOOTSTRAP_UNAVAILABLE",

          phase:
            "server",
        },
      );
    }

    this.serverModule =
      serverModule;

    const serverOptions =
      {
        ...(this.options.serverOptions ||
          {}),
      };

    serverOptions.app =
      this.application;

    serverOptions.application =
      this.application;

    serverOptions.applicationName =
      APPLICATION_NAME;

    serverOptions.serviceName =
      SERVICE_NAME;

    serverOptions.environment =
      this.context?.environment;

    serverOptions.config =
      this.context?.config;

    serverOptions.bootstrap =
      this;

    serverOptions.bootstrapId =
      this.bootstrapId;

    if (
      typeof serverModule.registerServerHooks ===
        "function" &&
      this.options.registerServerHooks
    ) {
      try {
        await serverModule.registerServerHooks(
          this.context,
          serverOptions,
        );
      } catch (error) {
        throw new ApplicationBootstrapError(
          "Unable to register TITech HTTP server lifecycle hooks.",
          {
            code:
              "SERVER_HOOK_REGISTRATION_FAILED",

            phase:
              "server",

            cause:
              error,
          },
        );
      }
    }

    const startFunction =
      serverModule.start ||
      serverModule.initialize;

    if (
      typeof startFunction !==
      "function"
    ) {
      throw new ApplicationBootstrapError(
        "TITech HTTP server bootstrap adapter does not expose start() or initialize().",
        {
          code:
            "SERVER_START_API_UNAVAILABLE",

          phase:
            "server",
        },
      );
    }

    const result =
      await startFunction(
        this.context,
        serverOptions,
      );

    this.server =
      result?.server ||
      result?.httpServer ||
      result?.httpsServer ||
      serverModule.getServer?.() ||
      null;

    this.context.server =
      this.server;

    this.context.serverModule =
      serverModule;

    this.context.serverResult =
      result;

    return result;
  }

  async stopServer(
    reason,
    metadata = {},
  ) {
    const serverModule =
      this.serverModule ||
      this.context?.serverModule;

    if (
      !serverModule
    ) {
      this.server =
        null;

      if (
        this.context
      ) {
        this.context.server =
          null;
      }

      return true;
    }

    const stopFunction =
      serverModule.stop ||
      serverModule.shutdown ||
      serverModule.close;

    if (
      typeof stopFunction !==
      "function"
    ) {
      this.server =
        null;

      if (
        this.context
      ) {
        this.context.server =
          null;
      }

      return true;
    }

    await stopFunction(
      reason,
      metadata,
      this.context,
      this,
    );

    this.server =
      null;

    if (
      this.context
    ) {
      this.context.server =
        null;
    }

    return true;
  }

  /* ===========================================================================
   * STARTUP
   * ===========================================================================
   */

  async start(
    suppliedContext = {},
  ) {
    if (
      this.destroyed
    ) {
      throw new ApplicationBootstrapError(
        "Cannot start a destroyed TITech application bootstrap.",
        {
          code:
            "BOOTSTRAP_DESTROYED",
        },
      );
    }

    if (
      this.started
    ) {
      return this.getSnapshot();
    }

    if (
      this.startPromise
    ) {
      await this.startPromise;

      return this.getSnapshot();
    }

    if (
      this.stopping
    ) {
      throw new ApplicationBootstrapError(
        "Cannot start application bootstrap while shutdown is in progress.",
        {
          code:
            "BOOTSTRAP_START_DURING_SHUTDOWN",
        },
      );
    }

    if (
      this.stopped &&
      !this.options.allowRestart
    ) {
      throw new ApplicationBootstrapError(
        "Application bootstrap cannot be restarted after shutdown.",
        {
          code:
            "BOOTSTRAP_ALREADY_STOPPED",
        },
      );
    }

    if (
      this.stopped &&
      this.options.allowRestart
    ) {
      this.prepareForRestart();
    }

    this.starting =
      true;

    this.failed =
      false;

    this.lastError =
      null;

    this.startedAt =
      now();

    this.completedPhases =
      [];

    if (
      !this.context
    ) {
      this.context =
        this.createContext(
          suppliedContext,
        );
    } else {
      Object.assign(
        this.context,
        suppliedContext || {},
      );

      this.context =
        this.createContext(
          this.context,
        );
    }

    if (
      this.context.application
    ) {
      this.setApplication(
        this.context.application,
      );
    }

    if (
      !this.initialized
    ) {
      this.initialized =
        true;

      this.initializedAt =
        now();
    }

    this.lifecycleAbortController =
      new AbortController();

    this.context.signal =
      this.lifecycleAbortController
        .signal;

    this.startPromise =
      withTimeout(
        signal =>
          this.performStartup(
            signal,
          ),
        this.options
          .startupTimeoutMs,
        "application-bootstrap",
      );

    try {
      await this.startPromise;

      this.starting =
        false;

      this.started =
        true;

      this.stopped =
        false;

      this.failed =
        false;

      this.emit(
        "started",
        this.getSnapshot(),
      );

      this.log(
        "info",
        "TITech application bootstrap completed.",
        {
          application:
            APPLICATION_NAME,

          durationMs:
            elapsedMs(
              this.startedAt,
            ),
        },
      );

      return this.getSnapshot();
    } catch (error) {
      this.starting =
        false;

      this.started =
        false;

      this.failed =
        true;

      this.lastError =
        error;

      this.emit(
        "failed",
        {
          error:
            safeError(
              error,
            ),
        },
      );

      throw error;
    } finally {
      this.startPromise =
        null;
    }
  }

  async performStartup(
    signal,
  ) {
    const order =
      this.resolvePhaseOrder();

    this.emit(
      "starting",
      {
        phases:
          order.map(
            phase =>
              phase.name,
          ),
      },
    );

    this.log(
      "info",
      "Starting TITech application bootstrap.",
      {
        phases:
          order.map(
            phase =>
              phase.name,
          ),
      },
    );

    try {
      for (
        const definition of
          order
      ) {
        if (
          signal?.aborted
        ) {
          throw new ApplicationBootstrapError(
            "TITech application bootstrap was aborted.",
            {
              code:
                "BOOTSTRAP_ABORTED",

              cause:
                signal.reason,
            },
          );
        }

        /**
         * The HTTP transport phase is intentionally handled separately.
         */
        if (
          definition.name ===
          "server"
        ) {
          await this.executeServerPhase(
            definition,
          );

          continue;
        }

        try {
          await this.executePhase(
            definition,
          );
        } catch (error) {
          /**
           * Required phases always fail startup.
           *
           * Optional phases may be allowed to fail while the remainder of
           * the application continues, controlled by
           * failOnOptionalPhaseError.
           */
          if (
            definition.required ||
            this.options
              .failOnOptionalPhaseError
          ) {
            throw error;
          }

          this.log(
            "warn",
            `Optional TITech bootstrap phase "${definition.name}" failed; continuing startup.`,
            {
              phase:
                definition.name,

              error:
                safeError(
                  error,
                ),
            },
          );
        }

        if (
          this.context?.application &&
          !this.application
        ) {
          this.application =
            this.context.application;
        }

        if (
          this.context?.logger
        ) {
          this.setLogger(
            this.context.logger,
          );
        }
      }

      if (
        this.options
          .requireApplication
      ) {
        this.assertApplication(
          this.application ||
            this.context?.application,
        );
      }

      this.application =
        this.application ||
        this.context?.application ||
        null;

      return this.getSnapshot();
    } catch (error) {
      this.log(
        "error",
        "TITech application startup failed. Beginning transactional rollback.",
        {
          error:
            safeError(
              error,
            ),
        },
      );

      const rollbackErrors =
        await this.rollback(
          error,
        );

      if (
        rollbackErrors.length > 0
      ) {
        this.log(
          "error",
          "TITech startup rollback completed with errors.",
          {
            rollbackErrors:
              rollbackErrors.map(
                safeError,
              ),
          },
        );
      }

      throw error;
    }
  }

  async executeServerPhase(
    definition,
  ) {
    const state =
      this.phaseStates.get(
        "server",
      ) ||
      this.createPhaseState(
        definition,
      );

    this.phaseStates.set(
      "server",
      state,
    );

    if (
      !this.options.startServer
    ) {
      state.status =
        "skipped";

      state.skippedReason =
        "disabled_by_option";

      state.completedAt =
        now();

      this.emit(
        "phase.skipped",
        {
          phase:
            "server",

          reason:
            state.skippedReason,
        },
      );

      return null;
    }

    state.status =
      "starting";

    state.startedAt =
      now();

    state.error =
      null;

    state.completedAt =
      null;

    this.emit(
      "phase.starting",
      {
        phase:
          "server",
      },
    );

    const serverStart =
      Date.now();

    try {
      const result =
        await withTimeout(
          () =>
            this.startServer(),
          definition.timeoutMs,
          "server",
          {
            signal:
              this.lifecycleAbortController
                .signal,
          },
        );

      state.result =
        result;

      state.status =
        "started";

      state.completedAt =
        now();

      state.durationMs =
        elapsedMs(
          serverStart,
        );

      this.completedPhases.push(
        "server",
      );

      this.emit(
        "phase.completed",
        {
          phase:
            "server",

          durationMs:
            state.durationMs,
        },
      );

      return result;
    } catch (error) {
      state.status =
        "failed";

      state.error =
        safeError(
          error,
        );

      state.completedAt =
        now();

      state.durationMs =
        elapsedMs(
          serverStart,
        );

      this.emit(
        "phase.failed",
        {
          phase:
            "server",

          error:
            safeError(
              error,
            ),
        },
      );

      throw this.wrapPhaseError(
        error,
        "server",
      );
    }
  }

  /* ===========================================================================
   * ROLLBACK
   * ===========================================================================
   */

  async rollback(
    cause,
  ) {
    const definitions =
      this.resolvePhaseOrder();

    const completedSet =
      new Set(
        this.completedPhases,
      );

    const errors =
      [];

    for (
      const definition of
        [...definitions].reverse()
    ) {
      if (
        !completedSet.has(
          definition.name,
        )
      ) {
        continue;
      }

      try {
        if (
          definition.name ===
          "server"
        ) {
          await this.stopServer(
            "bootstrap-rollback",
            {
              cause,
            },
          );

          const state =
            this.phaseStates.get(
              "server",
            );

          if (
            state
          ) {
            state.rollbackAttempted =
              true;

            state.rollbackCompleted =
              true;

            state.status =
              "stopped";
          }

          continue;
        }

        await this.stopPhase(
          definition,
        );
      } catch (error) {
        errors.push(
          error,
        );
      }
    }

    this.emit(
      "rollback.completed",
      {
        cause:
          safeError(
            cause,
          ),

        errors:
          errors.map(
            safeError,
          ),
      },
    );

    return errors;
  }

  /* ===========================================================================
   * PHASE SHUTDOWN
   * ===========================================================================
   */

  async stopPhase(
    definition,
  ) {
    const state =
      this.phaseStates.get(
        definition.name,
      );

    if (
      !state ||
      state.status !==
        "started"
    ) {
      return;
    }

    state.rollbackAttempted =
      true;

    const implementation =
      await this.resolvePhaseImplementation(
        definition.name,
        definition,
      );

    if (
      !implementation.stop
    ) {
      state.rollbackCompleted =
        true;

      state.status =
        "stopped";

      return;
    }

    try {
      await withTimeout(
        signal =>
          implementation.stop(
            this.context,
            this,
            signal,
          ),
        Math.min(
          definition.timeoutMs ||
            this.options
              .shutdownTimeoutMs,
          this.options
            .shutdownTimeoutMs,
        ),
        `${definition.name}-shutdown`,
      );

      state.rollbackCompleted =
        true;

      state.status =
        "stopped";
    } catch (error) {
      state.rollbackCompleted =
        false;

      state.rollbackError =
        safeError(
          error,
        );

      state.status =
        "failed";

      this.emit(
        "phase.shutdown_failed",
        {
          phase:
            definition.name,

          error:
            safeError(
              error,
            ),
        },
      );

      throw new ApplicationBootstrapError(
        `Shutdown of bootstrap phase "${definition.name}" failed.`,
        {
          code:
            "BOOTSTRAP_PHASE_SHUTDOWN_FAILED",

          phase:
            definition.name,

          cause:
            error,
        },
      );
    }
  }

  /* ===========================================================================
   * SHUTDOWN
   * ===========================================================================
   */

  async stop(
    reason =
      "application-request",
    metadata = {},
  ) {
    if (
      this.stopPromise
    ) {
      return this.stopPromise;
    }

    if (
      this.stopped
    ) {
      return true;
    }

    this.stopPromise =
      this.performShutdown(
        reason,
        metadata,
      );

    try {
      return await this.stopPromise;
    } finally {
      this.stopPromise =
        null;
    }
  }

  async shutdown(
    reason =
      "application-request",
    metadata = {},
  ) {
    return this.stop(
      reason,
      metadata,
    );
  }

  async performShutdown(
    reason,
    metadata = {},
  ) {
    if (
      this.stopping
    ) {
      return false;
    }

    this.stopping =
      true;

    this.started =
      false;

    try {
      if (
        !this.lifecycleAbortController
          .signal.aborted
      ) {
        this.lifecycleAbortController.abort(
          new Error(
            `Application shutdown requested: ${reason}`,
          ),
        );
      }
    } catch {
      // Abort is best effort.
    }

    this.emit(
      "stopping",
      {
        reason,

        signal:
          metadata?.signal ||
          null,
      },
    );

    this.log(
      "info",
      "Stopping TITech application bootstrap.",
      {
        reason,
      },
    );

    let shutdownError =
      null;

    /**
     * HTTP transport stops first.
     */
    try {
      await withTimeout(
        () =>
          this.stopServer(
            reason,
            metadata,
          ),
        this.options
          .shutdownTimeoutMs,
        "server-shutdown",
      );
    } catch (error) {
      shutdownError =
        error;
    }

    /**
     * Then stop all phases that actually reached started state.
     */
    const completed =
      [
        ...this.completedPhases,
      ].reverse();

    for (
      const phaseName of
        completed
    ) {
      if (
        phaseName ===
        "server"
      ) {
        continue;
      }

      const definition =
        this.phaseDefinitions.get(
          phaseName,
        );

      if (
        !definition
      ) {
        continue;
      }

      try {
        await this.stopPhase(
          definition,
        );
      } catch (error) {
        shutdownError =
          shutdownError ||
          error;
      }
    }

    this.stopping =
      false;

    this.stopped =
      !shutdownError;

    this.failed =
      Boolean(
        shutdownError,
      );

    this.stoppedAt =
      now();

    if (
      shutdownError
    ) {
      this.lastError =
        shutdownError;

      this.emit(
        "shutdown.failed",
        {
          reason,

          error:
            safeError(
              shutdownError,
            ),
        },
      );

      this.log(
        "error",
        "TITech application bootstrap shutdown completed with errors.",
        {
          reason,

          error:
            safeError(
              shutdownError,
            ),
        },
      );

      if (
        !this.options
          .allowPartialShutdown
      ) {
        throw shutdownError;
      }

      return false;
    }

    this.emit(
      "stopped",
      {
        reason,
      },
    );

    this.log(
      "info",
      "TITech application bootstrap stopped.",
      {
        reason,

        durationMs:
          this.startedAt
            ? elapsedMs(
                this.startedAt,
              )
            : 0,
      },
    );

    return true;
  }

  /* ===========================================================================
   * READINESS
   * ===========================================================================
   */

  async readiness() {
    const phaseResults =
      {};

    for (
      const definition of
        this.resolvePhaseOrder()
    ) {
      const state =
        this.phaseStates.get(
          definition.name,
        );

      if (
        state?.status !==
          "started" &&
        definition.name !==
          "readiness"
      ) {
        continue;
      }

      const implementation =
        await this.resolvePhaseImplementation(
          definition.name,
          definition,
        );

      if (
        typeof implementation.readiness !==
        "function"
      ) {
        continue;
      }

      try {
        const result =
          await implementation.readiness(
            this.context,
            this,
          );

        phaseResults[
          definition.name
        ] =
          typeof result ===
          "boolean"
            ? {
                ready:
                  result,
              }
            : result;
      } catch (error) {
        phaseResults[
          definition.name
        ] = {
          ready:
            false,

          error:
            safeError(
              error,
            ),
        };
      }
    }

    const failedRequired =
      Object.entries(
        phaseResults,
      ).filter(
        ([
          phaseName,
          result,
        ]) => {
          const definition =
            this.phaseDefinitions.get(
              phaseName,
            );

          return (
            definition?.required !==
              false &&
            result &&
            result.ready ===
              false
          );
        },
      );

    const ready =
      this.started &&
      !this.stopping &&
      !this.failed &&
      failedRequired.length ===
        0;

    return {
      ready,

      status:
        ready
          ? "ready"
          : "not_ready",

      application:
        APPLICATION_NAME,

      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      bootstrapId:
        this.bootstrapId,

      phases:
        phaseResults,

      timestamp:
        new Date().toISOString(),
    };
  }

  /* ===========================================================================
   * HEALTH
   * ===========================================================================
   */

  async health() {
    const phaseResults =
      {};

    for (
      const definition of
        this.resolvePhaseOrder()
    ) {
      const state =
        this.phaseStates.get(
          definition.name,
        );

      if (
        state?.status !==
        "started"
      ) {
        continue;
      }

      const implementation =
        await this.resolvePhaseImplementation(
          definition.name,
          definition,
        );

      if (
        typeof implementation.health !==
        "function"
      ) {
        continue;
      }

      try {
        phaseResults[
          definition.name
        ] =
          await implementation.health(
            this.context,
            this,
          );
      } catch (error) {
        phaseResults[
          definition.name
        ] = {
          status:
            "unhealthy",

          healthy:
            false,

          error:
            safeError(
              error,
            ),
        };
      }
    }

    const unhealthy =
      Object.values(
        phaseResults,
      ).some(
        result =>
          result &&
          (
            result.status ===
              "unhealthy" ||
            result.healthy ===
              false
          ),
      );

    return {
      status:
        !this.started
          ? "degraded"
          : unhealthy ||
              this.failed
            ? "unhealthy"
            : "healthy",

      application:
        APPLICATION_NAME,

      started:
        this.started,

      stopping:
        this.stopping,

      stopped:
        this.stopped,

      failed:
        this.failed,

      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      bootstrapId:
        this.bootstrapId,

      applicationAvailable:
        Boolean(
          this.application,
        ),

      serverAvailable:
        Boolean(
          this.server,
        ),

      phases:
        phaseResults,

      timestamp:
        new Date().toISOString(),
    };
  }

  /* ===========================================================================
   * SNAPSHOT
   * ===========================================================================
   */

  getSnapshot() {
    const phases =
      {};

    for (
      const [
        name,
        state,
      ] of this.phaseStates
    ) {
      phases[name] =
        Object.freeze({
          name:
            state.name,

          priority:
            state.priority,

          required:
            state.required,

          enabled:
            state.enabled,

          status:
            state.status,

          startedAt:
            state.startedAt,

          completedAt:
            state.completedAt,

          durationMs:
            state.durationMs,

          error:
            state.error,

          skippedReason:
            state.skippedReason,

          rollbackAttempted:
            state.rollbackAttempted,

          rollbackCompleted:
            state.rollbackCompleted,

          rollbackError:
            state.rollbackError,
        });
    }

    return Object.freeze({
      application:
        APPLICATION_NAME,

      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      version:
        VERSION,

      bootstrapId:
        this.bootstrapId,

      initialized:
        this.initialized,

      initializedAt:
        this.initializedAt,

      starting:
        this.starting,

      started:
        this.started,

      stopping:
        this.stopping,

      stopped:
        this.stopped,

      failed:
        this.failed,

      destroyed:
        this.destroyed,

      applicationAvailable:
        Boolean(
          this.application,
        ),

      serverAvailable:
        Boolean(
          this.server,
        ),

      startedAt:
        this.startedAt,

      stoppedAt:
        this.stoppedAt,

      lastError:
        safeError(
          this.lastError,
        ),

      completedPhases:
        Object.freeze([
          ...this.completedPhases,
        ]),

      phases:
        Object.freeze(
          phases,
        ),
    });
  }

  snapshot() {
    return this.getSnapshot();
  }

  getState() {
    return this.getSnapshot();
  }

  /* ===========================================================================
   * PREDICATES
   * ===========================================================================
   */

  isInitialized() {
    return this.initialized;
  }

  isStarting() {
    return this.starting;
  }

  isStarted() {
    return this.started;
  }

  isStopping() {
    return this.stopping;
  }

  isStopped() {
    return this.stopped;
  }

  isFailed() {
    return this.failed;
  }

  isDestroyed() {
    return this.destroyed;
  }

  isReady() {
    return (
      this.started &&
      !this.stopping &&
      !this.failed
    );
  }

  /* ===========================================================================
   * EVENTS
   * ===========================================================================
   */

  on(
    event,
    listener,
  ) {
    this.events.on(
      event,
      listener,
    );

    return this;
  }

  once(
    event,
    listener,
  ) {
    this.events.once(
      event,
      listener,
    );

    return this;
  }

  off(
    event,
    listener,
  ) {
    this.events.off(
      event,
      listener,
    );

    return this;
  }

  emit(
    event,
    payload = {},
  ) {
    try {
      this.events.emit(
        event,
        {
          application:
            APPLICATION_NAME,

          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          bootstrapId:
            this.bootstrapId,

          timestamp:
            new Date().toISOString(),

          ...payload,
        },
      );
    } catch {
      /**
       * Subscriber failures must never break lifecycle execution.
       */
    }
  }

  /* ===========================================================================
   * RESTART SUPPORT
   * ===========================================================================
   */

  prepareForRestart() {
    if (
      this.starting ||
      this.started ||
      this.stopping
    ) {
      throw new ApplicationBootstrapError(
        "Cannot prepare TITech bootstrap for restart while active.",
        {
          code:
            "BOOTSTRAP_RESTART_ACTIVE",
        },
      );
    }

    this.stopped =
      false;

    this.failed =
      false;

    this.lastError =
      null;

    this.startedAt =
      null;

    this.stoppedAt =
      null;

    this.completedPhases =
      [];

    this.phaseImplementations.clear();

    this.lifecycleAbortController =
      new AbortController();

    if (
      this.context
    ) {
      this.context.signal =
        this.lifecycleAbortController
          .signal;
    }

    for (
      const definition of
        this.phaseDefinitions.values()
    ) {
      this.phaseStates.set(
        definition.name,
        this.createPhaseState(
          definition,
        ),
      );
    }

    return true;
  }

  /* ===========================================================================
   * RESET
   * ===========================================================================
   */

  reset() {
    if (
      this.starting ||
      this.started ||
      this.stopping
    ) {
      throw new ApplicationBootstrapError(
        "Cannot reset an active TITech application bootstrap.",
        {
          code:
            "BOOTSTRAP_RESET_NOT_ALLOWED",
        },
      );
    }

    this.context =
      null;

    this.application =
      null;

    this.server =
      null;

    this.serverModule =
      null;

    this.phaseStates =
      new Map();

    this.phaseImplementations
      .clear();

    this.completedPhases =
      [];

    this.startPromise =
      null;

    this.stopPromise =
      null;

    this.starting =
      false;

    this.started =
      false;

    this.stopping =
      false;

    this.stopped =
      false;

    this.failed =
      false;

    this.lastError =
      null;

    this.startedAt =
      null;

    this.stoppedAt =
      null;

    this.initialized =
      false;

    this.initializedAt =
      null;

    this.destroyed =
      false;

    this.bootstrapId =
      this.createBootstrapId();

    this.lifecycleAbortController =
      new AbortController();

    for (
      const definition of
        this.phaseDefinitions.values()
    ) {
      this.phaseStates.set(
        definition.name,
        this.createPhaseState(
          definition,
        ),
      );
    }

    return true;
  }

  /* ===========================================================================
   * DESTROY
   * ===========================================================================
   */

  async destroy() {
    if (
      this.destroyed
    ) {
      return true;
    }

    if (
      this.started ||
      this.starting ||
      this.stopping
    ) {
      await this.stop(
        "bootstrap-destroy",
      );
    }

    try {
      if (
        !this.lifecycleAbortController
          .signal.aborted
      ) {
        this.lifecycleAbortController.abort(
          new Error(
            "TITech application bootstrap destroyed.",
          ),
        );
      }
    } catch {
      // Best effort.
    }

    this.phaseImplementations.clear();

    this.events.removeAllListeners();

    this.destroyed =
      true;

    return true;
  }
}

/* =============================================================================
 * FACTORY
 * =============================================================================
 */

function createApplicationBootstrap(
  options = {},
) {
  return new ApplicationBootstrap(
    options,
  );
}

/* =============================================================================
 * LAZY SINGLETON
 * =============================================================================
 */

let defaultBootstrap =
  null;

function getApplicationBootstrap(
  options = {},
) {
  if (
    !defaultBootstrap
  ) {
    defaultBootstrap =
      new ApplicationBootstrap(
        options,
      );
  }

  return defaultBootstrap;
}

/* =============================================================================
 * CONVENIENCE API
 * =============================================================================
 */

async function startApplication(
  context = {},
  options = {},
) {
  const bootstrap =
    getApplicationBootstrap(
      options,
    );

  if (
    context?.application
  ) {
    bootstrap.setApplication(
      context.application,
    );
  }

  if (
    !bootstrap.isInitialized()
  ) {
    bootstrap.initialize(
      context,
    );
  }

  return bootstrap.start(
    context,
  );
}

async function shutdownApplication(
  reason =
    "application-request",
  metadata = {},
) {
  if (
    !defaultBootstrap
  ) {
    return true;
  }

  return defaultBootstrap.stop(
    reason,
    metadata,
  );
}

function getApplication() {
  return (
    defaultBootstrap
      ?.getApplication() ||
    null
  );
}

function getBootstrapState() {
  return (
    defaultBootstrap
      ?.getSnapshot() || {
        application:
          APPLICATION_NAME,

        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        started:
          false,

        stopped:
          false,
      }
  );
}

/* =============================================================================
 * ESM EXPORTS
 * =============================================================================
 */

export {
  ApplicationBootstrap,

  ApplicationBootstrapError,

  createApplicationBootstrap,

  getApplicationBootstrap,

  startApplication,

  shutdownApplication,

  getApplication,

  getBootstrapState,

  APPLICATION_NAME,

  COMPONENT,

  SERVICE_NAME,

  VERSION,

  DEFAULTS,

  DEFAULT_PHASES,
};