'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (TITech)
 * =============================================================================
 *
 * File:
 *   backend/modules/offline/index.js
 *
 * Purpose:
 *   Enterprise public entry point for the TITech offline-first domain module.
 *
 * Responsibilities:
 *   - Expose the canonical offline domain API
 *   - Centralize offline constants
 *   - Provide safe event classification helpers
 *   - Provide financial-event safety helpers
 *   - Provide synchronization and conflict helpers
 *   - Prevent callers from depending on internal implementation details
 *   - Preserve a stable module contract for controllers/services/workers
 *
 * Architecture:
 *
 *   Routes / Controllers
 *          │
 *          ▼
 *   Offline Module API
 *          │
 *          ├── Constants
 *          ├── Event Classification
 *          ├── Financial Safety
 *          ├── Sync Classification
 *          └── Conflict Classification
 *          │
 *          ▼
 *   Offline Services
 *          │
 *          ▼
 *   Event Store / Sync / Reconciliation
 *          │
 *          ▼
 *   Financial Transaction Boundary
 *          │
 *          ▼
 *   Ledger
 *
 * IMPORTANT:
 *   This file is intentionally a thin domain facade.
 *   Persistence, network calls, transaction management, cryptography,
 *   reconciliation execution, and queue processing belong in dedicated
 *   services rather than this module entry point.
 *
 * =============================================================================
 */

const constants = require('./constants');

// =============================================================================
// Destructure Canonical Constants
// =============================================================================

const {
  MODULE_NAME,
  MODULE_VERSION,
  DOMAIN,

  EVENT_TYPES,
  EVENT_CATEGORIES,
  EVENT_STATUS,

  SYNC_STATUS,

  CONFLICT_TYPES,
  CONFLICT_RESOLUTION,

  DEVICE_STATUS,
  MEETING_STATUS,

  FINANCIAL_OPERATION_STATUS,
  IDEMPOTENCY_STATUS,
  QUEUE_STATUS,

  AUDIT_ACTIONS,

  RETRY,
  SYNC,
  STORAGE,
  SECURITY,
  FINANCIAL,
  CURRENCY,
  CURSOR,
  RECONCILIATION,
  HASH_CHAIN,

  OFFLINE_ERROR_CODES,

  HEADERS,
  EVENT_METADATA,
  EVENT_VERSION,
  TIME,
  LIMITS,

  FINANCIAL_EVENT_TYPES,
  MEETING_EVENT_TYPES,
  DEVICE_EVENT_TYPES,
} = constants;

// =============================================================================
// Internal Sets
// =============================================================================

const FINANCIAL_EVENT_SET = new Set(FINANCIAL_EVENT_TYPES);

const MEETING_EVENT_SET = new Set(MEETING_EVENT_TYPES);

const DEVICE_EVENT_SET = new Set(DEVICE_EVENT_TYPES);

const EVENT_TYPE_SET = new Set(Object.values(EVENT_TYPES));

const EVENT_STATUS_SET = new Set(Object.values(EVENT_STATUS));

const SYNC_STATUS_SET = new Set(Object.values(SYNC_STATUS));

const CONFLICT_TYPE_SET = new Set(Object.values(CONFLICT_TYPES));

const CONFLICT_RESOLUTION_SET = new Set(Object.values(CONFLICT_RESOLUTION));

const DEVICE_STATUS_SET = new Set(Object.values(DEVICE_STATUS));

const MEETING_STATUS_SET = new Set(Object.values(MEETING_STATUS));

const FINANCIAL_OPERATION_STATUS_SET = new Set(
  Object.values(FINANCIAL_OPERATION_STATUS),
);

const IDEMPOTENCY_STATUS_SET = new Set(
  Object.values(IDEMPOTENCY_STATUS),
);

const QUEUE_STATUS_SET = new Set(Object.values(QUEUE_STATUS));

