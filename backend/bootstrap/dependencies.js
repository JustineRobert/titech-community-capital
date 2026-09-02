'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/dependencies.js
 *
 * Purpose:
 *   Enterprise production-grade runtime dependency registry.
 *
 * Responsibilities:
 *   - Register required and optional runtime dependencies.
 *   - Resolve dependencies deterministically.
 *   - Validate required dependencies before application readiness.
 *   - Lazily load optional integrations.
 *   - Track dependency lifecycle and availability.
 *   - Expose safe dependency metadata.
 *   - Support test/runtime dependency overrides.
 *   - Provide dependency lookup without repeated require() calls.
 *   - Provide health/status diagnostics.
 *   - Prevent accidental exposure of dependency internals.
 *
 * Architectural position:
 *
 *   environment
 *       ↓
 *   configuration
 *       ↓
 *   dependency registry
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
 *   services
 *       ↓
 *   middleware
 *       ↓
 *   routes
 *       ↓
 *   server
 *
 * IMPORTANT:
 *
 *   This module manages SOFTWARE DEPENDENCIES.
 *
 *   It does NOT:
 *     - connect MongoDB
 *     - connect Redis
 *     - start queues
 *     - execute financial transactions
 *     - implement application services
 *     - implement business logic
 *     - implement HTTP routes
 *
 *   Runtime infrastructure lifecycle remains owned by the corresponding
 *   bootstrap modules.
 *
 * =============================================================================
 */

const path =
  require('node:path');

const fs =
  require('node:fs');

/**
 * -----------------------------------------------------------------------------
 * Runtime Context
 * -----------------------------------------------------------------------------
 */

let runtimeContext =
  null;

try {
  // eslint-disable-next-line global-require
  runtimeContext =
    require('../runtime/context');
} catch {
  runtimeContext =
    null;
}

/**
 * -----------------------------------------------------------------------------
 * Package Metadata
 * -----------------------------------------------------------------------------
 */

function resolvePackageJson() {
  try {
    if (
      runtimeContext?.packageJson
    ) {
      return runtimeContext.packageJson;
    }

    const packagePath =
      path.resolve(
        __dirname,
        '..',
        '..',
        'package.json',
      );

    if (
      fs.existsSync(
        packagePath,
      )
    ) {
      return JSON.parse(
        fs.readFileSync(
          packagePath,
          'utf8',
        ),
      );
    }
  } catch {
    // Metadata is diagnostic only.
  }

  return {
    name:
      'titech-backend',

    version:
      '0.0.0',
  };
}

const packageJson =
  resolvePackageJson();

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const DEPENDENCY_TYPES =
  Object.freeze({
    REQUIRED:
      'required',

    OPTIONAL:
      'optional',
  });

const DEPENDENCY_STATES =
  Object.freeze({
    REGISTERED:
      'registered',

    LOADING:
      'loading',

    AVAILABLE:
      'available',

    UNAVAILABLE:
      'unavailable',

    OVERRIDDEN:
      'overridden',

    FAILED:
      'failed',
  });

const COMPONENT =
  'dependency-registry';

const SERVICE_NAME =
  process.env.SERVICE_NAME ||
  process.env.OTEL_SERVICE_NAME ||
  'titech-backend';

/**
 * -----------------------------------------------------------------------------
 * Sensitive module/configuration keys
 * -----------------------------------------------------------------------------
 */

const SENSITIVE_KEYS =
  new Set([
    'password',
    'passcode',
    'pin',
    'otp',
    'token',
    'accessToken',
    'refreshToken',
    'authorization',
    'cookie',
    'secret',
    'apiKey',
    'api_key',
    'clientSecret',
    'client_secret',
    'privateKey',
    'private_key',
    'encryptionKey',
    'encryption_key',
    'jwt',
    'jwtSecret',
    'uri',
    'connectionString',
    'dsn',
  ]);

/**
 * =============================================================================
 * Core Dependency Loader
 * =============================================================================
 *
 * Required dependencies are loaded eagerly because failure to load them means
 * the application cannot safely bootstrap.
 *
 * =============================================================================
 */

