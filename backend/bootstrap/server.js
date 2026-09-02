'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/server.js
 *
 * Purpose:
 *   Enterprise production-grade HTTP/HTTPS network-server bootstrap adapter.
 *
 * Architectural responsibility:
 *
 *   ApplicationBootstrap / app.js
 *              │
 *              ▼
 *       application readiness
 *              │
 *              ▼
 *       bootstrap/server.js
 *              │
 *              ├── HTTP server
 *              └── HTTPS server
 *              │
 *              ▼
 *        listening sockets
 *
 * This module owns:
 *   - network server creation;
 *   - HTTP/HTTPS transport configuration;
 *   - network server lifecycle;
 *   - server timeout configuration;
 *   - connection tracking;
 *   - graceful shutdown;
 *   - startup/shutdown synchronization;
 *   - readiness gating;
 *   - operational diagnostics;
 *   - lifecycle hook registration.
 *
 * This module does NOT own:
 *   - Express route definitions;
 *   - controllers;
 *   - authentication;
 *   - authorization;
 *   - financial transactions;
 *   - ledger logic;
 *   - MongoDB;
 *   - Redis;
 *   - queues;
 *   - business resilience algorithms;
 *   - application construction.
 *
 * IMPORTANT:
 *   app.js / ApplicationBootstrap remains responsible for creating and
 *   validating the Express application.
 *
 *   This adapter accepts an already-created Express-compatible application.
 *
 * =============================================================================
 */

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

/**
 * -----------------------------------------------------------------------------
 * Optional lifecycle infrastructure
 * -----------------------------------------------------------------------------
 */

let hooksModule = null;

try {
  // eslint-disable-next-line global-require
  hooksModule = require('./hooks');
} catch {
  hooksModule = null;
}

const hooks =
  hooksModule?.hooks &&
  typeof hooksModule.hooks.has === 'function'
    ? hooksModule.hooks
    : null;

const lifecycle =
  typeof hooksModule?.lifecycle === 'function'
    ? hooksModule.lifecycle
    : null;

/**
 * -----------------------------------------------------------------------------
 * Optional readiness infrastructure
 * -----------------------------------------------------------------------------
 */

let readinessModule = null;

try {
  // eslint-disable-next-line global-require
  readinessModule = require('./readinessState');
} catch {
  readinessModule = null;
}

/**
 * -----------------------------------------------------------------------------
 * Optional observability infrastructure
 * -----------------------------------------------------------------------------
 */

let observabilityModule = null;

try {
  // eslint-disable-next-line global-require
  observabilityModule = require('./observability');
} catch {
  observabilityModule = null;
}

/**
 * -----------------------------------------------------------------------------
 * Optional runtime infrastructure
 * -----------------------------------------------------------------------------
 */

let runtimeModule = null;

try {
  // eslint-disable-next-line global-require
  runtimeModule = require('./runtime');
} catch {
  runtimeModule = null;
}

/**
 * -----------------------------------------------------------------------------
 * Optional logger infrastructure
 * -----------------------------------------------------------------------------
 */

let loggerModule = null;

try {
  // eslint-disable-next-line global-require
  loggerModule = require('./logger');
} catch {
  loggerModule = null;
}

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const COMPONENT = 'http-server';

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  'titech-community-capital-backend';

const APPLICATION_NAME =
  process.env.APPLICATION_NAME ||
  'TITech Community Capital';

const DEFAULTS = Object.freeze({
  host: '0.0.0.0',

  port: 5000,

  httpsPort: 5443,

  requestTimeoutMs: 30_000,

  headersTimeoutMs: 65_000,

  keepAliveTimeoutMs: 5_000,

  maxConnections: 10_000,

  shutdownTimeoutMs: 30_000,

  shutdownDrainMs: 5_000,

  httpEnabled: true,

  httpsEnabled: false,

  gracefulShutdown: true,

  requireReadiness: true,

  reusePort: false,

  keepAlive: true,

  enableConnectionTracking: true,

  enableClientErrorHandling: true,

  enableLifecycleHooks: true,
});

const SERVER_STATES = Object.freeze({
  INITIALIZING: 'initializing',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
});

const TRANSPORT_TYPES = Object.freeze({
  HTTP: 'http',
  HTTPS: 'https',
});

/**
 * =============================================================================
 * ERRORS
 * =============================================================================
 */

class ServerBootstrapError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'ServerBootstrapError';

    this.code =
      options.code ||
      'SERVER_BOOTSTRAP_ERROR';

    this.phase =
      options.phase ||
      null;

    this.cause =
      options.cause ||
      null;

    this.details = Object.freeze({
      ...(options.details || {}),
    });

    if (Error.captureStackTrace) {
      Error.captureStackTrace(
        this,
        ServerBootstrapError,
      );
    }
  }
}

/**
 * =============================================================================
 * NORMALIZATION / VALIDATION UTILITIES
 * =============================================================================
 */

function asBoolean(value, fallback) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return [
    '1',
    'true',
    'yes',
    'on',
    'enabled',
  ].includes(
    String(value)
      .trim()
      .toLowerCase(),
  );
}

function asPositiveInteger(value, fallback) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    return fallback;
  }

  return parsed;
}

function normalizeHost(value) {
  const normalized =
    String(
      value ??
        DEFAULTS.host,
    ).trim();

  return normalized || DEFAULTS.host;
}

function normalizePath(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  return normalized || null;
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
      error.code ||
      null,

    message:
      error.message ||
      'Unknown error',
  };
}

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object'
  );
}

/**
 * =============================================================================
 * EXPRESS APPLICATION NORMALIZATION
 * =============================================================================
 *
 * The server layer deliberately does not construct the Express application.
 *
 * It does, however, tolerate common module/export shapes:
 *
 *   app
 *   { app }
 *   { application }
 *   { default: app }
 *   { default: { app } }
 *
 * This prevents accidental export-shape incompatibility from reaching
 * http.createServer().
 * =============================================================================
 */

function isExpressCompatibleApplication(
  value,
) {
  return (
    typeof value === 'function' &&
    (
      typeof value.use === 'function' ||
      typeof value.handle === 'function'
    )
  );
}

function unwrapApplication(value) {
  if (!value) {
    return null;
  }

  if (
    isExpressCompatibleApplication(
      value,
    )
  ) {
    return value;
  }

  if (
    isObject(value) &&
    isExpressCompatibleApplication(
      value.app,
    )
  ) {
    return value.app;
  }

  if (
    isObject(value) &&
    isExpressCompatibleApplication(
      value.application,
    )
  ) {
    return value.application;
  }

  if (
    isObject(value) &&
    isExpressCompatibleApplication(
      value.default,
    )
  ) {
    return value.default;
  }

  if (
    isObject(value?.default) &&
    isExpressCompatibleApplication(
      value.default.app,
    )
  ) {
    return value.default.app;
  }

  if (
    isObject(value?.default) &&
    isExpressCompatibleApplication(
      value.default.application,
    )
  ) {
    return value.default.application;
  }

  return null;
}

