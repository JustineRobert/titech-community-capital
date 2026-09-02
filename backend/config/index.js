<<<<<<< HEAD
/**
 * =============================================================================
 * TITech Community Capital LTD
 * Canonical Enterprise Application Configuration
 * =============================================================================
 *
 * File:
 *   backend/config/index.js
 *
 * Purpose:
 *   Single canonical configuration composition and access boundary for the
 *   TITech Community Capital backend.
 *
 * Responsibilities:
 *   - Consume the canonical environment bootstrap.
 *   - Compose strongly typed configuration modules.
 *   - Expose one immutable application configuration object.
 *   - Provide safe typed configuration accessors.
 *   - Provide compatibility helpers for legacy configuration consumers.
 *   - Centralize runtime/API/health/deployment metadata.
 *   - Provide sanitized configuration snapshots for diagnostics.
 *   - Prevent application modules from reading process.env directly.
 *   - Expose canonical environment flags.
 *   - Preserve deterministic configuration semantics.
 *
 * Configuration flow:
 *
 *   process.env / .env
 *          │
 *          ▼
 *   bootstrap/environment.js
 *          │
 *          ▼
 *   config/*.config.js
 *          │
 *          ▼
 *   backend/config/index.js
 *          │
 *     ┌────┴───────────────────────────────┐
 *     │                                    │
 *     ▼                                    ▼
 *  application code                  infrastructure
 *
 * IMPORTANT:
 *   This file MUST remain ESM.
 *
 * IMPORTANT:
 *   No direct process.env access is permitted here.
 *   Environment variables are owned by:
 *
 *     backend/bootstrap/environment.js
 *
 * IMPORTANT:
 *   Never expose secrets through snapshot(), toJSON(), diagnostics or logs.
=======
'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/routes/index.js
 *
 * Purpose:
 *   Enterprise production-grade HTTP route registration boundary.
 *
 * Responsibilities:
 *   - Register application API routes.
 *   - Register liveness/readiness/health endpoints.
 *   - Register operational metrics endpoint when available.
 *   - Register controlled internal diagnostics.
 *   - Centralize route prefixes.
 *   - Validate the Express application contract.
 *   - Prevent accidental duplicate route registration.
 *   - Preserve deterministic route ordering.
 *   - Normalize route-not-found errors.
 *   - Integrate with TITech runtime/readiness state.
 *   - Keep routing separate from middleware, controllers and business logic.
 *
 * This module does NOT:
 *   - initialize databases.
 *   - initialize Redis.
 *   - initialize queues.
 *   - initialize Socket.IO.
 *   - execute financial operations.
 *   - implement authentication.
 *   - implement authorization.
 *   - start the HTTP server.
 *   - own global middleware.
 *
 * =============================================================================
 *
 * Route architecture:
 *
 *   backend/bootstrap/app.js
 *            │
 *            ▼
 *      registerRoutes(app)
 *            │
 *      ┌─────┴────────────────────┐
 *      ▼                          ▼
 *   runtime routes             API routes
 *      │                          │
 *      ├── /live                  ├── /api/auth
 *      ├── /ready                 ├── /api/legal
 *      ├── /health                └── /api/email
 *      └── /metrics
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
 *
 * =============================================================================
 */

<<<<<<< HEAD
'use strict';

import environment from '../bootstrap/environment.js';

import app from './app.config.js';
import database from './database.config.js';
import auth from './auth.config.js';
import cors from './cors.config.js';
import redis from './redis.config.js';
import email from './email.config.js';
import security from './security.config.js';
import observability from './observability.config.js';
import features from './features.config.js';
=======
const {
    getApplicationState,
    getHealthState,
    isReady,
    isLive
} = require('../runtime/state');

/**
 * =============================================================================
 * Optional configuration
 * =============================================================================
 */

let configuration = null;

try {

    // eslint-disable-next-line global-require
    configuration =
        require('../config/configProvider');

} catch {

    configuration =
        null;

}

/**
 * =============================================================================
 * Optional observability
 * =============================================================================
 */

let observability = null;

try {

    // eslint-disable-next-line global-require
    observability =
        require('../bootstrap/observability');

} catch {

    observability =
        null;

}

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule = null;

try {

    // eslint-disable-next-line global-require
    loggerModule =
        require('../utils/logger');

} catch {

    loggerModule =
        null;

}
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
<<<<<<< HEAD
  'configuration';

const APPLICATION_LEGAL_NAME =
  'TITech Community Capital LTD';

const DEFAULTS = Object.freeze({
  api: Object.freeze({
    prefix: '/api',
    livenessPath: '/live',
    readinessPath: '/ready',
    healthPath: '/health',
    metricsPath: '/metrics',
    diagnosticsPath: '/health/diagnostics',
  }),

  health: Object.freeze({
    diagnosticsEnabled: false,
  }),

  deployment: Object.freeze({
    region: null,
    deploymentId: null,
  }),
});

/**
 * =============================================================================
 * Internal helpers
 * =============================================================================
 */

/**
 * Return the first non-null/undefined candidate.
 */
function firstDefined(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null
    ) {
      return value;
    }
  }

  return undefined;
}

/**
 * Safely clone plain configuration structures.
 *
 * This is intentionally conservative. Configuration modules should normally
 * contain JSON-compatible primitives, arrays and plain objects.
 */
function cloneValue(value) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  const output = {};

  for (const [key, child] of Object.entries(value)) {
    output[key] = cloneValue(child);
  }

  return output;
}

