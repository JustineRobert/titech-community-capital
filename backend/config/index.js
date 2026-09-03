/**
 * =============================================================================
 * TITech Community Capital LTD
 * Canonical Enterprise Application Configuration
 * =============================================================================
 *
 * File:
 *   backend/config/index.js
 *
 * Module:
 *   ES Modules (ESM)
 *
 * Purpose:
 *   Single canonical configuration composition and access boundary.
 *
 * Architecture:
 *
 *   process.env / .env
 *          ↓
 *   bootstrap/environment.js
 *          ↓
 *   config/*.config.js
 *          ↓
 *   config/index.js
 *          ↓
 *   application / infrastructure / middleware / routes
 *
 * Rules:
 *   - MUST remain ESM.
 *   - MUST NOT read process.env directly.
 *   - MUST NOT load dotenv.
 *   - MUST NOT connect to infrastructure.
 *   - MUST NOT expose secrets through diagnostics.
 *   - MUST expose one immutable canonical configuration.
 *   - Legacy aliases are supported only through normalized accessors.
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

// =============================================================================
// CONSTANTS
// =============================================================================

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
    instanceId: null,
  }),

  runtime: Object.freeze({
    host: '0.0.0.0',
    port: 5000,
  }),
});

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

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

function cloneValue(
  value,
  seen = new WeakMap(),
) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (Array.isArray(value)) {
    const output = [];

    seen.set(value, output);

    for (const item of value) {
      output.push(
        cloneValue(item, seen),
      );
    }

    return output;
  }

  const output = {};

  seen.set(value, output);

  for (const [
    key,
    child,
  ] of Object.entries(value)) {
    output[key] =
      cloneValue(child, seen);
  }

  return output;
}

function deepFreeze(
  value,
  seen = new WeakSet(),
) {
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

  for (
    const key of
      Reflect.ownKeys(value)
  ) {
    deepFreeze(
      value[key],
      seen,
    );
  }

  return Object.freeze(value);
}

function getByPath(
  source,
  path,
  fallback = undefined,
) {
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
          segment.trim(),
      )
      .filter(Boolean);

  if (
    segments.length === 0
  ) {
    return fallback;
  }

  let current =
    source;

  for (
    const segment of
      segments
  ) {
    if (
      current === null ||
      current === undefined ||
      !Object.prototype.hasOwnProperty.call(
        Object(current),
        segment,
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

function normalizePath(
  value,
  fallback = '/',
) {
  const candidate =
    String(
      firstDefined(
        value,
        fallback,
        '/',
      ),
    ).trim();

  if (!candidate) {
    return fallback;
  }

  const collapsed =
    candidate
      .replace(
        /\/{2,}/g,
        '/',
      )
      .replace(
        /[?#].*$/g,
        '',
      );

  if (
    collapsed === '/'
  ) {
    return '/';
  }

  const normalized =
    collapsed.startsWith('/')
      ? collapsed
      : `/${collapsed}`;

  return (
    normalized.replace(
      /\/+$/g,
      '',
    ) || '/'
  );
}

function joinPath(
  prefix,
  routePath,
) {
  const normalizedPrefix =
    normalizePath(
      prefix,
      '',
    );

  const normalizedRoute =
    String(
      firstDefined(
        routePath,
        '',
      ),
    )
      .trim()
      .replace(
        /^\/+/g,
        '',
      )
      .replace(
        /\/+$/g,
        '',
      );

  if (
    !normalizedPrefix
  ) {
    return normalizedRoute
      ? `/${normalizedRoute}`
      : '/';
  }

  if (
    !normalizedRoute
  ) {
    return normalizedPrefix;
  }

  return `${normalizedPrefix}/${normalizedRoute}`;
}

function toBoolean(
  value,
  fallback = false,
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

function toNumber(
  value,
  fallback = undefined,
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

// =============================================================================
// ENVIRONMENT FACADE NORMALIZATION
// =============================================================================
//
// environment.js exposes a callable default export:
//
//   environment()
//   environment.environment
//   environment.runtime
//   environment.http
//
// Normalize these into a stable local reference so configuration modules do
// not depend on the callable-function shape.
//

const canonicalEnvironment =
  environment?.environment ||
  environment;

const runtime =
  canonicalEnvironment?.runtime ||
  {};

const http =
  canonicalEnvironment?.http ||
  {};

const environmentFlags =
  canonicalEnvironment?.flags ||
  {};

const environmentDeployment =
  canonicalEnvironment?.deployment ||
  {};

const environmentMeta =
  canonicalEnvironment?.meta ||
  canonicalEnvironment?.meta?.metadata ||
  {};

const canonicalNodeEnv =
  firstDefined(
    canonicalEnvironment?.app?.nodeEnv,
    canonicalEnvironment?.app?.environment,
    runtime?.nodeEnv,
    runtime?.environment,
    environmentFlags?.isProduction
      ? 'production'
      : environmentFlags?.isStaging
        ? 'staging'
        : environmentFlags?.isTest
          ? 'test'
          : 'development',
  );

const canonicalServiceName =
  firstDefined(
    canonicalEnvironment?.app?.serviceName,
    app?.serviceName,
    app?.name,
    'titech-community-capital-backend',
  );

const canonicalApplicationName =
  firstDefined(
    canonicalEnvironment?.app?.name,
    app?.name,
    'TITech Community Capital',
  );

const canonicalVersion =
  firstDefined(
    canonicalEnvironment?.app?.version,
    app?.version,
    '0.0.0',
  );

const canonicalHostname =
  firstDefined(
    runtime?.hostname,
    canonicalEnvironment?.hostname,
    environmentDeployment?.hostname,
    app?.host,
    DEFAULTS.runtime.host,
  );

const canonicalHost =
  firstDefined(
    http?.host,
    app?.host,
    DEFAULTS.runtime.host,
  );

const canonicalPort =
  toNumber(
    firstDefined(
      http?.port,
      app?.port,
      DEFAULTS.runtime.port,
    ),
    DEFAULTS.runtime.port,
  );

// =============================================================================
// CANONICAL APPLICATION VALUES
// =============================================================================

const serviceName =
  String(
    canonicalServiceName,
  ).trim();

const applicationName =
  String(
    canonicalApplicationName,
  ).trim();

const applicationVersion =
  String(
    canonicalVersion,
  ).trim();

const applicationEnvironment =
  String(
    canonicalNodeEnv,
  ).trim().toLowerCase();

// =============================================================================
// FLAGS
// =============================================================================

const flags =
  Object.freeze({
    isProduction:
      Boolean(
        environmentFlags?.isProduction ??
          applicationEnvironment ===
            'production',
      ),

    isStaging:
      Boolean(
        environmentFlags?.isStaging ??
          applicationEnvironment ===
            'staging',
      ),

    isDevelopment:
      Boolean(
        environmentFlags?.isDevelopment ??
          applicationEnvironment ===
            'development',
      ),

    isTest:
      Boolean(
        environmentFlags?.isTest ??
          applicationEnvironment ===
            'test',
      ),

    isCI:
      Boolean(
        environmentFlags?.isCI ??
          false,
      ),
  });

// =============================================================================
// CANONICAL API
// =============================================================================

const api =
  Object.freeze({
    prefix:
      normalizePath(
        firstDefined(
          app?.api?.prefix,
          app?.apiPrefix,
          DEFAULTS.api.prefix,
        ),
        DEFAULTS.api.prefix,
      ),

    livenessPath:
      normalizePath(
        firstDefined(
          app?.api?.livenessPath,
          app?.livenessPath,
          DEFAULTS.api.livenessPath,
        ),
        DEFAULTS.api.livenessPath,
      ),

    readinessPath:
      normalizePath(
        firstDefined(
          app?.api?.readinessPath,
          app?.readinessPath,
          DEFAULTS.api.readinessPath,
        ),
        DEFAULTS.api.readinessPath,
      ),

    healthPath:
      normalizePath(
        firstDefined(
          app?.api?.healthPath,
          app?.healthPath,
          DEFAULTS.api.healthPath,
        ),
        DEFAULTS.api.healthPath,
      ),

    metricsPath:
      normalizePath(
        firstDefined(
          app?.api?.metricsPath,
          app?.metricsPath,
          DEFAULTS.api.metricsPath,
        ),
        DEFAULTS.api.metricsPath,
      ),

    diagnosticsPath:
      normalizePath(
        firstDefined(
          app?.api?.diagnosticsPath,
          app?.diagnosticsPath,
          DEFAULTS.api.diagnosticsPath,
        ),
        DEFAULTS.api.diagnosticsPath,
      ),
  });

// =============================================================================
// HEALTH
// =============================================================================

const health =
  Object.freeze({
    diagnosticsEnabled:
      toBoolean(
        firstDefined(
          app?.health?.diagnosticsEnabled,
          app?.diagnosticsEnabled,
          security?.diagnosticsEnabled,
          DEFAULTS.health
            .diagnosticsEnabled,
        ),
        DEFAULTS.health
          .diagnosticsEnabled,
      ),
  });

// =============================================================================
// DEPLOYMENT
// =============================================================================

const deployment =
  Object.freeze({
    instanceId:
      firstDefined(
        environmentDeployment?.instanceId,
        environmentDeployment?.instanceID,
        environmentDeployment?.hostname,
        runtime?.hostname,
        canonicalHostname,
        DEFAULTS.deployment.instanceId,
      ),

    region:
      firstDefined(
        environmentDeployment?.region,
        DEFAULTS.deployment.region,
      ),

    deploymentId:
      firstDefined(
        environmentDeployment?.deploymentId,
        environmentDeployment?.releaseId,
        DEFAULTS.deployment
          .deploymentId,
      ),

    hostname:
      canonicalHostname,

    releaseId:
      firstDefined(
        environmentDeployment?.releaseId,
        null,
      ),

    commitSha:
      firstDefined(
        environmentDeployment?.commitSha,
        null,
      ),
  });

// =============================================================================
// RUNTIME
// =============================================================================
//
// Runtime is intentionally separated from application configuration.
//

const runtimeConfig =
  Object.freeze({
    nodeVersion:
      runtime?.nodeVersion,

    nodeMajor:
      runtime?.nodeMajor,

    platform:
      runtime?.platform,

    architecture:
      runtime?.architecture,

    pid:
      runtime?.pid,

    ppid:
      runtime?.ppid,

    hostname:
      canonicalHostname,

    cpuCount:
      runtime?.cpuCount,

    host:
      canonicalHost,

    port:
      canonicalPort,
  });

// =============================================================================
// COMPOSE CANONICAL CONFIGURATION
// =============================================================================

const configuration = {
  // ===========================================================================
  // Identity
  // ===========================================================================

  component:
    COMPONENT,

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

  // ===========================================================================
  // Network
  // ===========================================================================

  host:
    canonicalHost,

  port:
    canonicalPort,

  hostname:
    canonicalHostname,

  api,

  // ===========================================================================
  // Runtime
  // ===========================================================================

  runtime:
    runtimeConfig,

  // ===========================================================================
  // Feature / environment flags
  // ===========================================================================

  flags,

  // ===========================================================================
  // Deployment
  // ===========================================================================

  deployment,

  // ===========================================================================
  // Health
  // ===========================================================================

  health,

  // ===========================================================================
  // Application-specific configuration modules
  // ===========================================================================

  app,

  database,

  auth,

  jwt:
    auth?.jwt,

  session:
    Object.freeze({
      secret:
        auth?.sessionSecret,

      cookie:
        auth?.cookie,

      ttl:
        auth?.sessionTtl,
    }),

  cors,

  redis,

  email,

  security,

  observability,

  features,
};

// =============================================================================
// COMPOSED CONFIGURATION VALIDATION
// =============================================================================

function validateConfiguration(
  value,
) {
  const errors =
    [];

  if (
    !value.application
  ) {
    errors.push(
      'application is required',
    );
  }

  if (
    !value.serviceName
  ) {
    errors.push(
      'serviceName is required',
    );
  }

  if (
    !value.environment
  ) {
    errors.push(
      'environment is required',
    );
  }

  if (
    !Number.isInteger(
      value.port,
    ) ||
    value.port < 1 ||
    value.port > 65_535
  ) {
    errors.push(
      'port must be a valid TCP port',
    );
  }

  if (
    !value.api.prefix.startsWith('/')
  ) {
    errors.push(
      'api.prefix must start with "/"',
    );
  }

  if (
    value.api.livenessPath ===
    value.api.readinessPath &&
    value.api.livenessPath !==
      '/live'
  ) {
    /*
     * Same paths are allowed in theory, but using distinct endpoints is the
     * canonical default and this condition intentionally remains non-fatal.
     */
  }

  if (
    value.flags.isProduction &&
    value.health.diagnosticsEnabled
  ) {
    /*
     * Diagnostics can exist in production, but routes should require
     * authorization. Configuration does not silently disable the feature.
     */
  }

  if (
    errors.length > 0
  ) {
    const error =
      new Error(
        `Canonical configuration validation failed: ${errors.join('; ')}`,
      );

    error.code =
      'CONFIGURATION_VALIDATION_FAILED';

    error.details = {
      errors,
    };

    throw error;
  }

  return true;
}