function assertApplication(value) {
  const application =
    unwrapApplication(value);

  if (!application) {
    throw new ServerBootstrapError(
      'A valid Express-compatible application is required.',
      {
        code:
          'SERVER_APPLICATION_INVALID',

        phase:
          'application',

        details: {
          receivedType:
            typeof value,

          receivedConstructor:
            value?.constructor?.name ||
            null,

          expected:
            'Express-compatible function/application',
        },
      },
    );
  }

  return application;
}

function resolveApplication(
  context = {},
  options = {},
) {
  const candidates = [
    options.app,
    options.application,

    context?.app,
    context?.application,

    context?.expressApp,

    context?.serverApplication,
  ];

  for (const candidate of candidates) {
    const application =
      unwrapApplication(candidate);

    if (application) {
      return application;
    }
  }

  throw new ServerBootstrapError(
    'No valid Express application was supplied to backend/bootstrap/server.js.',
    {
      code:
        'SERVER_APPLICATION_MISSING',

      phase:
        'application',

      details: {
        supportedSources: [
          'options.app',
          'options.application',
          'context.app',
          'context.application',
          'context.expressApp',
          'context.serverApplication',
        ],
      },
    },
  );
}

/**
 * =============================================================================
 * CONFIGURATION
 * =============================================================================
 */

function resolveServerConfiguration(
  context = {},
  options = {},
) {
  const config =
    context?.config ||
    {};

  const environment =
    context?.environment ||
    {};

  const serverConfig =
    config.server ||
    config.http ||
    {};

  const httpConfig =
    config.http ||
    {};

  const tlsConfig =
    config.tls ||
    environment.tls ||
    {};

  const host =
    options.host ??
    serverConfig.host ??
    httpConfig.host ??
    environment.http?.host ??
    process.env.HOST ??
    DEFAULTS.host;

  const port =
    asPositiveInteger(
      options.port ??
        serverConfig.port ??
        httpConfig.port ??
        environment.http?.port ??
        process.env.PORT,
      DEFAULTS.port,
    );

  const httpsPort =
    asPositiveInteger(
      options.httpsPort ??
        serverConfig.httpsPort ??
        httpConfig.httpsPort ??
        environment.http?.httpsPort ??
        process.env.HTTPS_PORT,
      DEFAULTS.httpsPort,
    );

  const httpEnabled =
    options.httpEnabled ??
    asBoolean(
      serverConfig.httpEnabled ??
        httpConfig.httpEnabled ??
        process.env.HTTP_ENABLED,
      DEFAULTS.httpEnabled,
    );

  const httpsEnabled =
    options.httpsEnabled ??
    asBoolean(
      serverConfig.httpsEnabled ??
        httpConfig.httpsEnabled ??
        tlsConfig.enabled ??
        process.env.TLS_ENABLED,
      DEFAULTS.httpsEnabled,
    );

  const gracefulShutdown =
    options.gracefulShutdown ??
    asBoolean(
      serverConfig.gracefulShutdown ??
        httpConfig.gracefulShutdown ??
        process.env.GRACEFUL_SHUTDOWN,
      DEFAULTS.gracefulShutdown,
    );

  const requireReadiness =
    options.requireReadiness ??
    asBoolean(
      serverConfig.requireReadiness ??
        httpConfig.requireReadiness ??
        process.env.REQUIRE_HTTP_READINESS,
      DEFAULTS.requireReadiness,
    );

  const enableConnectionTracking =
    options.enableConnectionTracking ??
    asBoolean(
      serverConfig.enableConnectionTracking ??
        process.env.ENABLE_CONNECTION_TRACKING,
      DEFAULTS.enableConnectionTracking,
    );

  const enableClientErrorHandling =
    options.enableClientErrorHandling ??
    asBoolean(
      serverConfig.enableClientErrorHandling ??
        process.env.ENABLE_CLIENT_ERROR_HANDLING,
      DEFAULTS.enableClientErrorHandling,
    );

  const enableLifecycleHooks =
    options.enableLifecycleHooks ??
    asBoolean(
      serverConfig.enableLifecycleHooks ??
        process.env.ENABLE_SERVER_LIFECYCLE_HOOKS,
      DEFAULTS.enableLifecycleHooks,
    );

  return Object.freeze({
    host:
      normalizeHost(host),

    port,

    httpsPort,

    httpEnabled,

    httpsEnabled,

    requestTimeoutMs:
      asPositiveInteger(
        options.requestTimeoutMs ??
          serverConfig.requestTimeoutMs ??
          httpConfig.requestTimeoutMs ??
          environment.http?.requestTimeoutMs ??
          process.env.REQUEST_TIMEOUT_MS,
        DEFAULTS.requestTimeoutMs,
      ),

    headersTimeoutMs:
      asPositiveInteger(
        options.headersTimeoutMs ??
          serverConfig.headersTimeoutMs ??
          httpConfig.headersTimeoutMs ??
          environment.http?.headersTimeoutMs ??
          process.env.HEADERS_TIMEOUT_MS,
        DEFAULTS.headersTimeoutMs,
      ),

    keepAliveTimeoutMs:
      asPositiveInteger(
        options.keepAliveTimeoutMs ??
          serverConfig.keepAliveTimeoutMs ??
          httpConfig.keepAliveTimeoutMs ??
          environment.http?.keepAliveTimeoutMs ??
          process.env.KEEP_ALIVE_TIMEOUT_MS,
        DEFAULTS.keepAliveTimeoutMs,
      ),

    maxConnections:
      asPositiveInteger(
        options.maxConnections ??
          serverConfig.maxConnections ??
          httpConfig.maxConnections ??
          process.env.MAX_CONNECTIONS,
        DEFAULTS.maxConnections,
      ),

    shutdownTimeoutMs:
      asPositiveInteger(
        options.shutdownTimeoutMs ??
          serverConfig.shutdownTimeoutMs ??
          httpConfig.shutdownTimeoutMs ??
          environment.http?.shutdownTimeoutMs ??
          process.env.SHUTDOWN_TIMEOUT_MS,
        DEFAULTS.shutdownTimeoutMs,
      ),

    shutdownDrainMs:
      asPositiveInteger(
        options.shutdownDrainMs ??
          serverConfig.shutdownDrainMs ??
          httpConfig.shutdownDrainMs ??
          process.env.SHUTDOWN_DRAIN_MS,
        DEFAULTS.shutdownDrainMs,
      ),

    gracefulShutdown,

    requireReadiness,

    reusePort:
      options.reusePort ??
      asBoolean(
        serverConfig.reusePort ??
          httpConfig.reusePort ??
          process.env.REUSE_PORT,
        DEFAULTS.reusePort,
      ),

    keepAlive:
      options.keepAlive ??
      asBoolean(
        serverConfig.keepAlive ??
          httpConfig.keepAlive ??
          process.env.KEEP_ALIVE,
        DEFAULTS.keepAlive,
      ),

    enableConnectionTracking,

    enableClientErrorHandling,

    enableLifecycleHooks,

    tls:
      Object.freeze({
        keyPath:
          normalizePath(
            options.tlsKeyPath ??
              tlsConfig.keyPath ??
              process.env.TLS_KEY_PATH,
          ),

        certPath:
          normalizePath(
            options.tlsCertPath ??
              tlsConfig.certPath ??
              process.env.TLS_CERT_PATH,
          ),

        caPath:
          normalizePath(
            options.tlsCaPath ??
              tlsConfig.caPath ??
              process.env.TLS_CA_PATH,
          ),

        passphrase:
          options.tlsPassphrase ??
          tlsConfig.passphrase ??
          process.env.TLS_PASSPHRASE ??
          undefined,

        requestCert:
          options.tlsRequestCert ??
          tlsConfig.requestCert ??
          asBoolean(
            process.env.TLS_REQUEST_CERT,
            false,
          ),

        rejectUnauthorized:
          options.tlsRejectUnauthorized ??
          tlsConfig.rejectUnauthorized ??
          asBoolean(
            process.env.TLS_REJECT_UNAUTHORIZED,
            true,
          ),
      }),
  });
}