/**
 * Recursively freeze objects and arrays.
 *
 * This protects the canonical configuration from accidental runtime mutation.
 */
function deepFreeze(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return value;
  }

  if (seen.has(value)) {
    return value;
  }

  seen.add(value);

  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
}

/**
 * Read a dotted configuration path.
 *
 * Example:
 *
 *   getByPath(configuration, 'app.serviceName')
 */
function getByPath(source, path, fallback = undefined) {
  if (
    !source ||
    !path
  ) {
    return fallback;
  }

  const segments =
    String(path)
      .split('.')
      .map(
        (segment) =>
          segment.trim()
      )
      .filter(Boolean);

  if (!segments.length) {
    return fallback;
  }

  let current = source;

  for (const segment of segments) {
    if (
      current === null ||
      current === undefined ||
      !Object.prototype.hasOwnProperty.call(
        Object(current),
        segment
      )
    ) {
      return fallback;
    }

    current =
      current[segment];
  }

  return current === undefined
    ? fallback
    : current;
}

/**
 * Normalize a route path.
 */
function normalizePath(
  value,
  fallback
) {
  const resolved =
    String(
      firstDefined(
        value,
        fallback,
        '/'
      )
    )
      .trim()
      .replace(
        /\/+/g,
        '/'
      );

  if (!resolved || resolved === '/') {
    return resolved === ''
      ? fallback
      : '/';
  }

  return resolved.startsWith('/')
    ? resolved.replace(
        /\/+$/,
        ''
      ) || '/'
    : `/${resolved.replace(
        /\/+$/,
        ''
      )}`;
}

/**
 * Join two route path segments.
 */
function joinPath(
  prefix,
  path
) {
  const normalizedPrefix =
    normalizePath(
      prefix,
      ''
    );

  const normalizedPath =
    String(
      firstDefined(
        path,
        ''
      )
    )
      .trim()
      .replace(
        /^\/+/,
        ''
      );

  if (!normalizedPrefix) {
    return normalizedPath
      ? `/${normalizedPath}`
      : '/';
  }

  if (!normalizedPath) {
    return normalizedPrefix;
  }

  return `${normalizedPrefix}/${normalizedPath}`;
}

/**
 * Convert a value to a boolean using deterministic semantics.
 */
function toBoolean(
  value,
  fallback = false
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  if (
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    typeof value === 'number'
  ) {
    return value !== 0;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    [
      'true',
      '1',
      'yes',
      'y',
      'on',
      'enabled',
    ].includes(normalized)
  ) {
    return true;
  }

  if (
    [
      'false',
      '0',
      'no',
      'n',
      'off',
      'disabled',
    ].includes(normalized)
  ) {
    return false;
  }

  return fallback;
}

/**
 * Convert a value to a finite number.
 */
