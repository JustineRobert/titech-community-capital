<<<<<<< HEAD
=======
'use strict';

>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
 * `backend/bootstrap/server.js` is the canonical HTTP transport adapter.
=======
 * `backend/bootstrap/server.js` is treated as the canonical HTTP transport
 * adapter.
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
 *
 * ApplicationBootstrap prepares the application and delegates network startup
 * and shutdown to that adapter.
 *
<<<<<<< HEAD
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
=======
 * =============================================================================
 */

const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

/* =============================================================================
 * METADATA
 * =============================================================================
 */

const COMPONENT =
<<<<<<< HEAD
  "application-bootstrap";

const APPLICATION_NAME =
  process.env.APPLICATION_NAME ||
  "TITech Community Capital";
=======
  'application-bootstrap';

const APPLICATION_NAME =
  process.env.APPLICATION_NAME ||
  'TITech Community Capital';
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
<<<<<<< HEAD
  "titech-community-capital-backend";

const VERSION =
  process.env.APP_BOOTSTRAP_VERSION ||
  "2026.1";
=======
  'titech-community-capital-backend';

const VERSION =
  process.env.APP_BOOTSTRAP_VERSION ||
  '2026.1';
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

/* =============================================================================
 * DEFAULTS
 * =============================================================================
 */

