'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/fingerprint.js
 *
 * Purpose:
 *   Enterprise production-grade configuration fingerprinting subsystem.
 *
 * Responsibilities:
 *   - Generate deterministic fingerprints for effective configuration.
 *   - Detect configuration drift between processes/deployments.
 *   - Exclude secrets and sensitive configuration from fingerprints.
 *   - Normalize configuration before hashing.
 *   - Support SHA-256 and approved cryptographic algorithms.
 *   - Produce full and shortened fingerprints.
 *   - Generate fingerprints for environment/configuration snapshots.
 *   - Compare fingerprints safely.
 *   - Provide safe diagnostics for operations and observability.
 *   - Support bootstrap/configProvider integration.
 *   - Maintain immutable runtime fingerprint state.
 *
 * IMPORTANT:
 *
 *   This module does NOT:
 *     - store credentials.
 *     - expose secrets.
 *     - authenticate requests.
 *     - connect to databases.
 *     - connect to Redis.
 *     - start Express.
 *     - mutate process.env.
 *     - persist audit events.
 *
 * Fingerprinting answers:
 *
 *   "Are these effective configurations materially the same?"
 *
 * It does NOT answer:
 *
 *   "Is this configuration valid?"
 *
 * Configuration validation remains owned by:
 *
 *   backend/config/environment.js
 *   backend/config/bootstrapEnvironment.js
 *   backend/config/index.js
 *
 * =============================================================================
 *
 * Architecture:
 *
 *   process.env
 *       ↓
 *   environment.js
 *       ↓
 *   config/index.js
 *       ↓
 *   configProvider.js
 *       ↓
 *   fingerprint.js
 *       ↓
 *   startup diagnostics / observability / deployment verification
 *
 * =============================================================================
 */

'use strict';

/**
 * =============================================================================
 * Core Dependencies
 * =============================================================================
 */

const crypto =
  require('node:crypto');

/**
 * =============================================================================
 * Optional Integration
 * =============================================================================
 */

let startupErrors = null;

try {
  // eslint-disable-next-line global-require
  startupErrors =
    require('../bootstrap/startupErrors');
} catch {
  startupErrors = null;
}

let loggerModule = null;

try {
  // eslint-disable-next-line global-require
  loggerModule =
    require('../utils/logger');
} catch {
  loggerModule = null;
}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
  'configuration-fingerprint';

const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  'titech-backend';

const APPLICATION_NAME =
  process.env.APP_NAME ||
  'titech-community-capital';

const FINGERPRINT_SCHEMA_VERSION =
  1;

const DEFAULT_ALGORITHM =
  'sha256';

const DEFAULT_LENGTH =
  64;

const SUPPORTED_ALGORITHMS =
  Object.freeze([
    'sha256',
    'sha384',
    'sha512',
  ]);

const FINGERPRINT_FORMATS =
  Object.freeze({
    HEX:
      'hex',

    BASE64:
      'base64',

    BASE64URL:
      'base64url',
  });

const DEFAULT_FORMAT =
  FINGERPRINT_FORMATS.HEX;

/**
 * =============================================================================
 * Sensitive fields
 * =============================================================================
 *
 * Fingerprints must never depend directly on secret values.
 *
 * This list intentionally covers both exact names and common enterprise naming
 * patterns.
 * =============================================================================
 */

const SENSITIVE_KEYS =
  Object.freeze([
    'password',
    'passcode',
    'pin',
    'otp',
    'token',
    'accessToken',
    'refreshToken',
    'authorization',
    'cookie',
    'set-cookie',
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
    'sessionSecret',
    'refreshTokenSecret',
    'databaseUrl',
    'databaseUri',
    'connectionString',
    'dsn',
    'mongoUri',
    'mongodbUri',
    'mongoUriFallback',
    'mongodbUriFallback',
    'redisUrl',
    'redisUri',
    'redisPassword',
    'smtpPassword',
    'smtpPass',
    'stripeSecretKey',
    'awsSecretAccessKey',
    'gcpPrivateKey',
  ]);

const SENSITIVE_KEY_PATTERN =
  /(password|passcode|pin|otp|token|secret|authorization|cookie|api[_-]?key|private[_-]?key|encryption[_-]?key|credential|dsn|connectionstring|databaseuri|databaseurl|mongouri|mongodburi|redisuri|redisurl)/i;

/**
 * =============================================================================
 * Volatile fields
 * =============================================================================
 *
 * These values can legitimately change every process start without representing
 * a meaningful deployment configuration change.
 * =============================================================================
 */

