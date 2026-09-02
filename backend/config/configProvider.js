'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/configProvider.js
 *
 * Purpose:
 *   Enterprise production-grade configuration provider and access layer.
 *
 * Responsibilities:
 *   - Provide one canonical read-only configuration access boundary.
 *   - Compose environment, application and subsystem configuration.
 *   - Prevent configuration mutation after bootstrap.
 *   - Support typed configuration lookup.
 *   - Support nested/path-based configuration access.
 *   - Provide safe configuration snapshots.
 *   - Provide environment-aware configuration helpers.
 *   - Detect missing/undefined configuration explicitly.
 *   - Support test/runtime configuration overrides without mutating production
 *     configuration.
 *   - Provide compatibility with backend/config/index.js and specialized
 *     configuration modules.
 *
 * IMPORTANT:
 *
 *   This module owns CONFIGURATION ACCESS.
 *
 *   It does NOT:
 *     - load MongoDB connections.
 *     - create Redis clients.
 *     - initialize Express.
 *     - start servers.
 *     - initialize services.
 *     - mutate process.env.
 *     - execute financial transactions.
 *
 * Configuration lifecycle:
 *
 *   process.env
 *       ↓
 *   bootstrapEnvironment.js
 *       ↓
 *   config/index.js
 *       ↓
 *   specialized config modules
 *       ↓
 *   configProvider.js
 *       ↓
 *   bootstrap/application/services/infrastructure
 *
 * =============================================================================
 */

const path =
  require('node:path');

const util =
  require('node:util');

/**
 * -----------------------------------------------------------------------------
 * Configuration Sources
 * -----------------------------------------------------------------------------
 *
 * These are loaded defensively so configProvider.js does not create hard
 * circular dependencies during the bootstrap phase.
 * -----------------------------------------------------------------------------
 */

let baseConfiguration = null;
let environmentConfiguration = null;
let auditConfiguration = null;
let cacheConfiguration = null;

/**
 * Canonical config/index.js.
 */
try {
  // eslint-disable-next-line global-require
  baseConfiguration =
    require('./index');
} catch {
  baseConfiguration = null;
}

/**
 * Environment bootstrap configuration.
 */
try {
  // eslint-disable-next-line global-require
  environmentConfiguration =
    require('./bootstrapEnvironment');
} catch {
  environmentConfiguration = null;
}

/**
 * Audit policy configuration.
 */
try {
  // eslint-disable-next-line global-require
  auditConfiguration =
    require('./audit');
} catch {
  auditConfiguration = null;
}

/**
 * Cache policy configuration.
 */
try {
  // eslint-disable-next-line global-require
  cacheConfiguration =
    require('./cache');
} catch {
  cacheConfiguration = null;
}

/**
 * -----------------------------------------------------------------------------
 * Optional startup error integration
 * -----------------------------------------------------------------------------
 */

let startupErrors = null;

try {
  // eslint-disable-next-line global-require
  startupErrors =
    require('../bootstrap/startupErrors');
} catch {
  startupErrors = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
  'config-provider';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'titech-community-capital';

const CONFIG_STATES =
  Object.freeze({
    CREATED:
      'created',

    READY:
      'ready',

    DEGRADED:
      'degraded',

    FAILED:
      'failed',
  });

const SOURCE_NAMES =
  Object.freeze({
    BASE:
      'base',

    ENVIRONMENT:
      'environment',

    AUDIT:
      'audit',

    CACHE:
      'cache',

    OVERRIDE:
      'override',
  });

const DEFAULTS =
  Object.freeze({
    strict:
      true,

    cloneOnRead:
      false,

    freeze:
      true,

    allowOverrides:
      false,
  });

/**
 * =============================================================================
 * Error
 * =============================================================================
 */

class ConfigProviderError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'ConfigProviderError';

    this.code =
      options.code ||
      'CONFIG_PROVIDER_ERROR';

    this.path =
      options.path ||
      null;

    this.source =
      options.source ||
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
      ConfigProviderError,
    );
  }
}

/**
 * =============================================================================
 * Utility
 * =============================================================================
 */

function normalizePath(
  value,
) {
  if (
    Array.isArray(
      value,
    )
  ) {
    return value
      .map(
        item =>
          String(
            item,
          ).trim(),
      )
      .filter(Boolean);
  }

  if (
    typeof value !==
    'string'
  ) {
    return [];
  }

  return value
    .split('.')
    .map(
      item =>
        item.trim(),
    )
    .filter(Boolean);
}

function pathToString(
  value,
) {
  return normalizePath(
    value,
  ).join('.');
}

function hasOwn(
  object,
  key,
) {
  return Object.prototype.hasOwnProperty.call(
    object,
    key,
  );
}

