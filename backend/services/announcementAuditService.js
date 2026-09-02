/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Announcement Audit Service
 * ============================================================================
 *
 * File:
 *   backend/services/announcementAuditService.js
 *
 * Purpose:
 *   Centralized, production-grade audit service for announcement operations.
 *
 * Responsibilities:
 *   - Record immutable announcement audit events.
 *   - Normalize and validate audit input.
 *   - Hash sensitive request metadata.
 *   - Preserve tenant isolation context.
 *   - Support administrative, security, and regulatory investigations.
 *   - Prevent accidental persistence of sensitive secrets.
 *   - Provide consistent audit-service errors.
 *
 * Architecture:
 *   Announcement
 *        |
 *        +--> AnnouncementRead
 *        |       Mutable per-user interaction state
 *        |
 *        +--> AnnouncementAudit
 *                Immutable operational audit trail
 *
 * Security:
 *   - Never store passwords, tokens, credentials, or raw IP/user-agent data.
 *   - tenantId must come from trusted server-side authorization context.
 *   - Client-provided tenant identifiers must never become authoritative.
 *   - Audit metadata must contain operational information only.
 *
 * ============================================================================
 */

'use strict';

const crypto = require('crypto');

const AnnouncementAudit =
  require('../models/AnnouncementAudit');

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const MAX_METADATA_KEYS = 50;
const MAX_METADATA_STRING_LENGTH = 1000;
const MAX_ARRAY_ITEMS = 50;

const HASH_ALGORITHM = 'sha256';

/**
 * Fields that must never be persisted into audit metadata.
 *
 * Matching is case-insensitive and supports common credential/token names.
 */
const FORBIDDEN_METADATA_KEYS = new Set([
  'password',
  'passwd',
  'passcode',
  'pin',
  'otp',
  'token',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'id_token',
  'idToken',
  'authorization',
  'cookie',
  'cookies',
  'secret',
  'client_secret',
  'clientSecret',
  'api_key',
  'apiKey',
  'private_key',
  'privateKey',
  'credential',
  'credentials',
]);

/* ============================================================================
 * ERRORS
 * ========================================================================== */

class AnnouncementAuditError extends Error {
  constructor(message, code = 'ANNOUNCEMENT_AUDIT_ERROR') {
    super(message);

    this.name = 'AnnouncementAuditError';
    this.code = code;

    Error.captureStackTrace?.(
      this,
      AnnouncementAuditError,
    );
  }
}

/* ============================================================================
 * HELPERS
 * ========================================================================== */

/**
 * Determine whether a value is a valid non-empty string.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

/**
 * Safely normalize an identifier.
 *
 * Mongoose accepts ObjectId values as strings or ObjectIds. The service does
 * not convert arbitrary values into database identifiers here; Mongoose
 * remains responsible for schema-level ObjectId validation.
 *
 * @param {*} value
 * @returns {*}
 */
function normalizeIdentifier(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  return value;
}

/**
 * Hash sensitive request metadata.
 *
 * SHA-256 provides a deterministic one-way representation suitable for
 * correlation/investigation without storing the raw value.
 *
 * @param {*} value
 * @returns {string|null}
 */
function hashValue(value) {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ''
  ) {
    return null;
  }

  return crypto
    .createHash(HASH_ALGORITHM)
    .update(String(value), 'utf8')
    .digest('hex');
}

/**
 * Normalize an audit action.
 *
 * @param {*} action
 * @returns {string}
 */
function normalizeAction(action) {
  if (!isNonEmptyString(action)) {
    throw new AnnouncementAuditError(
      'Audit action is required.',
      'INVALID_AUDIT_ACTION',
    );
  }

  return action.trim().toLowerCase();
}

/**
 * Determine whether an object key is sensitive.
 *
 * @param {string} key
 * @returns {boolean}
 */