const VOLATILE_KEYS =
  Object.freeze([
    'timestamp',
    'startedAt',
    'completedAt',
    'initializedAt',
    'readyAt',
    'stoppedAt',
    'uptime',
    'uptimeSeconds',
    'pid',
    'processId',
    'instanceId',
    'hostname',
    'hostName',
    'randomId',
    'requestId',
    'correlationId',
    'traceId',
    'spanId',
    'nonce',
    'generatedAt',
    'createdAt',
    'updatedAt',
    'lastHealthCheckAt',
  ]);

const VOLATILE_KEY_PATTERN =
  /^(timestamp|generatedAt|initializedAt|readyAt|stoppedAt|uptime|uptimeSeconds|pid|processId|instanceId|hostname|hostName|requestId|correlationId|traceId|spanId|nonce)$/i;

/**
 * =============================================================================
 * Errors
 * =============================================================================
 */

class FingerprintError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'FingerprintError';

    this.code =
      options.code ||
      'FINGERPRINT_ERROR';

    this.path =
      options.path ||
      null;

    this.algorithm =
      options.algorithm ||
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
      FingerprintError,
    );
  }
}

/**
 * =============================================================================
 * Utility
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
  message,
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

          service:
            SERVICE_NAME,

          application:
            APPLICATION_NAME,

          ...metadata,
        },
        message,
      );

      return;
    }
  } catch {
    // Best effort.
  }

  const text =
    `[${COMPONENT}] ${message}`;

  if (
    level === 'error' ||
    level === 'fatal'
  ) {
    process.stderr.write(
      `${text}\n`,
    );
  } else {
    process.stdout.write(
      `${text}\n`,
    );
  }
}

function normalizeAlgorithm(
  algorithm,
) {
  const value =
    String(
      algorithm ||
        DEFAULT_ALGORITHM,
    )
      .trim()
      .toLowerCase();

  if (
    !SUPPORTED_ALGORITHMS.includes(
      value,
    )
  ) {
    throw new FingerprintError(
      `Unsupported fingerprint algorithm "${value}".`,
      {
        code:
          'FINGERPRINT_ALGORITHM_UNSUPPORTED',

        algorithm:
          value,

        details: {
          supported:
            SUPPORTED_ALGORITHMS,
        },
      },
    );
  }

  return value;
}

function normalizeFormat(
  format,
) {
  const value =
    String(
      format ||
        DEFAULT_FORMAT,
    )
      .trim()
      .toLowerCase();

  if (
    !Object.values(
      FINGERPRINT_FORMATS,
    ).includes(
      value,
    )
  ) {
    throw new FingerprintError(
      `Unsupported fingerprint format "${value}".`,
      {
        code:
          'FINGERPRINT_FORMAT_UNSUPPORTED',

        details: {
          supported:
            Object.values(
              FINGERPRINT_FORMATS,
            ),
        },
      },
    );
  }

  return value;
}

function isPlainObject(
  value,
) {
  if (
    value === null ||
    typeof value !==
      'object'
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(
      value,
    );

  return (
    prototype ===
      Object.prototype ||
    prototype ===
      null
  );
}

function isSensitiveKey(
  key,
) {
  const normalized =
    String(
      key ||
        '',
    )
      .trim();

  return (
    SENSITIVE_KEYS.includes(
      normalized,
    ) ||
    SENSITIVE_KEY_PATTERN.test(
      normalized,
    )
  );
}

function isVolatileKey(
  key,
) {
  const normalized =
    String(
      key ||
        '',
    )
      .trim();

  return (
    VOLATILE_KEYS.includes(
      normalized,
    ) ||
    VOLATILE_KEY_PATTERN.test(
      normalized,
    )
  );
}

function stableSortKeys(
  object,
) {
  return Object.keys(
    object,
  ).sort(
    (a, b) =>
      a.localeCompare(
        b,
      ),
  );
}

function normalizePrimitive(
  value,
) {
  if (
    value === null
  ) {
    return null;
  }

  if (
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value ===
      'string' ||
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
      'number'
  ) {
    if (
      Number.isNaN(
        value,
      )
    ) {
      return '[NaN]';
    }

    if (
      value ===
      Infinity
    ) {
      return '[Infinity]';
    }

    if (
      value ===
      -Infinity
    ) {
      return '[-Infinity]';
    }

    return value;
  }

  if (
    typeof value ===
      'bigint'
  ) {
    return String(
      value,
    );
  }

  if (
    typeof value ===
      'symbol'
  ) {
    return String(
      value,
    );
  }

  if (
    typeof value ===
      'function'
  ) {
    return '[Function]';
  }

  return value;
}

/**
 * =============================================================================
 * Canonicalization
 * =============================================================================
 *
 * Produces a deterministic, JSON-safe representation.
 *
 * Rules:
 *   1. Sensitive fields are omitted.
 *   2. Volatile fields are omitted by default.
 *   3. Object keys are sorted.
 *   4. Arrays retain order unless explicitly requested otherwise.
 *   5. Dates become ISO strings.
 *   6. Sets/Maps become deterministic arrays.
 *   7. Circular references are replaced with a marker.
 * =============================================================================
 */

