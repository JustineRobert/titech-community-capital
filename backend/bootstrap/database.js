'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/database.js
 *
 * Purpose:
 *   Enterprise production-grade database bootstrap adapter.
 *
 * Responsibilities:
 *   - Integrate the canonical TITech database subsystem into bootstrap.
 *   - Establish the database connection only once.
 *   - Prevent duplicate/concurrent initialization.
 *   - Provide readiness and health checks.
 *   - Support graceful database shutdown.
 *   - Track connection lifecycle state.
 *   - Surface database startup failures through startupErrors.js.
 *   - Integrate with readinessState.js.
 *   - Integrate with observability and logger.
 *   - Support Mongoose-compatible and generic database adapters.
 *   - Preserve the existing database implementation as authoritative.
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
 *   database
 *       ↓
 *   services
 *       ↓
 *   middleware
 *       ↓
 *   routes
 *       ↓
 *   HTTP server
 *
 * IMPORTANT:
 *
 *   This module is a DATABASE LIFECYCLE ADAPTER.
 *
 *   It does NOT:
 *     - implement repositories
 *     - execute business queries
 *     - execute financial transactions
 *     - implement ledger logic
 *     - implement migrations
 *     - own business models
 *     - implement MongoDB/Mongoose internals
 *
 * Existing database code remains authoritative.
 *
 * Supported underlying database contracts:
 *
 *   connect()
 *   connectDB()
 *   connectDatabase()
 *   initialize()
 *   start()
 *
 *   close()
 *   closeDB()
 *   closeDatabase()
 *   disconnect()
 *   disconnectDB()
 *   shutdown()
 *   stop()
 *
 * Health/readiness:
 *
 *   health()
 *   checkHealth()
 *   readiness()
 *   isReady()
 *   isConnected()
 *   ping()
 *
 * =============================================================================
 */

const mongoose =
  safeRequire('mongoose');

/**
 * -----------------------------------------------------------------------------
 * Optional integrations
 * -----------------------------------------------------------------------------
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

let startupErrors = null;

try {
  // eslint-disable-next-line global-require
  startupErrors =
    require('./startupErrors');
} catch {
  startupErrors = null;
}

let databaseImplementation = null;

let databaseImplementationPath =
  null;

/**
 * -----------------------------------------------------------------------------
 * Constants
 * -----------------------------------------------------------------------------
 */

const COMPONENT =
  'database';

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  'titech-backend';

const DEFAULTS = Object.freeze({
  connectTimeoutMs:
    30_000,

  healthTimeoutMs:
    5_000,

  shutdownTimeoutMs:
    30_000,

  serverSelectionTimeoutMs:
    10_000,

  heartbeatFrequencyMS:
    10_000,

  autoResolveImplementation:
    true,

  required:
    true,

  enabled:
    true,
});

const DATABASE_STATES =
  Object.freeze({
    CREATED:
      'created',

    INITIALIZING:
      'initializing',

    CONNECTED:
      'connected',

    DEGRADED:
      'degraded',

    DISCONNECTED:
      'disconnected',

    STOPPING:
      'stopping',

    STOPPED:
      'stopped',

    FAILED:
      'failed',
  });

const IMPLEMENTATION_CANDIDATES =
  Object.freeze([
    '../config/db',
    '../config/database',
    '../database',
    '../database/index',
    '../infrastructure/database',
    '../infrastructure/database/index',
    '../db',
    '../db/index',
  ]);

/**
 * -----------------------------------------------------------------------------
 * Error
 * -----------------------------------------------------------------------------
 */

class DatabaseBootstrapError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'DatabaseBootstrapError';

    this.code =
      options.code ||
      'DATABASE_BOOTSTRAP_ERROR';

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
      DatabaseBootstrapError,
    );
  }
}

/**
 * -----------------------------------------------------------------------------
 * Utility
 * -----------------------------------------------------------------------------
 */

function safeRequire(
  moduleName,
) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(moduleName);
  } catch {
    return null;
  }
}