function loadRequired(
  moduleName,
) {
  const startedAt =
    process.hrtime.bigint();

  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const dependency =
      require(moduleName);

    return {
      dependency,

      available:
        true,

      state:
        DEPENDENCY_STATES
          .AVAILABLE,

      error:
        null,

      loadDurationMs:
        elapsedMs(
          startedAt,
        ),
    };
  } catch (error) {
    const normalized =
      normalizeLoadError(
        moduleName,
        error,
      );

    normalized.loadDurationMs =
      elapsedMs(
        startedAt,
      );

    throw normalized;
  }
}

/**
 * -----------------------------------------------------------------------------
 * Optional Dependency Loader
 * -----------------------------------------------------------------------------
 *
 * Optional packages are not loaded until explicitly requested unless eager
 * loading is configured.
 * -----------------------------------------------------------------------------
 */

function loadOptional(
  moduleName,
) {
  const startedAt =
    process.hrtime.bigint();

  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const dependency =
      require(moduleName);

    return {
      dependency,

      available:
        true,

      state:
        DEPENDENCY_STATES
          .AVAILABLE,

      error:
        null,

      loadDurationMs:
        elapsedMs(
          startedAt,
        ),
    };
  } catch (error) {
    return {
      dependency:
        null,

      available:
        false,

      state:
        DEPENDENCY_STATES
          .UNAVAILABLE,

      error:
        sanitizeErrorMessage(
          error,
        ),

      loadDurationMs:
        elapsedMs(
          startedAt,
        ),
    };
  }
}

/**
 * =============================================================================
 * Built-in Dependency Catalog
 * =============================================================================
 */

const REQUIRED_DEPENDENCY_DEFINITIONS =
  Object.freeze({
    express:
      Object.freeze({
        module:
          'express',
      }),

    cors:
      Object.freeze({
        module:
          'cors',
      }),

    cookieParser:
      Object.freeze({
        module:
          'cookie-parser',
      }),

    helmet:
      Object.freeze({
        module:
          'helmet',
      }),

    compression:
      Object.freeze({
        module:
          'compression',
      }),

    responseTime:
      Object.freeze({
        module:
          'response-time',
      }),

    timeout:
      Object.freeze({
        module:
          'connect-timeout',
      }),

    rateLimit:
      Object.freeze({
        module:
          'express-rate-limit',
      }),

    hpp:
      Object.freeze({
        module:
          'hpp',
      }),

    mongoSanitize:
      Object.freeze({
        module:
          'express-mongo-sanitize',
      }),

    xss:
      Object.freeze({
        module:
          'xss-clean',
      }),

    mongoose:
      Object.freeze({
        module:
          'mongoose',
      }),

    Redis:
      Object.freeze({
        module:
          'ioredis',
      }),

    promClient:
      Object.freeze({
        module:
          'prom-client',
      }),

    Joi:
      Object.freeze({
        module:
          'joi',
      }),

    Ajv:
      Object.freeze({
        module:
          'ajv',
      }),

    addFormats:
      Object.freeze({
        module:
          'ajv-formats',
      }),
  });

const OPTIONAL_DEPENDENCY_DEFINITIONS =
  Object.freeze({
    BullMQ:
      Object.freeze({
        module:
          'bullmq',

        description:
          'Queue and worker infrastructure.',
      }),

    swaggerUi:
      Object.freeze({
        module:
          'swagger-ui-express',

        description:
          'OpenAPI/Swagger HTTP documentation UI.',
      }),

    swaggerJsDoc:
      Object.freeze({
        module:
          'swagger-jsdoc',

        description:
          'OpenAPI document generation.',
      }),

    OpenTelemetry:
      Object.freeze({
        module:
          '@opentelemetry/api',

        description:
          'Distributed tracing API.',
      }),

    Sentry:
      Object.freeze({
        module:
          '@sentry/node',

        description:
          'Error and performance telemetry.',
      }),

    Pino:
      Object.freeze({
        module:
          'pino',

        description:
          'Structured logging.',
      }),

    Winston:
      Object.freeze({
        module:
          'winston',

        description:
          'Alternative structured logging provider.',
      }),
  });