function canonicalize(
  value,
  options = {},
  path = '',
  seen = new WeakSet(),
) {
  const excludeSensitive =
    options.excludeSensitive !==
      false;

  const excludeVolatile =
    options.excludeVolatile !==
      false;

  const sortArrays =
    options.sortArrays ===
    true;

  /**
   * Primitive.
   */
  if (
    value === null ||
    value === undefined ||
    typeof value !==
      'object'
  ) {
    return normalizePrimitive(
      value,
    );
  }

  /**
   * Circular reference.
   */
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

  /**
   * Date.
   */
  if (
    value instanceof
    Date
  ) {
    return value.toISOString();
  }

  /**
   * Buffer.
   */
  if (
    Buffer.isBuffer(
      value,
    )
  ) {
    return value.toString(
      'base64',
    );
  }

  /**
   * Set.
   */
  if (
    value instanceof
    Set
  ) {
    const array =
      [
        ...value.values(),
      ].map(
        item =>
          canonicalize(
            item,
            options,
            path,
            seen,
          ),
      );

    if (
      sortArrays
    ) {
      array.sort(
        compareCanonicalValues,
      );
    }

    return array;
  }

  /**
   * Map.
   */
  if (
    value instanceof
    Map
  ) {
    const entries =
      [
        ...value.entries(),
      ].map(
        ([
          key,
          item,
        ]) => [
          canonicalize(
            key,
            options,
            path,
            seen,
          ),
          canonicalize(
            item,
            options,
            path,
            seen,
          ),
        ],
      );

    entries.sort(
      (a, b) =>
        JSON.stringify(
          a[0],
        ).localeCompare(
          JSON.stringify(
            b[0],
          ),
        ),
    );

    return entries;
  }

  /**
   * Arrays.
   */
  if (
    Array.isArray(
      value,
    )
  ) {
    const result =
      value.map(
        (
          item,
          index,
        ) =>
          canonicalize(
            item,
            options,
            `${path}[${index}]`,
            seen,
          ),
      );

    if (
      sortArrays
    ) {
      result.sort(
        compareCanonicalValues,
      );
    }

    return result;
  }

  /**
   * Class instances / objects.
   */
  const result =
    {};

  for (
    const key of
      stableSortKeys(
        value,
      )
  ) {
    if (
      excludeSensitive &&
      isSensitiveKey(
        key,
      )
    ) {
      continue;
    }

    if (
      excludeVolatile &&
      isVolatileKey(
        key,
      )
    ) {
      continue;
    }

    const childPath =
      path
        ? `${path}.${key}`
        : key;

    result[key] =
      canonicalize(
        value[key],
        options,
        childPath,
        seen,
      );
  }

  return result;
}

function compareCanonicalValues(
  a,
  b,
) {
  return JSON.stringify(
    a,
  ).localeCompare(
    JSON.stringify(
      b,
    ),
  );
}

/**
 * =============================================================================
 * Canonical serialization
 * =============================================================================
 */

function canonicalJson(
  value,
  options = {},
) {
  const canonical =
    canonicalize(
      value,
      options,
    );

  return JSON.stringify(
    canonical,
  );
}

/**
 * =============================================================================
 * Digest generation
 * =============================================================================
 */

function digest(
  value,
  options = {},
) {
  const algorithm =
    normalizeAlgorithm(
      options.algorithm,
    );

  const format =
    normalizeFormat(
      options.format,
    );

  const input =
    typeof value ===
      'string'
      ? value
      : canonicalJson(
          value,
          options,
        );

  const hash =
    crypto
      .createHash(
        algorithm,
      )
      .update(
        input,
        'utf8',
      )
      .digest(
        format,
      );

  return hash;
}

/**
 * =============================================================================
 * Fingerprint object generation
 * =============================================================================
 */

