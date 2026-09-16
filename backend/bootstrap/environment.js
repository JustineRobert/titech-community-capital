/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Process Environment Bootstrap
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/environment.js
 *
 * Module:
 *   ES Modules (ESM)
 *
 * Purpose:
 *   Canonical process-environment boundary for the TITech Community Capital
 *   backend.
 *
 * Architectural boundary:
 *
 *   External environment / .env files
 *                ↓
 *        environment.js
 *                ↓
 *          config/index.js
 *                ↓
 *     observability / resilience
 *                ↓
 *     infrastructure / services
 *                ↓
 *       middleware / routes
 *                ↓
 *             server
 *
 * Responsibilities:
 *   - Load environment variables exactly once per process.
 *   - Preserve externally injected environment variables.
 *   - Apply deterministic environment-file precedence.
 *   - Normalize NODE_ENV and supported aliases.
 *   - Normalize booleans, integers, lists, URLs, durations and secrets.
 *   - Support backward-compatible environment aliases.
 *   - Validate runtime and security configuration.
 *   - Enforce production safety requirements.
 *   - Expose immutable typed configuration.
 *   - Expose safe non-sensitive runtime metadata.
 *   - Support ApplicationBootstrap lifecycle compatibility.
 *
 * MUST NOT:
 *   - connect to MongoDB
 *   - connect to Redis
 *   - initialize queues
 *   - initialize Socket.IO
 *   - initialize business services
 *   - create an HTTP server
 *   - orchestrate startup/shutdown
 *
 * Runtime:
 *   Node.js 20+
 *
 * =============================================================================
 */

'use strict';

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

// =============================================================================
// ESM PATH IDENTITY
// =============================================================================

const CURRENT_FILE = fileURLToPath(
  import.meta.url,
);

const CURRENT_DIRECTORY =
  path.dirname(
    CURRENT_FILE,
  );

const BACKEND_ROOT =
  path.resolve(
    CURRENT_DIRECTORY,
    '..',
  );

const PROJECT_ROOT =
  path.resolve(
    BACKEND_ROOT,
    '..',
  );

/*
 * Optional override for test harnesses and non-standard deployments.
 *
 * This does not change PROJECT_ROOT/BACKEND_ROOT identity.
 */
const ENVIRONMENT_ROOT =
  path.resolve(
    process.env.TITECH_ENV_ROOT ||
      BACKEND_ROOT,
  );

const ENVIRONMENT_SEARCH_ROOTS =
  Object.freeze([
    ENVIRONMENT_ROOT,
    PROJECT_ROOT,
  ]);

// =============================================================================
// CONSTANTS
// =============================================================================

const NODE_ENVIRONMENTS =
  Object.freeze([
    'development',
    'test',
    'staging',
    'production',
  ]);

const NODE_ENV_ALIASES =
  Object.freeze({
    dev: 'development',
    development: 'development',

    test: 'test',

    stage: 'staging',
    staging: 'staging',

    prod: 'production',
    production: 'production',
  });

const TRUE_VALUES = new Set([
  '1',
  'true',
  'yes',
  'on',
  'enabled',
]);

const FALSE_VALUES = new Set([
  '0',
  'false',
  'no',
  'off',
  'disabled',
]);

const LOG_LEVELS =
  Object.freeze([
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
    'silent',
  ]);

const JWT_ALGORITHMS =
  Object.freeze([
    'HS256',
    'HS384',
    'HS512',
  ]);

const URL_PROTOCOLS =
  Object.freeze([
    'http:',
    'https:',
  ]);

const MONGODB_PROTOCOLS =
  Object.freeze([
    'mongodb:',
    'mongodb+srv:',
  ]);

const REDIS_PROTOCOLS =
  Object.freeze([
    'redis:',
    'rediss:',
  ]);

const COOKIE_SAME_SITE_VALUES =
  Object.freeze([
    'strict',
    'lax',
    'none',
  ]);

const MIN_SECRET_LENGTH = 32;

const DEFAULTS =
  Object.freeze({
    NODE_ENV:
      'development',

    APP_NAME:
      'TITech Community Capital LTD',

    APP_SHORT_NAME:
      'TITech',

    SERVICE_NAME:
      'titech-community-capital-backend',

    APP_VERSION:
      '1.0.0',

    HOST:
      '0.0.0.0',

    PORT:
      5000,

    LOG_LEVEL:
      'info',

    LOG_PRETTY:
      true,

    LOG_REDACT_SECRETS:
      true,

    ENABLE_REQUEST_LOGGING:
      true,

    TRUST_PROXY:
      0,

    CORS_ORIGINS:
      '',

    CORS_CREDENTIALS:
      true,

    CORS_MAX_AGE_SECONDS:
      86_400,

    CORS_METHODS:
      'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',

    CORS_ALLOWED_HEADERS:
      'Accept,Authorization,Content-Type,Idempotency-Key,X-Request-ID,X-Correlation-ID',

    BODY_LIMIT:
      '1mb',

    JSON_LIMIT:
      '1mb',

    URLENCODED_LIMIT:
      '1mb',

    REQUEST_TIMEOUT_MS:
      60_000,

    HEADERS_TIMEOUT_MS:
      70_000,

    KEEP_ALIVE_TIMEOUT_MS:
      65_000,

    SOCKET_TIMEOUT_MS:
      65_000,

    SHUTDOWN_TIMEOUT_MS:
      30_000,

    MONGODB_ENABLED:
      true,

    MONGODB_MAX_POOL_SIZE:
      20,

    MONGODB_MIN_POOL_SIZE:
      5,

    MONGODB_SERVER_SELECTION_TIMEOUT_MS:
      10_000,

    MONGODB_SOCKET_TIMEOUT_MS:
      45_000,

    MONGODB_CONNECT_TIMEOUT_MS:
      10_000,

    REDIS_ENABLED:
      true,

    REDIS_KEY_PREFIX:
      'titech:',

    REDIS_CONNECT_TIMEOUT_MS:
      10_000,

    REDIS_MAX_RETRIES:
      3,

    QUEUE_ENABLED:
      true,

    QUEUE_PREFIX:
      'titech',

    QUEUE_DEFAULT_ATTEMPTS:
      3,

    QUEUE_BACKOFF_DELAY_MS:
      1_000,

    IDEMPOTENCY_ENABLED:
      true,

    IDEMPOTENCY_TTL_SECONDS:
      86_400,

    IDEMPOTENCY_HEADER_NAME:
      'Idempotency-Key',

    IDEMPOTENCY_LOCK_TIMEOUT_MS:
      30_000,

    JWT_ISSUER:
      'titech-community-capital',

    JWT_AUDIENCE:
      'titech-community-capital-api',

    JWT_ACCESS_EXPIRES_IN:
      '15m',

    JWT_REFRESH_EXPIRES_IN:
      '30d',

    JWT_ALGORITHM:
      'HS256',

    PASSWORD_MIN_LENGTH:
      12,

    ENABLE_SWAGGER:
      false,

    ENABLE_GRAPHQL:
      false,

    ENABLE_METRICS:
      true,

    ENABLE_HEALTH_CHECKS:
      true,

    ENABLE_TRACING:
      false,

    ENABLE_CSRF:
      false,

    ENABLE_RATE_LIMITING:
      true,

    RATE_LIMIT_WINDOW_MS:
      60_000,

    RATE_LIMIT_MAX:
      100,

    TLS_ENABLED:
      false,

    TLS_REJECT_UNAUTHORIZED:
      true,

    COOKIE_SECURE:
      false,

    COOKIE_HTTP_ONLY:
      true,

    COOKIE_SAME_SITE:
      'lax',

    COOKIE_PATH:
      '/',

    COMPRESSION_ENABLED:
      true,

    GRACEFUL_SHUTDOWN:
      true,

    EMAIL_ENABLED:
      false,

    EMAIL_PORT:
      587,

    PROMETHEUS_PORT:
      9090,

    REQUIRE_TLS:
      false,

    ALLOW_INSECURE_AUTH:
      false,

    BCRYPT_SALT_ROUNDS:
      12,
  });

// =============================================================================
// ERROR TYPE
// =============================================================================

class EnvironmentError extends Error {
  constructor(
    message,
    details = {},
    cause = null,
  ) {
    super(
      message,
      cause
        ? { cause }
        : undefined,
    );

    this.name =
      'EnvironmentError';

    this.code =
      details.code ||
      'INVALID_ENVIRONMENT';

    this.details =
      Object.freeze({
        ...details,
        code: undefined,
      });

    Error.captureStackTrace?.(
      this,
      EnvironmentError,
    );
  }
}

// =============================================================================
// GENERAL UTILITIES
// =============================================================================

function hasOwn(
  object,
  key,
) {
  return Object.prototype.hasOwnProperty.call(
    object,
    key,
  );
}

function isBlank(
  value,
) {
  return (
    value === undefined ||
    value === null ||
    String(value).trim() === ''
  );
}