/**
 * =============================================================================
 * Registry
 * =============================================================================
 */

const dependencyRegistry =
  new Map();

/**
 * =============================================================================
 * Utility
 * =============================================================================
 */

function elapsedMs(
  startedAt,
) {
  return (
    Number(
      process.hrtime.bigint() -
        startedAt,
    ) / 1_000_000
  );
}

function normalizeName(
  name,
) {
  if (
    typeof name !==
      'string' ||
    name.trim() ===
      ''
  ) {
    throw new TypeError(
      'Dependency name must be a non-empty string.',
    );
  }

  return name.trim();
}

function sanitizeErrorMessage(
  error,
) {
  const message =
    error?.message ||
    String(error);

  return message.length >
    500
    ? message.slice(
        0,
        500,
      )
    : message;
}

function normalizeLoadError(
  moduleName,
  error,
) {
  const normalized =
    new Error(
      `Required TITech dependency "${moduleName}" could not be loaded: ${sanitizeErrorMessage(
        error,
      )}`,
    );

  normalized.code =
    error?.code ||
    'DEPENDENCY_LOAD_FAILED';

  normalized.cause =
    error;

  normalized.module =
    moduleName;

  return normalized;
}

function safeFreeze(
  value,
) {
  try {
    return Object.freeze(
      value,
    );
  } catch {
    return value;
  }
}

function sanitize(
  value,
  seen = new WeakSet(),
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
    typeof value ===
    'function'
  ) {
    return '[Function]';
  }

  if (
    seen.has(value)
  ) {
    return '[Circular]';
  }

  seen.add(value);

  if (
    Array.isArray(value)
  ) {
    return value.map(
      item =>
        sanitize(
          item,
          seen,
        ),
    );
  }

  const result = {};

  for (
    const [
      key,
      child,
    ] of Object.entries(
      value,
    )
  ) {
    if (
      SENSITIVE_KEYS.has(
        key,
      ) ||
      SENSITIVE_KEYS.has(
        key.toLowerCase(),
      )
    ) {
      result[key] =
        '[REDACTED]';

      continue;
    }

    result[key] =
      sanitize(
        child,
        seen,
      );
  }

  return result;
}

/**
 * =============================================================================
 * Registry Record
 * =============================================================================
 */

function createRecord(
  name,
  definition,
) {
  const type =
    definition.type ||
    DEPENDENCY_TYPES.REQUIRED;

  if (
    !Object.values(
      DEPENDENCY_TYPES,
    ).includes(
      type,
    )
  ) {
    throw new TypeError(
      `Invalid dependency type "${type}".`,
    );
  }

  return {
    name,

    module:
      definition.module ||
      null,

    type,

    description:
      definition.description ||
      null,

    required:
      type ===
      DEPENDENCY_TYPES.REQUIRED,

    optional:
      type ===
      DEPENDENCY_TYPES.OPTIONAL,

    enabled:
      definition.enabled !==
      false,

    eager:
      definition.eager ===
        true ||
      type ===
        DEPENDENCY_TYPES.REQUIRED,

    dependency:
      definition.dependency ??
      null,

    available:
      false,

    state:
      DEPENDENCY_STATES
        .REGISTERED,

    error:
      null,

    loadDurationMs:
      0,

    loadAttempts:
      0,

    loadedAt:
      null,

    updatedAt:
      new Date(),

    metadata:
      {
        ...(definition.metadata ||
          {}),
      },

    loader:
      definition.loader ||
      null,
  };
}

/**
 * =============================================================================
 * Registry Registration
 * =============================================================================
 */