function isObject(
  value,
) {
  return (
    value !== null &&
    typeof value ===
      'object' &&
    !Array.isArray(
      value,
    )
  );
}

function deepMerge(
  target,
  source,
) {
  const result =
    isObject(
      target,
    )
      ? {
          ...target,
        }
      : {};

  if (
    !isObject(
      source,
    )
  ) {
    return result;
  }

  for (
    const [
      key,
      value,
    ] of Object.entries(
      source,
    )
  ) {
    if (
      isObject(
        value,
      ) &&
      isObject(
        result[key],
      )
    ) {
      result[key] =
        deepMerge(
          result[key],
          value,
        );

      continue;
    }

    if (
      isObject(
        value,
      )
    ) {
      result[key] =
        deepMerge(
          {},
          value,
        );

      continue;
    }

    if (
      Array.isArray(
        value,
      )
    ) {
      result[key] =
        [
          ...value,
        ];

      continue;
    }

    result[key] =
      value;
  }

  return result;
}

function deepFreeze(
  value,
  seen = new WeakSet(),
) {
  if (
    value === null ||
    value === undefined ||
    (
      typeof value !==
        'object' &&
      typeof value !==
        'function'
    )
  ) {
    return value;
  }

  if (
    seen.has(
      value,
    )
  ) {
    return value;
  }

  seen.add(
    value,
  );

  for (
    const key of
      Reflect.ownKeys(
        value,
      )
  ) {
    try {
      deepFreeze(
        value[key],
        seen,
      );
    } catch {
      // Best effort.
    }
  }

  try {
    Object.freeze(
      value,
    );
  } catch {
    // Best effort.
  }

  return value;
}

function deepClone(
  value,
  seen = new WeakMap(),
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value !==
    'object'
  ) {
    return value;
  }

  if (
    seen.has(
      value,
    )
  ) {
    return seen.get(
      value,
    );
  }

  if (
    value instanceof
    Date
  ) {
    return new Date(
      value.getTime(),
    );
  }

  if (
    value instanceof
    RegExp
  ) {
    return new RegExp(
      value.source,
      value.flags,
    );
  }

  if (
    value instanceof
    Map
  ) {
    const result =
      new Map();

    seen.set(
      value,
      result,
    );

    for (
      const [
        key,
        item,
      ] of value.entries()
    ) {
      result.set(
        deepClone(
          key,
          seen,
        ),
        deepClone(
          item,
          seen,
        ),
      );
    }

    return result;
  }

  if (
    value instanceof
    Set
  ) {
    const result =
      new Set();

    seen.set(
      value,
      result,
    );

    for (
      const item of
        value.values()
    ) {
      result.add(
        deepClone(
          item,
          seen,
        ),
      );
    }

    return result;
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    const result =
      [];

    seen.set(
      value,
      result,
    );

    for (
      const item of
        value
    ) {
      result.push(
        deepClone(
          item,
          seen,
        ),
      );
    }

    return result;
  }

  const result =
    Object.create(
      Object.getPrototypeOf(
        value,
      ),
    );

  seen.set(
    value,
    result,
  );

  for (
    const [
      key,
      item,
    ] of Object.entries(
      value,
    )
  ) {
    result[key] =
      deepClone(
        item,
        seen,
      );
  }

  return result;
}