function cleanString(
  value,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return '';
  }

  return String(value)
    .replace(
      /^\uFEFF/,
      '',
    )
    .trim()
    .replace(
      /^(['"])(.*)\1$/s,
      '$2',
    )
    .trim();
}

function normalizeString(
  value,
  fallback = undefined,
) {
  const normalized =
    cleanString(value);

  return normalized ||
    fallback;
}

function normalizeLowerCase(
  value,
  fallback = undefined,
) {
  const normalized =
    normalizeString(
      value,
      fallback,
    );

  return normalized === undefined
    ? undefined
    : normalized.toLowerCase();
}

function normalizeUpperCase(
  value,
  fallback = undefined,
) {
  const normalized =
    normalizeString(
      value,
      fallback,
    );

  return normalized === undefined
    ? undefined
    : normalized.toUpperCase();
}

function firstEnvironmentValue(
  names,
  fallback = undefined,
) {
  for (
    const name of names
  ) {
    const value =
      process.env[name];

    if (
      !isBlank(value)
    ) {
      return value;
    }
  }

  return fallback;
}

// =============================================================================
// NODE_ENV
// =============================================================================

function normalizeNodeEnvironment(
  value,
  fallback =
    DEFAULTS.NODE_ENV,
) {
  const normalized =
    normalizeLowerCase(
      value,
      fallback,
    );

  return (
    NODE_ENV_ALIASES[
      normalized
    ] ||
    normalized
  );
}

// =============================================================================
// PARSERS
// =============================================================================

function parseBoolean(
  value,
  fallback = undefined,
  variableName = 'UNKNOWN',
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

  const normalized =
    cleanString(value)
      .toLowerCase();

  if (
    TRUE_VALUES.has(
      normalized,
    )
  ) {
    return true;
  }

  if (
    FALSE_VALUES.has(
      normalized,
    )
  ) {
    return false;
  }

  throw new EnvironmentError(
    `Environment variable "${variableName}" must be a boolean.`,
    {
      code:
        'INVALID_BOOLEAN',
      variable:
        variableName,
      expected:
        'true/false, 1/0, yes/no, on/off, enabled/disabled',
    },
  );
}

function parseInteger(
  value,
  fallback = undefined,
  {
    variableName =
      'UNKNOWN',

    min =
      undefined,

    max =
      undefined,
  } = {},
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const normalized =
    cleanString(value);

  if (
    !/^-?\d+$/.test(
      normalized,
    )
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" must be an integer.`,
      {
        code:
          'INVALID_INTEGER',
        variable:
          variableName,
      },
    );
  }

  const parsed =
    Number(normalized);

  if (
    !Number.isSafeInteger(
      parsed,
    )
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" is outside the safe integer range.`,
      {
        code:
          'INTEGER_OUT_OF_RANGE',
        variable:
          variableName,
      },
    );
  }

  if (
    min !== undefined &&
    parsed < min
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" must be >= ${min}.`,
      {
        code:
          'INTEGER_BELOW_MINIMUM',
        variable:
          variableName,
        minimum:
          min,
      },
    );
  }

  if (
    max !== undefined &&
    parsed > max
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" must be <= ${max}.`,
      {
        code:
          'INTEGER_ABOVE_MAXIMUM',
        variable:
          variableName,
        maximum:
          max,
      },
    );
  }

  return parsed;
}

/**
 * Supports:
 *
 *   1000
 *   5s
 *   2m
 *   1h
 *   1d
 */
function parseDurationMs(
  value,
  fallback = undefined,
  variableName = 'UNKNOWN',
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
    'number'
  ) {
    if (
      Number.isFinite(value) &&
      value >= 0
    ) {
      return Math.trunc(value);
    }

    throw new EnvironmentError(
      `Environment variable "${variableName}" must be a valid duration.`,
      {
        code:
          'INVALID_DURATION',
        variable:
          variableName,
      },
    );
  }

  const normalized =
    cleanString(value)
      .toLowerCase();

  if (
    /^\d+$/.test(
      normalized,
    )
  ) {
    return parseInteger(
      normalized,
      fallback,
      {
        variableName,
        min: 0,
      },
    );
  }

  const match =
    normalized.match(
      /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/,
    );

  if (!match) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" must be a valid duration.`,
      {
        code:
          'INVALID_DURATION',
        variable:
          variableName,
        expected:
          'milliseconds, ms, s, m, h or d',
      },
    );
  }

  const amount =
    Number(match[1]);

  const multipliers =
    Object.freeze({
      ms: 1,
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    });

  const result =
    amount *
    multipliers[match[2]];

  if (
    !Number.isSafeInteger(
      Math.round(result),
    )
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" exceeds the safe duration range.`,
      {
        code:
          'DURATION_OUT_OF_RANGE',
        variable:
          variableName,
      },
    );
  }

  return Math.round(result);
}

function parseList(
  value,
  fallback = [],
) {
  if (
    isBlank(value)
  ) {
    return [...fallback];
  }

  const source =
    Array.isArray(value)
      ? value
      : String(value).split(',');

  return [
    ...new Set(
      source
        .map(
          item =>
            cleanString(item),
        )
        .filter(Boolean),
    ),
  ];
}

function parseUrl(
  value,
  fallback = undefined,
  {
    variableName =
      'UNKNOWN',

    protocols = [],

    allowCredentials =
      true,

  } = {},
) {
  if (
    isBlank(value)
  ) {
    return fallback;
  }

  let parsed;

  try {
    parsed =
      new URL(
        cleanString(value),
      );
  } catch (error) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" must be a valid URL.`,
      {
        code:
          'INVALID_URL',
        variable:
          variableName,
      },
      error,
    );
  }

  if (
    protocols.length > 0 &&
    !protocols.includes(
      parsed.protocol,
    )
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" uses an unsupported protocol.`,
      {
        code:
          'UNSUPPORTED_URL_PROTOCOL',
        variable:
          variableName,
        allowedProtocols:
          protocols,
      },
    );
  }

  if (
    !allowCredentials &&
    (
      parsed.username ||
      parsed.password
    )
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" must not contain URL credentials.`,
      {
        code:
          'URL_CREDENTIALS_NOT_ALLOWED',
        variable:
          variableName,
      },
    );
  }

  return parsed.toString();
}

function parseSecret(
  value,
  {
    variableName =
      'UNKNOWN',

    required =
      false,

    minLength =
      MIN_SECRET_LENGTH,

    rejectPlaceholder =
      true,

  } = {},
) {
  const normalized =
    normalizeString(value);

  if (
    normalized === undefined
  ) {
    if (
      required
    ) {
      throw new EnvironmentError(
        `Required environment variable "${variableName}" is missing.`,
        {
          code:
            'REQUIRED_SECRET_MISSING',
          variable:
            variableName,
        },
      );
    }

    return undefined;
  }

  if (
    normalized.length <
    minLength
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" does not meet the minimum secret length.`,
      {
        code:
          'SECRET_TOO_SHORT',
        variable:
          variableName,
        minimumLength:
          minLength,
      },
    );
  }

  if (
    rejectPlaceholder &&
    /^(change[_-]?this|replace[_-]?with|your[_-]|example|supersecret|password123|secret123|changeme)/i.test(
      normalized,
    )
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" contains a placeholder or unsafe development secret.`,
      {
        code:
          'PLACEHOLDER_SECRET',
        variable:
          variableName,
      },
    );
  }

  return normalized;
}

function ensureEnum(
  value,
  allowed,
  variableName,
) {
  if (
    !allowed.includes(value)
  ) {
    throw new EnvironmentError(
      `Environment variable "${variableName}" contains an unsupported value.`,
      {
        code:
          'INVALID_ENUM',
        variable:
          variableName,
        allowed,
      },
    );
  }

  return value;
}

// =============================================================================
// DEEP FREEZE
// =============================================================================

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
    seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (
    const key of Reflect.ownKeys(
      value,
    )
  ) {
    deepFreeze(
      value[key],
      seen,
    );
  }

  Object.freeze(value);

  return value;
}

// =============================================================================
// CRYPTOGRAPHIC UTILITIES
// =============================================================================

function fingerprintSecret(
  secret,
) {
  if (
    !secret
  ) {
    return null;
  }

  return crypto
    .createHash('sha256')
    .update(
      String(secret),
      'utf8',
    )
    .digest('hex')
    .slice(
      0,
      12,
    );
}

// =============================================================================
// ENVIRONMENT FILE LOADING
// =============================================================================

let environmentFilesLoaded =
  false;

let loadedEnvironmentFiles =
  Object.freeze([]);

function normalizeEnvironmentFilePath(
  filePath,
) {
  return path.normalize(
    filePath,
  );
}

function loadEnvFile(
  filePath,
) {
  const normalizedPath =
    normalizeEnvironmentFilePath(
      filePath,
    );

  if (
    !fs.existsSync(
      normalizedPath,
    )
  ) {
    return false;
  }

  let content;

  try {
    content =
      fs.readFileSync(
        normalizedPath,
        'utf8',
      );
  } catch (error) {
    throw new EnvironmentError(
      `Unable to read environment file: ${normalizedPath}.`,
      {
        code:
          'ENV_FILE_READ_FAILED',
        file:
          normalizedPath,
      },
      error,
    );
  }

  let parsed;

  try {
    parsed =
      dotenv.parse(
        content,
      );
  } catch (error) {
    throw new EnvironmentError(
      `Unable to parse environment file: ${normalizedPath}.`,
      {
        code:
          'ENV_FILE_PARSE_FAILED',
        file:
          normalizedPath,
      },
      error,
    );
  }

  /*
   * IMPORTANT:
   *
   * process.env always has higher precedence than .env files.
   *
   * Therefore this function only assigns an environment-file value when the
   * variable has not already been explicitly injected into the process.
   */
  for (
    const [
      key,
      value,
    ] of Object.entries(parsed)
  ) {
    if (
      process.env[key] ===
      undefined
    ) {
      process.env[key] =
        value;
    }
  }

  return true;
}

