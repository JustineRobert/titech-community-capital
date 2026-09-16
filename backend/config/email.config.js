// ============================================================================
// backend/config/email.config.js
// ============================================================================
// TITech Community Capital LTD
// Enterprise Email Configuration
//
// PURPOSE
// ----------------------------------------------------------------------------
// Centralized, validated email configuration for application notifications,
// transactional mail, alerts, password-reset workflows, receipts and
// operational messaging.
//
// DESIGN GOALS
// ----------------------------------------------------------------------------
// - ESM compatible
// - Deterministic environment parsing
// - Safe defaults
// - Fail-fast validation when email is enabled
// - No secrets exposed through safe metadata
// - SMTP/TLS configuration
// - Connection timeout configuration
// - Development-friendly behavior
// - Production configuration readiness
// - Compatible with bootstrap/environment configuration
//
// IMPORTANT
// ----------------------------------------------------------------------------
// This file MUST NOT send email.
// It only defines validated configuration.
//
// ============================================================================

"use strict";

/**
 * ============================================================================
 * ENVIRONMENT
 * ============================================================================
 */

const env = process.env;

/**
 * ============================================================================
 * PARSING HELPERS
 * ============================================================================
 */

function parseBoolean(
  value,
  defaultValue = false,
) {
  if (
    value == null ||
    String(value).trim() === ""
  ) {
    return defaultValue;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    [
      "true",
      "1",
      "yes",
      "y",
      "on",
      "enabled",
    ].includes(normalized)
  ) {
    return true;
  }

  if (
    [
      "false",
      "0",
      "no",
      "n",
      "off",
      "disabled",
    ].includes(normalized)
  ) {
    return false;
  }

  throw new Error(
    `Invalid boolean environment value: "${value}".`,
  );
}

function parseInteger(
  value,
  {
    defaultValue,
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER,
    name,
  },
) {
  if (
    value == null ||
    String(value).trim() === ""
  ) {
    return defaultValue;
  }

  const parsed =
    Number(
      String(value).trim(),
    );

  if (
    !Number.isInteger(parsed) ||
    !Number.isSafeInteger(parsed)
  ) {
    throw new Error(
      `${name} must be a valid integer.`,
    );
  }

  if (
    parsed < min ||
    parsed > max
  ) {
    throw new Error(
      `${name} must be between ${min} and ${max}.`,
    );
  }

  return parsed;
}

function parseString(
  value,
  defaultValue = null,
) {
  if (
    value == null
  ) {
    return defaultValue;
  }

  const normalized =
    String(value).trim();

  return normalized || defaultValue;
}

function parseNullableUrl(
  value,
) {
  const normalized =
    parseString(value);

  if (!normalized) {
    return null;
  }

  try {
    return new URL(
      normalized,
    );
  } catch {
    throw new Error(
      `Invalid EMAIL_URL value: "${normalized}".`,
    );
  }
}

function assertRequired(
  value,
  name,
) {
  if (
    value == null ||
    String(value).trim() === ""
  ) {
    throw new Error(
      `${name} is required when email is enabled.`,
    );
  }
}

/**
 * ============================================================================
 * BASIC EMAIL SETTINGS
 * ============================================================================
 */

const enabled =
  parseBoolean(
    env.EMAIL_ENABLED,
    false,
  );

const host =
  parseString(
    env.EMAIL_HOST,
    null,
  );

const port =
  parseInteger(
    env.EMAIL_PORT,
    {
      defaultValue: 587,
      min: 1,
      max: 65535,
      name: "EMAIL_PORT",
    },
  );

const user =
  parseString(
    env.EMAIL_USER,
    null,
  );

const password =
  parseString(
    env.EMAIL_PASSWORD,
    null,
  );

const from =
  parseString(
    env.EMAIL_FROM,
    null,
  );

/**
 * ============================================================================
 * SMTP SECURITY
 * ============================================================================
 *
 * Port 465 normally uses implicit TLS.
 * Port 587 normally uses STARTTLS.
 *
 * EMAIL_SECURE can explicitly override the inferred behavior.
 */

const inferredSecure =
  port === 465;

const secure =
  env.EMAIL_SECURE == null
    ? inferredSecure
    : parseBoolean(
        env.EMAIL_SECURE,
        inferredSecure,
      );

const requireTLS =
  parseBoolean(
    env.EMAIL_REQUIRE_TLS,
    port === 587,
  );

/**
 * Reject obviously contradictory configuration.
 *
 * Port 465 with requireTLS=true normally does not describe STARTTLS semantics.
 * Explicit EMAIL_SECURE is still respected.
 */
if (
  secure &&
  requireTLS
) {
  /**
   * We do not reject this outright because some SMTP clients/providers expose
   * both concepts differently. The transport adapter remains responsible for
   * the final TLS semantics.
   */
}