<<<<<<< HEAD
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
=======
const DEFAULTS = Object.freeze({
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
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

/* =============================================================================
 * CANONICAL PHASE DEFINITIONS
 * =============================================================================
 */

<<<<<<< HEAD
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
=======
const DEFAULT_PHASES = Object.freeze([
  Object.freeze({
    name:
      'environment',

    priority:
      100,

    required:
      true,

    dependencies:
      [],
  }),

  Object.freeze({
    name:
      'configuration',

    priority:
      200,

    required:
      true,

    dependencies:
      ['environment'],
  }),

  Object.freeze({
    name:
      'logger',

    priority:
      300,

    required:
      true,

    dependencies:
      ['configuration'],
  }),

  Object.freeze({
    name:
      'observability',

    priority:
      400,

    required:
      false,

    dependencies:
      ['logger'],
  }),

  Object.freeze({
    name:
      'readiness',

    priority:
      500,

    required:
      true,

    dependencies:
      ['configuration'],
  }),

  Object.freeze({
    name:
      'resilience',

    priority:
      600,

    required:
      false,

    dependencies:
      ['configuration'],
    }),

  Object.freeze({
    name:
      'infrastructure',

    priority:
      700,

    required:
      true,

    dependencies:
      ['configuration'],
  }),

  Object.freeze({
    name:
      'services',

    priority:
      800,

    required:
      true,

    dependencies:
      ['infrastructure'],
  }),

  Object.freeze({
    name:
      'middleware',

    priority:
      900,

    required:
      true,

    dependencies:
      ['services'],
  }),

  Object.freeze({
    name:
      'routes',

    priority:
      950,

    required:
      true,

    dependencies:
      ['middleware'],
  }),

  Object.freeze({
    name:
      'server',

    priority:
      1000,

    required:
      true,

    dependencies:
      ['routes'],
  }),
]);
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

/* =============================================================================
 * PHASE MODULE CANDIDATES
 * =============================================================================
<<<<<<< HEAD
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
=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
 */

const PHASE_MODULE_CANDIDATES =
  Object.freeze({
    environment:
      Object.freeze([
<<<<<<< HEAD
        "./environment",
        "./environmentLoader",
        "../config/environment",
        "../config/env",
=======
        './environment',
        './environmentLoader',
        '../config/environment',
        '../config/env',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ]),

    configuration:
      Object.freeze([
<<<<<<< HEAD
        "./configuration",
        "./config",
        "../config",
        "../config/index",
=======
        './configuration',
        './config',
        '../config',
        '../config/index',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ]),

    logger:
      Object.freeze([
<<<<<<< HEAD
        "./logger",
        "../utils/logger",
        "../utils/logger/index",
=======
        './logger',
        '../utils/logger',
        '../utils/logger/index',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ]),

    observability:
      Object.freeze([
<<<<<<< HEAD
        "./observability",
        "../observability",
        "../monitoring/observability",
=======
        './observability',
        '../observability',
        '../monitoring/observability',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ]),

    readiness:
      Object.freeze([
<<<<<<< HEAD
        "./readinessState",
        "./readiness",
=======
        './readinessState',
        './readiness',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ]),

    resilience:
      Object.freeze([
<<<<<<< HEAD
        "./resilience",
        "../resilience",
=======
        './resilience',
        '../resilience',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ]),

    infrastructure:
      Object.freeze([
<<<<<<< HEAD
        "./infrastructure",
        "../infrastructure",
=======
        './infrastructure',
        '../infrastructure',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ]),

    services:
      Object.freeze([
<<<<<<< HEAD
        "./services",
        "../services",
=======
        './services',
        '../services',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ]),

    middleware:
      Object.freeze([
<<<<<<< HEAD
        "./middleware",
        "../middleware",
=======
        './middleware',
        '../middleware',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ]),

    routes:
      Object.freeze([
<<<<<<< HEAD
        "./routes",
        "../routes",
=======
        './routes',
        '../routes',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ]),

    server:
      Object.freeze([
<<<<<<< HEAD
        "./server",
=======
        './server',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
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
=======
    super(message);

    this.name =
      'ApplicationBootstrapError';

    this.code =
      options.code ||
      'APPLICATION_BOOTSTRAP_ERROR';
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

    this.phase =
      options.phase ||
      null;

<<<<<<< HEAD
    this.component =
      options.component ||
      COMPONENT;

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
    value === ""
=======
    value === ''
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
  ) {
    return fallback;
  }

  if (
<<<<<<< HEAD
    typeof value === "boolean"
=======
    typeof value ===
    'boolean'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
  ) {
    return value;
  }

  return [
<<<<<<< HEAD
    "1",
    "true",
    "yes",
    "on",
    "enabled",
=======
    '1',
    'true',
    'yes',
    'on',
    'enabled',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
    value === ""
=======
    value === ''
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      : Number(
          startedAt,
        );
=======
      : Number(startedAt);
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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

<<<<<<< HEAD
=======
function isPromiseLike(
  value,
) {
  return Boolean(
    value &&
      typeof value.then ===
        'function',
  );
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
      'Error',

    code:
      error.code ||
      null,

    message:
      error.message ||
      String(error),

    phase:
      error.phase ||
      null,
  };
}

function moduleExists(
  modulePath,
) {
  try {
    require.resolve(
      modulePath,
    );

    return true;
  } catch {
    return false;
  }
}

function loadModule(
  modulePath,
) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(
      modulePath,
    );
  } catch (error) {
    throw new ApplicationBootstrapError(
      `Unable to load bootstrap module: ${modulePath}`,
      {
        code:
          'BOOTSTRAP_MODULE_LOAD_FAILED',

        cause:
          error,

        details: {
          modulePath,
        },
      },
    );
  }
}

function unwrapModule(
  value,
) {
  if (
    value &&
    typeof value ===
      'object' &&
    value.default
  ) {
    return value.default;
  }

  return value;
}

>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
function freezeCopy(
  value,
) {
  if (
    !value ||
    typeof value !==
<<<<<<< HEAD
      "object"
=======
      'object'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
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

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "test"
=======
        'test'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ) {
        console.debug(
          prefix,
          message,
<<<<<<< HEAD
          metadata || "",
=======
          metadata || '',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        metadata || "",
=======
        metadata || '',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      );
    },

    warn(
      message,
      metadata,
    ) {
      console.warn(
        prefix,
        message,
<<<<<<< HEAD
        metadata || "",
=======
        metadata || '',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      );
    },

    error(
      message,
      metadata,
    ) {
      console.error(
        prefix,
        message,
<<<<<<< HEAD
        metadata || "",
=======
        metadata || '',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
    options.signal ||
    null;
=======
    options.signal || null;
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

  const controller =
    new AbortController();

  const signal =
    controller.signal;

<<<<<<< HEAD
  let abortParent =
    null;

  let parentListenerInstalled =
    false;
=======
  if (
    parentSignal
  ) {
    if (
      parentSignal.aborted
    ) {
      controller.abort(
        parentSignal.reason,
      );
    } else {
      parentSignal.addEventListener(
        'abort',
        () => {
          controller.abort(
            parentSignal.reason,
          );
        },
        {
          once:
            true,
        },
      );
    }
  }
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

  return new Promise(
    (
      resolve,
      reject,
    ) => {
      let settled =
        false;

<<<<<<< HEAD
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
=======
      const cleanup =
        () => {
          clearTimeout(
            timer,
          );

          parentSignal?.removeEventListener?.(
            'abort',
            abortParent,
          );
        };

      const abortParent =
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        () => {
          if (
            settled
          ) {
            return;
          }

          controller.abort(
<<<<<<< HEAD
            parentSignal?.reason,
=======
            parentSignal.reason,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
          );

          settled =
            true;

          cleanup();

          reject(
            new ApplicationBootstrapError(
              `Bootstrap phase "${phase}" was aborted.`,
              {
                code:
<<<<<<< HEAD
                  "BOOTSTRAP_PHASE_ABORTED",
=======
                  'BOOTSTRAP_PHASE_ABORTED',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

                phase,

                cause:
<<<<<<< HEAD
                  parentSignal?.reason,
=======
                  parentSignal.reason,

                details: {
                  timeoutMs:
                    timeout,
                },
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
              },
            ),
          );
        };

<<<<<<< HEAD
      timer =
=======
      const timer =
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
                    "BOOTSTRAP_PHASE_TIMEOUT",
=======
                    'BOOTSTRAP_PHASE_TIMEOUT',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
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
=======
        parentSignal
      ) {
        parentSignal.addEventListener(
          'abort',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
          abortParent,
          {
            once:
              true,
          },
        );
<<<<<<< HEAD

        parentListenerInstalled =
          true;
=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
    this.phaseImplementations =
      new Map();

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

  normalizeOptions(
    options,
  ) {
    const source =
      options &&
      typeof options ===
<<<<<<< HEAD
        "object"
=======
        'object'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      "-",
=======
      '-',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    );
  }

  /* ===========================================================================
   * INITIALIZATION
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

  initialize(
    suppliedContext = {},
  ) {
    if (
      this.destroyed
    ) {
      throw new ApplicationBootstrapError(
<<<<<<< HEAD
        "Cannot initialize a destroyed TITech application bootstrap.",
        {
          code:
            "BOOTSTRAP_DESTROYED",
=======
        'Cannot initialize a destroyed TITech application bootstrap.',
        {
          code:
            'BOOTSTRAP_DESTROYED',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        },
      );
    }

    if (
      this.started ||
      this.starting
    ) {
      throw new ApplicationBootstrapError(
<<<<<<< HEAD
        "Cannot initialize application bootstrap after startup has begun.",
        {
          code:
            "BOOTSTRAP_INITIALIZATION_LOCKED",
=======
        'Cannot initialize application bootstrap after startup has begun.',
        {
          code:
            'BOOTSTRAP_INITIALIZATION_LOCKED',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        },
      );
    }

    const incoming =
      suppliedContext &&
      typeof suppliedContext ===
<<<<<<< HEAD
        "object"
=======
        'object'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      "initialized",
=======
      'initialized',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

  createContext(
    suppliedContext = {},
  ) {
    const context =
      suppliedContext &&
      typeof suppliedContext ===
<<<<<<< HEAD
        "object"
=======
        'object'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      this.lifecycleAbortController
        .signal;
=======
      this.lifecycleAbortController.signal;
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

    return context;
  }

  /* ===========================================================================
   * ENVIRONMENT
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

  resolveEnvironment() {
    return Object.freeze({
      nodeEnv:
        process.env.NODE_ENV ||
<<<<<<< HEAD
        "development",
=======
        'development',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

  resolveConfiguration() {
    return Object.freeze({
      environment:
        process.env.NODE_ENV ||
<<<<<<< HEAD
        "development",
=======
        'development',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
        "0.0.0.0",
=======
        '0.0.0.0',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    });
  }

  /* ===========================================================================
   * APPLICATION
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
        "The Express application cannot be replaced while the application lifecycle is active.",
        {
          code:
            "APPLICATION_LOCKED",
=======
        'The Express application cannot be replaced while the application lifecycle is active.',
        {
          code:
            'APPLICATION_LOCKED',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "function"
    ) {
      throw new ApplicationBootstrapError(
        "A valid Express-compatible application is required.",
        {
          code:
            "APPLICATION_INVALID",
=======
        'function'
    ) {
      throw new ApplicationBootstrapError(
        'A valid Express-compatible application is required.',
        {
          code:
            'APPLICATION_INVALID',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        },
      );
    }
  }

  /* ===========================================================================
   * LOGGER
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

  setLogger(
    logger,
  ) {
    if (
      !logger ||
      typeof logger !==
<<<<<<< HEAD
        "object"
=======
        'object'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "function"
=======
        'function'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
        "object"
    ) {
      throw new ApplicationBootstrapError(
        "Bootstrap phase definition must be an object.",
        {
          code:
            "BOOTSTRAP_PHASE_INVALID",
=======
        'object'
    ) {
      throw new ApplicationBootstrapError(
        'Bootstrap phase definition must be an object.',
        {
          code:
            'BOOTSTRAP_PHASE_INVALID',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        },
      );
    }

    const name =
      String(
        definition.name ||
<<<<<<< HEAD
          "",
=======
          '',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ).trim();

    if (
      !name
    ) {
      throw new ApplicationBootstrapError(
<<<<<<< HEAD
        "Bootstrap phase requires a name.",
        {
          code:
            "BOOTSTRAP_PHASE_NAME_REQUIRED",
=======
        'Bootstrap phase requires a name.',
        {
          code:
            'BOOTSTRAP_PHASE_NAME_REQUIRED',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
          "function"
=======
          'function'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
            ? definition.start
            : null,

        stop:
          typeof definition.stop ===
<<<<<<< HEAD
          "function"
=======
          'function'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
            ? definition.stop
            : null,

        health:
          typeof definition.health ===
<<<<<<< HEAD
          "function"
=======
          'function'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
            ? definition.health
            : null,

        readiness:
          typeof definition.readiness ===
<<<<<<< HEAD
          "function"
=======
          'function'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
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
=======
    if (
      !this.phaseStates.has(
        name,
      )
    ) {
      this.phaseStates.set(
        name,
        this.createPhaseState(
          normalized,
        ),
      );
    }
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

    return this;
  }

  unregisterPhase(
    name,
  ) {
    const phaseName =
      String(
<<<<<<< HEAD
        name || "",
=======
        name || '',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
          "starting" ||
        state.status ===
          "started"
=======
          'starting' ||
        state.status ===
          'started'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      )
    ) {
      throw new ApplicationBootstrapError(
        `Cannot unregister active bootstrap phase "${phaseName}".`,
        {
          code:
<<<<<<< HEAD
            "BOOTSTRAP_ACTIVE_PHASE",
=======
            'BOOTSTRAP_ACTIVE_PHASE',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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

<<<<<<< HEAD
    this.phaseImplementations.delete(
      phaseName,
    );

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "pending",
=======
        'pending',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD

      skippedReason:
        null,
=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    };
  }

  /* ===========================================================================
   * MODULE DISCOVERY
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

  resolveCandidate(
    candidate,
  ) {
<<<<<<< HEAD
    return resolveLocalModulePath(
      candidate,
      CURRENT_DIRECTORY,
    );
  }

  async discoverPhaseModule(
=======
    if (
      path.isAbsolute(
        candidate,
      )
    ) {
      return moduleExists(
        candidate,
      )
        ? candidate
        : null;
    }

    const absolute =
      path.resolve(
        __dirname,
        candidate,
      );

    return moduleExists(
      absolute,
    )
      ? absolute
      : null;
  }

  discoverPhaseModule(
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
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
=======
      if (
        !moduleExists(
          this.resolveCandidate(
            definition.modulePath,
          ) ||
            definition.modulePath,
        )
      ) {
        return null;
      }

      return unwrapModule(
        loadModule(
          this.resolveCandidate(
            definition.modulePath,
          ) ||
            definition.modulePath,
        ),
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
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
=======
        resolved
      ) {
        return unwrapModule(
          loadModule(
            resolved,
          ),
        );
      }
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "function"
=======
        'function'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ) {
        return module[name].bind(
          module,
        );
      }
    }

    if (
      typeof module ===
<<<<<<< HEAD
      "function"
=======
      'function'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    ) {
      return module;
    }

    return null;
  }

<<<<<<< HEAD
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

=======
  resolvePhaseImplementation(
    phaseName,
    definition,
  ) {
    /**
     * Explicitly supplied handlers always win.
     */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
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
=======
      return {
        module:
          null,

        ...explicit,
      };
    }

    const module =
      this.discoverPhaseModule(
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        phaseName,
        definition,
      );

    if (
      !module
    ) {
<<<<<<< HEAD
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
=======
      return {
        module:
          null,

        ...explicit,
      };
    }

    return {
      module,

      start:
        explicit.start ||
        this.resolveModuleFunction(
          module,
          [
            'initialize',
            'init',
            'start',
            'bootstrap',
            'setup',
          ],
        ),

      stop:
        explicit.stop ||
        this.resolveModuleFunction(
          module,
          [
            'shutdown',
            'stop',
            'close',
            'dispose',
          ],
        ),

      health:
        explicit.health ||
        this.resolveModuleFunction(
          module,
          [
            'health',
            'getHealth',
          ],
        ),

      readiness:
        explicit.readiness ||
        this.resolveModuleFunction(
          module,
          [
            'readiness',
            'isReady',
          ],
        ),
    };
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
  }

  /* ===========================================================================
   * PHASE ORDER
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
                "BOOTSTRAP_PHASE_CYCLE",
=======
                'BOOTSTRAP_PHASE_CYCLE',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
            `Bootstrap phase dependency "${name}" is unavailable.`,
            {
              code:
                "BOOTSTRAP_PHASE_DEPENDENCY_MISSING",
=======
            `Bootstrap phase "${name}" depends on an unavailable phase "${name}".`,
            {
              code:
                'BOOTSTRAP_PHASE_DEPENDENCY_MISSING',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
                  "BOOTSTRAP_PHASE_DEPENDENCY_MISSING",
=======
                  'BOOTSTRAP_PHASE_DEPENDENCY_MISSING',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
      "starting";
=======
      'starting';
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

    state.startedAt =
      now();

    state.completedAt =
      null;

<<<<<<< HEAD
    state.durationMs =
      0;

    state.error =
      null;

    state.result =
      null;

    state.skippedReason =
      null;

=======
    state.error =
      null;

>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    state.rollbackAttempted =
      false;

    state.rollbackCompleted =
      false;

    state.rollbackError =
      null;

    this.emit(
<<<<<<< HEAD
      "phase.starting",
=======
      'phase.starting',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      {
        phase:
          definition.name,
      },
    );

<<<<<<< HEAD
=======
    const implementation =
      this.resolvePhaseImplementation(
        definition.name,
        definition,
      );

    state.module =
      implementation.module;

>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    const phaseStart =
      Date.now();

    try {
<<<<<<< HEAD
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
=======
      if (
        !implementation.start
      ) {
        /**
         * Optional phases may legitimately be absent.
         *
         * Required phases fail only when no valid implementation exists and
         * the phase cannot be satisfied by already prepared application state.
         */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
                "BOOTSTRAP_REQUIRED_PHASE_UNAVAILABLE",
=======
                'BOOTSTRAP_REQUIRED_PHASE_UNAVAILABLE',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

              phase:
                definition.name,
            },
          );
        }

        state.status =
<<<<<<< HEAD
          "skipped";

        state.skippedReason =
          "no_implementation";
=======
          'skipped';
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

        state.completedAt =
          now();

        state.durationMs =
          elapsedMs(
            phaseStart,
          );

        this.emit(
<<<<<<< HEAD
          "phase.skipped",
          {
            phase:
              definition.name,

            reason:
              state.skippedReason,
=======
          'phase.skipped',
          {
            phase:
              definition.name,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
      if (
        result &&
        typeof result ===
          "object"
=======
      /**
       * Modules are permitted to populate application, logger and other
       * canonical context members.
       */
      if (
        result &&
        typeof result ===
          'object'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
            "object"
=======
            'object'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        ) {
          Object.assign(
            this.context,
            result.context,
          );
        }
<<<<<<< HEAD

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
=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "started";
=======
        'started';
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
        "phase.completed",
=======
        'phase.completed',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "failed";
=======
        'failed';
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
        "phase.failed",
=======
        'phase.failed',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      case "environment":
=======
      case 'environment':
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        return Boolean(
          this.context?.environment,
        );

<<<<<<< HEAD
      case "configuration":
=======
      case 'configuration':
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        return Boolean(
          this.context?.config,
        );

<<<<<<< HEAD
      case "logger":
=======
      case 'logger':
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        return Boolean(
          this.logger,
        );

<<<<<<< HEAD
      case "readiness":
        return true;

      case "infrastructure":
      case "services":
      case "middleware":
      case "routes":
=======
      case 'readiness':
        return true;

      case 'infrastructure':
      case 'services':
      case 'middleware':
      case 'routes':
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        return Boolean(
          this.context?.application ||
            this.application,
        );

<<<<<<< HEAD
      case "server":
=======
      case 'server':
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
          "BOOTSTRAP_PHASE_FAILED",
=======
          'BOOTSTRAP_PHASE_FAILED',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

        phase,

        cause:
          error,
      },
    );
  }

  /* ===========================================================================
   * SERVER ADAPTER
<<<<<<< HEAD
   * ===========================================================================
   */

  async resolveServerModule(
=======
   * =========================================================================== */

  resolveServerModule(
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
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
=======
    const candidate =
      path.resolve(
        __dirname,
        'server.js',
      );

    if (
      moduleExists(
        candidate,
      )
    ) {
      return unwrapModule(
        loadModule(
          candidate,
        ),
      );
    }

    return null;
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "Cannot start the TITech HTTP server before an application has been composed.",
        {
          code:
            "SERVER_APPLICATION_UNAVAILABLE",

          phase:
            "server",
=======
        'Cannot start the TITech HTTP server before an application has been composed.',
        {
          code:
            'SERVER_APPLICATION_UNAVAILABLE',

          phase:
            'server',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        },
      );
    }

    const serverModule =
      this.serverModule ||
<<<<<<< HEAD
      (await this.resolveServerModule(
        this.context,
      ));
=======
      this.resolveServerModule(
        this.context,
      );
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

    if (
      !serverModule
    ) {
      throw new ApplicationBootstrapError(
<<<<<<< HEAD
        "HTTP server bootstrap adapter is unavailable.",
        {
          code:
            "SERVER_BOOTSTRAP_UNAVAILABLE",

          phase:
            "server",
=======
        'HTTP server bootstrap adapter is unavailable.',
        {
          code:
            'SERVER_BOOTSTRAP_UNAVAILABLE',

          phase:
            'server',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
=======
    /**
     * Canonical application injection.
     */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "function" &&
      this.options.registerServerHooks
    ) {
      try {
        await serverModule.registerServerHooks(
=======
        'function' &&
      this.options.registerServerHooks
    ) {
      try {
        serverModule.registerServerHooks(
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
          this.context,
          serverOptions,
        );
      } catch (error) {
        throw new ApplicationBootstrapError(
<<<<<<< HEAD
          "Unable to register TITech HTTP server lifecycle hooks.",
          {
            code:
              "SERVER_HOOK_REGISTRATION_FAILED",

            phase:
              "server",
=======
          'Unable to register TITech HTTP server lifecycle hooks.',
          {
            code:
              'SERVER_HOOK_REGISTRATION_FAILED',

            phase:
              'server',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
      "function"
    ) {
      throw new ApplicationBootstrapError(
        "TITech HTTP server bootstrap adapter does not expose start() or initialize().",
        {
          code:
            "SERVER_START_API_UNAVAILABLE",

          phase:
            "server",
=======
      'function'
    ) {
      throw new ApplicationBootstrapError(
        'TITech HTTP server bootstrap adapter does not expose start() or initialize().',
        {
          code:
            'SERVER_START_API_UNAVAILABLE',

          phase:
            'server',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      this.server =
        null;

      if (
        this.context
      ) {
        this.context.server =
          null;
      }

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      return true;
    }

    const stopFunction =
      serverModule.stop ||
      serverModule.shutdown ||
      serverModule.close;

    if (
      typeof stopFunction !==
<<<<<<< HEAD
      "function"
=======
      'function'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      this.context,
      this,
=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

  async start(
    suppliedContext = {},
  ) {
    if (
      this.destroyed
    ) {
      throw new ApplicationBootstrapError(
<<<<<<< HEAD
        "Cannot start a destroyed TITech application bootstrap.",
        {
          code:
            "BOOTSTRAP_DESTROYED",
=======
        'Cannot start a destroyed TITech application bootstrap.',
        {
          code:
            'BOOTSTRAP_DESTROYED',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "Cannot start application bootstrap while shutdown is in progress.",
        {
          code:
            "BOOTSTRAP_START_DURING_SHUTDOWN",
=======
        'Cannot start application bootstrap while shutdown is in progress.',
        {
          code:
            'BOOTSTRAP_START_DURING_SHUTDOWN',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        },
      );
    }

    if (
      this.stopped &&
      !this.options.allowRestart
    ) {
      throw new ApplicationBootstrapError(
<<<<<<< HEAD
        "Application bootstrap cannot be restarted after shutdown.",
        {
          code:
            "BOOTSTRAP_ALREADY_STOPPED",
=======
        'Application bootstrap cannot be restarted after shutdown.',
        {
          code:
            'BOOTSTRAP_ALREADY_STOPPED',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "application-bootstrap",
=======
        'application-bootstrap',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "started",
=======
        'started',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        this.getSnapshot(),
      );

      this.log(
<<<<<<< HEAD
        "info",
        "TITech application bootstrap completed.",
=======
        'info',
        'TITech application bootstrap completed.',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "failed",
=======
        'failed',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      "starting",
=======
      'starting',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      {
        phases:
          order.map(
            phase =>
              phase.name,
          ),
      },
    );

    this.log(
<<<<<<< HEAD
      "info",
      "Starting TITech application bootstrap.",
=======
      'info',
      'Starting TITech application bootstrap.',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
            "TITech application bootstrap was aborted.",
            {
              code:
                "BOOTSTRAP_ABORTED",
=======
            'TITech application bootstrap was aborted.',
            {
              code:
                'BOOTSTRAP_ABORTED',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

              cause:
                signal.reason,
            },
          );
        }

<<<<<<< HEAD
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
=======
        if (
          definition.name ===
          'server'
        ) {
          const state =
            this.phaseStates.get(
              'server',
            ) ||
            this.createPhaseState(
              definition,
            );

          this.phaseStates.set(
            'server',
            state,
          );

          if (
            !this.options.startServer
          ) {
            state.status =
              'skipped';

            state.completedAt =
              now();

            continue;
          }

          state.status =
            'starting';

          state.startedAt =
            now();

          this.emit(
            'phase.starting',
            {
              phase:
                'server',
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
                'server',
                {
                  signal:
                    this.lifecycleAbortController
                      .signal,
                },
              );

            state.result =
              result;

            state.status =
              'started';

            state.completedAt =
              now();

            state.durationMs =
              elapsedMs(
                serverStart,
              );

            this.completedPhases.push(
              'server',
            );

            this.emit(
              'phase.completed',
              {
                phase:
                  'server',

                durationMs:
                  state.durationMs,
              },
            );
          } catch (error) {
            state.status =
              'failed';

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
              'phase.failed',
              {
                phase:
                  'server',

                error:
                  safeError(
                    error,
                  ),
              },
            );

            throw this.wrapPhaseError(
              error,
              'server',
            );
          }

          continue;
        }

        await this.executePhase(
          definition,
        );
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
        "error",
        "TITech application startup failed. Beginning transactional rollback.",
=======
        'error',
        'TITech application startup failed. Beginning transactional rollback.',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
          "error",
          "TITech startup rollback completed with errors.",
=======
          'error',
          'TITech startup rollback completed with errors.',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
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
=======
  /* ===========================================================================
   * ROLLBACK
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
          "server"
        ) {
          await this.stopServer(
            "bootstrap-rollback",
=======
          'server'
        ) {
          await this.stopServer(
            'bootstrap-rollback',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
            {
              cause,
            },
          );

          const state =
            this.phaseStates.get(
<<<<<<< HEAD
              "server",
=======
              'server',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
            );

          if (
            state
          ) {
            state.rollbackAttempted =
              true;

            state.rollbackCompleted =
              true;

            state.status =
<<<<<<< HEAD
              "stopped";
=======
              'stopped';
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      "rollback.completed",
=======
      'rollback.completed',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
        "started"
=======
        'started'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    ) {
      return;
    }

    state.rollbackAttempted =
      true;

    const implementation =
<<<<<<< HEAD
      await this.resolvePhaseImplementation(
=======
      this.resolvePhaseImplementation(
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        definition.name,
        definition,
      );

    if (
      !implementation.stop
    ) {
      state.rollbackCompleted =
        true;

      state.status =
<<<<<<< HEAD
        "stopped";
=======
        'stopped';
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
=======
        {
          signal:
            this.lifecycleAbortController
              .signal,
        },
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      );

      state.rollbackCompleted =
        true;

      state.status =
<<<<<<< HEAD
        "stopped";
=======
        'stopped';
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    } catch (error) {
      state.rollbackCompleted =
        false;

      state.rollbackError =
        safeError(
          error,
        );

      state.status =
<<<<<<< HEAD
        "failed";

      this.emit(
        "phase.shutdown_failed",
=======
        'failed';

      this.emit(
        'phase.shutdown_failed',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
            "BOOTSTRAP_PHASE_SHUTDOWN_FAILED",
=======
            'BOOTSTRAP_PHASE_SHUTDOWN_FAILED',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
   * ===========================================================================
   */

  async stop(
    reason =
      "application-request",
=======
   * =========================================================================== */

  async stop(
    reason =
      'application-request',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      "application-request",
=======
      'application-request',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      if (
        !this.lifecycleAbortController
          .signal.aborted
      ) {
        this.lifecycleAbortController.abort(
=======
      this.lifecycleAbortController
        .abort(
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
          new Error(
            `Application shutdown requested: ${reason}`,
          ),
        );
<<<<<<< HEAD
      }
=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    } catch {
      // Abort is best effort.
    }

    this.emit(
<<<<<<< HEAD
      "stopping",
=======
      'stopping',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      {
        reason,

        signal:
          metadata?.signal ||
          null,
      },
    );

    this.log(
<<<<<<< HEAD
      "info",
      "Stopping TITech application bootstrap.",
      {
        reason,
=======
      'info',
      'Stopping TITech application bootstrap.',
      {
        reason,

        signal:
          metadata?.signal ||
          null,
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      },
    );

    let shutdownError =
      null;

    /**
<<<<<<< HEAD
     * HTTP transport stops first.
=======
     * Transport stops first.
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "server-shutdown",
=======
        'server-shutdown',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      );
    } catch (error) {
      shutdownError =
        error;
    }

    /**
<<<<<<< HEAD
     * Then stop all phases that actually reached started state.
=======
     * Only stop phases that actually completed, in exact reverse completion
     * order.
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "server"
=======
        'server'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
        "shutdown.failed",
=======
        'shutdown.failed',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
        {
          reason,

          error:
            safeError(
              shutdownError,
            ),
        },
      );

      this.log(
<<<<<<< HEAD
        "error",
        "TITech application bootstrap shutdown completed with errors.",
=======
        'error',
        'TITech application bootstrap shutdown completed with errors.',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
      "stopped",
=======
      'stopped',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      {
        reason,
      },
    );

    this.log(
<<<<<<< HEAD
      "info",
      "TITech application bootstrap stopped.",
=======
      'info',
      'TITech application bootstrap stopped.',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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

<<<<<<< HEAD
      if (
        state?.status !==
          "started" &&
        definition.name !==
          "readiness"
=======
      /**
       * Do not claim readiness from phases that never started.
       */
      if (
        state?.status !==
          'started' &&
        definition.name !==
          'readiness'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ) {
        continue;
      }

      const implementation =
<<<<<<< HEAD
        await this.resolvePhaseImplementation(
=======
        this.resolvePhaseImplementation(
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
          definition.name,
          definition,
        );

      if (
        typeof implementation.readiness !==
<<<<<<< HEAD
        "function"
=======
        'function'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
          "boolean"
=======
          'boolean'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
          ? "ready"
          : "not_ready",
=======
          ? 'ready'
          : 'not_ready',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
        "started"
=======
        'started'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      ) {
        continue;
      }

      const implementation =
<<<<<<< HEAD
        await this.resolvePhaseImplementation(
=======
        this.resolvePhaseImplementation(
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
          definition.name,
          definition,
        );

      if (
        typeof implementation.health !==
<<<<<<< HEAD
        "function"
=======
        'function'
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
            "unhealthy",
=======
            'unhealthy',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
              "unhealthy" ||
=======
              'unhealthy' ||
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
            result.healthy ===
              false
          ),
      );

    return {
      status:
        !this.started
<<<<<<< HEAD
          ? "degraded"
          : unhealthy ||
              this.failed
            ? "unhealthy"
            : "healthy",
=======
          ? 'degraded'
          : unhealthy ||
              this.failed
            ? 'unhealthy'
            : 'healthy',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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

<<<<<<< HEAD
          skippedReason:
            state.skippedReason,

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
       * Subscriber failures must never break lifecycle execution.
=======
       * Event subscribers must never break lifecycle execution.
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
       */
    }
  }

  /* ===========================================================================
   * RESTART SUPPORT
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

  prepareForRestart() {
    if (
      this.starting ||
      this.started ||
      this.stopping
    ) {
      throw new ApplicationBootstrapError(
<<<<<<< HEAD
        "Cannot prepare TITech bootstrap for restart while active.",
        {
          code:
            "BOOTSTRAP_RESTART_ACTIVE",
=======
        'Cannot prepare TITech bootstrap for restart while active.',
        {
          code:
            'BOOTSTRAP_RESTART_ACTIVE',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
    this.phaseImplementations.clear();

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

  reset() {
    if (
      this.starting ||
      this.started ||
      this.stopping
    ) {
      throw new ApplicationBootstrapError(
<<<<<<< HEAD
        "Cannot reset an active TITech application bootstrap.",
        {
          code:
            "BOOTSTRAP_RESET_NOT_ALLOWED",
=======
        'Cannot reset an active TITech application bootstrap.',
        {
          code:
            'BOOTSTRAP_RESET_NOT_ALLOWED',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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

<<<<<<< HEAD
    this.phaseImplementations
      .clear();

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
   * ===========================================================================
   */
=======
   * =========================================================================== */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
        "bootstrap-destroy",
=======
        'bootstrap-destroy',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
      );
    }

    try {
<<<<<<< HEAD
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
=======
      this.lifecycleAbortController
        .abort(
          new Error(
            'TITech application bootstrap destroyed.',
          ),
        );
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
    } catch {
      // Best effort.
    }

<<<<<<< HEAD
    this.phaseImplementations.clear();

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
 * =============================================================================
 */
=======
 * ============================================================================= */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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
<<<<<<< HEAD
 * =============================================================================
 */
=======
 * ============================================================================= */
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

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

<<<<<<< HEAD
  if (
    !bootstrap.isInitialized()
  ) {
    bootstrap.initialize(
      context,
    );
  }

=======
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
  return bootstrap.start(
    context,
  );
}

async function shutdownApplication(
  reason =
<<<<<<< HEAD
    "application-request",
=======
    'application-request',
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
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
<<<<<<< HEAD
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
=======
 * EXPORTS
 * =============================================================================
 */

module.exports =
  Object.freeze({
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
  });
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