function buildEnvironmentFileOrder(
  nodeEnvironment,
) {
  /*
   * Highest-priority external source:
   *
   *   process.env
   *
   * Then files from lowest → highest priority:
   *
   *   repository .env
   *   backend .env
   *   repository .env.local
   *   backend .env.local
   *   repository .env.<env>
   *   backend .env.<env>
   *   repository .env.<env>.local
   *   backend .env.<env>.local
   *
   * Because loadEnvFile() only assigns undefined process.env keys, simply
   * loading in this order means LOWER-priority values would incorrectly win.
   *
   * To make file precedence actually deterministic, loading is therefore
   * performed by first collecting all file values and then applying the
   * resulting merged map.
   */

  const order = [];

  const pushUnique =
    filePath => {
      const normalized =
        normalizeEnvironmentFilePath(
          filePath,
        );

      if (
        !order.includes(
          normalized,
        )
      ) {
        order.push(
          normalized,
        );
      }
    };

  /*
   * Lowest precedence first.
   */
  pushUnique(
    path.join(
      PROJECT_ROOT,
      '.env',
    ),
  );

  pushUnique(
    path.join(
      ENVIRONMENT_ROOT,
      '.env',
    ),
  );

  pushUnique(
    path.join(
      PROJECT_ROOT,
      '.env.local',
    ),
  );

  pushUnique(
    path.join(
      ENVIRONMENT_ROOT,
      '.env.local',
    ),
  );

  pushUnique(
    path.join(
      PROJECT_ROOT,
      `.env.${nodeEnvironment}`,
    ),
  );

  pushUnique(
    path.join(
      ENVIRONMENT_ROOT,
      `.env.${nodeEnvironment}`,
    ),
  );

  pushUnique(
    path.join(
      PROJECT_ROOT,
      `.env.${nodeEnvironment}.local`,
    ),
  );

  pushUnique(
    path.join(
      ENVIRONMENT_ROOT,
      `.env.${nodeEnvironment}.local`,
    ),
  );

  return Object.freeze(
    order,
  );
}

function parseEnvironmentFile(
  filePath,
) {
  if (
    !fs.existsSync(
      filePath,
    )
  ) {
    return null;
  }

  let content;

  try {
    content =
      fs.readFileSync(
        filePath,
        'utf8',
      );
  } catch (error) {
    throw new EnvironmentError(
      `Unable to read environment file: ${filePath}.`,
      {
        code:
          'ENV_FILE_READ_FAILED',
        file:
          filePath,
      },
      error,
    );
  }

  try {
    return dotenv.parse(
      content,
    );
  } catch (error) {
    throw new EnvironmentError(
      `Unable to parse environment file: ${filePath}.`,
      {
        code:
          'ENV_FILE_PARSE_FAILED',
        file:
          filePath,
      },
      error,
    );
  }
}

function loadDotEnv() {
  if (
    environmentFilesLoaded
  ) {
    return loadedEnvironmentFiles;
  }

  /*
   * First discover NODE_ENV from already-injected process.env.
   *
   * We intentionally do NOT load .env yet because environment-specific file
   * selection depends on NODE_ENV.
   */
  let nodeEnvironment =
    normalizeNodeEnvironment(
      process.env.NODE_ENV,
      DEFAULTS.NODE_ENV,
    );

  if (
    !NODE_ENVIRONMENTS.includes(
      nodeEnvironment,
    )
  ) {
    throw new EnvironmentError(
      `Invalid NODE_ENV "${nodeEnvironment}".`,
      {
        code:
          'INVALID_NODE_ENV',
        variable:
          'NODE_ENV',
        allowed:
          NODE_ENVIRONMENTS,
      },
    );
  }

  /*
   * When NODE_ENV was not explicitly supplied, inspect only the base files to
   * discover it.
   */
  if (
    isBlank(
      process.env.NODE_ENV,
    )
  ) {
    const baseCandidates =
      Object.freeze([
        path.join(
          PROJECT_ROOT,
          '.env',
        ),

        path.join(
          ENVIRONMENT_ROOT,
          '.env',
        ),
      ]);

    for (
      const filePath of
        baseCandidates
    ) {
      const parsed =
        parseEnvironmentFile(
          filePath,
        );

      if (
        parsed?.NODE_ENV &&
        isBlank(
          process.env.NODE_ENV,
        )
      ) {
        nodeEnvironment =
          normalizeNodeEnvironment(
            parsed.NODE_ENV,
            DEFAULTS.NODE_ENV,
          );

        break;
      }
    }
  }

  if (
    !NODE_ENVIRONMENTS.includes(
      nodeEnvironment,
    )
  ) {
    throw new EnvironmentError(
      `Invalid NODE_ENV "${nodeEnvironment}".`,
      {
        code:
          'INVALID_NODE_ENV',
        variable:
          'NODE_ENV',
        allowed:
          NODE_ENVIRONMENTS,
      },
    );
  }

  /*
   * Explicitly injected NODE_ENV wins over every file.
   */
  process.env.NODE_ENV =
    nodeEnvironment;

  const fileOrder =
    buildEnvironmentFileOrder(
      nodeEnvironment,
    );

  const merged =
    Object.create(null);

  const loaded = [];

  /*
   * Merge file values from LOWEST → HIGHEST precedence.
   *
   * The backend root is later than the repository root and therefore wins.
   */
  for (
    const filePath of
      fileOrder
  ) {
    const parsed =
      parseEnvironmentFile(
        filePath,
      );

    if (!parsed) {
      continue;
    }

    loaded.push(
      filePath,
    );

    Object.assign(
      merged,
      parsed,
    );
  }

  /*
   * Finally apply only values which were not explicitly supplied through the
   * process environment.
   */
  for (
    const [
      key,
      value,
    ] of Object.entries(
      merged,
    )
  ) {
    if (
      process.env[key] ===
      undefined
    ) {
      process.env[key] =
        value;
    }
  }

  /*
   * Re-canonicalize NODE_ENV after merging files.
   */
  nodeEnvironment =
    normalizeNodeEnvironment(
      process.env.NODE_ENV,
      DEFAULTS.NODE_ENV,
    );

  ensureEnum(
    nodeEnvironment,
    NODE_ENVIRONMENTS,
    'NODE_ENV',
  );

  process.env.NODE_ENV =
    nodeEnvironment;

  environmentFilesLoaded =
    true;

  loadedEnvironmentFiles =
    Object.freeze(
      [
        ...new Set(
          loaded,
        ),
      ],
    );

  return loadedEnvironmentFiles;
}

// =============================================================================
// BUILD ENVIRONMENT
// =============================================================================

