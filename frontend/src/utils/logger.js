'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/utils/logger.js
 *
 * Purpose:
 *   Canonical frontend structured logger.
 *
 * Responsibilities:
 *   - Provide consistent info/warn/error/debug logging
 *   - Add application identity and timestamps
 *   - Deep-redact sensitive metadata
 *   - Safely serialize Error and circular values
 *   - Support environment-aware log levels
 *   - Prevent production debug noise
 *   - Provide a centralized observability integration boundary
 *
 * Non-responsibilities:
 *   - Authentication
 *   - API implementation
 *   - Financial transaction processing
 *   - Secret storage
 *   - Backend logging
 *
 * IMPORTANT:
 *
 *   Frontend logs may still contain sensitive context unless callers provide
 *   intentionally sanitized metadata. This logger applies defense-in-depth
 *   redaction but should never be treated as permission to log secrets.
 *
 * NEVER log:
 *
 *   - passwords
 *   - access tokens
 *   - refresh tokens
 *   - authorization headers
 *   - cookies
 *   - encryption keys
 *   - payment credentials
 *   - full KYC records
 *   - financial transaction payloads containing sensitive data
 *   - personally identifiable information unless explicitly required
 *
 * ============================================================================
 */

// ============================================================================
// Application identity
// ============================================================================

const SERVICE_NAME =
  'titech-community-capital-frontend';

const APP_NAME =
  'TITech Community Capital';

const APP_VERSION =
  import.meta.env.VITE_APP_VERSION ||
  '1.0.0';

const ENVIRONMENT =
  import.meta.env.MODE ||
  'development';

const IS_DEVELOPMENT =
  Boolean(import.meta.env.DEV);

const IS_PRODUCTION =
  Boolean(import.meta.env.PROD);

// ============================================================================
// Log levels
// ============================================================================

const LOG_LEVELS = Object.freeze({
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  SILENT: 50,
});

const DEFAULT_PRODUCTION_LEVEL =
  LOG_LEVELS.INFO;

const DEFAULT_DEVELOPMENT_LEVEL =
  LOG_LEVELS.DEBUG;

// ============================================================================
// Optional environment override
// ============================================================================
//
// Example:
//
// VITE_LOG_LEVEL=debug
// VITE_LOG_LEVEL=info
// VITE_LOG_LEVEL=warn
// VITE_LOG_LEVEL=error
// VITE_LOG_LEVEL=silent
//
// ============================================================================

const LOG_LEVEL_NAME =
  String(
    import.meta.env.VITE_LOG_LEVEL ||
      ''
  )
    .trim()
    .toUpperCase();

const ACTIVE_LOG_LEVEL =
  LOG_LEVELS[
    LOG_LEVEL_NAME
  ] ??
  (
    IS_DEVELOPMENT
      ? DEFAULT_DEVELOPMENT_LEVEL
      : DEFAULT_PRODUCTION_LEVEL
  );

// ============================================================================
// Sensitive key detection
// ============================================================================

const SENSITIVE_KEY_PATTERNS =
  Object.freeze([
    'authorization',
    'password',
    'passwd',
    'passphrase',
    'token',
    'access_token',
    'accesstoken',
    'refresh_token',
    'refreshtoken',
    'id_token',
    'idtoken',
    'secret',
    'client_secret',
    'clientsecret',
    'api_key',
    'apikey',
    'private_key',
    'privatekey',
    'encryption_key',
    'encryptionkey',
    'cookie',
    'set-cookie',
    'session',
    'credential',
    'credentials',
    'pin',
    'otp',
    'one_time_password',
    'cvv',
    'cvc',
  ]);

// ============================================================================
// Sensitive value markers
// ============================================================================

const REDACTED =
  '[REDACTED]';

const CIRCULAR =
  '[CIRCULAR]';

const UNSERIALIZABLE =
  '[UNSERIALIZABLE]';

// ============================================================================
// Key normalization
// ============================================================================

function normalizeKey(
  key
) {
  return String(key)
    .trim()
    .toLowerCase()
    .replace(
      /[\s-]/g,
      '_'
    );
}