/**
 * ============================================================================
 * TIMEOUT / CONNECTION SETTINGS
 * ============================================================================
 */

const connectionTimeout =
  parseInteger(
    env.EMAIL_CONNECTION_TIMEOUT_MS,
    {
      defaultValue: 10000,
      min: 1000,
      max: 120000,
      name:
        "EMAIL_CONNECTION_TIMEOUT_MS",
    },
  );

const greetingTimeout =
  parseInteger(
    env.EMAIL_GREETING_TIMEOUT_MS,
    {
      defaultValue: 10000,
      min: 1000,
      max: 120000,
      name:
        "EMAIL_GREETING_TIMEOUT_MS",
    },
  );

const socketTimeout =
  parseInteger(
    env.EMAIL_SOCKET_TIMEOUT_MS,
    {
      defaultValue: 20000,
      min: 1000,
      max: 300000,
      name:
        "EMAIL_SOCKET_TIMEOUT_MS",
    },
  );

const maxConnections =
  parseInteger(
    env.EMAIL_MAX_CONNECTIONS,
    {
      defaultValue: 5,
      min: 1,
      max: 100,
      name: "EMAIL_MAX_CONNECTIONS",
    },
  );

const maxMessages =
  parseInteger(
    env.EMAIL_MAX_MESSAGES,
    {
      defaultValue: 100,
      min: 1,
      max: 100000,
      name: "EMAIL_MAX_MESSAGES",
    },
  );

/**
 * ============================================================================
 * MESSAGE SETTINGS
 * ============================================================================
 */

const fromName =
  parseString(
    env.EMAIL_FROM_NAME,
    "TITech Community Capital",
  );

const replyTo =
  parseString(
    env.EMAIL_REPLY_TO,
    null,
  );

const messageIdDomain =
  parseString(
    env.EMAIL_MESSAGE_ID_DOMAIN,
    null,
  );

/**
 * ============================================================================
 * PROVIDER / TRANSPORT METADATA
 * ============================================================================
 */

const provider =
  parseString(
    env.EMAIL_PROVIDER,
    "smtp",
  ).toLowerCase();

const connectionUrl =
  parseNullableUrl(
    env.EMAIL_URL,
  );

/**
 * ============================================================================
 * FEATURE FLAGS
 * ============================================================================
 */

const sendNotifications =
  parseBoolean(
    env.EMAIL_SEND_NOTIFICATIONS,
    true,
  );

const sendTransactional =
  parseBoolean(
    env.EMAIL_SEND_TRANSACTIONAL,
    true,
  );

const sendOperationalAlerts =
  parseBoolean(
    env.EMAIL_SEND_OPERATIONAL_ALERTS,
    true,
  );

/**
 * ============================================================================
 * DEVELOPMENT / PRODUCTION BEHAVIOR
 * ============================================================================
 */

const nodeEnv =
  parseString(
    env.NODE_ENV,
    "development",
  ).toLowerCase();

const isProduction =
  nodeEnv === "production";

const isDevelopment =
  nodeEnv === "development";

const rejectUnauthorized =
  parseBoolean(
    env.EMAIL_TLS_REJECT_UNAUTHORIZED,
    isProduction,
  );

/**
 * ============================================================================
 * VALIDATION
 * ============================================================================
 *
 * When email is disabled, credentials are optional.
 *
 * When email is enabled, validate the SMTP configuration now rather than
 * allowing an application request to fail later.
 */

if (enabled) {
  if (
    !host &&
    !connectionUrl
  ) {
    throw new Error(
      "Email is enabled but neither EMAIL_HOST nor EMAIL_URL is configured.",
    );
  }

  if (
    provider === "smtp" &&
    !connectionUrl
  ) {
    assertRequired(
      host,
      "EMAIL_HOST",
    );
  }

  assertRequired(
    from,
    "EMAIL_FROM",
  );

  /**
   * SMTP authentication may legitimately be disabled for trusted local relay
   * or authenticated through another mechanism.
   *
   * Therefore we only require user/password when either one is provided.
   */
  if (
    (user && !password) ||
    (!user && password)
  ) {
    throw new Error(
      "EMAIL_USER and EMAIL_PASSWORD must either both be configured or both be omitted.",
    );
  }
}

/**
 * ============================================================================
 * FROM HEADER VALIDATION
 * ============================================================================
 *
 * This is intentionally lightweight. Full RFC mailbox validation belongs to
 * the mail transport layer.
 */