function registerDependency(
  name,
  dependencyOrDefinition,
  type =
    DEPENDENCY_TYPES.REQUIRED,
  metadata = {},
) {
  const normalizedName =
    normalizeName(
      name,
    );

  /**
   * ---------------------------------------------------------------------------
   * Normalize input
   * ---------------------------------------------------------------------------
   */

  let definition;

  if (
    dependencyOrDefinition &&
    typeof dependencyOrDefinition ===
      'object' &&
    (
      Object.prototype.hasOwnProperty.call(
        dependencyOrDefinition,
        'module',
      ) ||
      Object.prototype.hasOwnProperty.call(
        dependencyOrDefinition,
        'dependency',
      ) ||
      Object.prototype.hasOwnProperty.call(
        dependencyOrDefinition,
        'loader',
      )
    )
  ) {
    definition = {
      ...dependencyOrDefinition,

      type:
        dependencyOrDefinition.type ||
        type,

      metadata: {
        ...metadata,

        ...(dependencyOrDefinition.metadata ||
          {}),
      },
    };
  } else {
    definition = {
      dependency:
        dependencyOrDefinition,

      type,

      metadata,
    };
  }

  /**
   * ---------------------------------------------------------------------------
   * Duplicate protection
   * ---------------------------------------------------------------------------
   */

  const existing =
    dependencyRegistry.get(
      normalizedName,
    );

  if (
    existing
  ) {
    /**
     * Safe idempotency:
     *
     * Re-registering the exact logical dependency returns the existing record.
     */
    return existing;
  }

  const record =
    createRecord(
      normalizedName,
      definition,
    );

  /**
   * Immediately register the record.
   */
  dependencyRegistry.set(
    normalizedName,
    record,
  );

  /**
   * If an actual dependency object is already provided, mark it available.
   */
  if (
    record.dependency !==
      null &&
    record.dependency !==
      undefined
  ) {
    record.available =
      true;

    record.state =
      DEPENDENCY_STATES
        .AVAILABLE;

    record.loadedAt =
      new Date();

    record.updatedAt =
      new Date();
  }

  return record;
}

/**
 * =============================================================================
 * Initialization
 * =============================================================================
 */

function initializeDependency(
  name,
) {
  const normalizedName =
    normalizeName(
      name,
    );

  const record =
    dependencyRegistry.get(
      normalizedName,
    );

  if (
    !record
  ) {
    throw new Error(
      `Unknown TITech dependency "${normalizedName}".`,
    );
  }

  /**
   * Already available.
   */
  if (
    record.available &&
    record.dependency
  ) {
    return record.dependency;
  }

  /**
   * Disabled dependency.
   */
  if (
    record.enabled ===
    false
  ) {
    record.state =
      DEPENDENCY_STATES
        .UNAVAILABLE;

    record.updatedAt =
      new Date();

    return null;
  }

  /**
   * Prevent duplicate loading.
   */
  if (
    record.state ===
    DEPENDENCY_STATES.LOADING &&
    record.loadingPromise
  ) {
    return record.loadingPromise;
  }

  record.state =
    DEPENDENCY_STATES.LOADING;

  record.loadAttempts +=
    1;

  const startedAt =
    process.hrtime.bigint();

  record.loadingPromise =
    Promise.resolve().then(
      () => {
        if (
          typeof record.loader ===
          'function'
        ) {
          return record.loader(
            record,
          );
        }

        if (
          !record.module
        ) {
          return record.dependency;
        }

        // eslint-disable-next-line global-require, import/no-dynamic-require
        return require(
          record.module,
        );
      },
    )
      .then(
        dependency => {
          record.dependency =
            dependency;

          record.available =
            dependency !==
              null &&
            dependency !==
              undefined;

          record.state =
            record.available
              ? DEPENDENCY_STATES
                  .AVAILABLE
              : DEPENDENCY_STATES
                  .UNAVAILABLE;

          record.error =
            null;

          record.loadedAt =
            new Date();

          record.updatedAt =
            new Date();

          record.loadDurationMs =
            elapsedMs(
              startedAt,
            );

          return dependency;
        },
      )
      .catch(
        error => {
          record.dependency =
            null;

          record.available =
            false;

          record.state =
            record.required
              ? DEPENDENCY_STATES.FAILED
              : DEPENDENCY_STATES
                  .UNAVAILABLE;

          record.error =
            sanitizeErrorMessage(
              error,
            );

          record.updatedAt =
            new Date();

          record.loadDurationMs =
            elapsedMs(
              startedAt,
            );

          if (
            record.required
          ) {
            const normalized =
              normalizeLoadError(
                record.module ||
                  normalizedName,
                error,
              );

            normalized.dependency =
              normalizedName;

            throw normalized;
          }

          return null;
        },
      )
      .finally(
        () => {
          record.loadingPromise =
            null;
        },
      );

  return record.loadingPromise;
}