function toNumber(
  value,
  fallback = undefined
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  if (
    typeof value === 'number'
  ) {
    return Number.isFinite(value)
      ? value
      : fallback;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

/**
 * =============================================================================
 * Canonical application values
 * =============================================================================
 */

const serviceName =
  firstDefined(
    app?.serviceName,
    app?.name,
    'titech-backend'
  );

const applicationName =
  firstDefined(
    app?.name,
    'titech-community-capital'
  );

const applicationVersion =
  firstDefined(
    app?.version,
    '0.0.0'
  );

const applicationEnvironment =
  firstDefined(
    app?.environment,
    environment?.nodeEnv,
    environment?.environment,
    'development'
  );

const hostname =
  firstDefined(
    environment?.hostname,
    environment?.host,
    'localhost'
  );

/**
 * =============================================================================
 * Canonical API configuration
 * =============================================================================
 *
 * app.config.js may already expose API settings. When available, those values
 * remain authoritative. Otherwise, stable TITech defaults are used.
 * =============================================================================
 */

const api = Object.freeze({
  prefix:
    normalizePath(
      firstDefined(
        app?.api?.prefix,
        app?.apiPrefix,
        DEFAULTS.api.prefix
      ),
      DEFAULTS.api.prefix
    ),

  livenessPath:
    normalizePath(
      firstDefined(
        app?.api?.livenessPath,
        app?.livenessPath,
        DEFAULTS.api.livenessPath
      ),
      DEFAULTS.api.livenessPath
    ),

  readinessPath:
    normalizePath(
      firstDefined(
        app?.api?.readinessPath,
        app?.readinessPath,
        DEFAULTS.api.readinessPath
      ),
      DEFAULTS.api.readinessPath
    ),

  healthPath:
    normalizePath(
      firstDefined(
        app?.api?.healthPath,
        app?.healthPath,
        DEFAULTS.api.healthPath
      ),
      DEFAULTS.api.healthPath
    ),

  metricsPath:
    normalizePath(
      firstDefined(
        app?.api?.metricsPath,
        app?.metricsPath,
        DEFAULTS.api.metricsPath
      ),
      DEFAULTS.api.metricsPath
    ),

  diagnosticsPath:
    normalizePath(
      firstDefined(
        app?.api?.diagnosticsPath,
        app?.diagnosticsPath,
        DEFAULTS.api.diagnosticsPath
      ),
      DEFAULTS.api.diagnosticsPath
    ),
});

/**
 * =============================================================================
 * Canonical health configuration
 * =============================================================================
 */

const health = Object.freeze({
  diagnosticsEnabled:
    toBoolean(
      firstDefined(
        app?.health?.diagnosticsEnabled,
        app?.diagnosticsEnabled,
        security?.diagnosticsEnabled,
        DEFAULTS.health.diagnosticsEnabled
      ),
      DEFAULTS.health.diagnosticsEnabled
    ),
});

/**
 * =============================================================================
 * Canonical deployment metadata
 * =============================================================================
 *
 * bootstrap/environment.js is the sole owner of actual environment resolution.
 *
 * The properties below deliberately do NOT read process.env.
 * =============================================================================
 */

const deployment = Object.freeze({
  instanceId:
    firstDefined(
      environment?.instanceId,
      environment?.instanceID,
      environment?.hostname,
      environment?.host,
      hostname
    ),

  region:
    firstDefined(
      environment?.deploymentRegion,
      environment?.region,
      DEFAULTS.deployment.region
    ),

  deploymentId:
    firstDefined(
      environment?.deploymentId,
      environment?.deploymentID,
      environment?.releaseId,
      DEFAULTS.deployment.deploymentId
    ),

  hostname,

  nodeEnv:
    firstDefined(
      environment?.nodeEnv,
      environment?.environment,
      applicationEnvironment
    ),
});

/**
 * =============================================================================
 * Canonical runtime flags
 * =============================================================================
 */

const flags = Object.freeze({
  isProduction:
    Boolean(
      environment?.isProduction ??
      applicationEnvironment === 'production'
    ),

  isStaging:
    Boolean(
      environment?.isStaging ??
      applicationEnvironment === 'staging'
    ),

  isDevelopment:
    Boolean(
      environment?.isDevelopment ??
      applicationEnvironment === 'development'
    ),

  isTest:
    Boolean(
      environment?.isTest ??
      applicationEnvironment === 'test'
    ),

  isCI:
    Boolean(
      environment?.isCI ??
      environment?.ci ??
      false
    ),
});

/**
 =============================================================================
 * Canonical structured configuration
 * =============================================================================
 *
 * NOTE:
 *   database remains nested under database.mongodb for compatibility with
 *   existing consumers.
 * =============================================================================
 */

const configuration = {
  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------

  application:
    applicationName,

  applicationLegalName:
    APPLICATION_LEGAL_NAME,

  serviceName,

  version:
    applicationVersion,

  environment:
    applicationEnvironment,

  nodeEnv:
    applicationEnvironment,

  hostname,

  host:
    app?.host,

  port:
    toNumber(
      app?.port,
      undefined
    ),

  // ---------------------------------------------------------------------------
  // Canonical modules
  // ---------------------------------------------------------------------------

  app,

  runtime:
    environment,

  database: {
    mongodb:
      database,
  },

  auth,

  jwt:
    auth?.jwt,

  session: {
    secret:
      auth?.sessionSecret,
  },

  cors,

  redis,

  email,

  security,

  observability,

  features,

  // ---------------------------------------------------------------------------
  // HTTP/API
  // ---------------------------------------------------------------------------

  api,

  health,

  // ---------------------------------------------------------------------------
  // Runtime/deployment flags
  // ---------------------------------------------------------------------------

  flags,

  // ---------------------------------------------------------------------------
  // Deployment metadata
  // ---------------------------------------------------------------------------

  deployment,
};

/**
 * Deep-freeze the canonical configuration once.
 */
deepFreeze(configuration);

/**
 * =============================================================================
 * Public configuration accessors
 * =============================================================================
 */

/**
 * Return the canonical immutable configuration object.
 */
export function getConfiguration() {
  return configuration;
}

/**
 * Read an arbitrary dotted configuration property.
 *
 * Compatible with consumers such as:
 *
 *   configuration.get('app.serviceName')
 *   configuration.get('observability.metricsEnabled')
 */
export function get(
  path,
  fallback = undefined
) {
  return getByPath(
    configuration,
    path,
    fallback
  );
}

/**
 * Read a string configuration property.
 */
export function getString(
  path,
  fallback = undefined
) {
  const value =
    get(
      path,
      fallback
    );

  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return String(value);
}

/**
 * Read a boolean configuration property.
 */
export function getBoolean(
  path,
  fallback = false
) {
  return toBoolean(
    get(
      path,
      fallback
    ),
    fallback
  );
}

/**
 * Read a numeric configuration property.
 */
export function getNumber(
  path,
  fallback = undefined
) {
  return toNumber(
    get(
      path,
      fallback
    ),
    fallback
  );
}

/**
 * Read an object configuration property.
 *
 * Returns the original immutable object when already present.
 */
export function getObject(
  path,
  fallback = undefined
) {
  const value =
    get(
      path,
      fallback
    );

  return value;
}

/**
 * Determine the current environment.
 */
export function getEnvironment() {
  return configuration.environment;
}

/**
 * Environment predicates retained for compatibility with existing
 * infrastructure modules.
 */
export function isProduction() {
  return flags.isProduction;
}

export function isStaging() {
  return flags.isStaging;
}

export function isDevelopment() {
  return flags.isDevelopment;
}

export function isTest() {
  return flags.isTest;
}

export function isCI() {
  return flags.isCI;
=======
    'routes';

const DEFAULT_API_PREFIX =
    '/api';

const DEFAULT_HEALTH_PREFIX =
    '';

const DEFAULT_DIAGNOSTICS_PATH =
    '/health/diagnostics';

const DEFAULT_METRICS_PATH =
    '/metrics';

const DEFAULT_LIVE_PATH =
    '/live';

const DEFAULT_READY_PATH =
    '/ready';

const DEFAULT_HEALTH_PATH =
    '/health';

/**
 * =============================================================================
 * Internal runtime state
 * =============================================================================
 */

let routesRegistered =
    false;

let registrationStarted =
    false;

let registrationCompleted =
    false;

let registrationError =
    null;

let registrationTimestamp =
    null;

const registeredRouteGroups =
    new Set();

/**
 * =============================================================================
 * Route groups
 * =============================================================================
 */

const ROUTE_GROUPS =
    Object.freeze({
        API:
            'api',

        HEALTH:
            'health',

        DIAGNOSTICS:
            'diagnostics',

        METRICS:
            'metrics',

        NOT_FOUND:
            'not_found'
    });

/**
 * =============================================================================
 * Logger
 * =============================================================================
 */

function getLogger() {

    try {

        return (
            loggerModule?.getLogger?.() ||
            loggerModule?.logger ||
            loggerModule
        );

    } catch {

        return null;

    }

}

function log(
    level,
    metadata,
    message
) {

    try {

        const logger =
            getLogger();

        if (
            logger &&
            typeof logger[level] ===
                'function'
        ) {

            logger[level](
                {
                    component:
                        COMPONENT,

                    ...metadata
                },
                message
            );

            return;

        }

    } catch {

        // Logging failures must not prevent route registration.

    }

    const text =
        `[${COMPONENT}] ${message}`;

    if (
        level === 'error' ||
        level === 'fatal'
    ) {

        process.stderr.write(
            `${text}\n`
        );

    } else {

        process.stdout.write(
            `${text}\n`
        );

    }

}

/**
 * =============================================================================
 * Configuration helpers
 * =============================================================================
 */

function getConfig(
    path,
    fallback = undefined
) {

    try {

        if (
            typeof configuration?.get ===
                'function'
        ) {

            return configuration.get(
                path,
                fallback
            );

        }

        if (
            typeof configuration?.getObject ===
                'function'
        ) {

            return configuration.getObject(
                path,
                fallback
            );

        }

    } catch {

        // Fall through to fallback.

    }

    return fallback;

}

function getStringConfig(
    path,
    fallback
) {

    try {

        if (
            typeof configuration?.getString ===
                'function'
        ) {

            return configuration.getString(
                path,
                fallback
            );

        }

        if (
            typeof configuration?.get ===
                'function'
        ) {

            const value =
                configuration.get(
                    path,
                    fallback
                );

            return value ===
                    undefined ||
                value ===
                    null
                ? fallback
                : String(
                    value
                );

        }

    } catch {

        // Fall through.

    }

    return fallback;

}

function isProductionEnvironment() {

    try {

        if (
            typeof configuration?.isProduction ===
                'function'
        ) {

            return Boolean(
                configuration.isProduction()
            );

        }

        return (
            process.env.NODE_ENV ===
            'production'
        );

    } catch {

        return (
            process.env.NODE_ENV ===
            'production'
        );

    }

>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
}

/**
 * =============================================================================
<<<<<<< HEAD
 * Route configuration helpers
 * =============================================================================
 */

export function getApiPrefix() {
  return configuration.api.prefix;
}

export function getLivenessPath() {
  return configuration.api.livenessPath;
}

export function getReadinessPath() {
  return configuration.api.readinessPath;
}

export function getHealthPath() {
  return configuration.api.healthPath;
}

export function getMetricsPath() {
  return configuration.api.metricsPath;
}

export function getDiagnosticsPath() {
  return configuration.api.diagnosticsPath;
}

export function joinRoutePathForApi(
  path
) {
  return joinPath(
    configuration.api.prefix,
    path
  );
}

/**
 * =============================================================================
 * Diagnostic configuration snapshot
 * =============================================================================
 *
 * IMPORTANT:
 *   Never return live references to configuration internals.
 *
 * The snapshot is intended for:
 *   - diagnostics
 *   - tests
 *   - operational introspection
 *   - controlled administrative tooling
 *
 * Secrets are deliberately removed/redacted.
 * =============================================================================
 */

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|private.?key|api.?key|access.?key|refresh.?token|client.?secret|encryption.?key|signing.?key|credential|authorization)/i;

function sanitizeSnapshot(
  value,
  key = ''
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    SENSITIVE_KEY_PATTERN.test(
      key
    )
  ) {
    return '[REDACTED]';
  }

  if (
    typeof value !== 'object'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      (item) =>
        sanitizeSnapshot(
          item,
          key
        )
    );
  }

  const output = {};

  for (const [
    childKey,
    childValue
  ] of Object.entries(value)) {
    output[childKey] =
      sanitizeSnapshot(
        childValue,
        childKey
      );
  }

  return output;
}