function validateConfiguration(config) {
  if (
    !config.httpEnabled &&
    !config.httpsEnabled
  ) {
    throw new ServerBootstrapError(
      'Neither HTTP nor HTTPS transport is enabled.',
      {
        code:
          'SERVER_NO_TRANSPORT_ENABLED',

        phase:
          'configuration',
      },
    );
  }

  if (config.httpsEnabled) {
    if (!config.tls.keyPath) {
      throw new ServerBootstrapError(
        'HTTPS is enabled but TLS private key path is not configured.',
        {
          code:
            'SERVER_TLS_KEY_MISSING',

          phase:
            'configuration',
        },
      );
    }

    if (!config.tls.certPath) {
      throw new ServerBootstrapError(
        'HTTPS is enabled but TLS certificate path is not configured.',
        {
          code:
            'SERVER_TLS_CERTIFICATE_MISSING',

          phase:
            'configuration',
        },
      );
    }
  }

  if (
    config.headersTimeoutMs <=
    config.keepAliveTimeoutMs
  ) {
    throw new ServerBootstrapError(
      'headersTimeoutMs must be greater than keepAliveTimeoutMs.',
      {
        code:
          'SERVER_TIMEOUT_CONFIGURATION_INVALID',

        phase:
          'configuration',

        details: {
          headersTimeoutMs:
            config.headersTimeoutMs,

          keepAliveTimeoutMs:
            config.keepAliveTimeoutMs,
        },
      },
    );
  }

  return true;
}

/**
 * =============================================================================
 * INTERNAL STATE
 * =============================================================================
 */

let app = null;

let httpServer = null;

let httpsServer = null;

let activeServer = null;

let serverType = null;

let configuration = null;

let registered = false;

let lifecycleRegistration = null;

let state =
  SERVER_STATES.INITIALIZING;

let starting = false;

let started = false;

let stopping = false;

let stopped = false;

let failed = false;

let acceptingConnections = false;

let startPromise = null;

let stopPromise = null;

let lastError = null;

let startedAt = null;

let stoppingAt = null;

let stoppedAt = null;

let listeningAddress = null;

let httpAddress = null;

let httpsAddress = null;

let activeConnections =
  new Set();

let connectionCount = 0;

/**
 * =============================================================================
 * STATE HELPERS
 * =============================================================================
 */

function updateState() {
  if (failed) {
    state =
      SERVER_STATES.FAILED;

    return state;
  }

  if (stopping) {
    state =
      SERVER_STATES.STOPPING;

    return state;
  }

  if (starting) {
    state =
      SERVER_STATES.STARTING;

    return state;
  }

  if (stopped) {
    state =
      SERVER_STATES.STOPPED;

    return state;
  }

  if (started) {
    state =
      SERVER_STATES.RUNNING;

    return state;
  }

  state =
    SERVER_STATES.INITIALIZING;

  return state;
}

function isServerListening(server) {
  if (!server) {
    return false;
  }

  try {
    return server.listening === true;
  } catch {
    return false;
  }
}

function getListeningServers() {
  return [
    httpServer,
    httpsServer,
  ].filter(Boolean);
}

function hasListeningServer() {
  return getListeningServers().some(
    isServerListening,
  );
}

function isReady() {
  return (
    started === true &&
    stopping === false &&
    stopped === false &&
    failed === false &&
    acceptingConnections === true &&
    hasListeningServer()
  );
}

function isRunning() {
  return (
    started === true &&
    stopping === false &&
    stopped === false &&
    hasListeningServer()
  );
}

function getRuntimeState() {
  try {
    if (
      typeof runtimeModule?.getState ===
      'function'
    ) {
      return runtimeModule.getState();
    }

    if (
      runtimeModule?.state
    ) {
      return runtimeModule.state;
    }
  } catch {
    // Runtime diagnostics are optional.
  }

  return null;
}

/**
 * =============================================================================
 * LOGGING
 * =============================================================================
 */