validateConfiguration(
  configuration,
);

// =============================================================================
// FREEZE CANONICAL CONFIGURATION
// =============================================================================

deepFreeze(
  configuration,
);

// =============================================================================
// SAFE DIAGNOSTIC KEY FILTER
// =============================================================================
//
// Avoid broad terms such as "database", "redis" and "connection", because
// these can also occur in harmless metadata. Only redact fields that are
// likely to carry credentials/secrets.
//

const SENSITIVE_KEY_PATTERN =
  /(?:password|passwd|passcode|pin|otp|secret|token|private.?key|api.?key|access.?key|refresh.?token|client.?secret|encryption.?key|signing.?key|credential|authorization|cookie|dsn|uri)$/i;

// =============================================================================
// SANITIZATION
// =============================================================================

function sanitizeSnapshot(
  value,
  key = '',
  seen = new WeakSet(),
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    key &&
    SENSITIVE_KEY_PATTERN.test(
      key,
    )
  ) {
    return '[REDACTED]';
  }

  if (
    typeof value !== 'object'
  ) {
    return value;
  }

  if (
    seen.has(value)
  ) {
    return '[CIRCULAR]';
  }

  seen.add(value);

  if (
    Array.isArray(value)
  ) {
    return value.map(
      (item) =>
        sanitizeSnapshot(
          item,
          key,
          seen,
        ),
    );
  }

  const output =
    {};

  for (
    const [
      childKey,
      childValue,
    ] of Object.entries(value)
  ) {
    output[childKey] =
      sanitizeSnapshot(
        childValue,
        childKey,
        seen,
      );
  }

  return output;
}