// =============================================================================
// Generic Helpers
// =============================================================================

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeString(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function hasOwn(object, property) {
  return (
    isObject(object) &&
    Object.prototype.hasOwnProperty.call(object, property)
  );
}

// =============================================================================
// Event Helpers
// =============================================================================

function isKnownEventType(eventType) {
  return (
    isNonEmptyString(eventType) &&
    EVENT_TYPE_SET.has(eventType.trim())
  );
}

function isFinancialEventType(eventType) {
  return (
    isNonEmptyString(eventType) &&
    FINANCIAL_EVENT_SET.has(eventType.trim())
  );
}

function isMeetingEventType(eventType) {
  return (
    isNonEmptyString(eventType) &&
    MEETING_EVENT_SET.has(eventType.trim())
  );
}

function isDeviceEventType(eventType) {
  return (
    isNonEmptyString(eventType) &&
    DEVICE_EVENT_SET.has(eventType.trim())
  );
}

function requiresIdempotency(eventType) {
  return (
    SECURITY.REQUIRE_IDEMPOTENCY_FOR_FINANCIAL_EVENTS &&
    isFinancialEventType(eventType)
  );
}

function requiresSignature(eventType) {
  if (!isKnownEventType(eventType)) {
    return false;
  }

  return SECURITY.REQUIRE_EVENT_SIGNATURE;
}

function getEventCategory(eventType) {
  if (isFinancialEventType(eventType)) {
    return EVENT_CATEGORIES.CONTRIBUTION;
  }

  if (isMeetingEventType(eventType)) {
    return EVENT_CATEGORIES.MEETING;
  }

  if (isDeviceEventType(eventType)) {
    return EVENT_CATEGORIES.DEVICE;
  }

  switch (eventType) {
    case EVENT_TYPES.MEMBER_REGISTERED:
    case EVENT_TYPES.MEMBER_UPDATED:
      return EVENT_CATEGORIES.MEMBER;

    case EVENT_TYPES.SYNC_REQUESTED:
    case EVENT_TYPES.SYNC_COMPLETED:
    case EVENT_TYPES.SYNC_FAILED:
      return EVENT_CATEGORIES.SYNC;

    case EVENT_TYPES.RECONCILIATION_REQUIRED:
    case EVENT_TYPES.RECONCILIATION_COMPLETED:
      return EVENT_CATEGORIES.RECONCILIATION;

    default:
      return null;
  }
}

// =============================================================================
// Event Validation Helpers
// =============================================================================

function validateEventType(eventType) {
  const normalized = normalizeString(eventType);

  if (!normalized) {
    return {
      valid: false,
      reason: 'EVENT_TYPE_REQUIRED',
    };
  }

  if (!isKnownEventType(normalized)) {
    return {
      valid: false,
      reason: OFFLINE_ERROR_CODES.OFFLINE_EVENT_INVALID,
    };
  }

  return {
    valid: true,
    value: normalized,
  };
}

function validateEventVersion(version) {
  if (!Number.isInteger(version)) {
    return {
      valid: false,
      reason: 'EVENT_VERSION_INVALID',
    };
  }

  if (
    version < EVENT_VERSION.MIN_SUPPORTED ||
    version > EVENT_VERSION.MAX_SUPPORTED
  ) {
    return {
      valid: false,
      reason: 'EVENT_VERSION_UNSUPPORTED',
    };
  }

  return {
    valid: true,
    value: version,
  };
}

// =============================================================================
// Event Status Helpers
// =============================================================================

function isKnownEventStatus(status) {
  return (
    isNonEmptyString(status) &&
    EVENT_STATUS_SET.has(status.trim())
  );
}

function isTerminalEventStatus(status) {
  return [
    EVENT_STATUS.ACCEPTED,
    EVENT_STATUS.APPLIED,
    EVENT_STATUS.DUPLICATE,
    EVENT_STATUS.REJECTED,
    EVENT_STATUS.FAILED,
    EVENT_STATUS.RECONCILED,
    EVENT_STATUS.CANCELLED,
  ].includes(status);
}

// =============================================================================
// Sync Helpers
// =============================================================================

function isKnownSyncStatus(status) {
  return (
    isNonEmptyString(status) &&
    SYNC_STATUS_SET.has(status.trim())
  );
}

function isTerminalSyncStatus(status) {
  return [
    SYNC_STATUS.COMPLETED,
    SYNC_STATUS.FAILED,
    SYNC_STATUS.BLOCKED,
    SYNC_STATUS.CONFLICT,
    SYNC_STATUS.RECONCILIATION_REQUIRED,
  ].includes(status);
}

function canRetrySync(status) {
  return [
    SYNC_STATUS.FAILED,
    SYNC_STATUS.PARTIAL,
  ].includes(status);
}

// =============================================================================
// Conflict Helpers
// =============================================================================

function isKnownConflictType(type) {
  return (
    isNonEmptyString(type) &&
    CONFLICT_TYPE_SET.has(type.trim())
  );
}

function requiresManualConflictReview(type) {
  return [
    CONFLICT_TYPES.FINANCIAL_MISMATCH,
    CONFLICT_TYPES.LEDGER_MISMATCH,
    CONFLICT_TYPES.BALANCE_MISMATCH,
    CONFLICT_TYPES.SIGNATURE_INVALID,
    CONFLICT_TYPES.HASH_MISMATCH,
    CONFLICT_TYPES.DEVICE_TRUST_FAILURE,
    CONFLICT_TYPES.POLICY_VIOLATION,
  ].includes(type);
}

function isKnownConflictResolution(resolution) {
  return (
    isNonEmptyString(resolution) &&
    CONFLICT_RESOLUTION_SET.has(resolution.trim())
  );
}

// =============================================================================
// Device Helpers
// =============================================================================

function isKnownDeviceStatus(status) {
  return (
    isNonEmptyString(status) &&
    DEVICE_STATUS_SET.has(status.trim())
  );
}

function isTrustedDeviceStatus(status) {
  return status === DEVICE_STATUS.ACTIVE;
}

function isRevokedDeviceStatus(status) {
  return [
    DEVICE_STATUS.REVOKED,
    DEVICE_STATUS.COMPROMISED,
    DEVICE_STATUS.EXPIRED,
  ].includes(status);
}

// =============================================================================
// Meeting Helpers
// =============================================================================

function isKnownMeetingStatus(status) {
  return (
    isNonEmptyString(status) &&
    MEETING_STATUS_SET.has(status.trim())
  );
}

function isMeetingOpen(status) {
  return [
    MEETING_STATUS.OPEN,
    MEETING_STATUS.IN_PROGRESS,
  ].includes(status);
}

function isMeetingClosed(status) {
  return [
    MEETING_STATUS.CLOSED,
    MEETING_STATUS.CANCELLED,
  ].includes(status);
}

function requiresMeetingReconciliation(status) {
  return status === MEETING_STATUS.RECONCILIATION_REQUIRED;
}

// =============================================================================
// Financial Safety Helpers
// =============================================================================

function isKnownFinancialOperationStatus(status) {
  return (
    isNonEmptyString(status) &&
    FINANCIAL_OPERATION_STATUS_SET.has(status.trim())
  );
}

function isFinancialOperationTerminal(status) {
  return [
    FINANCIAL_OPERATION_STATUS.COMPLETED,
    FINANCIAL_OPERATION_STATUS.COMMITTED,
    FINANCIAL_OPERATION_STATUS.FAILED,
    FINANCIAL_OPERATION_STATUS.REVERSED,
    FINANCIAL_OPERATION_STATUS.REJECTED,
    FINANCIAL_OPERATION_STATUS.CONFLICT,
    FINANCIAL_OPERATION_STATUS.RECONCILIATION_REQUIRED,
  ].includes(status);
}

function isValidAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return false;
  }

  if (FINANCIAL.REQUIRE_POSITIVE_AMOUNT && amount <= 0) {
    return false;
  }

  return Number.isSafeInteger(
    Math.round(amount * 10 ** FINANCIAL.MAX_DECIMAL_PLACES),
  );
}