function validateEmailAddress(
  value,
  name,
) {
  if (!value) {
    return;
  }

  const email =
    String(value)
      .trim();

  /**
   * Supports:
   *
   *   user@example.com
   *   TITech Community Capital <user@example.com>
   */
  const match =
    email.match(
      /<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>$/,
    ) ||
    email.match(
      /^([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)$/,
    );

  if (!match) {
    throw new Error(
      `${name} must contain a valid email mailbox.`,
    );
  }
}

if (enabled) {
  validateEmailAddress(
    from,
    "EMAIL_FROM",
  );

  validateEmailAddress(
    replyTo,
    "EMAIL_REPLY_TO",
  );
}

/**
 * ============================================================================
 * NORMALIZED AUTH OBJECT
 * ============================================================================
 *
 * This object is intended for the mail adapter/transport.
 *
 * Keep it separate from the public configuration metadata so that password
 * handling is explicit.
 */

const auth =
  user && password
    ? Object.freeze({
        user,
        pass: password,
      })
    : null;

/**
 * ============================================================================
 * SMTP TLS CONFIGURATION
 * ============================================================================
 */

const tls =
  Object.freeze({
    rejectUnauthorized,

    servername:
      host || undefined,
  });

/**
 * ============================================================================
 * TRANSPORT CONFIGURATION
 * ============================================================================
 */

const transport =
  Object.freeze({
    protocol:
      connectionUrl
        ? connectionUrl.protocol.replace(
            ":",
            "",
          )
        : "smtp",

    host,

    port,

    secure,

    requireTLS,

    auth,

    tls,

    connectionTimeout,

    greetingTimeout,

    socketTimeout,

    pool: true,

    maxConnections,

    maxMessages,
  });

/**
 * ============================================================================
 * NORMALIZED CONFIGURATION
 * ============================================================================
 */

const configuration =
  Object.freeze({
    /**
     * ------------------------------------------------------------------------
     * Feature state
     * ------------------------------------------------------------------------
     */

    enabled,

    provider,

    environment:
      nodeEnv,

    isProduction,

    isDevelopment,

    /**
     * ------------------------------------------------------------------------
     * SMTP
     * ------------------------------------------------------------------------
     */

    host,

    port,

    secure,

    requireTLS,

    user,

    password,

    auth,

    from,

    fromName,

    replyTo,

    messageIdDomain,

    connectionUrl:
      connectionUrl
        ? connectionUrl.toString()
        : null,

    transport,

    /**
     * ------------------------------------------------------------------------
     * TLS
     * ------------------------------------------------------------------------
     */

    tls,

    rejectUnauthorized,

    /**
     * ------------------------------------------------------------------------
     * Pool / timeouts
     * ------------------------------------------------------------------------
     */

    connectionTimeout,
    greetingTimeout,
    socketTimeout,

    maxConnections,
    maxMessages,

    /**
     * ------------------------------------------------------------------------
     * Features
     * ------------------------------------------------------------------------
     */

    sendNotifications,

    sendTransactional,

    sendOperationalAlerts,

    /**
     * ------------------------------------------------------------------------
     * Security
     * ------------------------------------------------------------------------
     */

    credentialsConfigured:
      Boolean(
        user &&
        password,
      ),
  });

/**
 * ============================================================================
 * SAFE METADATA
 * ============================================================================
 *
 * Never expose:
 *   EMAIL_PASSWORD
 *   auth.pass
 *   complete connection credentials
 *
 * Suitable for startup logs / diagnostics.
 */

export function getSafeMetadata() {
  return Object.freeze({
    enabled:
      configuration.enabled,

    provider:
      configuration.provider,

    environment:
      configuration.environment,

    host:
      configuration.host,

    port:
      configuration.port,

    secure:
      configuration.secure,

    requireTLS:
      configuration.requireTLS,

    credentialsConfigured:
      configuration.credentialsConfigured,

    fromConfigured:
      Boolean(
        configuration.from,
      ),

    replyToConfigured:
      Boolean(
        configuration.replyTo,
      ),

    connectionTimeout:
      configuration.connectionTimeout,

    greetingTimeout:
      configuration.greetingTimeout,

    socketTimeout:
      configuration.socketTimeout,

    maxConnections:
      configuration.maxConnections,

    maxMessages:
      configuration.maxMessages,

    sendNotifications:
      configuration.sendNotifications,

    sendTransactional:
      configuration.sendTransactional,

    sendOperationalAlerts:
      configuration.sendOperationalAlerts,

    tlsRejectUnauthorized:
      configuration.rejectUnauthorized,
  });
}

/**
 * ============================================================================
 * VALIDATION HELPER
 * ============================================================================
 */

export function validateEmailConfiguration() {
  if (!configuration.enabled) {
    return {
      valid: true,
      enabled: false,
    };
  }

  if (
    !configuration.host &&
    !configuration.connectionUrl
  ) {
    throw new Error(
      "Email is enabled but no SMTP host or email connection URL is configured.",
    );
  }

  if (
    !configuration.from
  ) {
    throw new Error(
      "EMAIL_FROM is required when email is enabled.",
    );
  }

  return {
    valid: true,
    enabled: true,
  };
}

/**
 * ============================================================================
 * DEFAULT EXPORT
 * ============================================================================
 */

export default configuration;