function safeSerialize(
  value,
) {
  try {
    return JSON.parse(
      JSON.stringify(
        value,
        (
          key,
          currentValue,
        ) => {
          if (
            typeof currentValue ===
            'bigint'
          ) {
            return String(
              currentValue,
            );
          }

          if (
            typeof currentValue ===
            'function'
          ) {
            return '[Function]';
          }

          return currentValue;
        },
      ),
    );
  } catch {
    return String(
      value,
    );
  }
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

function environmentName() {
  return (
    process.env.NODE_ENV ||
    baseConfiguration?.environment ||
    environmentConfiguration
      ?.environment
      ?.app?.environment ||
    environmentConfiguration
      ?.configuration
      ?.app?.environment ||
    'development'
  );
}

/**
 * =============================================================================
 * Sensitive Value Detection
 * =============================================================================
 */

const SENSITIVE_KEY_PATTERN =
  /(password|passcode|pin|otp|token|secret|authorization|cookie|api[_-]?key|client[_-]?secret|private[_-]?key|encryption[_-]?key|jwt|credential|dsn|connectionstring|mongodburi|mongouri|redisuri|redisurl|databaseuri|databaseurl)/i;

function isSensitiveKey(
  key,
) {
  return SENSITIVE_KEY_PATTERN.test(
    String(
      key,
    ),
  );
}

function sanitize(
  value,
  key = '',
  seen = new WeakSet(),
) {
  if (
    isSensitiveKey(
      key,
    )
  ) {
    return '[REDACTED]';
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value !==
      'object'
  ) {
    return value;
  }

  if (
    seen.has(
      value,
    )
  ) {
    return '[Circular]';
  }

  seen.add(
    value,
  );

  if (
    Array.isArray(
      value,
    )
  ) {
    return value.map(
      item =>
        sanitize(
          item,
          '',
          seen,
        ),
    );
  }

  const result = {};

  for (
    const [
      childKey,
      childValue,
    ] of Object.entries(
      value,
    )
  ) {
    result[
      childKey
    ] =
      sanitize(
        childValue,
        childKey,
        seen,
      );
  }

  return result;
}

/**
 * =============================================================================
 * Configuration Source Resolution
 * =============================================================================
 */

function unwrapConfiguration(
  source,
) {
  if (
    source === null ||
    source === undefined
  ) {
    return {};
  }

  if (
    source.config &&
    isObject(
      source.config,
    )
  ) {
    return source.config;
  }

  if (
    source.configuration &&
    isObject(
      source.configuration,
    )
  ) {
    return source.configuration;
  }

  if (
    source.environment &&
    isObject(
      source.environment,
    ) &&
    (
      source.runtime ||
      source.server ||
      source.app
    )
  ) {
    return source;
  }

  return source;
}

function resolveBaseConfiguration() {
  const source =
    unwrapConfiguration(
      baseConfiguration,
    );

  return isObject(
    source,
  )
    ? source
    : {};
}

function resolveEnvironmentConfiguration() {
  const source =
    environmentConfiguration;

  if (
    source?.configuration
  ) {
    return unwrapConfiguration(
      source.configuration,
    );
  }

  if (
    source?.environment
  ) {
    return unwrapConfiguration(
      source.environment,
    );
  }

  return unwrapConfiguration(
    source,
  );
}

function resolveAuditConfiguration() {
  if (
    auditConfiguration?.config
  ) {
    return {
      audit:
        auditConfiguration.config,
    };
  }

  if (
    auditConfiguration?.audit
  ) {
    return {
      audit:
        auditConfiguration.audit,
    };
  }

  return {};
}

function resolveCacheConfiguration() {
  if (
    cacheConfiguration?.config
  ) {
    return {
      cache:
        cacheConfiguration.config,
    };
  }

  if (
    cacheConfiguration?.cache
  ) {
    return {
      cache:
        cacheConfiguration.cache,
    };
  }

  return {};
}

/**
 * =============================================================================
 * Provider
 * =============================================================================
 */

class ConfigProvider {
  constructor(
    options = {},
  ) {
    this.options =
      Object.freeze({
        strict:
          options.strict ??
          DEFAULTS.strict,

        cloneOnRead:
          options.cloneOnRead ??
          DEFAULTS.cloneOnRead,

        freeze:
          options.freeze ??
          DEFAULTS.freeze,

        allowOverrides:
          options.allowOverrides ??
          DEFAULTS.allowOverrides,
      });

    this.state =
      CONFIG_STATES.CREATED;

    this.configuration =
      null;

    this.sources =
      new Map();

    this.overrides =
      {};

    this.initialized =
      false;

    this.initializedAt =
      null;

    this.version =
      0;

    this.error =
      null;
  }

  /**
   * ---------------------------------------------------------------------------
   * Initialize
   * ---------------------------------------------------------------------------
   */

  initialize(
    options = {},
  ) {
    if (
      this.initialized &&
      this.configuration
    ) {
      return this;
    }

    try {
      const override =
        options.override ||
        {};

      if (
        Object.keys(
          override,
        ).length >
          0 &&
        !(
          options.allowOverrides ??
          this.options
            .allowOverrides
        )
      ) {
        throw new ConfigProviderError(
          'TITech configuration overrides are disabled for this provider.',
          {
            code:
              'CONFIG_OVERRIDES_DISABLED',
          },
        );
      }

      this.sources.set(
        SOURCE_NAMES.BASE,
        resolveBaseConfiguration(),
      );

      this.sources.set(
        SOURCE_NAMES.ENVIRONMENT,
        resolveEnvironmentConfiguration(),
      );

      this.sources.set(
        SOURCE_NAMES.AUDIT,
        resolveAuditConfiguration(),
      );

      this.sources.set(
        SOURCE_NAMES.CACHE,
        resolveCacheConfiguration(),
      );

      this.overrides =
        deepClone(
          override,
        );

      if (
        Object.keys(
          this.overrides,
        ).length >
          0
      ) {
        this.sources.set(
          SOURCE_NAMES.OVERRIDE,
          this.overrides,
        );
      }

      let configuration =
        {};

      /**
       * Source precedence:
       *
       * base
       *   ↓
       * environment
       *   ↓
       * specialized modules
       *   ↓
       * explicit runtime override
       */
      for (
        const [
          ,
          source,
        ] of this.sources
      ) {
        configuration =
          deepMerge(
            configuration,
            source,
          );
      }

      /**
       * Canonical aliases.
       */
      configuration =
        this._normalizeCanonicalShape(
          configuration,
        );

      /**
       * Validate before exposing configuration.
       */
      this._validate(
        configuration,
      );

      /**
       * Freeze production configuration.
       */
      this.configuration =
        this.options.freeze
          ? deepFreeze(
              configuration,
            )
          : configuration;

      this.state =
        CONFIG_STATES.READY;

      this.initialized =
        true;

      this.initializedAt =
        new Date();

      this.version +=
        1;

      this.error =
        null;

      return this;
    } catch (error) {
      this.state =
        CONFIG_STATES.FAILED;

      this.initialized =
        false;

      this.error =
        error;

      throw this._normalizeError(
        error,
      );
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Canonical shape
   * ---------------------------------------------------------------------------
   */

  _normalizeCanonicalShape(
    configuration,
  ) {
    const result =
      deepClone(
        configuration,
      );

    /**
     * Canonical application aliases.
     */
    result.app =
      result.app ||
      {};

    result.app.name =
      result.app.name ||
      result.applicationName ||
      result.name ||
      APPLICATION_NAME;

    result.app.serviceName =
      result.app.serviceName ||
      result.serviceName ||
      SERVICE_NAME;

    result.app.version =
      result.app.version ||
      result.version ||
      process.env.npm_package_version ||
      '0.0.0';

    result.app.environment =
      result.app.environment ||
      result.environment ||
      environmentName();

    result.app.nodeEnv =
      result.app.nodeEnv ||
      result.nodeEnv ||
      result.app.environment;

    /**
     * Canonical server aliases.
     */
    result.server =
      result.server ||
      {};

    if (
      result.port !==
      undefined &&
      result.server.port ===
        undefined
    ) {
      result.server.port =
        result.port;
    }

    if (
      result.host !==
      undefined &&
      result.server.host ===
        undefined
    ) {
      result.server.host =
        result.host;
    }

    /**
     * Canonical runtime aliases.
     */
    result.runtime =
      result.runtime ||
      {};

    result.runtime.nodeEnv =
      result.runtime.nodeEnv ||
      result.app.nodeEnv;

    result.runtime.environment =
      result.runtime.environment ||
      result.app.environment;

    result.runtime.production =
      result.runtime.production ??
      result.app.environment ===
        'production';

    result.runtime.staging =
      result.runtime.staging ??
      result.app.environment ===
        'staging';

    result.runtime.development =
      result.runtime.development ??
      result.app.environment ===
        'development';

    result.runtime.test =
      result.runtime.test ??
      result.app.environment ===
        'test';

    /**
     * Canonical observability aliases.
     */
    result.observability =
      result.observability ||
      {};

    if (
      result.flags?.metrics !==
        undefined &&
      result.observability
        .metricsEnabled ===
        undefined
    ) {
      result.observability
        .metricsEnabled =
        result.flags.metrics;
    }

    if (
      result.flags?.tracing !==
        undefined &&
      result.observability
        .tracingEnabled ===
        undefined
    ) {
      result.observability
        .tracingEnabled =
        result.flags.tracing;
    }

    /**
     * Canonical audit/cache.
     */
    result.audit =
      result.audit ||
      {};

    result.cache =
      result.cache ||
      {};

    return result;
  }

  /**
   * ---------------------------------------------------------------------------
   * Validation
   * ---------------------------------------------------------------------------
   */

  _validate(
    configuration,
  ) {
    if (
      !isObject(
        configuration,
      )
    ) {
      throw new ConfigProviderError(
        'TITech configuration must resolve to an object.',
        {
          code:
            'CONFIGURATION_INVALID',
        },
      );
    }

    if (
      !configuration.app?.name
    ) {
      throw new ConfigProviderError(
        'TITech application name is not configured.',
        {
          code:
            'APPLICATION_NAME_MISSING',

          path:
            'app.name',
        },
      );
    }

    if (
      !configuration.app?.serviceName
    ) {
      throw new ConfigProviderError(
        'TITech service name is not configured.',
        {
          code:
            'SERVICE_NAME_MISSING',

          path:
            'app.serviceName',
        },
      );
    }

    const environment =
      configuration
        .app
        ?.environment;

    if (
      !environment
    ) {
      throw new ConfigProviderError(
        'TITech runtime environment is not configured.',
        {
          code:
            'ENVIRONMENT_MISSING',

          path:
            'app.environment',
        },
      );
    }

    if (
      configuration.server?.port !==
      undefined
    ) {
      const port =
        Number(
          configuration
            .server
            .port,
        );

      if (
        !Number.isInteger(
          port,
        ) ||
        port < 1 ||
        port > 65_535
      ) {
        throw new ConfigProviderError(
          'TITech server port configuration is invalid.',
          {
            code:
              'SERVER_PORT_INVALID',

            path:
              'server.port',
          },
        );
      }
    }
  }

  /**
   * ---------------------------------------------------------------------------
   * Runtime initialize adapter
   * ---------------------------------------------------------------------------
   */

  async start(
    context = {},
  ) {
    this.initialize();

    if (
      context &&
      typeof context ===
        'object'
    ) {
      context.configuration =
        this.configuration;

      context.config =
        this.configuration;
    }

    return this.configuration;
  }

  async bootstrap(
    context = {},
  ) {
    return this.start(
      context,
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Basic access
   * ---------------------------------------------------------------------------
   */

  get(
    pathValue,
    defaultValue = undefined,
    options = {},
  ) {
    this._ensureInitialized();

    const pathParts =
      normalizePath(
        pathValue,
      );

    if (
      pathParts.length ===
      0
    ) {
      return this._returnValue(
        this.configuration,
        options,
      );
    }

    let current =
      this.configuration;

    for (
      const part of
        pathParts
    ) {
      if (
        current ===
          null ||
        current ===
          undefined ||
        !hasOwn(
          Object(
            current,
          ),
          part,
        )
      ) {
        if (
          options.required ??
          false
        ) {
          throw new ConfigProviderError(
            `Required TITech configuration "${pathParts.join(
              '.',
            )}" is undefined.`,
            {
              code:
                'CONFIGURATION_REQUIRED_MISSING',

              path:
                pathParts.join(
                  '.',
                ),
            },
          );
        }

        return defaultValue;
      }

      current =
        current[
          part
        ];
    }

    return this._returnValue(
      current,
      options,
    );
  }

  has(
    pathValue,
  ) {
    this._ensureInitialized();

    const parts =
      normalizePath(
        pathValue,
      );

    if (
      parts.length ===
      0
    ) {
      return true;
    }

    let current =
      this.configuration;

    for (
      const part of
        parts
    ) {
      if (
        current ===
          null ||
        current ===
          undefined ||
        !hasOwn(
          Object(
            current,
          ),
          part,
        )
      ) {
        return false;
      }

      current =
        current[
          part
        ];
    }

    return true;
  }

  require(
    pathValue,
    options = {},
  ) {
    return this.get(
      pathValue,
      undefined,
      {
        ...options,
        required:
          true,
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Typed getters
   * ---------------------------------------------------------------------------
   */

  getString(
    pathValue,
    defaultValue = undefined,
    options = {},
  ) {
    const value =
      this.get(
        pathValue,
        defaultValue,
        options,
      );

    if (
      value ===
        undefined ||
      value ===
        null
    ) {
      return defaultValue;
    }

    return String(
      value,
    );
  }

  getBoolean(
    pathValue,
    defaultValue = false,
    options = {},
  ) {
    const value =
      this.get(
        pathValue,
        defaultValue,
        options,
      );

    if (
      typeof value ===
      'boolean'
    ) {
      return value;
    }

    if (
      value ===
        undefined ||
      value ===
        null
    ) {
      return defaultValue;
    }

    const normalized =
      String(
        value,
      )
        .trim()
        .toLowerCase();

    if (
      [
        'true',
        '1',
        'yes',
        'on',
        'enabled',
      ].includes(
        normalized,
      )
    ) {
      return true;
    }

    if (
      [
        'false',
        '0',
        'no',
        'off',
        'disabled',
      ].includes(
        normalized,
      )
    ) {
      return false;
    }

    if (
      options.strict ??
      this.options.strict
    ) {
      throw new ConfigProviderError(
        `TITech configuration "${pathToString(
          pathValue,
        )}" is not a valid boolean.`,
        {
          code:
            'CONFIGURATION_BOOLEAN_INVALID',

          path:
            pathToString(
              pathValue,
            ),
        },
      );
    }

    return defaultValue;
  }

  getNumber(
    pathValue,
    defaultValue = undefined,
    options = {},
  ) {
    const value =
      this.get(
        pathValue,
        defaultValue,
        options,
      );

    if (
      value ===
        undefined ||
      value ===
        null
    ) {
      return defaultValue;
    }

    const parsed =
      Number(
        value,
      );

    if (
      Number.isFinite(
        parsed,
      )
    ) {
      return parsed;
    }

    if (
      options.strict ??
      this.options.strict
    ) {
      throw new ConfigProviderError(
        `TITech configuration "${pathToString(
          pathValue,
        )}" is not a valid number.`,
        {
          code:
            'CONFIGURATION_NUMBER_INVALID',

          path:
            pathToString(
              pathValue,
            ),
        },
      );
    }

    return defaultValue;
  }

  getInteger(
    pathValue,
    defaultValue = undefined,
    options = {},
  ) {
    const value =
      this.getNumber(
        pathValue,
        defaultValue,
        options,
      );

    if (
      value ===
        undefined ||
      value ===
        null
    ) {
      return defaultValue;
    }

    if (
      Number.isInteger(
        value,
      )
    ) {
      return value;
    }

    if (
      options.strict ??
      this.options.strict
    ) {
      throw new ConfigProviderError(
        `TITech configuration "${pathToString(
          pathValue,
        )}" must be an integer.`,
        {
          code:
            'CONFIGURATION_INTEGER_INVALID',

          path:
            pathToString(
              pathValue,
            ),
        },
      );
    }

    return defaultValue;
  }

  getArray(
    pathValue,
    defaultValue = [],
    options = {},
  ) {
    const value =
      this.get(
        pathValue,
        defaultValue,
        options,
      );

    if (
      Array.isArray(
        value,
      )
    ) {
      return this._returnValue(
        value,
        options,
      );
    }

    if (
      options.strict ??
      this.options.strict
    ) {
      throw new ConfigProviderError(
        `TITech configuration "${pathToString(
          pathValue,
        )}" must be an array.`,
        {
          code:
            'CONFIGURATION_ARRAY_INVALID',

          path:
            pathToString(
              pathValue,
            ),
        },
      );
    }

    return defaultValue;
  }

  getObject(
    pathValue,
    defaultValue = {},
    options = {},
  ) {
    const value =
      this.get(
        pathValue,
        defaultValue,
        options,
      );

    if (
      isObject(
        value,
      )
    ) {
      return this._returnValue(
        value,
        options,
      );
    }

    if (
      options.strict ??
      this.options.strict
    ) {
      throw new ConfigProviderError(
        `TITech configuration "${pathToString(
          pathValue,
        )}" must be an object.`,
        {
          code:
            'CONFIGURATION_OBJECT_INVALID',

          path:
            pathToString(
              pathValue,
            ),
        },
      );
    }

    return defaultValue;
  }

  /**
   * ---------------------------------------------------------------------------
   * Environment helpers
   * ---------------------------------------------------------------------------
   */

  isProduction() {
    return (
      this.getString(
        'app.environment',
        'development',
      ) ===
      'production'
    );
  }

  isStaging() {
    return (
      this.getString(
        'app.environment',
        'development',
      ) ===
      'staging'
    );
  }

  isDevelopment() {
    return (
      this.getString(
        'app.environment',
        'development',
      ) ===
      'development'
    );
  }

  isTest() {
    return (
      this.getString(
        'app.environment',
        'development',
      ) ===
      'test'
    );
  }

  isFeatureEnabled(
    feature,
    defaultValue = false,
  ) {
    const direct =
      this.get(
        `flags.${feature}`,
        undefined,
      );

    if (
      direct !==
      undefined
    ) {
      return Boolean(
        direct,
      );
    }

    const nested =
      this.get(
        `features.${feature}`,
        undefined,
      );

    if (
      nested !==
      undefined
    ) {
      return Boolean(
        nested,
      );
    }

    return defaultValue;
  }

  /**
   * ---------------------------------------------------------------------------
   * Common application accessors
   * ---------------------------------------------------------------------------
   */

  getApplicationName() {
    return this.getString(
      'app.name',
      APPLICATION_NAME,
    );
  }

  getServiceName() {
    return this.getString(
      'app.serviceName',
      SERVICE_NAME,
    );
  }

  getVersion() {
    return this.getString(
      'app.version',
      '0.0.0',
    );
  }

  getEnvironment() {
    return this.getString(
      'app.environment',
      'development',
    );
  }

  getPort() {
    return this.getInteger(
      'server.port',
      3000,
    );
  }

  getHost() {
    return this.getString(
      'server.host',
      '0.0.0.0',
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Specialized configuration
   * ---------------------------------------------------------------------------
   */

  getAuditConfig() {
    return this.getObject(
      'audit',
      {},
    );
  }

  getCacheConfig() {
    return this.getObject(
      'cache',
      {},
    );
  }

  getDatabaseConfig() {
    return this.getObject(
      'database',
      {},
    );
  }

  getRedisConfig() {
    return this.getObject(
      'redis',
      {},
    );
  }

  getObservabilityConfig() {
    return this.getObject(
      'observability',
      {},
    );
  }

  getResilienceConfig() {
    return this.getObject(
      'resilience',
      {},
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Safe snapshot
   * ---------------------------------------------------------------------------
   */

  snapshot(
    options = {},
  ) {
    this._ensureInitialized();

    const sanitized =
      sanitize(
        this.configuration,
      );

    return deepFreeze(
      {
        component:
          COMPONENT,

        service:
          this.getServiceName(),

        application:
          this.getApplicationName(),

        version:
          this.getVersion(),

        environment:
          this.getEnvironment(),

        state:
          this.state,

        initialized:
          this.initialized,

        versionNumber:
          this.version,

        initializedAt:
          this.initializedAt,

        configuration:
          sanitized,

        sources:
          Array.from(
            this.sources.keys(),
          ),

        timestamp:
          new Date().toISOString(),

        ...(options.includeMetadata
          ? {
              metadata: {
                provider:
                  COMPONENT,

                service:
                  SERVICE_NAME,

                application:
                  APPLICATION_NAME,

                runtimePath:
                  path.resolve(
                    __dirname,
                  ),

                nodeVersion:
                  process.versions
                    .node,
              },
            }
          : {}),
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Unsafe full configuration access
   * ---------------------------------------------------------------------------
   *
   * This is intentionally explicit. Prefer get()/snapshot() for normal code.
   * ----------------------------------------------------------------------------
   */

  getAll() {
    this._ensureInitialized();

    return this.configuration;
  }

  /**
   * ---------------------------------------------------------------------------
   * Source inspection
   * ---------------------------------------------------------------------------
   */

  getSources() {
    return Object.freeze(
      Array.from(
        this.sources.entries(),
      ).map(
        ([
          name,
          source,
        ]) => ({
          name,

          keys:
            Object.keys(
              source || {},
            ),

          available:
            Boolean(
              source,
            ),
        }),
      ),
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Overrides
   * ---------------------------------------------------------------------------
   *
   * Overrides are explicitly opt-in and should normally be limited to tests or
   * isolated CLI processes.
   * ---------------------------------------------------------------------------
   */

  withOverride(
    override,
    options = {},
  ) {
    if (
      !this.options
        .allowOverrides &&
      options.allowOverrides !==
        true
    ) {
      throw new ConfigProviderError(
        'TITech configuration overrides are disabled.',
        {
          code:
            'CONFIG_OVERRIDES_DISABLED',
        },
      );
    }

    const provider =
      new ConfigProvider(
        {
          ...this.options,

          allowOverrides:
            true,
        },
      );

    provider.initialize({
      override:
        override || {},

      allowOverrides:
        true,
    });

    return provider;
  }

  /**
   * ---------------------------------------------------------------------------
   * Status
   * ---------------------------------------------------------------------------
   */

  isReady() {
    return (
      this.initialized &&
      this.state ===
        CONFIG_STATES.READY &&
      !this.error
    );
  }

  isDegraded() {
    return (
      this.state ===
      CONFIG_STATES.DEGRADED
    );
  }

  isFailed() {
    return (
      this.state ===
      CONFIG_STATES.FAILED
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Internal
   * ---------------------------------------------------------------------------
   */

  _ensureInitialized() {
    if (
      !this.initialized ||
      !this.configuration
    ) {
      this.initialize();
    }
  }

  _returnValue(
    value,
    options = {},
  ) {
    if (
      options.clone ??
      this.options.cloneOnRead
    ) {
      return deepClone(
        value,
      );
    }

    return value;
  }

  _normalizeError(
    error,
  ) {
    if (
      error instanceof
      ConfigProviderError
    ) {
      return error;
    }

    if (
      startupErrors
        ?.configurationError
    ) {
      return startupErrors.configurationError(
        error?.message ||
          'TITech configuration provider failed.',
        {
          cause:
            error,

          critical:
            true,

          fatal:
            true,

          details: {
            component:
              COMPONENT,
          },
        },
      );
    }

    return new ConfigProviderError(
      error?.message ||
        'TITech configuration provider failed.',
      {
        code:
          error?.code ||
          'CONFIG_PROVIDER_INITIALIZATION_FAILED',

        cause:
          error,
      },
    );
  }

  /**
   * ---------------------------------------------------------------------------
   * Reset
   * ---------------------------------------------------------------------------
   *
   * Test/process isolation only.
   */

  reset() {
    this.configuration =
      null;

    this.sources.clear();

    this.overrides =
      {};

    this.initialized =
      false;

    this.initializedAt =
      null;

    this.version =
      0;

    this.error =
      null;

    this.state =
      CONFIG_STATES.CREATED;

    return this;
  }
}

/**
 * =============================================================================
 * Default Singleton
 * =============================================================================
 */

const configProvider =
  new ConfigProvider();

/**
 * =============================================================================
 * Initialize Default Provider
 * =============================================================================
 */

configProvider.initialize();

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function get(
  pathValue,
  defaultValue,
  options,
) {
  return configProvider.get(
    pathValue,
    defaultValue,
    options,
  );
}

function requireConfig(
  pathValue,
  options,
) {
  return configProvider.require(
    pathValue,
    options,
  );
}

function has(
  pathValue,
) {
  return configProvider.has(
    pathValue,
  );
}

function getString(
  pathValue,
  defaultValue,
  options,
) {
  return configProvider.getString(
    pathValue,
    defaultValue,
    options,
  );
}

function getBoolean(
  pathValue,
  defaultValue,
  options,
) {
  return configProvider.getBoolean(
    pathValue,
    defaultValue,
    options,
  );
}

function getNumber(
  pathValue,
  defaultValue,
  options,
) {
  return configProvider.getNumber(
    pathValue,
    defaultValue,
    options,
  );
}

function getInteger(
  pathValue,
  defaultValue,
  options,
) {
  return configProvider.getInteger(
    pathValue,
    defaultValue,
    options,
  );
}

function getArray(
  pathValue,
  defaultValue,
  options,
) {
  return configProvider.getArray(
    pathValue,
    defaultValue,
    options,
  );
}

function getObject(
  pathValue,
  defaultValue,
  options,
) {
  return configProvider.getObject(
    pathValue,
    defaultValue,
    options,
  );
}

function snapshot(
  options,
) {
  return configProvider.snapshot(
    options,
  );
}

/**
 * =============================================================================
 * Export
 * =============================================================================
 */

module.exports =
  Object.freeze({
    /**
     * Core.
     */
    ConfigProvider,

    ConfigProviderError,

    configProvider,

    provider:
      configProvider,

    /**
     * State.
     */
    CONFIG_STATES,

    SOURCE_NAMES,

    /**
     * Lifecycle.
     */
    initialize:
      options =>
        configProvider.initialize(
          options,
        ),

    start:
      context =>
        configProvider.start(
          context,
        ),

    bootstrap:
      context =>
        configProvider.bootstrap(
          context,
        ),

    reset:
      () =>
        configProvider.reset(),

    /**
     * Generic lookup.
     */
    get,

    require:
      requireConfig,

    has,

    getAll:
      () =>
        configProvider.getAll(),

    /**
     * Typed lookup.
     */
    getString,

    getBoolean,

    getNumber,

    getInteger,

    getArray,

    getObject,

    /**
     * Application helpers.
     */
    getApplicationName:
      () =>
        configProvider.getApplicationName(),

    getServiceName:
      () =>
        configProvider.getServiceName(),

    getVersion:
      () =>
        configProvider.getVersion(),

    getEnvironment:
      () =>
        configProvider.getEnvironment(),

    getPort:
      () =>
        configProvider.getPort(),

    getHost:
      () =>
        configProvider.getHost(),

    isProduction:
      () =>
        configProvider.isProduction(),

    isStaging:
      () =>
        configProvider.isStaging(),

    isDevelopment:
      () =>
        configProvider.isDevelopment(),

    isTest:
      () =>
        configProvider.isTest(),

    isFeatureEnabled:
      (
        feature,
        defaultValue,
      ) =>
        configProvider.isFeatureEnabled(
          feature,
          defaultValue,
        ),

    /**
     * Specialized configuration.
     */
    getAuditConfig:
      () =>
        configProvider.getAuditConfig(),

    getCacheConfig:
      () =>
        configProvider.getCacheConfig(),

    getDatabaseConfig:
      () =>
        configProvider.getDatabaseConfig(),

    getRedisConfig:
      () =>
        configProvider.getRedisConfig(),

    getObservabilityConfig:
      () =>
        configProvider.getObservabilityConfig(),

    getResilienceConfig:
      () =>
        configProvider.getResilienceConfig(),

    /**
     * Diagnostics.
     */
    snapshot,

    getSources:
      () =>
        configProvider.getSources(),

    /**
     * Explicit test/runtime overrides.
     */
    withOverride:
      (
        override,
        options,
      ) =>
        configProvider.withOverride(
          override,
          options,
        ),

    /**
     * Status.
     */
    isReady:
      () =>
        configProvider.isReady(),

    isDegraded:
      () =>
        configProvider.isDegraded(),

    isFailed:
      () =>
        configProvider.isFailed(),

    /**
     * Metadata.
     */
    COMPONENT,

    SERVICE_NAME,

    APPLICATION_NAME,
  });