function isSupportedCurrency(currency) {
  return (
    isNonEmptyString(currency) &&
    CURRENCY.SUPPORTED.includes(currency.trim().toUpperCase())
  );
}

function normalizeCurrency(currency) {
  if (!isNonEmptyString(currency)) {
    return CURRENCY.DEFAULT;
  }

  return currency.trim().toUpperCase();
}

function requiresFinancialBoundary(eventType) {
  return isFinancialEventType(eventType);
}

// =============================================================================
// Idempotency Helpers
// =============================================================================

function isKnownIdempotencyStatus(status) {
  return (
    isNonEmptyString(status) &&
    IDEMPOTENCY_STATUS_SET.has(status.trim())
  );
}

function isTerminalIdempotencyStatus(status) {
  return [
    IDEMPOTENCY_STATUS.COMPLETED,
    IDEMPOTENCY_STATUS.FAILED,
    IDEMPOTENCY_STATUS.CONFLICT,
    IDEMPOTENCY_STATUS.EXPIRED,
  ].includes(status);
}

// =============================================================================
// Queue Helpers
// =============================================================================

function isKnownQueueStatus(status) {
  return (
    isNonEmptyString(status) &&
    QUEUE_STATUS_SET.has(status.trim())
  );
}

function isTerminalQueueStatus(status) {
  return [
    QUEUE_STATUS.COMPLETED,
    QUEUE_STATUS.DEAD_LETTER,
    QUEUE_STATUS.BLOCKED,
  ].includes(status);
}