/**
 * =============================================================================
 * Initialize All Dependencies
 * =============================================================================
 */

async function initializeDependencies(
  options = {},
) {
  const onlyRequired =
    options.onlyRequired ===
    true;

  const onlyOptional =
    options.onlyOptional ===
    true;

  const records =
    Array.from(
      dependencyRegistry.values(),
    ).filter(
      record => {
        if (
          onlyRequired &&
          !record.required
        ) {
          return false;
        }

        if (
          onlyOptional &&
          !record.optional
        ) {
          return false;
        }

        return (
          record.enabled !==
          false
        );
      },
    );

  const results = {};

  for (
    const record of
      records
  ) {
    try {
      results[
        record.name
      ] =
        await initializeDependency(
          record.name,
        );
    } catch (error) {
      if (
        record.required
      ) {
        throw error;
      }

      results[
        record.name
      ] =
        null;
    }
  }

  return results;
}

/**
 * =============================================================================
 * Required Dependency Validation
 * =============================================================================
 */

function getMissingRequiredDependencies() {
  return Array.from(
    dependencyRegistry.values(),
  )
    .filter(
      record =>
        record.required &&
        record.enabled !==
          false &&
        !record.available,
    )
    .map(
      record =>
        record.name,
    );
}

function validateDependencies(
  options = {},
) {
  const missing =
    getMissingRequiredDependencies();

  if (
    missing.length >
    0
  ) {
    const error =
      new Error(
        'TITech required runtime dependencies are unavailable.',
      );

    error.name =
      'DependencyValidationError';

    error.code =
      'REQUIRED_DEPENDENCIES_UNAVAILABLE';

    error.dependencies =
      missing;

    error.component =
      COMPONENT;

    error.service =
      SERVICE_NAME;

    if (
      options.throw ===
      false
    ) {
      return {
        valid:
          false,

        missing,
      };
    }

    throw error;
  }

  return {
    valid:
      true,

    missing: [],
  };
}

/**
 * =============================================================================
 * Accessors
 * =============================================================================
 */

function getDependency(
  name,
  options = {},
) {
  const normalizedName =
    normalizeName(
      name,
    );

  const record =
    dependencyRegistry.get(
      normalizedName,
    );

  if (
    !record
  ) {
    return undefined;
  }

  if (
    options.initialize ===
    true
  ) {
    return initializeDependency(
      normalizedName,
    );
  }

  return record.dependency;
}

async function getDependencyAsync(
  name,
  options = {},
) {
  const normalizedName =
    normalizeName(
      name,
    );

  const record =
    dependencyRegistry.get(
      normalizedName,
    );

  if (
    !record
  ) {
    return undefined;
  }

  if (
    options.initialize !==
      false &&
    !record.available
  ) {
    await initializeDependency(
      normalizedName,
    );
  }

  return record.dependency;
}

function requireDependency(
  name,
) {
  const normalizedName =
    normalizeName(
      name,
    );

  const dependency =
    getDependency(
      normalizedName,
    );

  if (
    dependency === undefined ||
    dependency === null
  ) {
    const record =
      getDependencyRecord(
        normalizedName,
      );

    const error =
      new Error(
        `Required TITech runtime dependency "${normalizedName}" is unavailable.`,
      );

    error.code =
      'DEPENDENCY_UNAVAILABLE';

    error.dependency =
      normalizedName;

    error.type =
      record?.type;

    throw error;
  }

  return dependency;
}