// =============================================================================
// PUBLIC ACCESSORS
// =============================================================================

export function getConfiguration() {
  return configuration;
}

export function get(
  path,
  fallback = undefined,
) {
  return getByPath(
    configuration,
    path,
    fallback,
  );
}

export function getString(
  path,
  fallback = undefined,
) {
  const value =
    get(
      path,
      fallback,
    );

  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return String(value);
}

export function getBoolean(
  path,
  fallback = false,
) {
  return toBoolean(
    get(
      path,
      fallback,
    ),
    fallback,
  );
}

export function getNumber(
  path,
  fallback = undefined,
) {
  return toNumber(
    get(
      path,
      fallback,
    ),
    fallback,
  );
}

export function getObject(
  path,
  fallback = undefined,
) {
  return get(
    path,
    fallback,
  );
}

export function getEnvironment() {
  return configuration.environment;
}

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

// =============================================================================
// NETWORK / ROUTE ACCESSORS
// =============================================================================

export function getHost() {
  return configuration.host;
}

export function getPort() {
  return configuration.port;
}

export function getApiPrefix() {
  return configuration.api.prefix;
}

export function getLivenessPath() {
  return configuration.api
    .livenessPath;
}

export function getReadinessPath() {
  return configuration.api
    .readinessPath;
}