function isForbiddenMetadataKey(key) {
  const normalizedKey = String(key)
    .trim()
    .toLowerCase()
    .replace(/[\s-]/g, '_');

  return (
    FORBIDDEN_METADATA_KEYS.has(normalizedKey) ||
    normalizedKey.includes('password') ||
    normalizedKey.includes('token') ||
    normalizedKey.includes('secret') ||
    normalizedKey.includes('credential')
  );
}

/**
 * Safely sanitize metadata before persistence.
 *
 * This is deliberately conservative. Audit logs should capture enough
 * operational context for investigation without becoming a secondary
 * storage location for sensitive application data.
 *
 * @param {*} metadata
 * @returns {Object}
 */
function sanitizeMetadata(metadata) {
  if (
    metadata === undefined ||
    metadata === null
  ) {
    return {};
  }

  if (
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    throw new AnnouncementAuditError(
      'Audit metadata must be a plain object.',
      'INVALID_AUDIT_METADATA',
    );
  }

  const keys = Object.keys(metadata);

  if (keys.length > MAX_METADATA_KEYS) {
    throw new AnnouncementAuditError(
      `Audit metadata cannot contain more than ${MAX_METADATA_KEYS} keys.`,
      'AUDIT_METADATA_TOO_LARGE',
    );
  }

  const sanitized = {};

  for (const key of keys) {
    if (!key) {
      continue;
    }

    if (isForbiddenMetadataKey(key)) {
      continue;
    }

    const value = metadata[key];

    if (
      value === undefined ||
      value === null
    ) {
      sanitized[key] = null;
      continue;
    }

    if (typeof value === 'string') {
      sanitized[key] =
        value.length > MAX_METADATA_STRING_LENGTH
          ? value.slice(
              0,
              MAX_METADATA_STRING_LENGTH,
            )
          : value;

      continue;
    }

    if (
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      sanitized[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      sanitized[key] = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => {
          if (
            item === null ||
            item === undefined
          ) {
            return null;
          }

          if (
            typeof item === 'string'
          ) {
            return item.length >
              MAX_METADATA_STRING_LENGTH
              ? item.slice(
                  0,
                  MAX_METADATA_STRING_LENGTH,
                )
              : item;
          }

          if (
            typeof item === 'number' ||
            typeof item === 'boolean'
          ) {
            return item;
          }

          return '[redacted]';
        });

      continue;
    }

    /**
     * Nested objects are intentionally represented conservatively.
     * This prevents arbitrary request objects from being persisted.
     */
    if (
      typeof value === 'object'
    ) {
      sanitized[key] = '[object]';
      continue;
    }

    sanitized[key] = String(value).slice(
      0,
      MAX_METADATA_STRING_LENGTH,
    );
  }

  return sanitized;
}

/**
 * Normalize actor role.
 *
 * @param {*} actorRole
 * @returns {string|null}
 */
function normalizeActorRole(actorRole) {
  if (
    actorRole === undefined ||
    actorRole === null ||
    String(actorRole).trim() === ''
  ) {
    return null;
  }

  return String(actorRole)
    .trim()
    .slice(0, 100);
}

/**
 * Normalize correlation/request identifiers.
 *
 * @param {*} value
 * @param {number} maxLength
 * @returns {string|null}
 */
function normalizeString(value, maxLength) {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ''
  ) {
    return null;
  }

  return String(value)
    .trim()
    .slice(0, maxLength);
}

/**
 * Build a consistent audit metadata object.
 *
 * @param {Object} metadata
 * @returns {Object}
 */
function buildMetadata(metadata) {
  return Object.freeze({
    ...sanitizeMetadata(metadata),
  });
}

/* ============================================================================
 * SERVICE
 * ========================================================================== */

/**
 * Record an immutable announcement audit event.
 *
 * IMPORTANT:
 * This service records the authoritative server-side event. Frontend
 * telemetry must never be treated as the source of truth for audit history.
 *
 * @param {Object} options
 * @param {*} options.announcementId
 * @param {*} [options.tenantId]
 * @param {*} [options.actorUserId]
 * @param {*} [options.actorRole]
 * @param {string} options.action
 * @param {boolean} [options.success=true]
 * @param {string|null} [options.requestId]
 * @param {string|null} [options.correlationId]
 * @param {string|null} [options.ip]
 * @param {string|null} [options.userAgent]
 * @param {Object} [options.metadata]
 *
 * @returns {Promise<Object>}
 */