// =============================================================================
// Event Classification
// =============================================================================

function classifyEvent(eventType) {
  const normalizedType = normalizeString(eventType);

  return Object.freeze({
    eventType: normalizedType,
    known: isKnownEventType(normalizedType),
    category: getEventCategory(normalizedType),
    financial: isFinancialEventType(normalizedType),
    meeting: isMeetingEventType(normalizedType),
    device: isDeviceEventType(normalizedType),
    requiresIdempotency: requiresIdempotency(normalizedType),
    requiresSignature: requiresSignature(normalizedType),
    requiresFinancialBoundary:
      requiresFinancialBoundary(normalizedType),
  });
}

// =============================================================================
// Financial Event Safety Policy
// =============================================================================

function getFinancialSafetyPolicy(eventType) {
  const financial = isFinancialEventType(eventType);

  return Object.freeze({
    financial,

    requireIdempotency:
      financial && FINANCIAL.REQUIRE_IDEMPOTENCY_KEY,

    requireAtomicCommit:
      financial && FINANCIAL.REQUIRE_ATOMIC_COMMIT,

    requireCurrency:
      financial && FINANCIAL.REQUIRE_CURRENCY,

    requireAccountReference:
      financial && FINANCIAL.REQUIRE_ACCOUNT_REFERENCE,

    requireLedgerReference:
      financial && FINANCIAL.REQUIRE_LEDGER_REFERENCE,

    requireTransactionReference:
      financial && FINANCIAL.REQUIRE_TRANSACTION_REFERENCE,

    allowNegativeBalance:
      financial && FINANCIAL.ALLOW_NEGATIVE_BALANCE,

    clientMayAuthorize:
      financial && FINANCIAL.CLIENT_MAY_AUTHORIZE_FINANCIAL_COMMIT,

    clientMayFinalizeLedger:
      financial && FINANCIAL.CLIENT_MAY_FINALIZE_LEDGER_ENTRY,
  });
}

// =============================================================================
// Event Envelope Validation
// =============================================================================