function isSensitiveKey(
  key
) {
  const normalized =
    normalizeKey(key);

  return SENSITIVE_KEY_PATTERNS.some(
    (pattern) =>
      normalized ===
        pattern ||
      normalized.includes(
        pattern
      )
  );
}

// ============================================================================
// Error serialization
// ============================================================================

function serializeError(
  error
) {
  if (
    error instanceof Error
  ) {
    return {
      name:
        error.name ||
        'Error',

      message:
        error.message ||
        'Unknown error',

      stack:
        IS_DEVELOPMENT &&
        typeof error.stack ===
          'string'
          ? error.stack
          : undefined,
    };
  }

  return null;
}

// ============================================================================
// Safe deep sanitization
// ============================================================================

function sanitizeValue(
  value,
  seen = new WeakSet(),
  depth = 0
) {
  /*
   * Prevent pathological recursive structures from generating huge logs.
   */
  const MAX_DEPTH = 8;

  if (depth > MAX_DEPTH) {
    return '[MAX_DEPTH]';
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value ===
    'string' ||
    typeof value ===
    'number' ||
    typeof value ===
    'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
    'bigint'
  ) {
    return `${value}n`;
  }

  if (
    typeof value ===
    'function'
  ) {
    return '[FUNCTION]';
  }

  if (
    typeof value ===
    'symbol'
  ) {
    return String(value);
  }

  const serializedError =
    serializeError(
      value
    );

  if (serializedError) {
    return serializedError;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    typeof value ===
      'object'
  ) {
    if (
      seen.has(value)
    ) {
      return CIRCULAR;
    }

    seen.add(value);

    if (
      Array.isArray(value)
    ) {
      const result =
        value.map(
          (item) =>
            sanitizeValue(
              item,
              seen,
              depth + 1
            )
        );

      seen.delete(value);

      return result;
    }

    const result = {};

    for (
      const [
        key,
        childValue,
      ] of Object.entries(
        value
      )
    ) {
      if (
        isSensitiveKey(
          key
        )
      ) {
        result[key] =
          REDACTED;

        continue;
      }

      try {
        result[key] =
          sanitizeValue(
            childValue,
            seen,
            depth + 1
          );
      } catch {
        result[key] =
          UNSERIALIZABLE;
      }
    }

    seen.delete(value);

    return result;
  }

  return UNSERIALIZABLE;
}

// ============================================================================
// Metadata sanitization
// ============================================================================

export function redactMeta(
  meta = {}
) {
  return sanitizeValue(
    meta
  );
}

// ============================================================================
// Safe serialization
// ============================================================================

function safeJson(
  value
) {
  try {
    return JSON.stringify(
      value
    );
  } catch {
    return JSON.stringify({
      value:
        UNSERIALIZABLE,
    });
  }
}

// ============================================================================
// Correlation / trace metadata
// ============================================================================

function getCorrelationId() {
  if (
    typeof window ===
      'undefined'
  ) {
    return null;
  }

  try {
    return (
      window
        .__TITECH_APP_CONTEXT__
        ?.correlationId ||
      window
        .__TITECH_APP_INFO__
        ?.correlationId ||
      null
    );
  } catch {
    return null;
  }
}

// ============================================================================
// Structured log entry
// ============================================================================

function createLogEntry(
  level,
  message,
  meta = {}
) {
  const safeMeta =
    redactMeta(meta);

  return {
    timestamp:
      new Date().toISOString(),

    service:
      SERVICE_NAME,

    application:
      APP_NAME,

    version:
      APP_VERSION,

    environment:
      ENVIRONMENT,

    level,

    message:
      String(
        message ??
          ''
      ),

    ...(getCorrelationId()
      ? {
          correlationId:
            getCorrelationId(),
        }
      : {}),

    ...(safeMeta &&
    typeof safeMeta ===
      'object' &&
    !Array.isArray(
      safeMeta
    )
      ? safeMeta
      : {
          meta:
            safeMeta,
        }),
  };
}

// ============================================================================
// Console writer
// ============================================================================