/**
 * Return a detached, sanitized configuration snapshot.
 */
export function snapshot() {
  return sanitizeSnapshot(
    cloneValue(configuration)
  );
}

/**
 * Alias used by operational/diagnostic consumers.
 */
export function getSnapshot() {
  return snapshot();
=======
 * Route prefix resolution
 * =============================================================================
 */

function getApiPrefix() {

    const configured =
        getStringConfig(
            'api.prefix',
            DEFAULT_API_PREFIX
        );

    const normalized =
        String(
            configured ||
                DEFAULT_API_PREFIX
        )
            .trim()
            .replace(
                /\/+/g,
                '/'
            );

    if (
        normalized === '/'
    ) {

        return '';

    }

    return normalized.startsWith('/')
        ? normalized.replace(
            /\/$/,
            ''
        )
        : `/${normalized.replace(
            /\/$/,
            ''
        )}`;

}

function joinRoutePath(
    prefix,
    path
) {

    const normalizedPrefix =
        String(
            prefix ||
                ''
        )
            .trim()
            .replace(
                /\/$/,
                ''
            );

    const normalizedPath =
        String(
            path ||
                ''
        )
            .trim()
            .replace(
                /^\/+/,
                ''
            );

    if (
        !normalizedPrefix
    ) {

        return (
            normalizedPath
                ? `/${normalizedPath}`
                : '/'
        );

    }

    return normalizedPath
        ? `${normalizedPrefix}/${normalizedPath}`
        : normalizedPrefix;

}

/**
 * =============================================================================
 * Express application contract
 * =============================================================================
 */

function assertExpressApplication(
    app
) {

    if (
        !app ||
        typeof app.use !==
            'function'
    ) {

        throw new TypeError(
            'TITech route registration requires a valid Express application.'
        );

    }

    if (
        typeof app.get !==
            'function'
    ) {

        throw new TypeError(
            'TITech route registration requires Express application.get().'
        );

    }

    if (
        typeof app.set !==
            'function'
    ) {

        log(
            'warn',
            {},
            'Express application.set() is unavailable; route metadata will not be attached.'
        );

    }

    return true;

}

/**
 * =============================================================================
 * Route registration guards
 * =============================================================================
 */

function isGroupRegistered(
    group
) {

    return registeredRouteGroups.has(
        group
    );

}

function markGroupRegistered(
    group
) {

    registeredRouteGroups.add(
        group
    );

>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
}

/**
 * =============================================================================
<<<<<<< HEAD
 * Configuration metadata
 * =============================================================================
 */

export function getMetadata() {
  return Object.freeze({
    component:
      COMPONENT,

    application:
      configuration.application,

    applicationLegalName:
      configuration.applicationLegalName,

    serviceName:
      configuration.serviceName,

    version:
      configuration.version,

    environment:
      configuration.environment,

    nodeEnv:
      configuration.nodeEnv,

    hostname:
      configuration.hostname,

    deployment:
      Object.freeze({
        instanceId:
          configuration.deployment.instanceId,

        region:
          configuration.deployment.region,

        deploymentId:
          configuration.deployment.deploymentId,
      }),

    flags:
      configuration.flags,
  });
}

/**
 * =============================================================================
 * Compatibility facade
 * =============================================================================
 *
 * This default export intentionally exposes both:
 *
 *   1. canonical nested configuration properties
 *   2. configuration accessor methods
 *
 * This allows legacy modules to migrate incrementally from configuration
 * providers without reintroducing process.env access.
 * =============================================================================
 */

const configurationFacade =
  Object.freeze({
    ...configuration,

    get,
    getString,
    getBoolean,
    getNumber,
    getObject,

    getConfiguration,
    getEnvironment,

    isProduction,
    isStaging,
    isDevelopment,
    isTest,
    isCI,

    getApiPrefix,
    getLivenessPath,
    getReadinessPath,
    getHealthPath,
    getMetricsPath,
    getDiagnosticsPath,
    joinRoutePathForApi,

    snapshot,
    getSnapshot,
    getMetadata,
  });

/**
 * =============================================================================
 * Named exports
 * =============================================================================
 */

export {
  configuration,
  configurationFacade,
  api,
  health,
  deployment,
  flags,
  COMPONENT,
  APPLICATION_LEGAL_NAME,
  DEFAULTS,
};

/**
 * =============================================================================
 * Default export
 * =============================================================================
 */

export default configurationFacade;
=======
 * API routes
 * =============================================================================
 *
 * Individual route modules remain authoritative for:
 *   - authentication
 *   - validation
 *   - controllers
 *   - services
 *   - authorization
 *
 * This module only mounts them.
 * =============================================================================
 */

function registerApiRoutes(
    app
) {

    assertExpressApplication(
        app
    );

    if (
        isGroupRegistered(
            ROUTE_GROUPS.API
        )
    ) {

        return app;

    }

    const apiPrefix =
        getApiPrefix();

    /**
     * -------------------------------------------------------------------------
     * Authentication
     * -------------------------------------------------------------------------
     */

    const authRoutes =
        require('./auth');

    if (
        authRoutes
    ) {

        app.use(
            joinRoutePath(
                apiPrefix,
                '/auth'
            ),
            authRoutes
        );

    }

    /**
     * -------------------------------------------------------------------------
     * Legal
     * -------------------------------------------------------------------------
     */

    const legalRoutes =
        require('./legal.routes');

    if (
        legalRoutes
    ) {

        app.use(
            joinRoutePath(
                apiPrefix,
                '/legal'
            ),
            legalRoutes
        );

    }

    /**
     * -------------------------------------------------------------------------
     * Email
     * -------------------------------------------------------------------------
     */

    const emailRoutes =
        require('./email');

    if (
        emailRoutes
    ) {

        app.use(
            joinRoutePath(
                apiPrefix,
                '/email'
            ),
            emailRoutes
        );

    }

    markGroupRegistered(
        ROUTE_GROUPS.API
    );

    return app;

}

/**
 * =============================================================================
 * Liveness
 * =============================================================================
 *
 * Liveness intentionally does not check dependencies.
 *
 * Kubernetes/container orchestrators should not restart a healthy process merely
 * because MongoDB/Redis is temporarily unavailable.
 * =============================================================================
 */

function buildLivenessResponse() {

    const live =
        Boolean(
            isLive()
        );

    return {
        success:
            live,

        alive:
            live,

        status:
            live
                ? 'live'
                : 'stopped',

        service:
            getStringConfig(
                'app.serviceName',
                process.env.SERVICE_NAME ||
                    'titech-backend'
            ),

        application:
            getStringConfig(
                'app.name',
                process.env.APP_NAME ||
                    'titech-community-capital'
            ),

        version:
            getStringConfig(
                'app.version',
                process.env.APP_VERSION ||
                    '0.0.0'
            ),

        uptimeSeconds:
            process.uptime(),

        timestamp:
            new Date().toISOString()
    };

}

function registerLivenessRoute(
    app
) {

    const path =
        getStringConfig(
            'api.livenessPath',
            DEFAULT_LIVE_PATH
        );

    app.get(
        path,
        (
            req,
            res
        ) => {

            const response =
                buildLivenessResponse();

            return res
                .status(
                    response.success
                        ? 200
                        : 503
                )
                .json(
                    response
                );

        }
    );

}

/**
 * =============================================================================
 * Readiness
 * =============================================================================
 */

function buildReadinessResponse() {

    const ready =
        Boolean(
            isReady()
        );

    const health =
        getHealthState() ||
        {};

    return {
        success:
            ready,

        ready,

        status:
            ready
                ? 'ready'
                : 'not_ready',

        service:
            getStringConfig(
                'app.serviceName',
                process.env.SERVICE_NAME ||
                    'titech-backend'
            ),

        phase:
            health.phase ||
            null,

        healthy:
            Boolean(
                health.healthy
            ),

        live:
            Boolean(
                health.live
            ),

        started:
            Boolean(
                health.started
            ),

        starting:
            Boolean(
                health.starting
            ),

        shuttingDown:
            Boolean(
                health.shuttingDown
            ),

        stopped:
            Boolean(
                health.stopped
            ),

        failed:
            Boolean(
                health.failed
            ),

        timestamp:
            new Date().toISOString()
    };

}

function registerReadinessRoute(
    app
) {

    const path =
        getStringConfig(
            'api.readinessPath',
            DEFAULT_READY_PATH
        );

    app.get(
        path,
        (
            req,
            res
        ) => {

            const response =
                buildReadinessResponse();

            return res
                .status(
                    response.ready
                        ? 200
                        : 503
                )
                .json(
                    response
                );

        }
    );

}

/**
 * =============================================================================
 * General health
 * =============================================================================
 */

function buildHealthResponse() {

    const health =
        getHealthState() ||
        {};

    const healthy =
        Boolean(
            health.healthy
        ) &&
        !health.failed;

    return {
        success:
            healthy,

        status:
            healthy
                ? 'healthy'
                : 'degraded',

        service:
            getStringConfig(
                'app.serviceName',
                process.env.SERVICE_NAME ||
                    'titech-backend'
            ),

        application:
            getStringConfig(
                'app.name',
                process.env.APP_NAME ||
                    'titech-community-capital'
            ),

        version:
            getStringConfig(
                'app.version',
                process.env.APP_VERSION ||
                    '0.0.0'
            ),

        live:
            Boolean(
                health.live
            ),

        ready:
            Boolean(
                health.ready
            ),

        healthy:
            Boolean(
                health.healthy
            ),

        started:
            Boolean(
                health.started
            ),

        starting:
            Boolean(
                health.starting
            ),

        shuttingDown:
            Boolean(
                health.shuttingDown
            ),

        stopped:
            Boolean(
                health.stopped
            ),

        failed:
            Boolean(
                health.failed
            ),

        phase:
            health.phase ||
            null,

        lastHealthCheck:
            health.lastHealthCheck ||
            null,

        uptimeSeconds:
            process.uptime(),

        timestamp:
            new Date().toISOString()
    };

}

function registerHealthRoute(
    app
) {

    const path =
        getStringConfig(
            'api.healthPath',
            DEFAULT_HEALTH_PATH
        );

    app.get(
        path,
        (
            req,
            res
        ) => {

            const response =
                buildHealthResponse();

            return res
                .status(
                    response.success
                        ? 200
                        : 503
                )
                .json(
                    response
                );

        }
    );

}

/**
 * =============================================================================
 * Metrics
 * =============================================================================
 *
 * Metrics implementation remains owned by observability.
 *
 * This module only exposes the existing metrics handler.
 * =============================================================================
 */

function registerMetricsRoute(
    app
) {

    if (
        isGroupRegistered(
            ROUTE_GROUPS.METRICS
        )
    ) {

        return app;

    }

    const metricsEnabled =
        getConfig(
            'observability.metricsEnabled',
            getConfig(
                'features.metrics',
                true
            )
        );

    if (
        metricsEnabled ===
            false
    ) {

        markGroupRegistered(
            ROUTE_GROUPS.METRICS
        );

        return app;

    }

    const metricsPath =
        getStringConfig(
            'api.metricsPath',
            DEFAULT_METRICS_PATH
        );

    let metricsHandler =
        null;

    try {

        if (
            typeof observability?.metricsHandler ===
                'function'
        ) {

            metricsHandler =
                observability.metricsHandler();

        } else if (
            typeof observability?.observability?.metricsHandler ===
                'function'
        ) {

            metricsHandler =
                observability.observability.metricsHandler();

        }

    } catch (
        error
    ) {

        log(
            'warn',
            {
                error:
                    {
                        name:
                            error?.name,

                        message:
                            error?.message
                    }
            },
            'TITech observability metrics handler could not be initialized.'
        );

    }

    /**
     * Metrics should not be exposed through a broken placeholder endpoint.
     * Only register the endpoint when the canonical observability subsystem
     * provides it.
     */
    if (
        typeof metricsHandler ===
            'function'
    ) {

        app.get(
            metricsPath,
            metricsHandler
        );

        markGroupRegistered(
            ROUTE_GROUPS.METRICS
        );

        return app;

    }

    log(
        'warn',
        {},
        'TITech metrics endpoint was not registered because no metrics handler is available.'
    );

    return app;

}

/**
 * =============================================================================
 * Runtime health routes
 * =============================================================================
 */

function registerHealthRoutes(
    app
) {

    assertExpressApplication(
        app
    );

    if (
        isGroupRegistered(
            ROUTE_GROUPS.HEALTH
        )
    ) {

        return app;

    }

    registerLivenessRoute(
        app
    );

    registerReadinessRoute(
        app
    );

    registerHealthRoute(
        app
    );

    markGroupRegistered(
        ROUTE_GROUPS.HEALTH
    );

    return app;

}

/**
 * =============================================================================
 * Internal diagnostics
 * =============================================================================
 *
 * Diagnostics are intentionally unavailable in production unless explicitly
 * enabled AND authorized by a future security boundary.
 *
 * This route therefore defaults to 404 in production.
 * =============================================================================
 */

function isDiagnosticsEnabled() {

    const explicit =
        getConfig(
            'health.diagnosticsEnabled',
            undefined
        );

    if (
        explicit !==
            undefined
    ) {

        return Boolean(
            explicit
        );

    }

    return (
        !isProductionEnvironment()
    );

}

function buildDiagnosticsResponse(
    app
) {

    const state =
        getApplicationState();

    const health =
        getHealthState();

    let configurationSnapshot =
        null;

    try {

        configurationSnapshot =
            typeof configuration?.snapshot ===
                'function'
                ? configuration.snapshot()
                : null;

    } catch {

        configurationSnapshot =
            null;

    }

    let observabilitySnapshot =
        null;

    try {

        if (
            typeof observability?.snapshot ===
                'function'
        ) {

            observabilitySnapshot =
                observability.snapshot();

        } else if (
            typeof observability?.observability?.snapshot ===
                'function'
        ) {

            observabilitySnapshot =
                observability.observability.snapshot();

        }

    } catch {

        observabilitySnapshot =
            null;

    }

    return {
        success:
            true,

        component:
            COMPONENT,

        timestamp:
            new Date().toISOString(),

        application:
            {
                name:
                    getStringConfig(
                        'app.name',
                        process.env.APP_NAME ||
                            'titech-community-capital'
                    ),

                service:
                    getStringConfig(
                        'app.serviceName',
                        process.env.SERVICE_NAME ||
                            'titech-backend'
                    ),

                version:
                    getStringConfig(
                        'app.version',
                        process.env.APP_VERSION ||
                            '0.0.0'
                    ),

                environment:
                    getStringConfig(
                        'app.environment',
                        process.env.NODE_ENV ||
                            'development'
                    )
            },

        runtime:
            {
                node:
                    process.version,

                pid:
                    process.pid,

                platform:
                    process.platform,

                architecture:
                    process.arch,

                uptimeSeconds:
                    process.uptime()
            },

        routes:
            {
                registered:
                    routesRegistered,

                registrationStarted,

                registrationCompleted,

                registrationTimestamp,

                groups:
                    [
                        ...registeredRouteGroups
                    ]
            },

        state,

        health,

        configuration:
            configurationSnapshot,

        observability:
            observabilitySnapshot
    };

}

function registerDiagnosticRoutes(
    app
) {

    assertExpressApplication(
        app
    );

    if (
        isGroupRegistered(
            ROUTE_GROUPS.DIAGNOSTICS
        )
    ) {

        return app;

    }

    if (
        !isDiagnosticsEnabled()
    ) {

        markGroupRegistered(
            ROUTE_GROUPS.DIAGNOSTICS
        );

        return app;

    }

    app.get(
        DEFAULT_DIAGNOSTICS_PATH,
        (
            req,
            res
        ) => {

            /**
             * Production defense-in-depth.
             */
            if (
                isProductionEnvironment()
            ) {

                return res
                    .status(404)
                    .json({
                        success:
                            false,

                        code:
                            'NOT_FOUND',

                        message:
                            'Not found.'
                    });

            }

            return res
                .status(200)
                .json(
                    buildDiagnosticsResponse(
                        app
                    )
                );

        }
    );

    markGroupRegistered(
        ROUTE_GROUPS.DIAGNOSTICS
    );

    return app;

}

/**
 * =============================================================================
 * Route-not-found error
 * =============================================================================
 */

function createRouteNotFoundError(
    req
) {

    const error =
        new Error(
            `Route not found: ${req.method} ${req.originalUrl}`
        );

    error.name =
        'RouteNotFoundError';

    error.code =
        'ROUTE_NOT_FOUND';

    error.status =
        404;

    error.statusCode =
        404;

    error.expose =
        true;

    error.method =
        req.method;

    error.path =
        req.path ||
        req.originalUrl;

    return error;

}

function registerNotFoundHandler(
    app
) {

    assertExpressApplication(
        app
    );

    if (
        isGroupRegistered(
            ROUTE_GROUPS.NOT_FOUND
        )
    ) {

        return app;

    }

    app.use(
        (
            req,
            res,
            next
        ) => {

            return next(
                createRouteNotFoundError(
                    req
                )
            );

        }
    );

    markGroupRegistered(
        ROUTE_GROUPS.NOT_FOUND
    );

    return app;

}

/**
 * =============================================================================
 * Route metadata
 * =============================================================================
 */

function attachRouteMetadata(
    app
) {

    try {

        if (
            typeof app.set ===
                'function'
        ) {

            app.set(
                'titech.routesRegistered',
                true
            );

            app.set(
                'titech.routeRegistrationTimestamp',
                registrationTimestamp
            );

            app.set(
                'titech.routeGroups',
                Object.freeze(
                    [
                        ...registeredRouteGroups
                    ]
                )
            );

        }

    } catch {

        // Metadata is optional.

    }

}

/**
 * =============================================================================
 * Main registration boundary
 * =============================================================================
 */

function registerRoutes(
    app
) {

    assertExpressApplication(
        app
    );

    /**
     * Duplicate invocation protection.
     */
    if (
        routesRegistered
    ) {

        return app;

    }

    registrationStarted =
        true;

    registrationError =
        null;

    try {

        /**
         * ---------------------------------------------------------------------
         * API routes
         * ---------------------------------------------------------------------
         */

        registerApiRoutes(
            app
        );

        /**
         * ---------------------------------------------------------------------
         * Health / runtime routes
         * ---------------------------------------------------------------------
         */

        registerHealthRoutes(
            app
        );

        /**
         * ---------------------------------------------------------------------
         * Metrics
         * ---------------------------------------------------------------------
         */

        registerMetricsRoute(
            app
        );

        /**
         * ---------------------------------------------------------------------
         * Diagnostics
         * ---------------------------------------------------------------------
         */

        registerDiagnosticRoutes(
            app
        );

        /**
         * ---------------------------------------------------------------------
         * NOT FOUND
         * ---------------------------------------------------------------------
         *
         * This MUST be last among normal route definitions.
         */

        registerNotFoundHandler(
            app
        );

        registrationCompleted =
            true;

        routesRegistered =
            true;

        registrationTimestamp =
            new Date();

        attachRouteMetadata(
            app
        );

        log(
            'info',
            {
                routeGroups:
                    [
                        ...registeredRouteGroups
                    ],

                apiPrefix:
                    getApiPrefix()
            },
            'TITech HTTP routes registered successfully.'
        );

        return app;

    } catch (
        error
    ) {

        registrationError =
            error;

        registrationCompleted =
            false;

        routesRegistered =
            false;

        log(
            'error',
            {
                error:
                    {
                        name:
                            error?.name,

                        code:
                            error?.code,

                        message:
                            error?.message,

                        stack:
                            error?.stack
                    }
            },
            'TITech HTTP route registration failed.'
        );

        throw error;

    }

}

/**
 * =============================================================================
 * Route registration state
 * =============================================================================
 */

function getRouteState() {

    return Object.freeze({
        component:
            COMPONENT,

        registered:
            routesRegistered,

        registrationStarted,

        registrationCompleted,

        registrationTimestamp,

        error:
            registrationError
                ? {
                    name:
                        registrationError.name,

                    code:
                        registrationError.code,

                    message:
                        registrationError.message
                }
                : null,

        groups:
            Object.freeze(
                [
                    ...registeredRouteGroups
                ]
            )
    });

}

/**
 * =============================================================================
 * Reset
 * =============================================================================
 *
 * Test/process isolation only.
 *
 * Express route stacks cannot safely be removed from a running production
 * application, so reset is limited to module bookkeeping. A new Express app
 * should be created for tests.
 * =============================================================================
 */

function resetRouteState() {

    routesRegistered =
        false;

    registrationStarted =
        false;

    registrationCompleted =
        false;

    registrationError =
        null;

    registrationTimestamp =
        null;

    registeredRouteGroups.clear();

    return true;

}

/**
 * =============================================================================
 * Exports
 * =============================================================================
 */

module.exports =
    Object.freeze({

        /**
         * Main registration.
         */
        registerRoutes,

        /**
         * API.
         */
        registerApiRoutes,

        /**
         * Runtime health.
         */
        registerHealthRoutes,

        registerLivenessRoute,

        registerReadinessRoute,

        registerHealthRoute,

        /**
         * Metrics.
         */
        registerMetricsRoute,

        /**
         * Diagnostics.
         */
        registerDiagnosticRoutes,

        /**
         * 404.
         */
        registerNotFoundHandler,

        /**
         * Helpers.
         */
        buildLivenessResponse,

        buildReadinessResponse,

        buildHealthResponse,

        buildDiagnosticsResponse,

        createRouteNotFoundError,

        getApiPrefix,

        joinRoutePath,

        /**
         * State.
         */
        getRouteState,

        resetRouteState,

        /**
         * Constants.
         */
        COMPONENT,

        ROUTE_GROUPS

    });
>>>>>>> e171b5b5138dd4d5cecea24d20897464a3a34880