function validateEventEnvelope(event) {
  if (!isObject(event)) {
    return {
      valid: false,
      errors: ['EVENT_ENVELOPE_REQUIRED'],
    };
  }

  const errors = [];

  const eventTypeResult = validateEventType(
    event[EVENT_METADATA.EVENT_TYPE],
  );

  if (!eventTypeResult.valid) {
    errors.push(eventTypeResult.reason);
  }

  const versionResult = validateEventVersion(
    event[EVENT_METADATA.EVENT_VERSION],
  );

  if (!versionResult.valid) {
    errors.push(versionResult.reason);
  }

  if (
    SECURITY.REQUIRE_TENANT_CONTEXT &&
    !isNonEmptyString(event[EVENT_METADATA.TENANT_ID])
  ) {
    errors.push('TENANT_ID_REQUIRED');
  }

  if (
    SECURITY.REQUIRE_DEVICE_IDENTITY &&
    !isNonEmptyString(event[EVENT_METADATA.DEVICE_ID])
  ) {
    errors.push('DEVICE_ID_REQUIRED');
  }

  if (
    requiresIdempotency(event[EVENT_METADATA.EVENT_TYPE]) &&
    !isNonEmptyString(event[EVENT_METADATA.IDEMPOTENCY_KEY])
  ) {
    errors.push(OFFLINE_ERROR_CODES.OFFLINE_IDEMPOTENCY_CONFLICT);
  }

  if (
    SECURITY.REQUIRE_EVENT_SIGNATURE &&
    !isNonEmptyString(event[EVENT_METADATA.SIGNATURE])
  ) {
    errors.push(OFFLINE_ERROR_CODES.OFFLINE_SIGNATURE_INVALID);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// =============================================================================
// Configuration Snapshot
// =============================================================================

function getConfiguration() {
  return Object.freeze({
    module: DOMAIN,
    eventVersion: EVENT_VERSION,
    retry: RETRY,
    sync: SYNC,
    storage: STORAGE,
    security: SECURITY,
    financial: FINANCIAL,
    currency: CURRENCY,
    cursor: CURSOR,
    reconciliation: RECONCILIATION,
    hashChain: HASH_CHAIN,
    limits: LIMITS,
    headers: HEADERS,
  });
}

// =============================================================================
// Public Module API
// =============================================================================

const offlineModule = Object.freeze({
  // Metadata
  MODULE_NAME,
  MODULE_VERSION,
  DOMAIN,

  // Canonical constants
  EVENT_TYPES,
  EVENT_CATEGORIES,
  EVENT_STATUS,

  SYNC_STATUS,
  CONFLICT_TYPES,
  CONFLICT_RESOLUTION,

  DEVICE_STATUS,
  MEETING_STATUS,

  FINANCIAL_OPERATION_STATUS,
  IDEMPOTENCY_STATUS,
  QUEUE_STATUS,

  AUDIT_ACTIONS,

  RETRY,
  SYNC,
  STORAGE,
  SECURITY,
  FINANCIAL,
  CURRENCY,
  CURSOR,
  RECONCILIATION,
  HASH_CHAIN,

  OFFLINE_ERROR_CODES,

  HEADERS,
  EVENT_METADATA,
  EVENT_VERSION,
  TIME,
  LIMITS,

  FINANCIAL_EVENT_TYPES,
  MEETING_EVENT_TYPES,
  DEVICE_EVENT_TYPES,

  // Generic helpers
  isNonEmptyString,
  normalizeString,
  isObject,
  hasOwn,

  // Event helpers
  isKnownEventType,
  isFinancialEventType,
  isMeetingEventType,
  isDeviceEventType,
  requiresIdempotency,
  requiresSignature,
  getEventCategory,
  validateEventType,
  validateEventVersion,
  validateEventEnvelope,
  classifyEvent,

  // Event status helpers
  isKnownEventStatus,
  isTerminalEventStatus,

  // Sync helpers
  isKnownSyncStatus,
  isTerminalSyncStatus,
  canRetrySync,

  // Conflict helpers
  isKnownConflictType,
  requiresManualConflictReview,
  isKnownConflictResolution,

  // Device helpers
  isKnownDeviceStatus,
  isTrustedDeviceStatus,
  isRevokedDeviceStatus,

  // Meeting helpers
  isKnownMeetingStatus,
  isMeetingOpen,
  isMeetingClosed,
  requiresMeetingReconciliation,

  // Financial helpers
  isKnownFinancialOperationStatus,
  isFinancialOperationTerminal,
  isValidAmount,
  isSupportedCurrency,
  normalizeCurrency,
  requiresFinancialBoundary,
  getFinancialSafetyPolicy,

  // Idempotency helpers
  isKnownIdempotencyStatus,
  isTerminalIdempotencyStatus,

  // Queue helpers
  isKnownQueueStatus,
  isTerminalQueueStatus,

  // Configuration
  getConfiguration,
});

module.exports = offlineModule;