async function requireDependencyAsync(
  name,
) {
  await getDependencyAsync(
    name,
    {
      initialize:
        true,
    },
  );

  return requireDependency(
    name,
  );
}

/**
 * =============================================================================
 * Metadata
 * =============================================================================
 */

function getDependencyRecord(
  name,
) {
  const record =
    dependencyRegistry.get(
      normalizeName(
        name,
      ),
    );

  if (
    !record
  ) {
    return undefined;
  }

  return createSafeRecord(
    record,
  );
}

function createSafeRecord(
  record,
) {
  return safeFreeze({
    name:
      record.name,

    module:
      record.module,

    type:
      record.type,

    description:
      record.description,

    required:
      record.required,

    optional:
      record.optional,

    enabled:
      record.enabled,

    available:
      record.available,

    state:
      record.state,

    error:
      record.error,

    loadDurationMs:
      record.loadDurationMs,

    loadAttempts:
      record.loadAttempts,

    loadedAt:
      record.loadedAt
        ?.toISOString() ||
      null,

    updatedAt:
      record.updatedAt
        ?.toISOString() ||
      null,

    metadata:
      sanitize(
        record.metadata,
      ),
  });
}

/**
 * =============================================================================
 * Availability
 * =============================================================================
 */

function hasDependency(
  name,
) {
  const record =
    dependencyRegistry.get(
      normalizeName(
        name,
      ),
    );

  return Boolean(
    record?.available,
  );
}

function hasRequiredDependency(
  name,
) {
  const record =
    dependencyRegistry.get(
      normalizeName(
        name,
      ),
    );

  return Boolean(
    record?.required &&
    record.available,
  );
}

function getDependencyNames() {
  return Array.from(
    dependencyRegistry.keys(),
  );
}

function getAvailableDependencies() {
  return Array.from(
    dependencyRegistry.values(),
  )
    .filter(
      record =>
        record.available,
    )
    .map(
      record =>
        record.name,
    );
}

function getUnavailableDependencies() {
  return Array.from(
    dependencyRegistry.values(),
  )
    .filter(
      record =>
        !record.available,
    )
    .map(
      record =>
        record.name,
    );
}

function getRequiredDependencies() {
  return Array.from(
    dependencyRegistry.values(),
  )
    .filter(
      record =>
        record.required,
    )
    .map(
      record =>
        record.name,
    );
}

function getOptionalDependencies() {
  return Array.from(
    dependencyRegistry.values(),
  )
    .filter(
      record =>
        record.optional,
    )
    .map(
      record =>
        record.name,
    );
}

/**
 * =============================================================================
 * Status
 * =============================================================================
 */

function getDependencyStatus() {
  const records =
    Array.from(
      dependencyRegistry.values(),
    );

  const required =
    records.filter(
      record =>
        record.required,
    );

  const optional =
    records.filter(
      record =>
        record.optional,
    );

  const missingRequired =
    required.filter(
      record =>
        record.enabled !==
          false &&
        !record.available,
    );

  const unavailableOptional =
    optional.filter(
      record =>
        record.enabled !==
          false &&
        !record.available,
    );

  const failed =
    records.filter(
      record =>
        record.state ===
        DEPENDENCY_STATES.FAILED,
    );

  return {
    healthy:
      missingRequired.length ===
      0,

    total:
      records.length,

    available:
      records.filter(
        record =>
          record.available,
      ).length,

    unavailable:
      records.filter(
        record =>
          !record.available,
      ).length,

    required:
      required.length,

    optional:
      optional.length,

    missingRequired:
      missingRequired.map(
        record =>
          record.name,
      ),

    unavailableOptional:
      unavailableOptional.map(
        record =>
          record.name,
      ),

    failed:
      failed.map(
        record =>
          record.name,
      ),
  };
}