function buildEnvironment() {
  loadDotEnv();

  const nodeEnv =
    normalizeNodeEnvironment(
      process.env.NODE_ENV,
      DEFAULTS.NODE_ENV,
    );

  ensureEnum(
    nodeEnv,
    NODE_ENVIRONMENTS,
    'NODE_ENV',
  );

  process.env.NODE_ENV =
    nodeEnv;

  const isDevelopment =
    nodeEnv ===
    'development';

  const isTest =
    nodeEnv === 'test';

  const isStaging =
    nodeEnv ===
    'staging';

  const isProduction =
    nodeEnv ===
    'production';

  // ---------------------------------------------------------------------------
  // Backward-compatible aliases
  // ---------------------------------------------------------------------------

  const mongoUriRaw =
    firstEnvironmentValue([
      'MONGODB_URI',
      'MONGO_URI',
      'MONGO_URL',
    ]);

  const mongoDatabaseRaw =
    firstEnvironmentValue([
      'MONGODB_DATABASE',
      'MONGODB_DB_NAME',
      'MONGO_DB_NAME',
      'DB_NAME',
    ]);

  const redisUrlRaw =
    firstEnvironmentValue([
      'REDIS_URL',
      'REDIS_URI',
    ]);

  const jwtAccessSecretRaw =
    firstEnvironmentValue([
      'JWT_ACCESS_SECRET',
      'JWT_SECRET',
    ]);

  const jwtRefreshSecretRaw =
    firstEnvironmentValue([
      'JWT_REFRESH_SECRET',
      'REFRESH_TOKEN_SECRET',
    ]);

  const securityEncryptionKeyRaw =
    firstEnvironmentValue([
      'SECURITY_ENCRYPTION_KEY',
      'ENCRYPTION_KEY',
    ]);

  const corsOriginsRaw =
    firstEnvironmentValue([
      'CORS_ORIGINS',
      'CLIENT_ORIGIN',
    ]);

  // ---------------------------------------------------------------------------
  // Core environment
  // ---------------------------------------------------------------------------

  const environment = {
    app: {
      name:
        normalizeString(
          process.env.APP_NAME,
          DEFAULTS.APP_NAME,
        ),

      shortName:
        normalizeString(
          process.env.APP_SHORT_NAME,
          DEFAULTS.APP_SHORT_NAME,
        ),

      serviceName:
        normalizeString(
          process.env.SERVICE_NAME,
          DEFAULTS.SERVICE_NAME,
        ),

      version:
        normalizeString(
          process.env.APP_VERSION ||
            process.env.npm_package_version,
          DEFAULTS.APP_VERSION,
        ),

      environment:
        nodeEnv,

      nodeEnv,
    },

    runtime: {
      nodeVersion:
        process.version,

      nodeMajor:
        Number(
          process.versions.node
            .split('.')[0],
        ),

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
        os.cpus?.().length ||
        1,

      memoryBytes:
        os.totalmem?.() ||
        null,

      workingDirectory:
        process.cwd(),

      backendRoot:
        BACKEND_ROOT,

      projectRoot:
        PROJECT_ROOT,

      environmentRoot:
        ENVIRONMENT_ROOT,

      isDevelopment,

      isTest,

      isStaging,

      isProduction,
    },

    http: {
      host:
        normalizeString(
          process.env.HOST,
          DEFAULTS.HOST,
        ),

      port:
        parseInteger(
          process.env.PORT,
          DEFAULTS.PORT,
          {
            variableName:
              'PORT',
            min:
              1,
            max:
              65_535,
          },
        ),

      trustProxy:
        parseInteger(
          process.env.TRUST_PROXY,
          DEFAULTS.TRUST_PROXY,
          {
            variableName:
              'TRUST_PROXY',
            min:
              0,
            max:
              100,
          },
        ),

      bodyLimit:
        normalizeString(
          process.env.BODY_LIMIT,
          DEFAULTS.BODY_LIMIT,
        ),

      jsonLimit:
        normalizeString(
          process.env.JSON_LIMIT,
          DEFAULTS.JSON_LIMIT,
        ),

      urlencodedLimit:
        normalizeString(
          process.env.URLENCODED_LIMIT,
          DEFAULTS.URLENCODED_LIMIT,
        ),

      requestTimeoutMs:
        parseDurationMs(
          firstEnvironmentValue([
            'REQUEST_TIMEOUT_MS',
            'HTTP_REQUEST_TIMEOUT_MS',
          ]),
          DEFAULTS.REQUEST_TIMEOUT_MS,
          'REQUEST_TIMEOUT_MS',
        ),

      headersTimeoutMs:
        parseDurationMs(
          firstEnvironmentValue([
            'HEADERS_TIMEOUT_MS',
            'HTTP_HEADERS_TIMEOUT_MS',
          ]),
          DEFAULTS.HEADERS_TIMEOUT_MS,
          'HEADERS_TIMEOUT_MS',
        ),

      keepAliveTimeoutMs:
        parseDurationMs(
          firstEnvironmentValue([
            'KEEP_ALIVE_TIMEOUT_MS',
            'HTTP_KEEP_ALIVE_TIMEOUT_MS',
          ]),
          DEFAULTS.KEEP_ALIVE_TIMEOUT_MS,
          'KEEP_ALIVE_TIMEOUT_MS',
        ),

      socketTimeoutMs:
        parseDurationMs(
          process.env.SOCKET_TIMEOUT_MS,
          DEFAULTS.SOCKET_TIMEOUT_MS,
          'SOCKET_TIMEOUT_MS',
        ),

      shutdownTimeoutMs:
        parseDurationMs(
          firstEnvironmentValue([
            'SHUTDOWN_TIMEOUT_MS',
            'GRACEFUL_SHUTDOWN_TIMEOUT_MS',
          ]),
          DEFAULTS.SHUTDOWN_TIMEOUT_MS,
          'SHUTDOWN_TIMEOUT_MS',
        ),
    },

    logging: {
      level:
        ensureEnum(
          normalizeLowerCase(
            process.env.LOG_LEVEL,
            DEFAULTS.LOG_LEVEL,
          ),
          LOG_LEVELS,
          'LOG_LEVEL',
        ),

      enabled:
        parseBoolean(
          process.env.ENABLE_REQUEST_LOGGING,
          DEFAULTS.ENABLE_REQUEST_LOGGING,
          'ENABLE_REQUEST_LOGGING',
        ),

      pretty:
        parseBoolean(
          process.env.LOG_PRETTY,
          isDevelopment,
          'LOG_PRETTY',
        ),

      redactSecrets:
        parseBoolean(
          process.env.LOG_REDACT_SECRETS,
          DEFAULTS.LOG_REDACT_SECRETS,
          'LOG_REDACT_SECRETS',
        ),

      directory:
        normalizeString(
          process.env.LOG_DIR,
          'logs',
        ),
    },

    observability: {
      metricsEnabled:
        parseBoolean(
          firstEnvironmentValue([
            'ENABLE_METRICS',
            'PROMETHEUS_ENABLED',
          ]),
          DEFAULTS.ENABLE_METRICS,
          'ENABLE_METRICS',
        ),

      healthChecksEnabled:
        parseBoolean(
          process.env.ENABLE_HEALTH_CHECKS,
          DEFAULTS.ENABLE_HEALTH_CHECKS,
          'ENABLE_HEALTH_CHECKS',
        ),

      tracingEnabled:
        parseBoolean(
          firstEnvironmentValue([
            'ENABLE_TRACING',
            'OTEL_ENABLED',
          ]),
          DEFAULTS.ENABLE_TRACING,
          'ENABLE_TRACING',
        ),

      metricsPort:
        parseInteger(
          firstEnvironmentValue([
            'METRICS_PORT',
            'PROMETHEUS_PORT',
          ]),
          DEFAULTS.PROMETHEUS_PORT,
          {
            variableName:
              'METRICS_PORT',
            min:
              1,
            max:
              65_535,
          },
        ),

      otelEndpoint:
        parseUrl(
          firstEnvironmentValue([
            'OTEL_EXPORTER_OTLP_ENDPOINT',
            'OTEL_ENDPOINT',
          ]),
          undefined,
          {
            variableName:
              'OTEL_EXPORTER_OTLP_ENDPOINT',
            protocols:
              URL_PROTOCOLS,
            allowCredentials:
              false,
          },
        ),

      serviceName:
        normalizeString(
          process.env.OTEL_SERVICE_NAME ||
            process.env.SERVICE_NAME,
          DEFAULTS.SERVICE_NAME,
        ),
    },

    database: {
      mongodb: {
        enabled:
          parseBoolean(
            process.env.MONGODB_ENABLED,
            DEFAULTS.MONGODB_ENABLED,
            'MONGODB_ENABLED',
          ),

        uri:
          parseUrl(
            mongoUriRaw,
            undefined,
            {
              variableName:
                'MONGODB_URI',
              protocols:
                MONGODB_PROTOCOLS,
              allowCredentials:
                true,
            },
          ),

        databaseName:
          normalizeString(
            mongoDatabaseRaw,
            undefined,
          ),

        maxPoolSize:
          parseInteger(
            process.env.MONGODB_MAX_POOL_SIZE,
            DEFAULTS.MONGODB_MAX_POOL_SIZE,
            {
              variableName:
                'MONGODB_MAX_POOL_SIZE',
              min:
                1,
              max:
                1_000,
            },
          ),

        minPoolSize:
          parseInteger(
            process.env.MONGODB_MIN_POOL_SIZE,
            DEFAULTS.MONGODB_MIN_POOL_SIZE,
            {
              variableName:
                'MONGODB_MIN_POOL_SIZE',
              min:
                0,
              max:
                1_000,
            },
          ),

        serverSelectionTimeoutMs:
          parseDurationMs(
            process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
            DEFAULTS.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
            'MONGODB_SERVER_SELECTION_TIMEOUT_MS',
          ),

        socketTimeoutMs:
          parseDurationMs(
            process.env.MONGODB_SOCKET_TIMEOUT_MS,
            DEFAULTS.MONGODB_SOCKET_TIMEOUT_MS,
            'MONGODB_SOCKET_TIMEOUT_MS',
          ),

        connectTimeoutMs:
          parseDurationMs(
            process.env.MONGODB_CONNECT_TIMEOUT_MS,
            DEFAULTS.MONGODB_CONNECT_TIMEOUT_MS,
            'MONGODB_CONNECT_TIMEOUT_MS',
          ),
      },
    },

    redis: {
      enabled:
        parseBoolean(
          process.env.REDIS_ENABLED,
          DEFAULTS.REDIS_ENABLED,
          'REDIS_ENABLED',
        ),

      url:
        parseUrl(
          redisUrlRaw,
          undefined,
          {
            variableName:
              'REDIS_URL',
            protocols:
              REDIS_PROTOCOLS,
            allowCredentials:
              true,
          },
        ),

      keyPrefix:
        normalizeString(
          process.env.REDIS_KEY_PREFIX,
          DEFAULTS.REDIS_KEY_PREFIX,
        ),

      connectTimeoutMs:
        parseDurationMs(
          process.env.REDIS_CONNECT_TIMEOUT_MS,
          DEFAULTS.REDIS_CONNECT_TIMEOUT_MS,
          'REDIS_CONNECT_TIMEOUT_MS',
        ),

      maxRetries:
        parseInteger(
          process.env.REDIS_MAX_RETRIES,
          DEFAULTS.REDIS_MAX_RETRIES,
          {
            variableName:
              'REDIS_MAX_RETRIES',
            min:
              0,
            max:
              100,
          },
        ),

      logging:
        parseBoolean(
          process.env.REDIS_ENABLE_LOGGING,
          false,
          'REDIS_ENABLE_LOGGING',
        ),

      reconnectOnError:
        parseBoolean(
          process.env.REDIS_RECONNECT_ON_ERROR,
          true,
          'REDIS_RECONNECT_ON_ERROR',
        ),
    },

    security: {
      encryptionKey:
        parseSecret(
          securityEncryptionKeyRaw,
          {
            variableName:
              'SECURITY_ENCRYPTION_KEY',
            required:
              isProduction,
            minLength:
              MIN_SECRET_LENGTH,
          },
        ),

      passwordMinLength:
        parseInteger(
          process.env.PASSWORD_MIN_LENGTH,
          DEFAULTS.PASSWORD_MIN_LENGTH,
          {
            variableName:
              'PASSWORD_MIN_LENGTH',
            min:
              8,
            max:
              128,
          },
        ),

      bcryptSaltRounds:
        parseInteger(
          process.env.BCRYPT_SALT_ROUNDS,
          DEFAULTS.BCRYPT_SALT_ROUNDS,
          {
            variableName:
              'BCRYPT_SALT_ROUNDS',
            min:
              10,
            max:
              16,
          },
        ),

      requireTls:
        parseBoolean(
          process.env.REQUIRE_TLS,
          isProduction ||
            DEFAULTS.REQUIRE_TLS,
          'REQUIRE_TLS',
        ),

      allowInsecureAuth:
        parseBoolean(
          process.env.ALLOW_INSECURE_AUTH,
          isDevelopment ||
            isTest,
          'ALLOW_INSECURE_AUTH',
        ),

      enableCsrf:
        parseBoolean(
          process.env.ENABLE_CSRF,
          DEFAULTS.ENABLE_CSRF,
          'ENABLE_CSRF',
        ),
    },

    jwt: {
      accessSecret:
        parseSecret(
          jwtAccessSecretRaw,
          {
            variableName:
              'JWT_ACCESS_SECRET',
            required:
              isProduction,
            minLength:
              MIN_SECRET_LENGTH,
          },
        ),

      refreshSecret:
        parseSecret(
          jwtRefreshSecretRaw,
          {
            variableName:
              'JWT_REFRESH_SECRET',
            required:
              isProduction,
            minLength:
              MIN_SECRET_LENGTH,
          },
        ),

      issuer:
        normalizeString(
          process.env.JWT_ISSUER,
          DEFAULTS.JWT_ISSUER,
        ),

      audience:
        normalizeString(
          process.env.JWT_AUDIENCE,
          DEFAULTS.JWT_AUDIENCE,
        ),

      accessExpiresIn:
        normalizeString(
          process.env.JWT_ACCESS_EXPIRES_IN,
          DEFAULTS.JWT_ACCESS_EXPIRES_IN,
        ),

      refreshExpiresIn:
        normalizeString(
          process.env.JWT_REFRESH_EXPIRES_IN,
          DEFAULTS.JWT_REFRESH_EXPIRES_IN,
        ),

      algorithm:
        ensureEnum(
          normalizeUpperCase(
            process.env.JWT_ALGORITHM,
            DEFAULTS.JWT_ALGORITHM,
          ),
          JWT_ALGORITHMS,
          'JWT_ALGORITHM',
        ),
    },

    cors: {
      origins:
        parseList(
          corsOriginsRaw,
          isDevelopment
            ? [
                'http://localhost:3000',
                'http://localhost:5173',
              ]
            : [],
        ),

      methods:
        parseList(
          process.env.CORS_METHODS,
          DEFAULTS.CORS_METHODS.split(','),
        ),

      allowedHeaders:
        parseList(
          firstEnvironmentValue([
            'CORS_ALLOWED_HEADERS',
            'CORS_HEADERS',
          ]),
          DEFAULTS.CORS_ALLOWED_HEADERS.split(','),
        ),

      credentials:
        parseBoolean(
          firstEnvironmentValue([
            'CORS_CREDENTIALS',
            'CORS_ALLOW_CREDENTIALS',
          ]),
          DEFAULTS.CORS_CREDENTIALS,
          'CORS_CREDENTIALS',
        ),

      maxAgeSeconds:
        parseInteger(
          process.env.CORS_MAX_AGE_SECONDS,
          DEFAULTS.CORS_MAX_AGE_SECONDS,
          {
            variableName:
              'CORS_MAX_AGE_SECONDS',
            min:
              0,
            max:
              86_400,
          },
        ),
    },

    rateLimit: {
      enabled:
        parseBoolean(
          firstEnvironmentValue([
            'ENABLE_RATE_LIMITING',
            'ENABLE_RATE_LIMIT',
          ]),
          DEFAULTS.ENABLE_RATE_LIMITING,
          'ENABLE_RATE_LIMITING',
        ),

      windowMs:
        parseDurationMs(
          process.env.RATE_LIMIT_WINDOW_MS,
          DEFAULTS.RATE_LIMIT_WINDOW_MS,
          'RATE_LIMIT_WINDOW_MS',
        ),

      max:
        parseInteger(
          firstEnvironmentValue([
            'RATE_LIMIT_MAX',
            'RATE_LIMIT_MAX_REQUESTS',
          ]),
          DEFAULTS.RATE_LIMIT_MAX,
          {
            variableName:
              'RATE_LIMIT_MAX',
            min:
              1,
            max:
              1_000_000,
          },
        ),
    },

    idempotency: {
      enabled:
        parseBoolean(
          process.env.IDEMPOTENCY_ENABLED,
          DEFAULTS.IDEMPOTENCY_ENABLED,
          'IDEMPOTENCY_ENABLED',
        ),

      ttlSeconds:
        parseInteger(
          firstEnvironmentValue([
            'IDEMPOTENCY_TTL_SECONDS',
            'IDEMPOTENCY_TTL',
          ]),
          DEFAULTS.IDEMPOTENCY_TTL_SECONDS,
          {
            variableName:
              'IDEMPOTENCY_TTL_SECONDS',
            min:
              60,
            max:
              7 * 86_400,
          },
        ),

      headerName:
        normalizeString(
          process.env.IDEMPOTENCY_HEADER_NAME,
          DEFAULTS.IDEMPOTENCY_HEADER_NAME,
        ),

      lockTimeoutMs:
        parseDurationMs(
          process.env.IDEMPOTENCY_LOCK_TIMEOUT_MS,
          DEFAULTS.IDEMPOTENCY_LOCK_TIMEOUT_MS,
          'IDEMPOTENCY_LOCK_TIMEOUT_MS',
        ),
    },

    cookie: {
      secure:
        parseBoolean(
          process.env.COOKIE_SECURE,
          isProduction ||
            DEFAULTS.COOKIE_SECURE,
          'COOKIE_SECURE',
        ),

      httpOnly:
        parseBoolean(
          process.env.COOKIE_HTTP_ONLY,
          DEFAULTS.COOKIE_HTTP_ONLY,
          'COOKIE_HTTP_ONLY',
        ),

      sameSite:
        ensureEnum(
          normalizeLowerCase(
            process.env.COOKIE_SAME_SITE,
            DEFAULTS.COOKIE_SAME_SITE,
          ),
          COOKIE_SAME_SITE_VALUES,
          'COOKIE_SAME_SITE',
        ),

      domain:
        normalizeString(
          process.env.COOKIE_DOMAIN,
          undefined,
        ),

      path:
        normalizeString(
          process.env.COOKIE_PATH,
          DEFAULTS.COOKIE_PATH,
        ),
    },

    tls: {
      enabled:
        parseBoolean(
          process.env.TLS_ENABLED,
          DEFAULTS.TLS_ENABLED,
          'TLS_ENABLED',
        ),

      keyPath:
        normalizeString(
          process.env.TLS_KEY_PATH,
          undefined,
        ),

      certPath:
        normalizeString(
          process.env.TLS_CERT_PATH,
          undefined,
        ),

      caPath:
        normalizeString(
          process.env.TLS_CA_PATH,
          undefined,
        ),

      rejectUnauthorized:
        parseBoolean(
          process.env.TLS_REJECT_UNAUTHORIZED,
          DEFAULTS.TLS_REJECT_UNAUTHORIZED,
          'TLS_REJECT_UNAUTHORIZED',
        ),
    },

    features: {
      swaggerEnabled:
        parseBoolean(
          process.env.ENABLE_SWAGGER,
          DEFAULTS.ENABLE_SWAGGER,
          'ENABLE_SWAGGER',
        ),

      graphqlEnabled:
        parseBoolean(
          process.env.ENABLE_GRAPHQL,
          DEFAULTS.ENABLE_GRAPHQL,
          'ENABLE_GRAPHQL',
        ),

      healthChecksEnabled:
        parseBoolean(
          process.env.ENABLE_HEALTH_CHECKS,
          DEFAULTS.ENABLE_HEALTH_CHECKS,
          'ENABLE_HEALTH_CHECKS',
        ),

      gracefulShutdown:
        parseBoolean(
          firstEnvironmentValue([
            'GRACEFUL_SHUTDOWN',
            'ENABLE_GRACEFUL_SHUTDOWN',
          ]),
          DEFAULTS.GRACEFUL_SHUTDOWN,
          'GRACEFUL_SHUTDOWN',
        ),

      compressionEnabled:
        parseBoolean(
          process.env.COMPRESSION_ENABLED,
          DEFAULTS.COMPRESSION_ENABLED,
          'COMPRESSION_ENABLED',
        ),

      emailEnabled:
        parseBoolean(
          process.env.EMAIL_ENABLED,
          DEFAULTS.EMAIL_ENABLED,
          'EMAIL_ENABLED',
        ),
    },

    email: {
      enabled:
        parseBoolean(
          process.env.EMAIL_ENABLED,
          DEFAULTS.EMAIL_ENABLED,
          'EMAIL_ENABLED',
        ),

      host:
        normalizeString(
          process.env.EMAIL_HOST,
          undefined,
        ),

      port:
        parseInteger(
          process.env.EMAIL_PORT,
          DEFAULTS.EMAIL_PORT,
          {
            variableName:
              'EMAIL_PORT',
            min:
              1,
            max:
              65_535,
          },
        ),

      user:
        normalizeString(
          process.env.EMAIL_USER,
          undefined,
        ),

      password:
        normalizeString(
          process.env.EMAIL_PASSWORD,
          undefined,
        ),

      from:
        normalizeString(
          process.env.EMAIL_FROM,
          undefined,
        ),
    },

    payments: {
      stripeEnabled:
        parseBoolean(
          process.env.STRIPE_ENABLED,
          false,
          'STRIPE_ENABLED',
        ),

      flutterwaveEnabled:
        parseBoolean(
          process.env.FLUTTERWAVE_ENABLED,
          false,
          'FLUTTERWAVE_ENABLED',
        ),

      paystackEnabled:
        parseBoolean(
          process.env.PAYSTACK_ENABLED,
          false,
          'PAYSTACK_ENABLED',
        ),
    },

    mobileMoney: {
      mtnEnabled:
        parseBoolean(
          process.env.MTN_MOMO_ENABLED,
          false,
          'MTN_MOMO_ENABLED',
        ),

      airtelEnabled:
        parseBoolean(
          process.env.AIRTEL_MONEY_ENABLED,
          false,
          'AIRTEL_MONEY_ENABLED',
        ),
    },

    queue: {
      enabled:
        parseBoolean(
          process.env.QUEUE_ENABLED,
          DEFAULTS.QUEUE_ENABLED,
          'QUEUE_ENABLED',
        ),

      prefix:
        normalizeString(
          process.env.QUEUE_PREFIX,
          DEFAULTS.QUEUE_PREFIX,
        ),

      defaultAttempts:
        parseInteger(
          process.env.QUEUE_DEFAULT_ATTEMPTS,
          DEFAULTS.QUEUE_DEFAULT_ATTEMPTS,
          {
            variableName:
              'QUEUE_DEFAULT_ATTEMPTS',
            min:
              1,
            max:
              100,
          },
        ),

      backoffDelayMs:
        parseDurationMs(
          process.env.QUEUE_BACKOFF_DELAY_MS,
          DEFAULTS.QUEUE_BACKOFF_DELAY_MS,
          'QUEUE_BACKOFF_DELAY_MS',
        ),
    },

    urls: {
      app:
        parseUrl(
          firstEnvironmentValue([
            'APP_URL',
            'FRONTEND_URL',
          ]),
          undefined,
          {
            variableName:
              'APP_URL',
            protocols:
              URL_PROTOCOLS,
            allowCredentials:
              false,
          },
        ),

      api:
        parseUrl(
          firstEnvironmentValue([
            'API_URL',
            'BACKEND_URL',
          ]),
          undefined,
          {
            variableName:
              'API_URL',
            protocols:
              URL_PROTOCOLS,
            allowCredentials:
              false,
          },
        ),

      frontend:
        parseUrl(
          firstEnvironmentValue([
            'FRONTEND_URL',
            'CLIENT_ORIGIN',
          ]),
          undefined,
          {
            variableName:
              'FRONTEND_URL',
            protocols:
              URL_PROTOCOLS,
            allowCredentials:
              false,
          },
        ),
    },

    deployment: {
      environment:
        nodeEnv,

      region:
        normalizeString(
          firstEnvironmentValue([
            'DEPLOYMENT_REGION',
            'AWS_REGION',
            'CLOUD_REGION',
          ]),
          undefined,
        ),

      zone:
        normalizeString(
          firstEnvironmentValue([
            'DEPLOYMENT_ZONE',
            'AVAILABILITY_ZONE',
          ]),
          undefined,
        ),

      instanceId:
        normalizeString(
          process.env.INSTANCE_ID,
          undefined,
        ),

      releaseId:
        normalizeString(
          firstEnvironmentValue([
            'RELEASE_ID',
            'RELEASE',
          ]),
          undefined,
        ),

      commitSha:
        normalizeString(
          firstEnvironmentValue([
            'COMMIT_SHA',
            'GIT_COMMIT_SHA',
          ]),
          undefined,
        ),

      containerId:
        normalizeString(
          process.env.CONTAINER_ID,
          undefined,
        ),
    },

    flags: {
      isProduction,

      isStaging,

      isDevelopment,

      isTest,
    },
  };

  // ===========================================================================
  // Canonical top-level compatibility aliases
  // ===========================================================================

  environment.application =
    environment.app.name;

  environment.applicationLegalName =
    'TITech Community Capital LTD';

  environment.serviceName =
    environment.app.serviceName;

  environment.version =
    environment.app.version;

  environment.environment =
    environment.app.environment;

  environment.nodeEnv =
    environment.app.nodeEnv;

  environment.host =
    environment.http.host;

  environment.port =
    environment.http.port;

  environment.auth = {
    jwtSecret:
      environment.jwt.accessSecret,

    refreshSecret:
      environment.jwt.refreshSecret,

    sessionSecret:
      environment.security.encryptionKey,

    accessExpiresIn:
      environment.jwt.accessExpiresIn,

    refreshExpiresIn:
      environment.jwt.refreshExpiresIn,

    bcryptRounds:
      environment.security.bcryptSaltRounds,
  };

  validateEnvironment(
    environment,
  );

  return deepFreeze(
    environment,
  );
}