function log(
  level,
  payload = {},
  message = '',
) {
  const enriched = {
    application:
      APPLICATION_NAME,

    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    ...payload,
  };

  try {
    const logger =
      typeof loggerModule?.getLogger ===
      'function'
        ? loggerModule.getLogger()
        : null;

    if (
      logger &&
      typeof logger[level] ===
      'function'
    ) {
      logger[level](
        enriched,
        message,
      );

      return;
    }
  } catch {
    // Logging must never break lifecycle.
  }

  const output =
    `[${COMPONENT}] ${message}`;

  if (
    level === 'error' ||
    level === 'fatal'
  ) {
    process.stderr.write(
      `${output}\n`,
    );
  } else {
    process.stdout.write(
      `${output}\n`,
    );
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
  const enrichedPayload = {
    application:
      APPLICATION_NAME,

    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    ...payload,
  };

  try {
    if (
      typeof observabilityModule
        ?.observability
        ?.emitEvent ===
      'function'
    ) {
      return observabilityModule
        .observability
        .emitEvent(
          event,
          enrichedPayload,
        );
    }

    if (
      typeof observabilityModule?.emitEvent ===
      'function'
    ) {
      return observabilityModule.emitEvent(
        event,
        enrichedPayload,
      );
    }
  } catch {
    // Telemetry must never break lifecycle.
  }

  return null;
}

/**
 * =============================================================================
 * READINESS
 * =============================================================================
 */

async function assertReadyToListen(
  required,
) {
  if (!required) {
    return true;
  }

  if (!readinessModule) {
    throw new ServerBootstrapError(
      'HTTP server startup requires readiness validation, but readinessState is unavailable.',
      {
        code:
          'SERVER_READINESS_UNAVAILABLE',

        phase:
          'readiness',
      },
    );
  }

  try {
    if (
      typeof readinessModule.evaluate ===
      'function'
    ) {
      await readinessModule.evaluate({
        allowRecovery: true,
      });
    }

    let ready = false;

    if (
      typeof readinessModule.isReady ===
      'function'
    ) {
      ready =
        readinessModule.isReady();
    } else if (
      typeof readinessModule
        ?.readinessState
        ?.isReady ===
      'function'
    ) {
      ready =
        readinessModule
          .readinessState
          .isReady();
    } else if (
      readinessModule?.ready === true
    ) {
      ready = true;
    }

    if (!ready) {
      throw new ServerBootstrapError(
        'TITech network server cannot listen because the application is not ready.',
        {
          code:
            'SERVER_APPLICATION_NOT_READY',

          phase:
            'readiness',
        },
      );
    }

    return true;
  } catch (error) {
    if (
      error instanceof
      ServerBootstrapError
    ) {
      throw error;
    }

    throw new ServerBootstrapError(
      'TITech readiness validation failed before network server startup.',
      {
        code:
          'SERVER_READINESS_CHECK_FAILED',

        phase:
          'readiness',

        cause:
          error,
      },
    );
  }
}

/**
 * =============================================================================
 * TLS
 * =============================================================================
 */

function readTlsFile(
  filePath,
  logicalName,
) {
  if (!filePath) {
    throw new ServerBootstrapError(
      `TLS ${logicalName} path is not configured.`,
      {
        code:
          'SERVER_TLS_CONFIGURATION_MISSING',

        phase:
          'tls',

        details: {
          logicalName,
        },
      },
    );
  }

  try {
    return fs.readFileSync(
      filePath,
    );
  } catch (error) {
    throw new ServerBootstrapError(
      `Unable to read TLS ${logicalName} file.`,
      {
        code:
          'SERVER_TLS_FILE_READ_FAILED',

        phase:
          'tls',

        cause:
          error,

        details: {
          logicalName,

          filePath,
        },
      },
    );
  }
}

function buildTlsOptions(tls) {
  const key =
    readTlsFile(
      tls.keyPath,
      'private key',
    );

  const cert =
    readTlsFile(
      tls.certPath,
      'certificate',
    );

  const options = {
    key,

    cert,

    requestCert:
      Boolean(
        tls.requestCert,
      ),

    rejectUnauthorized:
      Boolean(
        tls.rejectUnauthorized,
      ),
  };

  if (tls.caPath) {
    options.ca =
      readTlsFile(
        tls.caPath,
        'CA certificate',
      );
  }

  if (
    tls.passphrase !==
    undefined
  ) {
    options.passphrase =
      tls.passphrase;
  }

  return options;
}

/**
 * =============================================================================
 * SOCKET TRACKING
 * =============================================================================
 */

function trackSocket(socket) {
  if (!socket) {
    return;
  }

  activeConnections.add(socket);

  connectionCount =
    activeConnections.size;

  const cleanup = () => {
    activeConnections.delete(
      socket,
    );

    connectionCount =
      activeConnections.size;
  };

  socket.once(
    'close',
    cleanup,
  );
}

function destroyActiveConnections() {
  for (
    const socket of activeConnections
  ) {
    try {
      if (
        socket &&
        !socket.destroyed
      ) {
        socket.destroy();
      }
    } catch {
      // Best effort.
    }
  }

  connectionCount =
    activeConnections.size;
}

/**
 * =============================================================================
 * SERVER EVENT HANDLERS
 * =============================================================================
 */

function handleServerError(
  error,
  transport,
) {
  lastError = error;

  const errorPayload = {
    transport,

    error:
      safeError(error),
  };

  log(
    'error',
    errorPayload,
    `TITech ${String(
      transport,
    ).toUpperCase()} server emitted an error.`,
  );

  emitObservabilityEvent(
    'server.error',
    errorPayload,
  );

  if (
    !started &&
    (
      error?.code ===
        'EADDRINUSE' ||
      error?.code ===
        'EACCES' ||
      error?.code ===
        'EAFNOSUPPORT'
    )
  ) {
    failed = true;

    updateState();
  }
}

function handleClientError(
  error,
  socket,
  transport,
) {
  log(
    'warn',
    {
      transport,

      error:
        safeError(error),

      remoteAddress:
        socket?.remoteAddress ||
        null,
    },
    `TITech ${String(
      transport,
    ).toUpperCase()} client connection error.`,
  );

  emitObservabilityEvent(
    'server.client_error',
    {
      transport,

      code:
        error?.code ||
        null,
    },
  );

  if (
    socket &&
    !socket.destroyed
  ) {
    try {
      socket.end(
        'HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n',
      );
    } catch {
      try {
        socket.destroy();
      } catch {
        // Best effort.
      }
    }
  }
}

function configureServer(
  server,
  config,
  transport,
) {
  server.requestTimeout =
    config.requestTimeoutMs;

  /**
   * Node.js recommends headersTimeout to be greater than keepAliveTimeout.
   */
  server.headersTimeout =
    Math.max(
      config.headersTimeoutMs,
      config.keepAliveTimeoutMs +
        1_000,
    );

  server.keepAliveTimeout =
    config.keepAliveTimeoutMs;

  server.maxConnections =
    config.maxConnections;

  if (
    config.enableConnectionTracking
  ) {
    server.on(
      'connection',
      trackSocket,
    );
  }

  server.on(
    'error',
    error =>
      handleServerError(
        error,
        transport,
      ),
  );

  if (
    config.enableClientErrorHandling
  ) {
    server.on(
      'clientError',
      (
        error,
        socket,
      ) =>
        handleClientError(
          error,
          socket,
          transport,
        ),
    );
  }

  server.on(
    'listening',
    () => {
      acceptingConnections =
        true;

      emitObservabilityEvent(
        'server.transport.listening',
        {
          transport,

          address:
            safeServerAddress(
              server,
            ),
        },
      );
    },
  );

  server.on(
    'close',
    () => {
      connectionCount =
        activeConnections.size;

      acceptingConnections =
        getListeningServers().some(
          isServerListening,
        );
    },
  );
}

/**
 * =============================================================================
 * SERVER CREATION
 * =============================================================================
 */

function createHttpServer(
  application,
  config,
) {
  const server =
    http.createServer(
      {
        keepAlive:
          config.keepAlive,
      },
      application,
    );

  configureServer(
    server,
    config,
    TRANSPORT_TYPES.HTTP,
  );

  return server;
}

function createHttpsServer(
  application,
  config,
) {
  const server =
    https.createServer(
      buildTlsOptions(
        config.tls,
      ),
      application,
    );

  configureServer(
    server,
    config,
    TRANSPORT_TYPES.HTTPS,
  );

  return server;
}

/**
 * =============================================================================
 * ADDRESS HELPERS
 * =============================================================================
 */

function safeServerAddress(server) {
  if (!server) {
    return null;
  }

  try {
    const address =
      server.address();

    if (!address) {
      return null;
    }

    if (
      typeof address ===
      'string'
    ) {
      return {
        address,
        family: null,
        port: null,
      };
    }

    return {
      address:
        address.address ||
        null,

      family:
        address.family ||
        null,

      port:
        address.port ||
        null,
    };
  } catch {
    return null;
  }
}

/**
 * =============================================================================
 * LISTEN
 * =============================================================================
 */

function listen(
  server,
  {
    host,
    port,
    reusePort,
    transport,
  },
) {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      let settled = false;

      const cleanup = () => {
        server.removeListener(
          'listening',
          onListening,
        );

        server.removeListener(
          'error',
          onError,
        );
      };

      const finish = (
        error,
        address,
      ) => {
        if (settled) {
          return;
        }

        settled = true;

        cleanup();

        if (error) {
          reject(error);
          return;
        }

        resolve(address);
      };

      const onListening = () => {
        const address =
          safeServerAddress(
            server,
          );

        if (!address) {
          finish(
            new ServerBootstrapError(
              'Server reported listening without a valid bound address.',
              {
                code:
                  'SERVER_ADDRESS_UNAVAILABLE',

                phase:
                  'listen',

                details: {
                  transport,
                },
              },
            ),
          );

          return;
        }

        finish(
          null,
          address,
        );
      };

      const onError =
        error => {
          finish(
            error,
          );
        };

      server.once(
        'listening',
        onListening,
      );

      server.once(
        'error',
        onError,
      );

      try {
        server.listen({
          host,

          port,

          reusePort:
            Boolean(
              reusePort,
            ),
        });
      } catch (error) {
        finish(
          error,
        );
      }
    },
  );
}