function createFingerprint(
  value,
  options = {},
) {
  const algorithm =
    normalizeAlgorithm(
      options.algorithm,
    );

  const format =
    normalizeFormat(
      options.format,
    );

  const canonicalOptions = {
    excludeSensitive:
      options.excludeSensitive !==
      false,

    excludeVolatile:
      options.excludeVolatile !==
      false,

    sortArrays:
      options.sortArrays ===
      true,
  };

  const canonical =
    canonicalJson(
      value,
      canonicalOptions,
    );

  const hash =
    crypto
      .createHash(
        algorithm,
      )
      .update(
        canonical,
        'utf8',
      )
      .digest(
        format,
      );

  const fullLength =
    hash.length;

  const length =
    Number.isInteger(
      options.length,
    ) &&
    options.length > 0
      ? Math.min(
          options.length,
          fullLength,
        )
      : Math.min(
          DEFAULT_LENGTH,
          fullLength,
        );

  const shortened =
    hash.slice(
      0,
      length,
    );

  return Object.freeze({
    schemaVersion:
      FINGERPRINT_SCHEMA_VERSION,

    algorithm,

    format,

    length,

    value:
      shortened,

    fullValue:
      hash,

    canonicalLength:
      Buffer.byteLength(
        canonical,
        'utf8',
      ),

    sensitiveExcluded:
      canonicalOptions
        .excludeSensitive,

    volatileExcluded:
      canonicalOptions
        .excludeVolatile,

    generatedAt:
      new Date(),

    component:
      COMPONENT,
  });
}

/**
 * =============================================================================
 * Environment fingerprint
 * =============================================================================
 *
 * Builds a fingerprint from process.env while deliberately excluding secrets.
 * =============================================================================
 */

function createEnvironmentFingerprint(
  options = {},
) {
  return createFingerprint(
    process.env,
    {
      ...options,

      excludeSensitive:
        true,

      excludeVolatile:
        options.excludeVolatile !==
        false,
    },
  );
}

/**
 * =============================================================================
 * Configuration fingerprint
 * =============================================================================
 */

function createConfigurationFingerprint(
  configuration,
  options = {},
) {
  if (
    configuration ===
      undefined ||
    configuration ===
      null
  ) {
    throw new FingerprintError(
      'TITech configuration cannot be null or undefined when creating a fingerprint.',
      {
        code:
          'FINGERPRINT_CONFIGURATION_MISSING',
      },
    );
  }

  return createFingerprint(
    configuration,
    {
      ...options,

      excludeSensitive:
        options.excludeSensitive !==
        false,
    },
  );
}

/**
 * =============================================================================
 * Compare fingerprints
 * =============================================================================
 */

function normalizeFingerprintValue(
  fingerprint,
) {
  if (
    typeof fingerprint ===
      'string'
  ) {
    return fingerprint;
  }

  if (
    fingerprint &&
    typeof fingerprint.value ===
      'string'
  ) {
    return fingerprint.value;
  }

  if (
    fingerprint &&
    typeof fingerprint.fullValue ===
      'string'
  ) {
    return fingerprint.fullValue;
  }

  return null;
}

function fingerprintsEqual(
  left,
  right,
) {
  const a =
    normalizeFingerprintValue(
      left,
    );

  const b =
    normalizeFingerprintValue(
      right,
    );

  if (
    !a ||
    !b
  ) {
    return false;
  }

  if (
    a.length !==
    b.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(
      a,
      'utf8',
    ),
    Buffer.from(
      b,
      'utf8',
    ),
  );
}

/**
 * =============================================================================
 * Fingerprint metadata
 * =============================================================================
 */

function getFingerprintMetadata(
  fingerprint,
) {
  const value =
    fingerprint &&
    typeof fingerprint ===
      'object'
      ? fingerprint
      : {
          value:
            normalizeFingerprintValue(
              fingerprint,
            ),
        };

  return Object.freeze({
    schemaVersion:
      value.schemaVersion ||
      FINGERPRINT_SCHEMA_VERSION,

    algorithm:
      value.algorithm ||
      DEFAULT_ALGORITHM,

    format:
      value.format ||
      DEFAULT_FORMAT,

    value:
      value.value ||
      null,

    length:
      value.length ||
      (
        value.value
          ? value.value.length
          : 0
      ),

    component:
      COMPONENT,
  });
}

/**
 * =============================================================================
 * Drift detection
 * =============================================================================
 */