function normalizeBoolean(
  value,
  fallback,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  if (
    typeof value ===
    'boolean'
  ) {
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

function asPositiveInteger(
  value,
  fallback,
) {
  const parsed =
    value === undefined
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

function normalizeName(
  value,
) {
  const name =
    String(
      value ||
        COMPONENT,
    ).trim();

  return name || COMPONENT;
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
      error.name,

    code:
      error.code,

    message:
      error.message,
  };
}

function hrtimeMs(
  started,
) {
  return (
    Number(
      process.hrtime.bigint() -
        started,
    ) / 1_000_000
  );
}

function withTimeout(
  fn,
  timeoutMs,
  label,
) {
  let timer;

  const operation =
    Promise.resolve().then(
      fn,
    );

  const timeout =
    new Promise(
      (_, reject) => {
        timer =
          setTimeout(
            () => {
              reject(
                new DatabaseBootstrapError(
                  `${label} timed out after ${timeoutMs}ms.`,
                  {
                    code:
                      'DATABASE_OPERATION_TIMEOUT',
                  },
                ),
              );
            },
            timeoutMs,
          );

        timer.unref?.();
      },
    );

  return Promise.race([
    operation,
    timeout,
  ]).finally(
    () => {
      if (timer) {
        clearTimeout(
          timer,
        );
      }
    },
  );
}

function unwrapModule(
  value,
) {
  if (
    value &&
    value.default
  ) {
    return value.default;
  }

  return value;
}

/**
 * -----------------------------------------------------------------------------
 * Configuration
 * -----------------------------------------------------------------------------
 */

function resolveConfiguration(
  context = {},
  options = {},
) {
  const config =
    context.config ||
    context.configuration ||
    {};

  const database =
    config.database ||
    config.db ||
    {};

  const mongo =
    database.mongodb ||
    database.mongo ||
    {};

  const uri =
    options.uri ||
    mongo.uri ||
    database.uri ||
    config.MONGO_URI ||
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    null;

  return Object.freeze({
    enabled:
      options.enabled ??
      normalizeBoolean(
        database.enabled ??
          process.env.DATABASE_ENABLED,
        DEFAULTS.enabled,
      ),

    required:
      options.required ??
      normalizeBoolean(
        database.required ??
          process.env.DATABASE_REQUIRED,
        DEFAULTS.required,
      ),

    uri,

    name:
      normalizeName(
        options.name ||
          database.name ||
          mongo.name ||
          'primary',
      ),

    connectTimeoutMs:
      asPositiveInteger(
        options.connectTimeoutMs ??
          database.connectTimeoutMs ??
          process.env.DATABASE_CONNECT_TIMEOUT_MS,
        DEFAULTS.connectTimeoutMs,
      ),

    healthTimeoutMs:
      asPositiveInteger(
        options.healthTimeoutMs ??
          database.healthTimeoutMs ??
          process.env.DATABASE_HEALTH_TIMEOUT_MS,
        DEFAULTS.healthTimeoutMs,
      ),

    shutdownTimeoutMs:
      asPositiveInteger(
        options.shutdownTimeoutMs ??
          database.shutdownTimeoutMs ??
          process.env.DATABASE_SHUTDOWN_TIMEOUT_MS,
        DEFAULTS.shutdownTimeoutMs,
      ),

    serverSelectionTimeoutMs:
      asPositiveInteger(
        options.serverSelectionTimeoutMs ??
          mongo.serverSelectionTimeoutMs ??
          process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
        DEFAULTS.serverSelectionTimeoutMs,
      ),

    heartbeatFrequencyMS:
      asPositiveInteger(
        options.heartbeatFrequencyMS ??
          mongo.heartbeatFrequencyMS ??
          process.env.MONGODB_HEARTBEAT_FREQUENCY_MS,
        DEFAULTS.heartbeatFrequencyMS,
      ),

    options:
      {
        ...(
          database.options ||
          {}
        ),
        ...(
          mongo.options ||
          {}
        ),
        ...(
          options.connectionOptions ||
          {}
        ),
      },
  });
}

/**
 * -----------------------------------------------------------------------------
 * Implementation Resolution
 * -----------------------------------------------------------------------------
 */

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

function resolveDatabaseImplementation() {
  if (
    databaseImplementation
  ) {
    return {
      implementation:
        databaseImplementation,

      path:
        databaseImplementationPath,
    };
  }

  for (
    const candidate of
      IMPLEMENTATION_CANDIDATES
  ) {
    if (
      !moduleExists(
        candidate,
      )
    ) {
      continue;
    }

    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded =
        require(candidate);

      databaseImplementation =
        unwrapModule(
          loaded,
        );

      databaseImplementationPath =
        candidate;

      return {
        implementation:
          databaseImplementation,

        path:
          databaseImplementationPath,
      };
    } catch (error) {
      throw new DatabaseBootstrapError(
        'Failed to load the TITech database implementation.',
        {
          code:
            'DATABASE_IMPLEMENTATION_LOAD_FAILED',

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
    implementation:
      null,

    path:
      null,
  };
}

/**
 * -----------------------------------------------------------------------------
 * Method Resolution
 * -----------------------------------------------------------------------------
 */

function bindMethod(
  target,
  candidates,
) {
  if (
    !target
  ) {
    return null;
  }

  for (
    const name of
      candidates
  ) {
    if (
      typeof target[name] ===
      'function'
    ) {
      return {
        name,
        fn:
          target[name].bind(
            target,
          ),
      };
    }
  }

  return null;
}

function resolveContract(
  implementation,
) {
  const candidates = [
    implementation,
    implementation?.database,
    implementation?.db,
    implementation?.connection,
    implementation?.manager,
    implementation?.default,
  ].filter(Boolean);

  const target =
    candidates[0] ||
    implementation ||
    null;

  return {
    target,

    connect:
      candidates
        .map(
          candidate =>
            bindMethod(
              candidate,
              [
                'connectDatabase',
                'connectDB',
                'connect',
                'initialize',
                'init',
                'start',
              ],
            ),
        )
        .find(Boolean) ||
      null,

    disconnect:
      candidates
        .map(
          candidate =>
            bindMethod(
              candidate,
              [
                'shutdown',
                'disconnectDatabase',
                'disconnectDB',
                'closeDatabase',
                'closeDB',
                'disconnect',
                'close',
                'stop',
              ],
            ),
        )
        .find(Boolean) ||
      null,

    health:
      candidates
        .map(
          candidate =>
            bindMethod(
              candidate,
              [
                'health',
                'checkHealth',
                'getHealth',
                'ping',
              ],
            ),
        )
        .find(Boolean) ||
      null,

    readiness:
      candidates
        .map(
          candidate =>
            bindMethod(
              candidate,
              [
                'readiness',
                'ready',
              ],
            ),
        )
        .find(Boolean) ||
      null,

    isReady:
      candidates
        .map(
          candidate =>
            bindMethod(
              candidate,
              [
                'isReady',
                'isConnected',
              ],
            ),
        )
        .find(Boolean) ||
      null,
  };
}

/**
 * =============================================================================
 * Database Manager
 * =============================================================================
 */

class DatabaseBootstrap {
  constructor(
    options = {},
  ) {
    this.options =
      Object.freeze({
        enabled:
          options.enabled ??
          normalizeBoolean(
            process.env.DATABASE_ENABLED,
            DEFAULTS.enabled,
          ),

        required:
          options.required ??
          normalizeBoolean(
            process.env.DATABASE_REQUIRED,
            DEFAULTS.required,
          ),

        autoResolveImplementation:
          options.autoResolveImplementation ??
          DEFAULTS.autoResolveImplementation,
      });

    this.state =
      DATABASE_STATES.CREATED;

    this.started =
      false;

    this.ready =
      false;

    this.stopping =
      false;

    this.stopped =
      false;

    this.failed =
      false;

    this.degraded =
      false;

    this.connectPromise =
      null;

    this.shutdownPromise =
      null;

    this.implementation =
      null;

    this.implementationPath =
      null;

    this.contract =
      null;

    this.config =
      null;

    this.context =
      null;

    this.connectedAt =
      null;

    this.disconnectedAt =
      null;

    this.lastHealthCheckAt =
      null;

    this.lastHealthResult =
      null;

    this.lastError =
      null;

    this.connectionCount =
      0;

    this._listenersInstalled =
      false;
  }

  /**
   * ---------------------------------------------------------------------------
   * Logger
   * ---------------------------------------------------------------------------
   */

  _log(
    level,
    payload,
    message,
  ) {
    try {
      const logger =
        loggerModule?.getLogger?.();

      if (
        logger &&
        typeof logger[level] ===
          'function'
      ) {
        logger[level](
          {
            component:
              COMPONENT,

            service:
              SERVICE_NAME,

            ...payload,
          },
          message,
        );

        return;
      }
    } catch {
      // Fallback below.
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
   * ---------------------------------------------------------------------------
   * Observability
   * ---------------------------------------------------------------------------
   */

  _emit(
    event,
    payload = {},
  ) {
    try {
      if (
        observabilityModule
          ?.observability
          ?.emitEvent
      ) {
        return observabilityModule
          .observability
          .emitEvent(
            event,
            {
              component:
                COMPONENT,

              service:
                SERVICE_NAME,

              ...payload,
            },
          );
      }

      if (
        typeof observabilityModule?.emitEvent ===
          'function'
      ) {
        return observabilityModule.emitEvent(
          event,
          {
            component:
              COMPONENT,

            service:
              SERVICE_NAME,

            ...payload,
          },
        );
      }
    } catch {
      // Telemetry must never block database lifecycle.
    }

    return null;
  }

  /**
   * ---------------------------------------------------------------------------
   * Initialization
   * ---------------------------------------------------------------------------
   */

  async initialize(
    context = {},
    options = {},
  ) {
    if (
      this.started &&
      this.ready &&
      !this.stopping
    ) {
      return this;
    }

    if (
      this.connectPromise
    ) {
      return this.connectPromise;
    }

    this.config =
      resolveConfiguration(
        context,
        {
          ...this.options,
          ...options,
        },
      );

    this.context =
      context;

    if (
      !this.config.enabled
    ) {
      this.degraded =
        true;

      this.state =
        DATABASE_STATES
          .DEGRADED;

      this.ready =
        !this.config.required;

      this._registerReadiness();

      return this;
    }

    this.connectPromise =
      (async () => {
        const startedAt =
          process.hrtime.bigint();

        this.state =
          DATABASE_STATES
            .INITIALIZING;

        this.failed =
          false;

        this.lastError =
          null;

        try {
          this._resolveImplementation();

          if (
            !this.contract?.connect
          ) {
            throw new DatabaseBootstrapError(
              'TITech database implementation does not expose a supported connection lifecycle.',
              {
                code:
                  'DATABASE_CONNECT_METHOD_UNAVAILABLE',
              },
            );
          }

          const connectResult =
            await withTimeout(
              () =>
                this._connect(),
              this.config
                .connectTimeoutMs,
              'TITech database connection',
            );

          this.started =
            true;

          this.ready =
            true;

          this.stopping =
            false;

          this.stopped =
            false;

          this.failed =
            false;

          this.degraded =
            false;

          this.state =
            DATABASE_STATES
              .CONNECTED;

          this.connectedAt =
            new Date();

          this.connectionCount +=
            1;

          this._installConnectionListeners();

          this._registerReadiness();

          this._emit(
            'database.connected',
            {
              implementation:
                this.implementationPath,

              durationMs:
                hrtimeMs(
                  startedAt,
                ),
            },
          );

          this._log(
            'info',
            {
              implementation:
                this.implementationPath,

              durationMs:
                hrtimeMs(
                  startedAt,
                ),
            },
            'TITech database connection established.',
          );

          return {
            database:
              this,

            connection:
              connectResult,
          };
        } catch (error) {
          const normalized =
            this._normalizeDatabaseError(
              error,
              {
                operation:
                  'database-connect',

                durationMs:
                  hrtimeMs(
                    startedAt,
                  ),
              },
            );

          this.lastError =
            normalized;

          this.failed =
            true;

          this.started =
            false;

          this.ready =
            false;

          this.degraded =
            true;

          this.state =
            DATABASE_STATES
              .FAILED;

          this._registerReadiness(
            normalized,
          );

          this._emit(
            'database.connection_failed',
            {
              error:
                safeError(
                  normalized,
                ),
            },
          );

          throw normalized;
        }
      })();

    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise =
        null;
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Implementation
   * ---------------------------------------------------------------------------
   */

  _resolveImplementation() {
    if (
      this.implementation &&
      this.contract
    ) {
      return;
    }

    if (
      this.options
        .autoResolveImplementation
    ) {
      const resolved =
        resolveDatabaseImplementation();

      if (
        resolved.implementation
      ) {
        this.implementation =
          resolved.implementation;

        this.implementationPath =
          resolved.path;

        this.contract =
          resolveContract(
            this.implementation,
          );
      }
    }

    /**
     * Mongoose fallback.
     *
     * This fallback remains here so TITech can run while the existing database
     * adapter is being migrated to a dedicated database module.
     */
    if (
      !this.contract?.connect &&
      mongoose
    ) {
      this.implementation =
        mongoose;

      this.implementationPath =
        'mongoose';

      this.contract =
        {
          target:
            mongoose,

          connect: {
            name:
              'connect',

            fn:
              mongoose.connect.bind(
                mongoose,
              ),
          },

          disconnect: {
            name:
              'disconnect',

            fn:
              mongoose.disconnect.bind(
                mongoose,
              ),
          },

          health: null,

          readiness: null,

          isReady: null,
        };
    }

    if (
      !this.contract
    ) {
      throw new DatabaseBootstrapError(
        'TITech database implementation could not be resolved.',
        {
          code:
            'DATABASE_IMPLEMENTATION_UNAVAILABLE',

          details: {
            candidates:
              IMPLEMENTATION_CANDIDATES,
          },
        },
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Connect
   * ---------------------------------------------------------------------------
   */

  async _connect() {
    const options = {
      ...(this.config?.options ||
        {}),
    };

    /**
     * Add Mongoose safety defaults when Mongoose itself owns the connection.
     */
    if (
      this.implementationPath ===
      'mongoose'
    ) {
      if (
        !options.serverSelectionTimeoutMS
      ) {
        options.serverSelectionTimeoutMS =
          this.config
            .serverSelectionTimeoutMs;
      }

      if (
        !options.heartbeatFrequencyMS
      ) {
        options.heartbeatFrequencyMS =
          this.config
            .heartbeatFrequencyMS;
      }

      if (
        !this.config.uri
      ) {
        throw new DatabaseBootstrapError(
          'TITech MongoDB URI is not configured.',
          {
            code:
              'DATABASE_URI_MISSING',
          },
        );
      }

      return this.contract
        .connect.fn(
          this.config.uri,
          options,
        );
    }

    /**
     * Existing database module.
     *
     * Prefer:
     *
     *   connect({ configuration, context })
     *
     * but fall back to:
     *
     *   connect(uri, options)
     *
     * when required.
     */
    try {
      return await this.contract
        .connect.fn(
          {
            configuration:
              this.config,

            context:
              this.context,

            uri:
              this.config.uri,

            options,
          },
        );
    } catch (
      firstError
    ) {
      /**
       * Do not retry arbitrary connection errors automatically when the
       * implementation may have side effects. Retry only the signature.
       *
       * A common legacy contract is:
       *
       *   connectDB()
       */
      if (
        this.config.uri
      ) {
        try {
          return await this.contract
            .connect.fn(
              this.config.uri,
              options,
            );
        } catch {
          throw firstError;
        }
      }

      throw firstError;
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Mongoose Connection State
   * ---------------------------------------------------------------------------
   */

  _getMongooseConnectionState() {
    if (
      !mongoose?.connection
    ) {
      return null;
    }

    const state =
      mongoose
        .connection
        .readyState;

    return {
      readyState:
        state,

      connected:
        state ===
        1,

      connecting:
        state ===
        2,

      disconnecting:
        state ===
        3,

      disconnected:
        state ===
        0,

      host:
        mongoose
          .connection
          .host ||
        null,

      name:
        mongoose
          .connection
          .name ||
        null,

      port:
        mongoose
          .connection
          .port ||
        null,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Event Listeners
   * ---------------------------------------------------------------------------
   */

  _installConnectionListeners() {
    if (
      this._listenersInstalled
    ) {
      return;
    }

    if (
      this.implementationPath !==
        'mongoose' ||
      !mongoose?.connection
    ) {
      return;
    }

    const connection =
      mongoose.connection;

    connection.on(
      'connected',
      () => {
        this.started =
          true;

        this.ready =
          true;

        this.failed =
          false;

        this.degraded =
          false;

        this.state =
          DATABASE_STATES
            .CONNECTED;

        this._registerReadiness();
      },
    );

    connection.on(
      'disconnected',
      () => {
        this.ready =
          false;

        this.degraded =
          true;

        this.state =
          DATABASE_STATES
            .DISCONNECTED;

        this._registerReadiness();
        this._emit(
          'database.disconnected',
        );
      },
    );

    connection.on(
      'reconnected',
      () => {
        this.ready =
          true;

        this.degraded =
          false;

        this.state =
          DATABASE_STATES
            .CONNECTED;

        this.lastError =
          null;

        this._registerReadiness();
        this._emit(
          'database.reconnected',
        );
      },
    );

    connection.on(
      'error',
      error => {
        this.lastError =
          error;

        this.degraded =
          true;

        this._emit(
          'database.error',
          {
            error:
              safeError(
                error,
              ),
          },
        );
      },
    );

    this._listenersInstalled =
      true;
  }

  /**
   * ---------------------------------------------------------------------------
   * Readiness
   * ---------------------------------------------------------------------------
   */

  _registerReadiness(
    error = null,
  ) {
    if (
      !readinessModule
    ) {
      return;
    }

    try {
      const existing =
        readinessModule
          .readinessState ||
        readinessModule;

      if (
        !existing
      ) {
        return;
      }

      const ready =
        this.ready &&
        !this.failed &&
        !this.stopping &&
        !this.stopped;

      if (
        ready &&
        typeof existing.markReady ===
          'function'
      ) {
        /**
         * markReady() in the current readinessState implementation is an
         * application-level method, so this adapter does not call it directly.
         *
         * Prefer dependency registration when available.
         */
        if (
          typeof existing.has ===
            'function' &&
          typeof existing.register ===
            'function' &&
          !existing.has(
            COMPONENT,
          )
        ) {
          existing.register({
            name:
              COMPONENT,

            severity:
              this.config?.required
                ? 'critical'
                : 'required',

            enabled:
              true,

            readiness:
              async () => ({
                ready:
                  this.ready,

                status:
                  this.ready
                    ? 'healthy'
                    : 'not_ready',
              }),

            health:
              async () =>
                this.health(),

            metadata: {
              component:
                COMPONENT,

              service:
                SERVICE_NAME,

              implementation:
                this.implementationPath,
            },
          });
        }

        return;
      }

      if (
        typeof existing.has ===
          'function' &&
        typeof existing.register ===
          'function'
      ) {
        if (
          !existing.has(
            COMPONENT,
          )
        ) {
          existing.register({
            name:
              COMPONENT,

            severity:
              this.config?.required
                ? 'critical'
                : 'required',

            enabled:
              true,

            readiness:
              async () => ({
                ready:
                  this.ready,

                status:
                  this.ready
                    ? 'healthy'
                    : 'not_ready',

                error:
                  safeError(
                    error,
                  ),
              }),

            health:
              async () =>
                this.health(),

            metadata: {
              component:
                COMPONENT,

              service:
                SERVICE_NAME,
            },
          });
        }
      }
    } catch {
      /**
       * Readiness integration must never replace the actual database error.
       */
    }
  }

  async readiness() {
    const current =
      await this._runReadinessCheck();

    return {
      ready:
        current.ready,

      status:
        current.ready
          ? 'ready'
          : this.degraded
            ? 'degraded'
            : 'not_ready',

      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      state:
        this.state,

      implementation:
        this.implementationPath,

      timestamp:
        new Date().toISOString(),
    };
  }

  async _runReadinessCheck() {
    if (
      this.stopping ||
      this.stopped ||
      this.failed
    ) {
      return {
        ready:
          false,
      };
    }

    if (
      this.contract?.isReady
    ) {
      try {
        const result =
          await withTimeout(
            () =>
              this.contract
                .isReady
                .fn(),
            this.config
              ?.healthTimeoutMs ||
              DEFAULTS
                .healthTimeoutMs,
            'TITech database readiness check',
          );

        return {
          ready:
            Boolean(
              result,
            ),
        };
      } catch {
        return {
          ready:
            false,
        };
      }
    }

    if (
      this.contract?.readiness
    ) {
      try {
        const result =
          await withTimeout(
            () =>
              this.contract
                .readiness
                .fn(),
            this.config
              ?.healthTimeoutMs ||
              DEFAULTS
                .healthTimeoutMs,
            'TITech database readiness check',
          );

        return {
          ready:
            normalizeReadinessResult(
              result,
            ),
        };
      } catch {
        return {
          ready:
            false,
        };
      }
    }

    const mongooseState =
      this._getMongooseConnectionState();

    if (
      mongooseState
    ) {
      return {
        ready:
          mongooseState.connected,
      };
    }

    return {
      ready:
        this.ready,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Health
   * ---------------------------------------------------------------------------
   */

  async health() {
    this.lastHealthCheckAt =
      new Date();

    try {
      let result =
        null;

      if (
        this.contract?.health
      ) {
        result =
          await withTimeout(
            () =>
              this.contract
                .health
                .fn(),
            this.config
              ?.healthTimeoutMs ||
              DEFAULTS
                .healthTimeoutMs,
            'TITech database health check',
          );
      } else {
        const readiness =
          await this._runReadinessCheck();

        result = {
          ready:
            readiness.ready,

          status:
            readiness.ready
              ? 'healthy'
              : 'unhealthy',
        };
      }

      this.lastHealthResult =
        result;

      const normalized =
        normalizeHealthResult(
          result,
        );

      return {
        status:
          this.failed
            ? 'unhealthy'
            : normalized.status,

        healthy:
          normalized.healthy,

        ready:
          normalized.ready,

        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        state:
          this.state,

        implementation:
          this.implementationPath,

        connection:
          this._getMongooseConnectionState(),

        timestamp:
          this.lastHealthCheckAt
            .toISOString(),
      };
    } catch (error) {
      this.lastHealthResult =
        {
          status:
            'unhealthy',

          error:
            safeError(
              error,
            ),
        };

      return {
        status:
          'unhealthy',

        healthy:
          false,

        ready:
          false,

        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        state:
          this.state,

        implementation:
          this.implementationPath,

        error:
          safeError(
            error,
          ),

        timestamp:
          this.lastHealthCheckAt
            .toISOString(),
      };
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Shutdown
   * ---------------------------------------------------------------------------
   */

  async shutdown(
    reason =
      'application-shutdown',
  ) {
    if (
      this.shutdownPromise
    ) {
      return this.shutdownPromise;
    }

    if (
      this.stopped
    ) {
      return true;
    }

    this.shutdownPromise =
      (async () => {
        this.stopping =
          true;

        this.ready =
          false;

        this.state =
          DATABASE_STATES
            .STOPPING;

        try {
          if (
            this.contract?.disconnect
          ) {
            await withTimeout(
              () =>
                this.contract
                  .disconnect
                  .fn(
                    {
                      reason,

                      context:
                        this.context,

                      configuration:
                        this.config,
                    },
                  ),
              this.config
                ?.shutdownTimeoutMs ||
                DEFAULTS
                  .shutdownTimeoutMs,
              'TITech database shutdown',
            );
          }

          this.started =
            false;

          this.ready =
            false;

          this.stopping =
            false;

          this.stopped =
            true;

          this.failed =
            false;

          this.degraded =
            false;

          this.state =
            DATABASE_STATES
              .STOPPED;

          this.disconnectedAt =
            new Date();

          this._emit(
            'database.stopped',
            {
              reason,
            },
          );

          this._log(
            'info',
            {
              reason,
            },
            'TITech database connection closed.',
          );

          return true;
        } catch (error) {
          const normalized =
            this._normalizeDatabaseError(
              error,
              {
                operation:
                  'database-shutdown',
              },
            );

          this.lastError =
            normalized;

          this.failed =
            true;

          this.stopping =
            false;

          this.state =
            DATABASE_STATES
              .FAILED;

          this._emit(
            'database.shutdown_failed',
            {
              error:
                safeError(
                  normalized,
                ),
            },
          );

          throw normalized;
        }
      })();

    try {
      return await this.shutdownPromise;
    } finally {
      this.shutdownPromise =
        null;
    }
  }

  async stop(
    reason,
  ) {
    return this.shutdown(
      reason,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Error Normalization
   * ---------------------------------------------------------------------------
   */

  _normalizeDatabaseError(
    error,
    options = {},
  ) {
    if (
      error instanceof
      DatabaseBootstrapError
    ) {
      return error;
    }

    if (
      startupErrors?.databaseError
    ) {
      return startupErrors.databaseError(
        error?.message ||
          'TITech database operation failed.',
        {
          cause:
            error,

          dependency:
            'database',

          component:
            COMPONENT,

          service:
            SERVICE_NAME,

          critical:
            this.config?.required !==
              false,

          retryable:
            isLikelyRetryableDatabaseError(
              error,
            ),

          operation:
            options.operation,

          durationMs:
            options.durationMs,

          preserveCauseStack:
            true,
        },
      );
    }

    return new DatabaseBootstrapError(
      error?.message ||
        'TITech database operation failed.',
      {
        code:
          'DATABASE_OPERATION_FAILED',

        cause:
          error,

        details: {
          operation:
            options.operation,
        },
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * State
   * ---------------------------------------------------------------------------
   */

  isReady() {
    return (
      this.ready &&
      !this.failed &&
      !this.stopping &&
      !this.stopped
    );
  }

  isConnected() {
    return this.isReady();
  }

  isStarted() {
    return this.started;
  }

  isStopped() {
    return this.stopped;
  }

  isFailed() {
    return this.failed;
  }

  isDegraded() {
    return this.degraded;
  }

  /**
   * ---------------------------------------------------------------------------
   * Snapshot
   * ---------------------------------------------------------------------------
   */

  snapshot() {
    return Object.freeze({
      component:
        COMPONENT,

      service:
        SERVICE_NAME,

      state:
        this.state,

      started:
        this.started,

      ready:
        this.ready,

      stopping:
        this.stopping,

      stopped:
        this.stopped,

      failed:
        this.failed,

      degraded:
        this.degraded,

      implementation:
        this.implementationPath,

      connectedAt:
        this.connectedAt,

      disconnectedAt:
        this.disconnectedAt,

      lastHealthCheckAt:
        this.lastHealthCheckAt,

      lastHealthResult:
        this.lastHealthResult,

      lastError:
        safeError(
          this.lastError,
        ),

      connectionCount:
        this.connectionCount,

      connection:
        this._getMongooseConnectionState(),

      configuration: {
        enabled:
          this.config?.enabled,

        required:
          this.config?.required,

        name:
          this.config?.name,

        uriConfigured:
          Boolean(
            this.config?.uri,
          ),

        connectTimeoutMs:
          this.config
            ?.connectTimeoutMs,

        healthTimeoutMs:
          this.config
            ?.healthTimeoutMs,

        shutdownTimeoutMs:
          this.config
            ?.shutdownTimeoutMs,
      },
    });
  }

  /**
   * ---------------------------------------------------------------------------
   * Reset
   * ---------------------------------------------------------------------------
   */

  reset() {
    if (
      this.started ||
      this.stopping
    ) {
      throw new DatabaseBootstrapError(
        'Cannot reset an active TITech database bootstrap.',
        {
          code:
            'DATABASE_RESET_NOT_ALLOWED',
        },
      );
    }

    this.state =
      DATABASE_STATES.CREATED;

    this.started =
      false;

    this.ready =
      false;

    this.stopping =
      false;

    this.stopped =
      false;

    this.failed =
      false;

    this.degraded =
      false;

    this.connectPromise =
      null;

    this.shutdownPromise =
      null;

    this.implementation =
      null;

    this.implementationPath =
      null;

    this.contract =
      null;

    this.config =
      null;

    this.context =
      null;

    this.connectedAt =
      null;

    this.disconnectedAt =
      null;

    this.lastHealthCheckAt =
      null;

    this.lastHealthResult =
      null;

    this.lastError =
      null;

    this.connectionCount =
      0;

    this._listenersInstalled =
      false;

    return this;
  }
}

/**
 -----------------------------------------------------------------------------
 * Result normalization
 * -----------------------------------------------------------------------------
 */

function normalizeReadinessResult(
  result,
) {
  if (
    typeof result ===
    'boolean'
  ) {
    return result;
  }

  if (
    result ===
      null ||
    result ===
      undefined
  ) {
    return true;
  }

  if (
    typeof result ===
    'object'
  ) {
    return (
      result.ready !==
        false &&
      result.healthy !==
        false &&
      result.status !==
        'not_ready' &&
      result.status !==
        'unhealthy'
    );
  }

  return Boolean(
    result,
  );
}

function normalizeHealthResult(
  result,
) {
  if (
    typeof result ===
    'boolean'
  ) {
    return {
      healthy:
        result,

      ready:
        result,

      status:
        result
          ? 'healthy'
          : 'unhealthy',
    };
  }

  if (
    result ===
      null ||
    result ===
      undefined
  ) {
    return {
      healthy:
        true,

      ready:
        true,

      status:
        'healthy',
    };
  }

  if (
    typeof result ===
    'object'
  ) {
    const healthy =
      result.healthy !==
        false &&
      result.status !==
        'unhealthy';

    const ready =
      result.ready !==
        false &&
      result.status !==
        'not_ready';

    return {
      healthy,

      ready,

      status:
        result.status ||
        (
          healthy
            ? 'healthy'
            : 'unhealthy'
        ),
    };
  }

  return {
    healthy:
      Boolean(result),

    ready:
      Boolean(result),

    status:
      result
        ? 'healthy'
        : 'unhealthy',
  };
}

function isLikelyRetryableDatabaseError(
  error,
) {
  const code =
    error?.code;

  return [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'MongoServerSelectionError',
    'MongoNetworkError',
    'MongoNetworkTimeoutError',
  ].includes(
    code ||
      error?.name,
  );
}

/**
 * =============================================================================
 * Default Singleton
 * =============================================================================
 */

const database =
  new DatabaseBootstrap();

/**
 * -----------------------------------------------------------------------------
 * Bootstrap Registration
 * -----------------------------------------------------------------------------
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
        -300,

      dependencies:
        options.dependencies ||
        [
          'resilience',
          'readiness',
        ],

      critical:
        options.critical !==
        false,

      timeoutMs:
        options.timeoutMs ||
        DEFAULTS
          .connectTimeoutMs,

      start:
        async hookContext =>
          database.initialize(
            hookContext ||
              context,
            options,
          ),

      ready:
        async () =>
          database.isReady(),

      health:
        async () =>
          database.health(),

      stop:
        async hookContext =>
          database.shutdown(
            hookContext?.reason ||
              'bootstrap-shutdown',
          ),

      metadata: {
        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        implementation:
          'backend/bootstrap/database.js',
      },
    },
  );
}

/**
 * -----------------------------------------------------------------------------
 * Convenience API
 * -----------------------------------------------------------------------------
 */

async function initialize(
  context,
  options,
) {
  return database.initialize(
    context,
    options,
  );
}

async function start(
  context,
  options,
) {
  return database.initialize(
    context,
    options,
  );
}

async function shutdown(
  reason,
) {
  return database.shutdown(
    reason,
  );
}

async function stop(
  reason,
) {
  return database.shutdown(
    reason,
  );
}

function isReady() {
  return database.isReady();
}

function isConnected() {
  return database.isConnected();
}

function isStarted() {
  return database.isStarted();
}

function isStopped() {
  return database.isStopped();
}

function isFailed() {
  return database.isFailed();
}

function isDegraded() {
  return database.isDegraded();
}

async function readiness() {
  return database.readiness();
}

async function health() {
  return database.health();
}

function snapshot() {
  return database.snapshot();
}

function getDatabase() {
  return database;
}

function getConnection() {
  if (
    database.implementationPath ===
      'mongoose'
  ) {
    return mongoose?.connection ||
      null;
  }

  return database.contract?.target ||
    null;
}

/**
 * -----------------------------------------------------------------------------
 * Export
 * -----------------------------------------------------------------------------
 */

module.exports =
  Object.freeze({
    /**
     * Core.
     */
    DatabaseBootstrap,

    DatabaseBootstrapError,

    DATABASE_STATES,

    database,

    /**
     * Lifecycle.
     */
    initialize,

    start,

    shutdown,

    stop,

    registerBootstrapHooks,

    bootstrap:
      registerBootstrapHooks,

    /**
     * Status.
     */
    isReady,

    isConnected,

    isStarted,

    isStopped,

    isFailed,

    isDegraded,

    /**
     * Health.
     */
    readiness,

    health,

    /**
     * Access.
     */
    getDatabase,

    getConnection,

    /**
     * Diagnostics.
     */
    snapshot,

    /**
     * Constants.
     */
    COMPONENT,

    SERVICE_NAME,

    IMPLEMENTATION_CANDIDATES,
  });