/**
 * =============================================================================
 * Safe Snapshot
 * =============================================================================
 */

function getDependencySnapshot() {
  return safeFreeze({
    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    application: {
      name:
        packageJson.name ||
        'titech-backend',

      version:
        packageJson.version ||
        '0.0.0',
    },

    status:
      getDependencyStatus(),

    dependencies:
      Array.from(
        dependencyRegistry.values(),
      ).map(
        createSafeRecord,
      ),

    timestamp:
      new Date().toISOString(),
  });
}

/**
 * =============================================================================
 * Dependency Override / Test Support
 * =============================================================================
 */

function setDependency(
  name,
  dependency,
  options = {},
) {
  const normalizedName =
    normalizeName(
      name,
    );

  let record =
    dependencyRegistry.get(
      normalizedName,
    );

  if (
    !record
  ) {
    record =
      createRecord(
        normalizedName,
        {
          dependency,

          type:
            options.type ||
            DEPENDENCY_TYPES
              .OPTIONAL,

          module:
            options.module ||
            null,

          description:
            options.description ||
            null,

          metadata:
            options.metadata ||
            {},
        },
      );

    dependencyRegistry.set(
      normalizedName,
      record,
    );
  } else {
    record.dependency =
      dependency;

    record.available =
      dependency !== null &&
      dependency !== undefined;

    record.state =
      record.available
        ? DEPENDENCY_STATES
            .OVERRIDDEN
        : DEPENDENCY_STATES
            .UNAVAILABLE;

    record.error =
      null;

    record.updatedAt =
      new Date();

    record.loadedAt =
      new Date();
  }

  return createSafeRecord(
    record,
  );
}

function removeDependency(
  name,
) {
  return dependencyRegistry.delete(
    normalizeName(
      name,
    ),
  );
}

/**
 * =============================================================================
 * Clear Registry
 * =============================================================================
 *
 * Test/process isolation only.
 * =============================================================================
 */

function reset() {
  dependencyRegistry.clear();

  registerBuiltInDependencies();

  return getDependencySnapshot();
}

/**
 * =============================================================================
 * Built-in Registration
 * =============================================================================
 */

function registerBuiltInDependencies() {
  /**
   * Required dependencies.
   */
  for (
    const [
      name,
      definition,
    ] of Object.entries(
      REQUIRED_DEPENDENCY_DEFINITIONS,
    )
  ) {
    if (
      dependencyRegistry.has(
        name,
      )
    ) {
      continue;
    }

    registerDependency(
      name,
      {
        module:
          definition.module,

        type:
          DEPENDENCY_TYPES.REQUIRED,

        description:
          definition.description ||
          null,

        eager:
          true,
      },
    );
  }

  /**
   * Optional dependencies.
   *
   * Registered lazily.
   */
  for (
    const [
      name,
      definition,
    ] of Object.entries(
      OPTIONAL_DEPENDENCY_DEFINITIONS,
    )
  ) {
    if (
      dependencyRegistry.has(
        name,
      )
    ) {
      continue;
    }

    registerDependency(
      name,
      {
        module:
          definition.module,

        type:
          DEPENDENCY_TYPES.OPTIONAL,

        description:
          definition.description ||
          null,

        eager:
          false,
      },
    );
  }
}

/**
 * =============================================================================
 * Eager Initialization of Required Dependencies
 * =============================================================================
 */

function initializeRequiredDependencies() {
  return initializeDependencies({
    onlyRequired:
      true,
  });
}

/**
 * =============================================================================
 * Optional Integration Initialization
 * =============================================================================
 */

function initializeOptionalDependencies(
  names = null,
) {
  if (
    Array.isArray(names) &&
    names.length > 0
  ) {
    return Promise.all(
      names.map(
        name =>
          initializeDependency(
            name,
          ),
      ),
    );
  }

  return initializeDependencies({
    onlyOptional:
      true,
  });
}