export function getHealthPath() {
  return configuration.api
    .healthPath;
}

export function getMetricsPath() {
  return configuration.api
    .metricsPath;
}

export function getDiagnosticsPath() {
  return configuration.api
    .diagnosticsPath;
}

export function joinRoutePathForApi(
  routePath,
) {
  return joinPath(
    configuration.api.prefix,
    routePath,
  );
}

// =============================================================================
// SAFE SNAPSHOTS
// =============================================================================

export function snapshot() {
  return sanitizeSnapshot(
    cloneValue(
      configuration,
    ),
  );
}

export function getSnapshot() {
  return snapshot();
}

// =============================================================================
// SAFE METADATA
// =============================================================================

export function getMetadata() {
  return Object.freeze({
    component:
      COMPONENT,

    application:
      configuration.application,

    applicationLegalName:
      configuration
        .applicationLegalName,

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

    runtime:
      Object.freeze({
        nodeVersion:
          configuration.runtime
            .nodeVersion,

        nodeMajor:
          configuration.runtime
            .nodeMajor,

        platform:
          configuration.runtime
            .platform,

        architecture:
          configuration.runtime
            .architecture,
      }),

    deployment:
      Object.freeze({
        instanceId:
          configuration
            .deployment
            .instanceId,

        region:
          configuration
            .deployment
            .region,

        deploymentId:
          configuration
            .deployment
            .deploymentId,

        releaseId:
          configuration
            .deployment
            .releaseId,

        commitSha:
          configuration
            .deployment
            .commitSha,
      }),

    flags:
      configuration.flags,
  });
}

// =============================================================================
// COMPATIBILITY FACADE
// =============================================================================

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

    getHost,
    getPort,

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

function initialize(
  context = {},
) {
  return {
    context: {
      ...context,
      config:
        configurationFacade,
    },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  configuration,
  configurationFacade,

  app,
  database,
  auth,
  cors,
  redis,
  email,
  security,
  observability,
  features,

  api,
  health,
  flags,
  deployment,
  runtimeConfig,

  COMPONENT,
  APPLICATION_LEGAL_NAME,
  DEFAULTS,

  environmentMeta,

  initialize,
};

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

export default configurationFacade;