/**
 * =============================================================================
 * START ONE TRANSPORT
 * =============================================================================
 */

async function startTransport(
  transport,
  application,
  config,
) {
  let server;

  if (
    transport ===
    TRANSPORT_TYPES.HTTPS
  ) {
    server =
      createHttpsServer(
        application,
        config,
      );
  } else {
    server =
      createHttpServer(
        application,
        config,
      );
  }

  try {
    const address =
      await listen(
        server,
        {
          host:
            config.host,

          port:
            transport ===
            TRANSPORT_TYPES.HTTPS
              ? config.httpsPort
              : config.port,

          reusePort:
            config.reusePort,

          transport,
        },
      );

    return {
      server,

      address,
    };
  } catch (error) {
    await closeServerSilently(
      server,
    );

    throw wrapError(
      error,
      transport ===
        TRANSPORT_TYPES.HTTPS
        ? 'SERVER_HTTPS_LISTEN_FAILED'
        : 'SERVER_HTTP_LISTEN_FAILED',
      'listen',
      `TITech ${transport.toUpperCase()} server failed to listen.`,
    );
  }
}

/**
 * =============================================================================
 * START
 * =============================================================================
 */

async function startServer(
  context = {},
  options = {},
) {
  if (
    started &&
    !stopping
  ) {
    return buildStartResult();
  }

  if (startPromise) {
    return startPromise;
  }

  if (stopping) {
    throw new ServerBootstrapError(
      'Cannot start the TITech network server while shutdown is in progress.',
      {
        code:
          'SERVER_START_DURING_SHUTDOWN',

        phase:
          'startup',
      },
    );
  }

  if (stopped) {
    throw new ServerBootstrapError(
      'Cannot restart the TITech network server after it has been stopped.',
      {
        code:
          'SERVER_ALREADY_STOPPED',

        phase:
          'startup',
      },
    );
  }

  startPromise =
    (async () => {
      starting = true;

      started = false;

      stopped = false;

      stopping = false;

      failed = false;

      acceptingConnections =
        false;

      lastError = null;

      updateState();

      try {
        configuration =
          resolveServerConfiguration(
            context,
            options,
          );

        validateConfiguration(
          configuration,
        );

        app =
          resolveApplication(
            context,
            options,
          );

        emitObservabilityEvent(
          'server.starting',
          {
            host:
              configuration.host,

            port:
              configuration.port,

            httpsPort:
              configuration.httpsPort,

            httpEnabled:
              configuration.httpEnabled,

            httpsEnabled:
              configuration.httpsEnabled,

            requireReadiness:
              configuration.requireReadiness,
          },
        );

        log(
          'info',
          {
            host:
              configuration.host,

            port:
              configuration.port,

            httpsPort:
              configuration.httpsPort,

            httpEnabled:
              configuration.httpEnabled,

            httpsEnabled:
              configuration.httpsEnabled,
          },
          'Starting TITech network server.',
        );

        /**
         * Readiness is checked immediately before binding sockets.
         */
        await assertReadyToListen(
          configuration.requireReadiness,
        );

        const startedTransports =
          [];

        /**
         * HTTP transport.
         */
        if (
          configuration.httpEnabled
        ) {
          const result =
            await startTransport(
              TRANSPORT_TYPES.HTTP,
              app,
              configuration,
            );

          httpServer =
            result.server;

          httpAddress =
            result.address;

          startedTransports.push(
            TRANSPORT_TYPES.HTTP,
          );
        }

        /**
         * HTTPS transport.
         *
         * If HTTPS startup fails after HTTP has already started, the HTTP
         * transport is immediately rolled back. Startup is therefore atomic.
         */
        try {
          if (
            configuration.httpsEnabled
          ) {
            const result =
              await startTransport(
                TRANSPORT_TYPES.HTTPS,
                app,
                configuration,
              );

            httpsServer =
              result.server;

            httpsAddress =
              result.address;

            startedTransports.push(
              TRANSPORT_TYPES.HTTPS,
            );
          }
        } catch (error) {
          await closeServerSilently(
            httpServer,
          );

          await closeServerSilently(
            httpsServer,
          );

          httpServer = null;

          httpsServer = null;

          httpAddress = null;

          httpsAddress = null;

          throw error;
        }

        /**
         * Select the primary server.
         *
         * HTTPS is preferred as the primary transport when available.
         */
        if (httpsServer) {
          activeServer =
            httpsServer;

          serverType =
            TRANSPORT_TYPES.HTTPS;

          listeningAddress =
            httpsAddress;
        } else {
          activeServer =
            httpServer;

          serverType =
            TRANSPORT_TYPES.HTTP;

          listeningAddress =
            httpAddress;
        }

        started = true;

        starting = false;

        stopping = false;

        stopped = false;

        failed = false;

        acceptingConnections =
          hasListeningServer();

        startedAt =
          new Date();

        lastError = null;

        updateState();

        /**
         * Inject runtime references into bootstrap context.
         *
         * This is intentionally limited to references and diagnostics.
         */
        if (
          context &&
          typeof context ===
            'object'
        ) {
          context.app =
            app;

          context.application =
            app;

          context.server =
            activeServer;

          context.httpServer =
            httpServer;

          context.httpsServer =
            httpsServer;

          context.serverType =
            serverType;

          context.serverAddress =
            listeningAddress;

          context.serverAddresses =
            {
              http:
                httpAddress,

              https:
                httpsAddress,
            };
        }

        emitObservabilityEvent(
          'server.started',
          {
            primaryTransport:
              serverType,

            http:
              httpAddress,

            https:
              httpsAddress,

            runtime:
              getRuntimeState(),
          },
        );

        log(
          'info',
          {
            primaryTransport:
              serverType,

            http:
              httpAddress,

            https:
              httpsAddress,

            activeConnections:
              activeConnections.size,
          },
          'TITech network server is listening.',
        );

        return buildStartResult();
      } catch (error) {
        starting = false;

        started = false;

        acceptingConnections =
          false;

        failed = true;

        stopped = false;

        lastError = error;

        updateState();

        await closeServerSilently(
          httpServer,
        );

        await closeServerSilently(
          httpsServer,
        );

        httpServer = null;

        httpsServer = null;

        activeServer = null;

        httpAddress = null;

        httpsAddress = null;

        listeningAddress = null;

        serverType = null;

        emitObservabilityEvent(
          'server.start_failed',
          {
            error:
              safeError(error),
          },
        );

        throw wrapError(
          error,
          'SERVER_START_FAILED',
          'startup',
          'TITech network server startup failed.',
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
 * START RESULT
 * =============================================================================
 */

function buildStartResult() {
  return {
    server:
      activeServer,

    type:
      serverType,

    address:
      listeningAddress,

    httpServer,

    httpsServer,

    httpAddress,

    httpsAddress,

    config:
      configuration,
  };
}

/**
 * =============================================================================
 * GRACEFUL SERVER CLOSE
 * =============================================================================
 */

async function closeServer(
  server,
  {
    timeoutMs =
      DEFAULTS.shutdownTimeoutMs,

    drainMs =
      DEFAULTS.shutdownDrainMs,
  } = {},
) {
  if (!server) {
    return;
  }

  if (
    !isServerListening(server)
  ) {
    await closeServerSilently(
      server,
    );

    return;
  }

  acceptingConnections =
    false;

  /**
   * Stop accepting new connections and allow existing connections to drain.
   */
  const closePromise =
    new Promise(
      (
        resolve,
        reject,
      ) => {
        let completed = false;

        let timeoutTimer = null;

        let drainTimer = null;

        const cleanup = () => {
          if (timeoutTimer) {
            clearTimeout(
              timeoutTimer,
            );
          }

          if (drainTimer) {
            clearTimeout(
              drainTimer,
            );
          }
        };

        const finish = error => {
          if (completed) {
            return;
          }

          completed = true;

          cleanup();

          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };

        timeoutTimer =
          setTimeout(
            () => {
              destroyActiveConnections();

              finish(
                new ServerBootstrapError(
                  `TITech network server did not close within ${timeoutMs}ms.`,
                  {
                    code:
                      'SERVER_CLOSE_TIMEOUT',

                    phase:
                      'shutdown',

                    details: {
                      activeConnections:
                        activeConnections.size,
                    },
                  },
                ),
              );
            },
            timeoutMs,
          );

        timeoutTimer.unref?.();

        /**
         * Drain deadline:
         *
         * Existing sockets are allowed to close naturally until this timer.
         * Remaining sockets are then destroyed.
         */
        if (drainMs > 0) {
          drainTimer =
            setTimeout(
              () => {
                destroyActiveConnections();
              },
              drainMs,
            );

          drainTimer.unref?.();
        }

        try {
          server.close(
            error => {
              finish(
                error ||
                  undefined,
              );
            },
          );
        } catch (error) {
          finish(error);
        }
      },
    );

  await closePromise;

  /**
   * Node.js provides these helpers on modern releases.
   */
  try {
    if (
      typeof server.closeIdleConnections ===
      'function'
    ) {
      server.closeIdleConnections();
    }
  } catch {
    // Best effort.
  }
}

/**
 * =============================================================================
 * FORCE CLOSE
 * =============================================================================
 */

function forceCloseServer(server) {
  if (!server) {
    return;
  }

  acceptingConnections =
    false;

  try {
    if (
      typeof server.closeAllConnections ===
      'function'
    ) {
      server.closeAllConnections();
    }
  } catch {
    // Best effort.
  }

  destroyActiveConnections();

  try {
    if (
      isServerListening(server)
    ) {
      server.close();
    }
  } catch {
    // Best effort.
  }
}

/**
 * =============================================================================
 * SILENT CLOSE
 * =============================================================================
 */

async function closeServerSilently(
  server,
) {
  if (!server) {
    return;
  }

  try {
    if (
      typeof server.closeAllConnections ===
      'function'
    ) {
      server.closeAllConnections();
    }
  } catch {
    // Best effort.
  }

  try {
    if (
      !isServerListening(server)
    ) {
      return;
    }

    await new Promise(
      resolve => {
        let settled = false;

        const finish = () => {
          if (settled) {
            return;
          }

          settled = true;

          resolve();
        };

        try {
          server.close(
            finish,
          );
        } catch {
          finish();
        }

        /**
         * Defensive fallback so a malformed server implementation cannot
         * permanently block bootstrap cleanup.
         */
        const timer =
          setTimeout(
            finish,
            5_000,
          );

        timer.unref?.();
      },
    );
  } catch {
    // Best effort.
  }
}

/**
 * =============================================================================
 * STOP
 * =============================================================================
 */

async function stopServer(
  reason =
    'application-request',
  metadata = {},
) {
  if (stopPromise) {
    return stopPromise;
  }

  if (
    stopped &&
    !started &&
    !starting
  ) {
    return true;
  }

  /**
   * A shutdown request before startup has completed.
   */
  if (
    starting &&
    startPromise
  ) {
    try {
      await startPromise;
    } catch {
      /**
       * Startup failure is already captured by startServer().
       */
    }
  }

  if (
    !httpServer &&
    !httpsServer &&
    !activeServer
  ) {
    started = false;

    starting = false;

    stopping = false;

    acceptingConnections =
      false;

    stopped = true;

    failed = false;

    updateState();

    return true;
  }

  stopPromise =
    (async () => {
      stopping = true;

      starting = false;

      started = false;

      acceptingConnections =
        false;

      stoppingAt =
        new Date();

      updateState();

      const graceful =
        configuration?.gracefulShutdown !==
        false;

      const activeSocketCount =
        activeConnections.size;

      emitObservabilityEvent(
        'server.shutdown_started',
        {
          reason,

          signal:
            metadata?.signal ||
            null,

          graceful,

          activeConnections:
            activeSocketCount,

          httpListening:
            isServerListening(
              httpServer,
            ),

          httpsListening:
            isServerListening(
              httpsServer,
            ),
        },
      );

      log(
        'info',
        {
          reason,

          signal:
            metadata?.signal ||
            null,

          graceful,

          activeConnections:
            activeSocketCount,
        },
        'TITech network server shutdown initiated.',
      );

      try {
        const servers =
          [
            httpServer,
            httpsServer,
          ].filter(Boolean);

        if (graceful) {
          const closeOperations =
            servers.map(
              server =>
                closeServer(
                  server,
                  {
                    timeoutMs:
                      configuration
                        ?.shutdownTimeoutMs ??
                      DEFAULTS
                        .shutdownTimeoutMs,

                    drainMs:
                      configuration
                        ?.shutdownDrainMs ??
                      DEFAULTS
                        .shutdownDrainMs,
                  },
                ),
            );

          await Promise.all(
            closeOperations,
          );
        } else {
          for (
            const server of servers
          ) {
            forceCloseServer(
              server,
            );
          }
        }

        activeServer = null;

        httpServer = null;

        httpsServer = null;

        httpAddress = null;

        httpsAddress = null;

        listeningAddress = null;

        serverType = null;

        acceptingConnections =
          false;

        started = false;

        starting = false;

        stopping = false;

        stopped = true;

        failed = false;

        stoppedAt =
          new Date();

        connectionCount =
          activeConnections.size;

        updateState();

        emitObservabilityEvent(
          'server.shutdown_completed',
          {
            reason,

            signal:
              metadata?.signal ||
              null,

            remainingConnections:
              activeConnections.size,
          },
        );

        log(
          'info',
          {
            reason,
          },
          'TITech network server stopped.',
        );

        return true;
      } catch (error) {
        lastError = error;

        failed = true;

        stopping = false;

        stopped = false;

        started = false;

        acceptingConnections =
          false;

        updateState();

        emitObservabilityEvent(
          'server.shutdown_failed',
          {
            reason,

            error:
              safeError(error),
          },
        );

        throw wrapError(
          error,
          'SERVER_SHUTDOWN_FAILED',
          'shutdown',
          'TITech network server shutdown failed.',
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
 * READINESS / HEALTH
 * =============================================================================
 */

async function readiness() {
  const ready =
    isReady();

  return {
    ready,

    status:
      ready
        ? 'ready'
        : stopping ||
            stopped ||
            failed
          ? 'not_ready'
          : starting
            ? 'starting'
            : 'initializing',

    state,

    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    serverType,

    acceptingConnections,

    activeConnections:
      activeConnections.size,

    transports: {
      http:
        isServerListening(
          httpServer,
        ),

      https:
        isServerListening(
          httpsServer,
        ),
    },

    address:
      listeningAddress,

    addresses: {
      http:
        httpAddress,

      https:
        httpsAddress,
    },

    timestamp:
      new Date().toISOString(),
  };
}

async function health() {
  const ready =
    isReady();

  return {
    status:
      ready
        ? 'healthy'
        : failed
          ? 'unhealthy'
          : 'degraded',

    ready,

    state,

    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    serverType,

    acceptingConnections,

    activeConnections:
      activeConnections.size,

    transports: {
      http:
        isServerListening(
          httpServer,
        ),

      https:
        isServerListening(
          httpsServer,
        ),
    },

    address:
      listeningAddress,

    addresses: {
      http:
        httpAddress,

      https:
        httpsAddress,
    },

    configuration:
      configuration
        ? sanitizeConfiguration(
            configuration,
          )
        : null,

    error:
      safeError(lastError),

    timestamp:
      new Date().toISOString(),
  };
}

/**
 * =============================================================================
 * CONFIGURATION SANITIZATION
 * =============================================================================
 *
 * Never expose:
 *   - TLS private-key paths;
 *   - TLS passphrases;
 *   - certificate contents;
 *   - CA contents;
 *   - secrets.
 * =============================================================================
 */

function sanitizeConfiguration(
  config,
) {
  return {
    host:
      config.host,

    port:
      config.port,

    httpsPort:
      config.httpsPort,

    httpEnabled:
      config.httpEnabled,

    httpsEnabled:
      config.httpsEnabled,

    gracefulShutdown:
      config.gracefulShutdown,

    requireReadiness:
      config.requireReadiness,

    requestTimeoutMs:
      config.requestTimeoutMs,

    headersTimeoutMs:
      config.headersTimeoutMs,

    keepAliveTimeoutMs:
      config.keepAliveTimeoutMs,

    maxConnections:
      config.maxConnections,

    shutdownTimeoutMs:
      config.shutdownTimeoutMs,

    shutdownDrainMs:
      config.shutdownDrainMs,

    reusePort:
      config.reusePort,

    keepAlive:
      config.keepAlive,

    enableConnectionTracking:
      config.enableConnectionTracking,

    enableClientErrorHandling:
      config.enableClientErrorHandling,

    enableLifecycleHooks:
      config.enableLifecycleHooks,

    tls: {
      enabled:
        config.httpsEnabled,

      keyConfigured:
        Boolean(
          config.tls?.keyPath,
        ),

      certificateConfigured:
        Boolean(
          config.tls?.certPath,
        ),

      caConfigured:
        Boolean(
          config.tls?.caPath,
        ),

      passphraseConfigured:
        Boolean(
          config.tls?.passphrase,
        ),

      requestCert:
        Boolean(
          config.tls?.requestCert,
        ),

      rejectUnauthorized:
        Boolean(
          config.tls?.rejectUnauthorized,
        ),
    },
  };
}

/**
 * =============================================================================
 * LIFECYCLE REGISTRATION
 * =============================================================================
 */

function registerServerHooks(
  context = {},
  options = {},
) {
  if (
    !lifecycle ||
    !hooks
  ) {
    if (
      options.requireLifecycleHooks ===
      true
    ) {
      throw new ServerBootstrapError(
        'TITech lifecycle infrastructure is required but unavailable.',
        {
          code:
            'SERVER_LIFECYCLE_UNAVAILABLE',

          phase:
            'registration',
        },
      );
    }

    registered = false;

    return null;
  }

  if (
    hooks.has(COMPONENT)
  ) {
    registered = true;

    lifecycleRegistration =
      hooks.get(COMPONENT);

    return lifecycleRegistration;
  }

  const dependencies =
    Array.isArray(
      options.dependencies,
    )
      ? [
          ...options.dependencies,
        ]
      : [
          'routes',
          'readiness',
        ];

  lifecycleRegistration =
    lifecycle(
      COMPONENT,
      {
        priority:
          options.priority ??
          1_000,

        dependencies,

        timeoutMs:
          options.timeoutMs ??
          configuration
            ?.shutdownTimeoutMs ??
          DEFAULTS
            .shutdownTimeoutMs,

        critical:
          options.critical !== false,

        enabled:
          options.enabled !== false,

        metadata: {
          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          application:
            APPLICATION_NAME,

          implementation:
            'backend/bootstrap/server.js',
        },

        start:
          async hookContext =>
            startServer(
              hookContext ||
                context,
              options,
            ),

        ready:
          async () =>
            isReady(),

        health:
          async () =>
            health(),

        stop:
          async hookContext =>
            stopServer(
              hookContext?.reason ||
                'bootstrap-shutdown',
              hookContext ||
                {},
            ),
      },
    );

  registered = true;

  return lifecycleRegistration;
}

function registerBootstrapHooks(
  context = {},
  options = {},
) {
  return registerServerHooks(
    context,
    options,
  );
}

/**
 * =============================================================================
 * APPLICATION INJECTION
 * =============================================================================
 */

function setApplication(value) {
  const application =
    assertApplication(
      value,
    );

  if (
    started ||
    starting ||
    stopping
  ) {
    throw new ServerBootstrapError(
      'Cannot replace the Express application while the TITech network server lifecycle is active.',
      {
        code:
          'SERVER_APPLICATION_LOCKED',

        phase:
          'application',
      },
    );
  }

  app =
    application;

  return app;
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
  return startServer(
    context,
    options,
  );
}

async function start(
  context = {},
  options = {},
) {
  return startServer(
    context,
    options,
  );
}

async function shutdown(
  reason =
    'application-request',
  metadata = {},
) {
  return stopServer(
    reason,
    metadata,
  );
}

async function stop(
  reason =
    'application-request',
  metadata = {},
) {
  return stopServer(
    reason,
    metadata,
  );
}

/**
 * =============================================================================
 * SERVER ACCESS
 * =============================================================================
 */

function getServer() {
  return activeServer;
}

function getHttpServer() {
  return httpServer;
}

function getHttpsServer() {
  return httpsServer;
}

function getApplication() {
  return app;
}

function getAddress() {
  return listeningAddress;
}

function getServerType() {
  return serverType;
}

function getConnectionCount() {
  return activeConnections.size;
}

/**
 * =============================================================================
 * STATE
 * =============================================================================
 */

function getState() {
  updateState();

  return Object.freeze({
    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    application:
      APPLICATION_NAME,

    state,

    registered,

    starting,

    started,

    stopping,

    stopped,

    failed,

    ready:
      isReady(),

    running:
      isRunning(),

    acceptingConnections,

    serverType,

    address:
      listeningAddress,

    addresses: {
      http:
        httpAddress,

      https:
        httpsAddress,
    },

    transports: {
      http:
        isServerListening(
          httpServer,
        ),

      https:
        isServerListening(
          httpsServer,
        ),
    },

    connectionCount:
      activeConnections.size,

    startedAt,

    stoppingAt,

    stoppedAt,

    lastError:
      safeError(lastError),
  });
}

/**
 * =============================================================================
 * DIAGNOSTIC SNAPSHOT
 * =============================================================================
 */

function snapshot() {
  return Object.freeze({
    ...getState(),

    configuration:
      configuration
        ? sanitizeConfiguration(
            configuration,
          )
        : null,

    applicationAvailable:
      Boolean(app),

    applicationValid:
      Boolean(
        unwrapApplication(app),
      ),

    httpServerAvailable:
      Boolean(httpServer),

    httpsServerAvailable:
      Boolean(httpsServer),

    activeServerAvailable:
      Boolean(activeServer),

    activeSockets:
      activeConnections.size,

    lifecycleInfrastructureAvailable:
      Boolean(
        lifecycle &&
        hooks,
      ),

    readinessInfrastructureAvailable:
      Boolean(
        readinessModule,
      ),

    observabilityInfrastructureAvailable:
      Boolean(
        observabilityModule,
      ),

    runtimeInfrastructureAvailable:
      Boolean(
        runtimeModule,
      ),

    loggerInfrastructureAvailable:
      Boolean(
        loggerModule,
      ),
  });
}

/**
 * =============================================================================
 * PREDICATES
 * =============================================================================
 */

function isRegistered() {
  return registered;
}

function isStarted() {
  return started;
}

function isStopping() {
  return stopping;
}

function isStopped() {
  return stopped;
}

function isFailed() {
  return failed;
}

/**
 * =============================================================================
 * RESET
 * =============================================================================
 *
 * Intended for:
 *   - automated tests;
 *   - isolated bootstrap tests;
 *   - controlled process reinitialization.
 *
 * It never destroys a live server.
 * =============================================================================
 */

function reset() {
  if (
    started ||
    starting ||
    stopping ||
    hasListeningServer()
  ) {
    throw new ServerBootstrapError(
      'Cannot reset an active TITech network server.',
      {
        code:
          'SERVER_RESET_NOT_ALLOWED',

        phase:
          'reset',
      },
    );
  }

  app = null;

  httpServer = null;

  httpsServer = null;

  activeServer = null;

  serverType = null;

  configuration = null;

  registered = false;

  lifecycleRegistration =
    null;

  state =
    SERVER_STATES.INITIALIZING;

  starting = false;

  started = false;

  stopping = false;

  stopped = false;

  failed = false;

  acceptingConnections = false;

  startPromise = null;

  stopPromise = null;

  lastError = null;

  startedAt = null;

  stoppingAt = null;

  stoppedAt = null;

  listeningAddress = null;

  httpAddress = null;

  httpsAddress = null;

  activeConnections =
    new Set();

  connectionCount = 0;

  return true;
}

/**
 * =============================================================================
 * ERROR WRAPPING
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
    ServerBootstrapError
  ) {
    return error;
  }

  return new ServerBootstrapError(
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
 * EXPORT
 * =============================================================================
 */

module.exports =
  Object.freeze({
    /**
     * Registration.
     */
    registerServerHooks,

    registerBootstrapHooks,

    bootstrap:
      registerBootstrapHooks,

    /**
     * Explicit lifecycle.
     */
    initialize,

    start,

    shutdown,

    stop,

    /**
     * Application injection.
     */
    setApplication,

    /**
     * Application validation.
     */
    assertApplication,

    isExpressCompatibleApplication,

    unwrapApplication,

    /**
     * Server access.
     */
    getServer,

    getHttpServer,

    getHttpsServer,

    getApplication,

    getAddress,

    getServerType,

    getConnectionCount,

    /**
     * Health/readiness.
     */
    readiness,

    health,

    /**
     * State.
     */
    getState,

    snapshot,

    isRegistered,

    isStarted,

    isStopping,

    isStopped,

    isFailed,

    isReady,

    isRunning,

    /**
     * Configuration.
     */
    resolveServerConfiguration,

    /**
     * Test support.
     */
    reset,

    /**
     * Metadata/errors.
     */
    ServerBootstrapError,

    COMPONENT,

    SERVICE_NAME,

    APPLICATION_NAME,

    SERVER_STATES,

    TRANSPORT_TYPES,
  });