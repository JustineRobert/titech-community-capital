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
 *
 * =============================================================================
 */

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

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
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
}

/**
 * =============================================================================
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
}

/**
 * =============================================================================
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