function detectDrift(
  expected,
  actual,
  options = {},
) {
  const expectedValue =
    normalizeFingerprintValue(
      expected,
    );

  const actualValue =
    normalizeFingerprintValue(
      actual,
    );

  const matches =
    fingerprintsEqual(
      expected,
      actual,
    );

  return Object.freeze({
    drift:
      !matches,

    matches,

    expected:
      expectedValue,

    actual:
      actualValue,

    severity:
      matches
        ? 'none'
        : options.severity ||
          'warning',

    component:
      COMPONENT,

    timestamp:
      new Date(),
  });
}

/**
 * =============================================================================
 * Redacted canonical representation
 * =============================================================================
 *
 * Useful when operators need to understand WHAT was fingerprinted without
 * exposing secrets.
 * =============================================================================
 */

function getCanonicalConfiguration(
  configuration,
  options = {},
) {
  return canonicalize(
    configuration,
    {
      excludeSensitive:
        options.excludeSensitive !==
        false,

      excludeVolatile:
        options.excludeVolatile !==
        false,

      sortArrays:
        options.sortArrays ===
        true,
    },
  );
}

function getCanonicalEnvironment(
  options = {},
) {
  return getCanonicalConfiguration(
    process.env,
    {
      ...options,

      excludeSensitive:
        true,
    },
  );
}

/**
 * =============================================================================
 * Runtime provider
 * =============================================================================
 */

class FingerprintProvider {

  constructor(
    options = {},
  ) {
    this.options =
      Object.freeze({
        algorithm:
          normalizeAlgorithm(
            options.algorithm,
          ),

        format:
          normalizeFormat(
            options.format,
          ),

        length:
          Number.isInteger(
            options.length,
          ) &&
          options.length > 0
            ? options.length
            : DEFAULT_LENGTH,

        excludeSensitive:
          options.excludeSensitive !==
          false,

        excludeVolatile:
          options.excludeVolatile !==
          false,

        sortArrays:
          options.sortArrays ===
          true,
      });

    this.state =
      'created';

    this.initialized =
      false;

    this.initializedAt =
      null;

    this.environment =
      null;

    this.configuration =
      null;

    this.environmentFingerprint =
      null;

    this.configurationFingerprint =
      null;

    this.combinedFingerprint =
      null;

    this.version =
      0;
  }

  initialize(
    options = {},
  ) {
    const environment =
      options.environment ||
      process.env;

    const configuration =
      options.configuration;

    const environmentFingerprint =
      options.environmentFingerprint ||
      createEnvironmentFingerprint(
        {
          ...this.options,
          ...options,
          excludeSensitive:
            true,
        },
      );

    const configurationFingerprint =
      configuration !==
        undefined
        ? createConfigurationFingerprint(
            configuration,
            {
              ...this.options,
              ...options,
              excludeSensitive:
                true,
            },
          )
        : null;

    const combinedInput =
      {
        environment:
          environmentFingerprint.fullValue,

        configuration:
          configurationFingerprint
            ?.fullValue ||
          null,
      };

    const combinedFingerprint =
      createFingerprint(
        combinedInput,
        {
          algorithm:
            this.options
              .algorithm,

          format:
            this.options
              .format,

          length:
            this.options
              .length,

          excludeSensitive:
            true,

          excludeVolatile:
            true,
        },
      );

    this.environment =
      environment;

    this.configuration =
      configuration;

    this.environmentFingerprint =
      environmentFingerprint;

    this.configurationFingerprint =
      configurationFingerprint;

    this.combinedFingerprint =
      combinedFingerprint;

    this.state =
      'ready';

    this.initialized =
      true;

    this.initializedAt =
      new Date();

    this.version +=
      1;

    return this;
  }

  getEnvironmentFingerprint() {
    this._ensureInitialized();

    return this
      .environmentFingerprint;
  }

  getConfigurationFingerprint() {
    this._ensureInitialized();

    return this
      .configurationFingerprint;
  }

  getCombinedFingerprint() {
    this._ensureInitialized();

    return this
      .combinedFingerprint;
  }

  snapshot() {
    this._ensureInitialized();

    return Object.freeze({
      component:
        COMPONENT,

      state:
        this.state,

      initialized:
        this.initialized,

      initializedAt:
        this.initializedAt,

      version:
        this.version,

      environment:
        getFingerprintMetadata(
          this
            .environmentFingerprint,
        ),

      configuration:
        this.configurationFingerprint
          ? getFingerprintMetadata(
              this
                .configurationFingerprint,
            )
          : null,

      combined:
        getFingerprintMetadata(
          this
            .combinedFingerprint,
        ),

      timestamp:
        new Date(),
    });
  }