function writeToConsole(
  level,
  entry
) {
  const payload =
    safeJson(entry);

  switch (level) {
    case 'DEBUG':
      console.debug(
        payload
      );
      break;

    case 'INFO':
      console.info(
        payload
      );
      break;

    case 'WARN':
      console.warn(
        payload
      );
      break;

    case 'ERROR':
      console.error(
        payload
      );
      break;

    default:
      console.log(
        payload
      );
  }
}

// ============================================================================
// Observability integration boundary
// ============================================================================
//
// Connect Sentry/OpenTelemetry/Datadog/TITech telemetry here later.
//
// Keep this function deliberately isolated so replacing console transport does
// not require changing the application code that calls logger.info(), etc.
// ============================================================================

function sendToObservability(
  entry
) {
  if (
    !IS_PRODUCTION
  ) {
    return;
  }

  /*
   * Example future implementation:
   *
   * window.__TITECH_TELEMETRY__?.captureLog(entry);
   *
   * Or:
   *
   * Sentry.addBreadcrumb({
   *   category: entry.service,
   *   message: entry.message,
   *   level: entry.level.toLowerCase(),
   *   data: entry,
   * });
   *
   * Keep the telemetry provider optional and centralized.
   */
}

// ============================================================================
// Log decision
// ============================================================================

function shouldLog(
  level
) {
  return (
    LOG_LEVELS[level] >=
    ACTIVE_LOG_LEVEL
  );
}

// ============================================================================
// Core logger
// ============================================================================

function log(
  level,
  message,
  meta = {}
) {
  if (
    !shouldLog(level)
  ) {
    return;
  }

  const entry =
    createLogEntry(
      level,
      message,
      meta
    );

  writeToConsole(
    level,
    entry
  );

  sendToObservability(
    entry
  );
}

// ============================================================================
// Public logger API
// ============================================================================

const logger = Object.freeze({
  debug(
    message,
    meta = {}
  ) {
    log(
      'DEBUG',
      message,
      meta
    );
  },

  info(
    message,
    meta = {}
  ) {
    log(
      'INFO',
      message,
      meta
    );
  },

  warn(
    message,
    meta = {}
  ) {
    log(
      'WARN',
      message,
      meta
    );
  },

  error(
    message,
    meta = {}
  ) {
    log(
      'ERROR',
      message,
      meta
    );
  },

  /**
   * Log an exception with normalized error metadata.
   */
  exception(
    error,
    meta = {}
  ) {
    const normalized =
      serializeError(
        error
      );

    log(
      'ERROR',
      normalized?.message ||
        'Unhandled exception',
      {
        ...meta,
        error:
          normalized || {
            value:
              sanitizeValue(
                error
              ),
          },
      }
    );
  },

  /**
   * Indicates whether a level is currently enabled.
   */
  isEnabled(
    level
  ) {
    const normalized =
      String(
        level || ''
      ).toUpperCase();

    return (
      LOG_LEVELS[
        normalized
      ] >=
      ACTIVE_LOG_LEVEL
    );
  },

  /**
   * Expose current logger configuration without secrets.
   */
  getConfig() {
    return Object.freeze({
      service:
        SERVICE_NAME,

      version:
        APP_VERSION,

      environment:
        ENVIRONMENT,

      level:
        LOG_LEVEL_NAME ||
        (
          IS_DEVELOPMENT
            ? 'DEBUG'
            : 'INFO'
        ),
    });
  },
});

// ============================================================================
// Development diagnostics
// ============================================================================

if (
  IS_DEVELOPMENT &&
  ACTIVE_LOG_LEVEL <=
    LOG_LEVELS.DEBUG
) {
  console.debug(
    JSON.stringify({
      timestamp:
        new Date().toISOString(),

      service:
        SERVICE_NAME,

      message:
        'Logger initialized',

      environment:
        ENVIRONMENT,

      version:
        APP_VERSION,
    })
  );
}

// ============================================================================
// Export
// ============================================================================

export {
  APP_NAME,
  APP_VERSION,
  ENVIRONMENT,
  IS_DEVELOPMENT,
  IS_PRODUCTION,
  LOG_LEVELS,
};

export default logger;