// =============================================================================
// VALIDATION
// =============================================================================

function validateEnvironment(
  environment,
) {
  const errors = [];

  const nodeEnv =
    environment?.app?.nodeEnv;

  const isDevelopment =
    environment?.runtime
      ?.isDevelopment === true;

  const isTest =
    environment?.runtime
      ?.isTest === true;

  const isStaging =
    environment?.runtime
      ?.isStaging === true;

  const isProduction =
    environment?.runtime
      ?.isProduction === true;

  if (
    !NODE_ENVIRONMENTS.includes(
      nodeEnv,
    )
  ) {
    errors.push(
      'NODE_ENV must be one of: ' +
        NODE_ENVIRONMENTS.join(
          ', ',
        ),
    );
  }

  const nodeMajor =
    Number(
      environment?.runtime
        ?.nodeMajor,
    );

  if (
    Number.isInteger(nodeMajor) &&
    nodeMajor < 20
  ) {
    errors.push(
      'Node.js 20 or newer is required.',
    );
  }

  if (
    isBlank(
      environment?.app?.name,
    )
  ) {
    errors.push(
      'APP_NAME must not be empty.',
    );
  }

  if (
    isBlank(
      environment?.app?.serviceName,
    )
  ) {
    errors.push(
      'SERVICE_NAME must not be empty.',
    );
  }

  // ---------------------------------------------------------------------------
  // HTTP timeout relationships
  // ---------------------------------------------------------------------------

  if (
    environment.http.headersTimeoutMs <=
    environment.http.keepAliveTimeoutMs
  ) {
    errors.push(
      'HEADERS_TIMEOUT_MS must be greater than KEEP_ALIVE_TIMEOUT_MS.',
    );
  }

  if (
    environment.http.socketTimeoutMs <
    environment.http.requestTimeoutMs
  ) {
    errors.push(
      'SOCKET_TIMEOUT_MS must be greater than or equal to REQUEST_TIMEOUT_MS.',
    );
  }

  // ---------------------------------------------------------------------------
  // MongoDB
  // ---------------------------------------------------------------------------

  const mongo =
    environment.database.mongodb;

  if (
    mongo.enabled &&
    !mongo.uri &&
    !isTest
  ) {
    errors.push(
      'MONGODB_URI or MONGO_URI is required when MongoDB is enabled.',
    );
  }

  if (
    mongo.maxPoolSize <
    mongo.minPoolSize
  ) {
    errors.push(
      'MONGODB_MAX_POOL_SIZE must be greater than or equal to MONGODB_MIN_POOL_SIZE.',
    );
  }

  if (
    mongo.enabled &&
    !mongo.databaseName &&
    !isTest
  ) {
    errors.push(
      'MongoDB database name must be configured when MongoDB is enabled.',
    );
  }

  if (
    mongo.serverSelectionTimeoutMs >
      mongo.connectTimeoutMs
  ) {
    /*
     * This is not inherently invalid for every deployment, so we surface it
     * as a warning-like validation condition only in metadata rather than
     * failing startup.
     */
  }

  // ---------------------------------------------------------------------------
  // Redis
  // ---------------------------------------------------------------------------

  const redis =
    environment.redis;

  if (
    redis.enabled &&
    !redis.url &&
    isProduction
  ) {
    errors.push(
      'REDIS_URL is required in production when Redis is enabled.',
    );
  }

  // ---------------------------------------------------------------------------
  // JWT
  // ---------------------------------------------------------------------------

  const accessSecret =
    environment.jwt.accessSecret;

  const refreshSecret =
    environment.jwt.refreshSecret;

  if (
    accessSecret &&
    refreshSecret &&
    accessSecret ===
      refreshSecret
  ) {
    errors.push(
      'JWT access and refresh secrets must be different.',
    );
  }

  if (
    isProduction &&
    accessSecret &&
    accessSecret.length <
      MIN_SECRET_LENGTH
  ) {
    errors.push(
      'JWT access secret is too short for production.',
    );
  }

  if (
    isProduction &&
    refreshSecret &&
    refreshSecret.length <
      MIN_SECRET_LENGTH
  ) {
    errors.push(
      'JWT refresh secret is too short for production.',
    );
  }

  // ---------------------------------------------------------------------------
  // CORS
  // ---------------------------------------------------------------------------

  const origins =
    environment.cors.origins;

  if (
    origins.includes('*') &&
    environment.cors.credentials
  ) {
    errors.push(
      'Wildcard CORS cannot be combined with credentialed requests.',
    );
  }

  for (
    const origin of origins
  ) {
    if (
      origin === '*'
    ) {
      if (
        isProduction ||
        isStaging
      ) {
        errors.push(
          'Wildcard CORS origin (*) is not permitted in staging or production.',
        );
      }

      continue;
    }

    try {
      const parsed =
        new URL(origin);

      if (
        !URL_PROTOCOLS.includes(
          parsed.protocol,
        )
      ) {
        errors.push(
          `CORS_ORIGINS contains an unsupported protocol: ${origin}`,
        );
      }

      if (
        parsed.username ||
        parsed.password
      ) {
        errors.push(
          `CORS_ORIGINS must not contain credentials: ${origin}`,
        );
      }

      if (
        isBlank(
          parsed.hostname,
        )
      ) {
        errors.push(
          `CORS_ORIGINS contains an origin without a hostname: ${origin}`,
        );
      }
    } catch {
      errors.push(
        `CORS_ORIGINS contains an invalid origin: ${origin}`,
      );
    }
  }

  if (
    isProduction &&
    origins.length === 0
  ) {
    errors.push(
      'CORS_ORIGINS must contain at least one explicit origin in production.',
    );
  }

  // ---------------------------------------------------------------------------
  // Cookies
  // ---------------------------------------------------------------------------

  if (
    environment.cookie.sameSite ===
      'none' &&
    !environment.cookie.secure
  ) {
    errors.push(
      'COOKIE_SECURE must be enabled when COOKIE_SAME_SITE=none.',
    );
  }

  if (
    isProduction &&
    !environment.cookie.secure
  ) {
    errors.push(
      'COOKIE_SECURE must be enabled in production.',
    );
  }

  // ---------------------------------------------------------------------------
  // TLS
  // ---------------------------------------------------------------------------

  if (
    environment.tls.enabled
  ) {
    if (
      !environment.tls.keyPath
    ) {
      errors.push(
        'TLS_KEY_PATH is required when TLS_ENABLED=true.',
      );
    }

    if (
      !environment.tls.certPath
    ) {
      errors.push(
        'TLS_CERT_PATH is required when TLS_ENABLED=true.',
      );
    }

    if (
      environment.tls.keyPath &&
      !fs.existsSync(
        path.resolve(
          environment.tls.keyPath,
        ),
      )
    ) {
      errors.push(
        `TLS_KEY_PATH does not exist: ${environment.tls.keyPath}`,
      );
    }

    if (
      environment.tls.certPath &&
      !fs.existsSync(
        path.resolve(
          environment.tls.certPath,
        ),
      )
    ) {
      errors.push(
        `TLS_CERT_PATH does not exist: ${environment.tls.certPath}`,
      );
    }

    if (
      environment.tls.caPath &&
      !fs.existsSync(
        path.resolve(
          environment.tls.caPath,
        ),
      )
    ) {
      errors.push(
        `TLS_CA_PATH does not exist: ${environment.tls.caPath}`,
      );
    }
  }

  if (
    environment.security.requireTls &&
    !environment.tls.enabled &&
    !isProduction
  ) {
    errors.push(
      'TLS is required by configuration but TLS_ENABLED is disabled.',
    );
  }

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  if (
    isProduction &&
    !environment.rateLimit.enabled
  ) {
    errors.push(
      'Rate limiting must not be disabled in production.',
    );
  }

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  if (
    environment.idempotency.enabled &&
    environment.idempotency.ttlSeconds <
      60
  ) {
    errors.push(
      'IDEMPOTENCY_TTL_SECONDS must be at least 60 seconds.',
    );
  }

  // ---------------------------------------------------------------------------
  // Security
  // ---------------------------------------------------------------------------

  if (
    isProduction &&
    environment.security.allowInsecureAuth
  ) {
    errors.push(
      'ALLOW_INSECURE_AUTH must be disabled in production.',
    );
  }

  if (
    isProduction &&
    !environment.logging.redactSecrets
  ) {
    errors.push(
      'LOG_REDACT_SECRETS must remain enabled in production.',
    );
  }

  if (
    isProduction &&
    !environment.jwt.accessSecret
  ) {
    errors.push(
      'JWT_ACCESS_SECRET or JWT_SECRET is required in production.',
    );
  }

  if (
    isProduction &&
    !environment.jwt.refreshSecret
  ) {
    errors.push(
      'JWT_REFRESH_SECRET or REFRESH_TOKEN_SECRET is required in production.',
    );
  }

  if (
    isProduction &&
    !environment.security.encryptionKey
  ) {
    errors.push(
      'SECURITY_ENCRYPTION_KEY or ENCRYPTION_KEY is required in production.',
    );
  }

  // ---------------------------------------------------------------------------
  // Email
  // ---------------------------------------------------------------------------

  if (
    environment.email.enabled
  ) {
    if (
      !environment.email.host
    ) {
      errors.push(
        'EMAIL_HOST is required when EMAIL_ENABLED=true.',
      );
    }

    if (
      !environment.email.from
    ) {
      errors.push(
        'EMAIL_FROM is required when EMAIL_ENABLED=true.',
      );
    }

    if (
      isProduction &&
      (
        !environment.email.user ||
        !environment.email.password
      )
    ) {
      errors.push(
        'EMAIL_USER and EMAIL_PASSWORD are required in production when email is enabled.',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Feature dependencies
  // ---------------------------------------------------------------------------

  if (
    environment.features.emailEnabled !==
    environment.email.enabled
  ) {
    errors.push(
      'EMAIL_ENABLED must remain consistent across features.emailEnabled and email.enabled.',
    );
  }

  // ---------------------------------------------------------------------------
  // Production observability
  // ---------------------------------------------------------------------------

  if (
    isProduction &&
    !environment.observability.metricsEnabled
  ) {
    /*
     * Metrics are strongly recommended but may be disabled deliberately in a
     * deployment. Do not hard-fail here.
     */
  }

  // ---------------------------------------------------------------------------
  // Failure
  // ---------------------------------------------------------------------------

  if (
    errors.length > 0
  ) {
    throw new EnvironmentError(
      [
        'TITech environment validation failed:',
        ...errors.map(
          error =>
            `  - ${error}`,
        ),
      ].join('\n'),
      {
        code:
          'ENVIRONMENT_VALIDATION_FAILED',
        errorCount:
          errors.length,
      },
    );
  }

  return true;
}

// =============================================================================
// SAFE DIAGNOSTICS
// =============================================================================

function buildSafeMetadata(
  environment,
) {
  return Object.freeze({
    application:
      environment.app.name,

    applicationLegalName:
      'TITech Community Capital LTD',

    serviceName:
      environment.app.serviceName,

    version:
      environment.app.version,

    environment:
      environment.app.environment,

    nodeVersion:
      environment.runtime.nodeVersion,

    nodeMajor:
      environment.runtime.nodeMajor,

    platform:
      environment.runtime.platform,

    architecture:
      environment.runtime.architecture,

    hostname:
      environment.runtime.hostname,

    pid:
      environment.runtime.pid,

    cpuCount:
      environment.runtime.cpuCount,

    host:
      environment.http.host,

    port:
      environment.http.port,

    mongodbEnabled:
      environment.database.mongodb.enabled,

    mongodbConfigured:
      Boolean(
        environment.database.mongodb.uri,
      ),

    mongodbDatabase:
      environment.database.mongodb.databaseName ||
      null,

    redisEnabled:
      environment.redis.enabled,

    redisConfigured:
      Boolean(
        environment.redis.url,
      ),

    metricsEnabled:
      environment.observability.metricsEnabled,

    tracingEnabled:
      environment.observability.tracingEnabled,

    rateLimitingEnabled:
      environment.rateLimit.enabled,

    idempotencyEnabled:
      environment.idempotency.enabled,

    tlsEnabled:
      environment.tls.enabled,

    csrfEnabled:
      environment.security.enableCsrf,

    gracefulShutdownEnabled:
      environment.features.gracefulShutdown,

    queueEnabled:
      environment.queue.enabled,

    emailEnabled:
      environment.email.enabled,

    jwtAccessConfigured:
      Boolean(
        environment.jwt.accessSecret,
      ),

    jwtRefreshConfigured:
      Boolean(
        environment.jwt.refreshSecret,
      ),

    jwtAccessFingerprint:
      fingerprintSecret(
        environment.jwt.accessSecret,
      ),

    jwtRefreshFingerprint:
      fingerprintSecret(
        environment.jwt.refreshSecret,
      ),

    encryptionKeyConfigured:
      Boolean(
        environment.security
          .encryptionKey,
      ),

    environmentFiles:
      loadedEnvironmentFiles.map(
        filePath =>
          path.relative(
            PROJECT_ROOT,
            filePath,
          ),
      ),

    loadedAt:
      new Date().toISOString(),
  });
}

// =============================================================================
// INITIALIZATION
// =============================================================================

loadDotEnv();

const environment =
  buildEnvironment();

const safeMetadata =
  buildSafeMetadata(
    environment,
  );

const loadedEnvFiles =
  Object.freeze(
    loadedEnvironmentFiles.map(
      filePath =>
        path.relative(
          PROJECT_ROOT,
          filePath,
        ),
    ),
  );

/*
 * Authoritative immutable application environment.
 *
 * Consumers may use this object for configuration, but must not expose it
 * through diagnostics or HTTP responses because it contains credentials and
 * secret material.
 */
const publicEnvironment =
  deepFreeze({
    ...environment,

    meta:
      safeMetadata,

    loadedEnvFiles,

    projectRoot:
      PROJECT_ROOT,

    backendRoot:
      BACKEND_ROOT,

    environmentRoot:
      ENVIRONMENT_ROOT,
  });

// =============================================================================
// SAFE CONFIGURATION VIEW
// =============================================================================
//
// This is deliberately separate from getEnvironment()/getConfig().
//
// It prevents operational diagnostics from accidentally exposing:
//   - passwords
//   - JWT secrets
//   - encryption keys
//   - MongoDB credentials
//   - Redis credentials
//
// =============================================================================

function buildSafeEnvironmentView(
  source,
) {
  const safe =
    structuredClone(
      source,
    );

  /*
   * Authentication secrets.
   */
  safe.jwt.accessSecret =
    undefined;

  safe.jwt.refreshSecret =
    undefined;

  safe.auth.jwtSecret =
    undefined;

  safe.auth.refreshSecret =
    undefined;

  safe.auth.sessionSecret =
    undefined;

  /*
   * Encryption.
   */
  safe.security.encryptionKey =
    undefined;

  /*
   * Email password.
   */
  safe.email.password =
    undefined;

  /*
   * Connection credentials.
   *
   * Keep host/protocol metadata useful while removing credential components.
   */
  safe.database.mongodb.uri =
    redactUrlCredentials(
      safe.database.mongodb.uri,
    );

  safe.redis.url =
    redactUrlCredentials(
      safe.redis.url,
    );

  return deepFreeze(
    safe,
  );
}

function redactUrlCredentials(
  value,
) {
  if (
    isBlank(value)
  ) {
    return value;
  }

  try {
    const parsed =
      new URL(value);

    parsed.username =
      '';

    parsed.password =
      '';

    return parsed.toString();
  } catch {
    return '[redacted]';
  }
}

const safeEnvironment =
  buildSafeEnvironmentView(
    publicEnvironment,
  );

// =============================================================================
// ACCESSORS
// =============================================================================

function get(
  name,
  fallback = undefined,
) {
  if (
    hasOwn(
      publicEnvironment,
      name,
    )
  ) {
    return publicEnvironment[
      name
    ];
  }

  return fallback;
}

function has(
  name,
) {
  return hasOwn(
    publicEnvironment,
    name,
  );
}

function getEnvironment() {
  return publicEnvironment;
}

function getConfig() {
  return publicEnvironment;
}

function getSafeEnvironment() {
  return safeEnvironment;
}

function getSafeMetadata() {
  return publicEnvironment.meta;
}

function isProduction() {
  return Boolean(
    publicEnvironment.runtime
      .isProduction,
  );
}

function isDevelopment() {
  return Boolean(
    publicEnvironment.runtime
      .isDevelopment,
  );
}

function isTest() {
  return Boolean(
    publicEnvironment.runtime
      .isTest,
  );
}

function isStaging() {
  return Boolean(
    publicEnvironment.runtime
      .isStaging,
  );
}

// =============================================================================
// RUNTIME VALIDATION
// =============================================================================

function assertProductionSafe() {
  if (
    !publicEnvironment.runtime
      .isProduction
  ) {
    return true;
  }

  validateEnvironment(
    publicEnvironment,
  );

  return true;
}

// =============================================================================
// BOOTSTRAP CONTRACT
// =============================================================================

async function initialize(
  context = {},
) {
  validateEnvironment(
    publicEnvironment,
  );

  if (
    context &&
    typeof context ===
      'object'
  ) {
    context.environment =
      publicEnvironment;

    context.configuration =
      context.configuration ||
      publicEnvironment;

    context.config =
      context.config ||
      publicEnvironment;
  }

  return {
    environment:
      publicEnvironment,

    configuration:
      publicEnvironment,

    config:
      publicEnvironment,

    meta:
      safeMetadata,
  };
}

async function init(
  context = {},
) {
  return initialize(
    context,
  );
}

async function start(
  context = {},
) {
  return initialize(
    context,
  );
}

async function bootstrap(
  context = {},
) {
  return initialize(
    context,
  );
}

async function setup(
  context = {},
) {
  return initialize(
    context,
  );
}

// =============================================================================
// TEST SUPPORT
// =============================================================================
//
// Environment configuration is intentionally process-scoped.
//
// A true reset requires a fresh module context/process because publicEnvironment
// is immutable by design.
//
// This function therefore resets only the loader bookkeeping and is useful for
// isolated test harnesses which explicitly re-import the module.
//
// =============================================================================

function __resetForTests() {
  environmentFilesLoaded =
    false;

  loadedEnvironmentFiles =
    Object.freeze([]);

  return true;
}

// =============================================================================
// BOOTSTRAP OBJECT
// =============================================================================

const environmentBootstrap =
  Object.assign(
    async function environmentBootstrap(
      context = {},
    ) {
      return initialize(
        context,
      );
    },
    {
      environment:
        publicEnvironment,

      configuration:
        publicEnvironment,

      config:
        publicEnvironment,

      safeEnvironment:
        safeEnvironment,

      initialize,

      init,

      start,

      bootstrap,

      setup,

      getEnvironment,

      getConfig,

      getSafeEnvironment,

      get,

      has,

      isProduction,

      isDevelopment,

      isTest,

      isStaging,

      getSafeMetadata,

      assertProductionSafe,

      buildEnvironment,

      validateEnvironment,

      loadDotEnv,

      normalizeNodeEnvironment,

      EnvironmentError,

      meta:
        safeMetadata,

      loadedEnvFiles,

      projectRoot:
        PROJECT_ROOT,

      backendRoot:
        BACKEND_ROOT,

      environmentRoot:
        ENVIRONMENT_ROOT,

      environmentSearchRoots:
        ENVIRONMENT_SEARCH_ROOTS,

      resetForTests:
        __resetForTests,
    },
  );

// =============================================================================
// NAMED EXPORTS
// =============================================================================

export {
  EnvironmentError,

  DEFAULTS,

  NODE_ENVIRONMENTS,

  NODE_ENV_ALIASES,

  ENVIRONMENT_SEARCH_ROOTS,

  loadDotEnv,

  buildEnvironment,

  validateEnvironment,

  normalizeNodeEnvironment,

  getEnvironment,

  getConfig,

  getSafeEnvironment,

  get,

  has,

  getSafeMetadata,

  isProduction,

  isDevelopment,

  isTest,

  isStaging,

  initialize,

  init,

  start,

  bootstrap,

  setup,

  assertProductionSafe,

  __resetForTests,
};

export const APPLICATION_NAME =
  publicEnvironment.app.name;

export const SERVICE_NAME =
  publicEnvironment.app.serviceName;

export const VERSION =
  publicEnvironment.app.version;

export const NODE_ENV =
  publicEnvironment.app.nodeEnv;

export default environmentBootstrap;