/**
 * =============================================================================
 * Compatibility Object
 * =============================================================================
 *
 * IMPORTANT:
 *
 * This object intentionally exposes the dependency objects for compatibility
 * with existing code, but a snapshot should be preferred for diagnostics.
 *
 * It is generated dynamically through getDependenciesObject() rather than being
 * a stale initialization-time copy.
 * =============================================================================
 */

function getDependenciesObject() {
  const output = {};

  for (
    const [
      name,
      record,
    ] of dependencyRegistry
  ) {
    output[name] =
      record.dependency;
  }

  return safeFreeze(
    output,
  );
}

/**
 * =============================================================================
 * Bootstrap Lifecycle Adapter
 * =============================================================================
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
        -900,

      dependencies:
        options.dependencies ||
        [
          'configuration',
        ],

      critical:
        options.critical !==
        false,

      timeoutMs:
        options.timeoutMs ||
        30_000,

      start:
        async () =>
          initializeRequiredDependencies(),

      ready:
        async () =>
          getDependencyStatus()
            .missingRequired
            .length ===
          0,

      health:
        async () => {
          const status =
            getDependencyStatus();

          return {
            status:
              status.healthy
                ? 'healthy'
                : 'unhealthy',

            ...status,
          };
        },

      stop:
        async () => true,

      metadata: {
        component:
          COMPONENT,

        service:
          SERVICE_NAME,

        application:
          packageJson.name,
      },
    },
  );
}

/**
 * =============================================================================
 * Canonical Required Dependency Object
 * =============================================================================
 *
 * These are loaded eagerly and are therefore available after module evaluation
 * when the backend starts normally.
 *
 * If a required package is missing, module initialization fails immediately.
 * =============================================================================
 */

const requiredDependencyObjects =
  {};

for (
  const [
    name,
    definition,
  ] of Object.entries(
    REQUIRED_DEPENDENCY_DEFINITIONS,
  )
) {
  const result =
    loadRequired(
      definition.module,
    );

  registerDependency(
    name,
    {
      dependency:
        result.dependency,

      module:
        definition.module,

      type:
        DEPENDENCY_TYPES.REQUIRED,

      description:
        definition.description ||
        null,

      metadata: {
        loadDurationMs:
          result.loadDurationMs,
      },
    },
  );

  requiredDependencyObjects[
    name
  ] =
    result.dependency;

  const record =
    dependencyRegistry.get(
      name,
    );

  record.loadDurationMs =
    result.loadDurationMs;

  record.loadAttempts =
    1;

  record.loadedAt =
    new Date();

  record.state =
    DEPENDENCY_STATES
      .AVAILABLE;
}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
  Object.freeze({
    /**
     * Metadata.
     */
    COMPONENT,

    SERVICE_NAME,

    DEPENDENCY_TYPES,

    DEPENDENCY_STATES,

    /**
     * Compatibility dependency object.
     *
     * Required dependencies are eagerly loaded.
     * Optional dependencies are null until initialized.
     */
    dependencies:
      getDependenciesObject(),

    /**
     * Registry access.
     */
    dependencyRegistry,

    registerDependency,

    setDependency,

    removeDependency,

    reset,

    /**
     * Loading.
     */
    initializeDependency,

    initializeDependencies,

    initializeRequiredDependencies,

    initializeOptionalDependencies,

    optionalRequire:
      loadOptional,

    /**
     * Lookup.
     */
    getDependency,

    getDependencyAsync,

    requireDependency,

    requireDependencyAsync,

    getDependencyRecord,

    /**
     * Availability.
     */
    hasDependency,

    hasRequiredDependency,

    getDependencyNames,

    getAvailableDependencies,

    getUnavailableDependencies,

    getRequiredDependencies,

    getOptionalDependencies,

    getMissingRequiredDependencies,

    /**
     * Validation.
     */
    validateDependencies,

    /**
     * Status/diagnostics.
     */
    getDependencyStatus,

    getDependencySnapshot,

    getDependenciesObject,

    /**
     * Bootstrap.
     */
    registerBootstrapHooks,
  });