  async start(
    context = {},
  ) {
    this.initialize({
      environment:
        context.environment ||
        process.env,

      configuration:
        context.configuration,
    });

    if (
      context &&
      typeof context ===
        'object'
    ) {
      context.fingerprint =
        this;
    }

    return this;
  }

  async bootstrap(
    context = {},
  ) {
    return this.start(
      context,
    );
  }

  reset() {
    this.state =
      'created';

    this.initialized =
      false;

    this.initializedAt =
      null;

    this.environment =
      null;

    this.configuration =
      null;

    this.environmentFingerprint =
      null;

    this.configurationFingerprint =
      null;

    this.combinedFingerprint =
      null;

    this.version =
      0;

    return this;
  }

  _ensureInitialized() {
    if (
      !this.initialized
    ) {
      this.initialize({
        environment:
          process.env,
      });
    }
  }
}

/**
 * =============================================================================
 * Default singleton
 * =============================================================================
 */

const fingerprintProvider =
  new FingerprintProvider();

fingerprintProvider.initialize({
  environment:
    process.env,
});

/**
 * =============================================================================
 * Convenience API
 * =============================================================================
 */

function initialize(
  options = {},
) {
  return fingerprintProvider.initialize(
    options,
  );
}

async function start(
  context = {},
) {
  return fingerprintProvider.start(
    context,
  );
}

async function bootstrap(
  context = {},
) {
  return fingerprintProvider.bootstrap(
    context,
  );
}

function environmentFingerprint(
  options = {},
) {
  return createEnvironmentFingerprint(
    options,
  );
}

function configurationFingerprint(
  configuration,
  options = {},
) {
  return createConfigurationFingerprint(
    configuration,
    options,
  );
}

function combinedFingerprint() {
  return fingerprintProvider
    .getCombinedFingerprint();
}

function snapshot() {
  return fingerprintProvider.snapshot();
}

function reset() {
  return fingerprintProvider.reset();
}

/**
 * =============================================================================
 * Diagnostics
 * =============================================================================
 */

function getDiagnostics() {
  const environment =
    fingerprintProvider
      .getEnvironmentFingerprint();

  const configuration =
    fingerprintProvider
      .getConfigurationFingerprint();

  const combined =
    fingerprintProvider
      .getCombinedFingerprint();

  return Object.freeze({
    component:
      COMPONENT,

    service:
      SERVICE_NAME,

    application:
      APPLICATION_NAME,

    state:
      fingerprintProvider
        .state,

    schemaVersion:
      FINGERPRINT_SCHEMA_VERSION,

    environment:
      getFingerprintMetadata(
        environment,
      ),

    configuration:
      configuration
        ? getFingerprintMetadata(
            configuration,
          )
        : null,

    combined:
      getFingerprintMetadata(
        combined,
      ),

    timestamp:
      new Date(),
  });
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
    FingerprintProvider,

    FingerprintError,

    fingerprintProvider,

    provider:
      fingerprintProvider,

    /**
     * Constants.
     */
    COMPONENT,

    SERVICE_NAME,

    APPLICATION_NAME,

    FINGERPRINT_SCHEMA_VERSION,

    DEFAULT_ALGORITHM,

    DEFAULT_FORMAT,

    DEFAULT_LENGTH,

    SUPPORTED_ALGORITHMS,

    FINGERPRINT_FORMATS,

    /**
     * Canonicalization.
     */
    canonicalize,

    canonicalJson,

    getCanonicalConfiguration,

    getCanonicalEnvironment,

    /**
     * Hashing/fingerprinting.
     */
    digest,

    createFingerprint,

    createEnvironmentFingerprint:

      environmentFingerprint,

    createConfigurationFingerprint:

      configurationFingerprint,

    getFingerprintMetadata,

    /**
     * Comparison/drift.
     */
    fingerprintsEqual,

    detectDrift,

    /**
     * Provider lifecycle.
     */
    initialize,

    start,

    bootstrap,

    snapshot,

    getDiagnostics,

    reset,

    /**
     * Environment/config convenience.
     */
    getEnvironmentFingerprint:

      () =>
        fingerprintProvider
          .getEnvironmentFingerprint(),

    getConfigurationFingerprint:

      () =>
        fingerprintProvider
          .getConfigurationFingerprint(),

    getCombinedFingerprint:

      combinedFingerprint,
  });