async function recordAnnouncementAudit({
  announcementId,
  tenantId = null,
  actorUserId = null,
  actorRole = null,
  action,
  success = true,
  requestId = null,
  correlationId = null,
  ip = null,
  userAgent = null,
  metadata = {},
} = {}) {
  /**
   * --------------------------------------------------------------------------
   * REQUIRED INPUT
   * --------------------------------------------------------------------------
   */

  if (
    announcementId === undefined ||
    announcementId === null ||
    announcementId === ''
  ) {
    throw new AnnouncementAuditError(
      'announcementId is required for audit logging.',
      'MISSING_ANNOUNCEMENT_ID',
    );
  }

  const normalizedAction =
    normalizeAction(action);

  /**
   * --------------------------------------------------------------------------
   * NORMALIZATION
   * --------------------------------------------------------------------------
   */

  const normalizedTenantId =
    normalizeIdentifier(tenantId);

  const normalizedActorUserId =
    normalizeIdentifier(actorUserId);

  const normalizedActorRole =
    normalizeActorRole(actorRole);

  const normalizedRequestId =
    normalizeString(requestId, 150);

  const normalizedCorrelationId =
    normalizeString(correlationId, 150);

  /**
   * Explicit boolean normalization prevents accidental persistence of
   * arbitrary truthy/falsy values.
   */
  const normalizedSuccess =
    success === true;

  /**
   * --------------------------------------------------------------------------
   * METADATA SANITIZATION
   * --------------------------------------------------------------------------
   */

  const sanitizedMetadata =
    buildMetadata(metadata);

  /**
   * --------------------------------------------------------------------------
   * PERSISTENCE
   * --------------------------------------------------------------------------
   *
   * AnnouncementAudit itself is responsible for immutability guards.
   *
   * No update/delete operation should be performed through this service.
   */

  try {
    const auditRecord =
      await AnnouncementAudit.create({
        announcementId:
          announcementId,

        tenantId:
          normalizedTenantId,

        actorUserId:
          normalizedActorUserId,

        actorRole:
          normalizedActorRole,

        action:
          normalizedAction,

        success:
          normalizedSuccess,

        requestId:
          normalizedRequestId,

        correlationId:
          normalizedCorrelationId,

        sourceIpHash:
          hashValue(ip),

        userAgentHash:
          hashValue(userAgent),

        metadata:
          sanitizedMetadata,
      });

    return auditRecord;
  } catch (error) {
    /**
     * Preserve already-classified audit errors.
     */
    if (
      error instanceof AnnouncementAuditError
    ) {
      throw error;
    }

    /**
     * Wrap database/Mongoose failures with a stable service-level error while
     * preserving the original error for upstream logging.
     */
    const auditError =
      new AnnouncementAuditError(
        'Failed to persist announcement audit record.',
        'AUDIT_PERSISTENCE_FAILED',
      );

    auditError.cause = error;

    throw auditError;
  }
}

/* ============================================================================
 * SPECIALIZED HELPERS
 * ========================================================================== */

/**
 * Record a successful announcement operation.
 *
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function recordSuccessfulAnnouncementAudit(
  options = {},
) {
  return recordAnnouncementAudit({
    ...options,
    success: true,
  });
}

/**
 * Record a failed announcement operation.
 *
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function recordFailedAnnouncementAudit(
  options = {},
) {
  return recordAnnouncementAudit({
    ...options,
    success: false,
  });
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports = Object.freeze({
  recordAnnouncementAudit,
  recordSuccessfulAnnouncementAudit,
  recordFailedAnnouncementAudit,
  hashValue,
  sanitizeMetadata,
  AnnouncementAuditError,
});