'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (TITech)
 * =============================================================================
 *
 * File:
 *   backend/modules/offline/constants.js
 *
 * Purpose:
 *   Canonical constants for the TITech offline-first financial event system.
 *
 * Design Goals:
 *   - Single source of truth for offline domain constants
 *   - Immutable runtime configuration
 *   - Deterministic event processing
 *   - Idempotent synchronization support
 *   - Financial safety
 *   - Conflict detection and reconciliation
 *   - Device/session trust boundaries
 *   - Auditability and observability
 *   - Backward-compatible domain evolution
 *
 * Architecture:
 *
 *   Offline Device
 *        │
 *        ▼
 *   Local Event Store
 *        │
 *        ▼
 *   Event Validation
 *        │
 *        ▼
 *   Idempotent Sync
 *        │
 *        ├──────────────► Conflict Detection
 *        │
 *        ├──────────────► Reconciliation
 *        │
 *        ▼
 *   Server Financial Boundary
 *        │
 *        ▼
 *   Ledger / Transaction System
 *
 * IMPORTANT:
 *   These constants define domain vocabulary and safety boundaries.
 *   Business logic MUST NOT silently redefine these values elsewhere.
 *
 * =============================================================================
 */

// =============================================================================
// Module Metadata
// =============================================================================

const MODULE_NAME = 'offline';

const MODULE_VERSION = '1.0.0';

const DOMAIN = Object.freeze({
  NAME: MODULE_NAME,
  VERSION: MODULE_VERSION,
  SYSTEM: 'TITech',
  PRODUCT: 'TITech Community Capital',
});

// =============================================================================
// Event Types
// =============================================================================

const EVENT_TYPES = Object.freeze({
  MEETING_STARTED: 'MEETING_STARTED',
  MEETING_UPDATED: 'MEETING_UPDATED',
  MEETING_CLOSED: 'MEETING_CLOSED',

  MEMBER_REGISTERED: 'MEMBER_REGISTERED',
  MEMBER_UPDATED: 'MEMBER_UPDATED',

  CONTRIBUTION_CREATED: 'CONTRIBUTION_CREATED',
  CONTRIBUTION_RECORDED: 'CONTRIBUTION_RECORDED',
  CONTRIBUTION_REVERSED: 'CONTRIBUTION_REVERSED',

  SAVINGS_CREATED: 'SAVINGS_CREATED',
  SAVINGS_CONTRIBUTION: 'SAVINGS_CONTRIBUTION',
  SAVINGS_WITHDRAWAL: 'SAVINGS_WITHDRAWAL',

  LOAN_CREATED: 'LOAN_CREATED',
  LOAN_APPROVED: 'LOAN_APPROVED',
  LOAN_DISBURSED: 'LOAN_DISBURSED',
  LOAN_REPAYMENT: 'LOAN_REPAYMENT',
  LOAN_REVERSED: 'LOAN_REVERSED',

  WITHDRAWAL_REQUESTED: 'WITHDRAWAL_REQUESTED',
  WITHDRAWAL_COMPLETED: 'WITHDRAWAL_COMPLETED',
  WITHDRAWAL_REVERSED: 'WITHDRAWAL_REVERSED',

  WALLET_CREDIT: 'WALLET_CREDIT',
  WALLET_DEBIT: 'WALLET_DEBIT',

  LEDGER_ENTRY_CREATED: 'LEDGER_ENTRY_CREATED',
  LEDGER_ENTRY_REVERSED: 'LEDGER_ENTRY_REVERSED',

  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_REVERSED: 'PAYMENT_REVERSED',

  DEVICE_REGISTERED: 'DEVICE_REGISTERED',
  DEVICE_REVOKED: 'DEVICE_REVOKED',

  SYNC_REQUESTED: 'SYNC_REQUESTED',
  SYNC_COMPLETED: 'SYNC_COMPLETED',
  SYNC_FAILED: 'SYNC_FAILED',

  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  RECONCILIATION_COMPLETED: 'RECONCILIATION_COMPLETED',
});

// =============================================================================
// Event Categories
// =============================================================================

const EVENT_CATEGORIES = Object.freeze({
  MEETING: 'MEETING',
  MEMBER: 'MEMBER',
  CONTRIBUTION: 'CONTRIBUTION',
  SAVINGS: 'SAVINGS',
  LOAN: 'LOAN',
  WITHDRAWAL: 'WITHDRAWAL',
  WALLET: 'WALLET',
  LEDGER: 'LEDGER',
  PAYMENT: 'PAYMENT',
  DEVICE: 'DEVICE',
  SYNC: 'SYNC',
  RECONCILIATION: 'RECONCILIATION',
});

// =============================================================================
// Event Lifecycle States
// =============================================================================

const EVENT_STATUS = Object.freeze({
  CREATED: 'CREATED',
  VALIDATED: 'VALIDATED',
  QUEUED: 'QUEUED',
  SYNCING: 'SYNCING',
  ACCEPTED: 'ACCEPTED',
  APPLIED: 'APPLIED',
  DUPLICATE: 'DUPLICATE',
  CONFLICT: 'CONFLICT',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  RECONCILED: 'RECONCILED',
  CANCELLED: 'CANCELLED',
});

// =============================================================================
// Sync States
// =============================================================================

const SYNC_STATUS = Object.freeze({
  IDLE: 'IDLE',
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  PARTIAL: 'PARTIAL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
  CONFLICT: 'CONFLICT',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
});

// =============================================================================
// Conflict Types
// =============================================================================

const CONFLICT_TYPES = Object.freeze({
  VERSION_MISMATCH: 'VERSION_MISMATCH',
  DUPLICATE_EVENT: 'DUPLICATE_EVENT',
  DUPLICATE_OPERATION: 'DUPLICATE_OPERATION',
  INVALID_SEQUENCE: 'INVALID_SEQUENCE',
  STALE_EVENT: 'STALE_EVENT',
  INVALID_STATE: 'INVALID_STATE',
  FINANCIAL_MISMATCH: 'FINANCIAL_MISMATCH',
  LEDGER_MISMATCH: 'LEDGER_MISMATCH',
  BALANCE_MISMATCH: 'BALANCE_MISMATCH',
  DEVICE_TRUST_FAILURE: 'DEVICE_TRUST_FAILURE',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  HASH_MISMATCH: 'HASH_MISMATCH',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  MEMBER_MISMATCH: 'MEMBER_MISMATCH',
  MEETING_MISMATCH: 'MEETING_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
});

// =============================================================================
// Conflict Resolution Strategies
// =============================================================================

const CONFLICT_RESOLUTION = Object.freeze({
  ACCEPT_SERVER: 'ACCEPT_SERVER',
  ACCEPT_CLIENT: 'ACCEPT_CLIENT',
  MERGE: 'MERGE',
  REJECT: 'REJECT',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  REPLAY: 'REPLAY',
  RECONCILE: 'RECONCILE',
});

// =============================================================================
// Device Trust States
// =============================================================================

const DEVICE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
  COMPROMISED: 'COMPROMISED',
});

// =============================================================================
// Meeting States
// =============================================================================

const MEETING_STATUS = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  CLOSING: 'CLOSING',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
});

// =============================================================================
// Financial Operation States
// =============================================================================

const FINANCIAL_OPERATION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  VALIDATING: 'VALIDATING',
  AUTHORIZED: 'AUTHORIZED',
  PROCESSING: 'PROCESSING',
  COMMITTED: 'COMMITTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
  REJECTED: 'REJECTED',
  CONFLICT: 'CONFLICT',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
});

// =============================================================================
// Idempotency States
// =============================================================================

const IDEMPOTENCY_STATUS = Object.freeze({
  RESERVED: 'RESERVED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CONFLICT: 'CONFLICT',
  EXPIRED: 'EXPIRED',
});

// =============================================================================
// Queue States
// =============================================================================

const QUEUE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
  DEAD_LETTER: 'DEAD_LETTER',
  BLOCKED: 'BLOCKED',
});

// =============================================================================
// Audit Actions
// =============================================================================

const AUDIT_ACTIONS = Object.freeze({
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',

  RECORD: 'RECORD',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  AUTHORIZE: 'AUTHORIZE',

  COMMIT: 'COMMIT',
  REVERSE: 'REVERSE',

  SYNC: 'SYNC',
  REPLAY: 'REPLAY',

  CONFLICT: 'CONFLICT',
  RECONCILE: 'RECONCILE',

  DEVICE_REGISTER: 'DEVICE_REGISTER',
  DEVICE_REVOKE: 'DEVICE_REVOKE',

  SECURITY_BLOCK: 'SECURITY_BLOCK',
});

// =============================================================================
// Retry Configuration
// =============================================================================

const RETRY = Object.freeze({
  MAX_ATTEMPTS: 5,

  INITIAL_DELAY_MS: 1_000,

  MAX_DELAY_MS: 30_000,

  BACKOFF_MULTIPLIER: 2,

  JITTER_RATIO: 0.2,
});

// =============================================================================
// Sync Configuration
// =============================================================================

const SYNC = Object.freeze({
  DEFAULT_BATCH_SIZE: 100,

  MAX_BATCH_SIZE: 500,

  MAX_EVENT_PAYLOAD_BYTES: 256 * 1024,

  MAX_TOTAL_BATCH_BYTES: 5 * 1024 * 1024,

  DEFAULT_TIMEOUT_MS: 30_000,

  MAX_TIMEOUT_MS: 120_000,

  MAX_CONCURRENT_SYNC_JOBS: 4,

  MAX_PENDING_EVENTS: 10_000,

  MAX_SYNC_ATTEMPTS: 10,
});

// =============================================================================
// Offline Storage Configuration
// =============================================================================

const STORAGE = Object.freeze({
  EVENT_STORE: 'titech_offline_events',

  OUTBOX_STORE: 'titech_offline_outbox',

  INBOX_STORE: 'titech_offline_inbox',

  DEVICE_STORE: 'titech_offline_device',

  MEETING_STORE: 'titech_offline_meetings',

  SYNC_CURSOR_STORE: 'titech_offline_sync_cursors',

  RECONCILIATION_STORE: 'titech_offline_reconciliation',

  AUDIT_STORE: 'titech_offline_audit',
});

// =============================================================================
// Security Configuration
// =============================================================================

const SECURITY = Object.freeze({
  HASH_ALGORITHM: 'sha256',

  SIGNATURE_ALGORITHM: 'ed25519',

  EVENT_ID_BYTES: 16,

  DEVICE_ID_BYTES: 16,

  IDEMPOTENCY_KEY_BYTES: 32,

  NONCE_BYTES: 16,

  MAX_CLOCK_SKEW_MS: 5 * 60 * 1000,

  REQUIRE_EVENT_SIGNATURE: true,

  REQUIRE_DEVICE_IDENTITY: true,

  REQUIRE_TENANT_CONTEXT: true,

  REQUIRE_IDEMPOTENCY_FOR_FINANCIAL_EVENTS: true,
});

// =============================================================================
// Financial Safety Configuration
// =============================================================================

const FINANCIAL = Object.freeze({
  ZERO_AMOUNT: 0,

  MIN_AMOUNT: 0,

  MAX_DECIMAL_PLACES: 2,

  REQUIRE_POSITIVE_AMOUNT: true,

  REQUIRE_CURRENCY: true,

  REQUIRE_ACCOUNT_REFERENCE: true,

  REQUIRE_LEDGER_REFERENCE: true,

  REQUIRE_TRANSACTION_REFERENCE: true,

  REQUIRE_IDEMPOTENCY_KEY: true,

  REQUIRE_ATOMIC_COMMIT: true,

  ALLOW_NEGATIVE_BALANCE: false,

  ALLOW_CLIENT_LEDGER_AUTHORITY: false,

  CLIENT_MAY_AUTHORIZE_FINANCIAL_COMMIT: false,

  CLIENT_MAY_FINALIZE_LEDGER_ENTRY: false,
});

// =============================================================================
// Currency
// =============================================================================

const CURRENCY = Object.freeze({
  DEFAULT: 'UGX',

  SUPPORTED: Object.freeze([
    'UGX',
    'KES',
    'TZS',
    'RWF',
    'USD',
    'EUR',
    'GBP',
  ]),
});

// =============================================================================
// Pagination / Cursor Configuration
// =============================================================================

const CURSOR = Object.freeze({
  INITIAL: null,

  MAX_LENGTH: 512,

  VERSION: 1,
});

// =============================================================================
// Reconciliation Configuration
// =============================================================================

const RECONCILIATION = Object.freeze({
  STATUS_PENDING: 'PENDING',

  STATUS_IN_PROGRESS: 'IN_PROGRESS',

  STATUS_RESOLVED: 'RESOLVED',

  STATUS_ESCALATED: 'ESCALATED',

  STATUS_REJECTED: 'REJECTED',

  MAX_AUTOMATIC_ATTEMPTS: 3,

  REQUIRE_AUDIT_TRAIL: true,

  REQUIRE_SERVER_LEDGER_VALIDATION: true,

  REQUIRE_MANUAL_REVIEW_FOR_FINANCIAL_MISMATCH: true,
});

// =============================================================================
// Hash Chain Configuration
// =============================================================================

const HASH_CHAIN = Object.freeze({
  ALGORITHM: 'sha256',

  GENESIS_HASH: 'GENESIS',

  REQUIRE_PREVIOUS_HASH: true,

  REQUIRE_SEQUENCE_NUMBER: true,

  VERIFY_ON_SYNC: true,

  VERIFY_ON_RECONCILIATION: true,
});

// =============================================================================
// Error Codes
// =============================================================================

const OFFLINE_ERROR_CODES = Object.freeze({
  OFFLINE_EVENT_INVALID: 'OFFLINE_EVENT_INVALID',
  OFFLINE_EVENT_DUPLICATE: 'OFFLINE_EVENT_DUPLICATE',
  OFFLINE_EVENT_REJECTED: 'OFFLINE_EVENT_REJECTED',

  OFFLINE_SYNC_FAILED: 'OFFLINE_SYNC_FAILED',
  OFFLINE_SYNC_CONFLICT: 'OFFLINE_SYNC_CONFLICT',
  OFFLINE_SYNC_BLOCKED: 'OFFLINE_SYNC_BLOCKED',

  OFFLINE_DEVICE_UNTRUSTED: 'OFFLINE_DEVICE_UNTRUSTED',
  OFFLINE_DEVICE_REVOKED: 'OFFLINE_DEVICE_REVOKED',

  OFFLINE_SIGNATURE_INVALID: 'OFFLINE_SIGNATURE_INVALID',
  OFFLINE_HASH_MISMATCH: 'OFFLINE_HASH_MISMATCH',

  OFFLINE_SEQUENCE_INVALID: 'OFFLINE_SEQUENCE_INVALID',
  OFFLINE_CURSOR_INVALID: 'OFFLINE_CURSOR_INVALID',

  OFFLINE_TENANT_MISMATCH: 'OFFLINE_TENANT_MISMATCH',
  OFFLINE_MEETING_CLOSED: 'OFFLINE_MEETING_CLOSED',

  OFFLINE_FINANCIAL_CONFLICT: 'OFFLINE_FINANCIAL_CONFLICT',
  OFFLINE_LEDGER_CONFLICT: 'OFFLINE_LEDGER_CONFLICT',

  OFFLINE_IDEMPOTENCY_CONFLICT: 'OFFLINE_IDEMPOTENCY_CONFLICT',

  OFFLINE_RECONCILIATION_REQUIRED: 'OFFLINE_RECONCILIATION_REQUIRED',
});

// =============================================================================
// HTTP Headers
// =============================================================================

const HEADERS = Object.freeze({
  IDEMPOTENCY_KEY: 'Idempotency-Key',

  DEVICE_ID: 'X-Device-ID',

  TENANT_ID: 'X-Tenant-ID',

  SYNC_CURSOR: 'X-Sync-Cursor',

  EVENT_ID: 'X-Event-ID',

  EVENT_SIGNATURE: 'X-Event-Signature',

  EVENT_HASH: 'X-Event-Hash',

  CLIENT_TIMESTAMP: 'X-Client-Timestamp',

  CLIENT_VERSION: 'X-Client-Version',
});

// =============================================================================
// Event Metadata Keys
// =============================================================================

const EVENT_METADATA = Object.freeze({
  EVENT_ID: 'eventId',

  EVENT_TYPE: 'eventType',

  EVENT_VERSION: 'eventVersion',

  TENANT_ID: 'tenantId',

  MEMBER_ID: 'memberId',

  GROUP_ID: 'groupId',

  MEETING_ID: 'meetingId',

  DEVICE_ID: 'deviceId',

  USER_ID: 'userId',

  REQUEST_ID: 'requestId',

  CORRELATION_ID: 'correlationId',

  IDEMPOTENCY_KEY: 'idempotencyKey',

  SEQUENCE: 'sequence',

  PREVIOUS_HASH: 'previousHash',

  HASH: 'hash',

  SIGNATURE: 'signature',

  CREATED_AT: 'createdAt',

  CLIENT_CREATED_AT: 'clientCreatedAt',

  SERVER_RECEIVED_AT: 'serverReceivedAt',

  VERSION: 'version',
});

// =============================================================================
// Event Versioning
// =============================================================================

const EVENT_VERSION = Object.freeze({
  CURRENT: 1,

  MIN_SUPPORTED: 1,

  MAX_SUPPORTED: 1,
});

// =============================================================================
// Time Configuration
// =============================================================================

const TIME = Object.freeze({
  MS_PER_SECOND: 1_000,

  MS_PER_MINUTE: 60 * 1_000,

  MS_PER_HOUR: 60 * 60 * 1_000,

  MS_PER_DAY: 24 * 60 * 60 * 1_000,
});

// =============================================================================
// Operational Limits
// =============================================================================

const LIMITS = Object.freeze({
  MAX_EVENT_ID_LENGTH: 128,

  MAX_DEVICE_ID_LENGTH: 128,

  MAX_TENANT_ID_LENGTH: 128,

  MAX_MEMBER_ID_LENGTH: 128,

  MAX_MEETING_ID_LENGTH: 128,

  MAX_GROUP_ID_LENGTH: 128,

  MAX_TRANSACTION_ID_LENGTH: 128,

  MAX_IDEMPOTENCY_KEY_LENGTH: 256,

  MAX_CORRELATION_ID_LENGTH: 128,

  MAX_REQUEST_ID_LENGTH: 128,

  MAX_EVENT_TYPE_LENGTH: 128,

  MAX_BATCH_EVENTS: SYNC.MAX_BATCH_SIZE,
});

// =============================================================================
// Event Type Classification
// =============================================================================

const FINANCIAL_EVENT_TYPES = Object.freeze([
  EVENT_TYPES.CONTRIBUTION_CREATED,
  EVENT_TYPES.CONTRIBUTION_RECORDED,
  EVENT_TYPES.CONTRIBUTION_REVERSED,

  EVENT_TYPES.SAVINGS_CREATED,
  EVENT_TYPES.SAVINGS_CONTRIBUTION,
  EVENT_TYPES.SAVINGS_WITHDRAWAL,

  EVENT_TYPES.LOAN_CREATED,
  EVENT_TYPES.LOAN_APPROVED,
  EVENT_TYPES.LOAN_DISBURSED,
  EVENT_TYPES.LOAN_REPAYMENT,
  EVENT_TYPES.LOAN_REVERSED,

  EVENT_TYPES.WITHDRAWAL_REQUESTED,
  EVENT_TYPES.WITHDRAWAL_COMPLETED,
  EVENT_TYPES.WITHDRAWAL_REVERSED,

  EVENT_TYPES.WALLET_CREDIT,
  EVENT_TYPES.WALLET_DEBIT,

  EVENT_TYPES.LEDGER_ENTRY_CREATED,
  EVENT_TYPES.LEDGER_ENTRY_REVERSED,

  EVENT_TYPES.PAYMENT_INITIATED,
  EVENT_TYPES.PAYMENT_COMPLETED,
  EVENT_TYPES.PAYMENT_FAILED,
  EVENT_TYPES.PAYMENT_REVERSED,
]);

const MEETING_EVENT_TYPES = Object.freeze([
  EVENT_TYPES.MEETING_STARTED,
  EVENT_TYPES.MEETING_UPDATED,
  EVENT_TYPES.MEETING_CLOSED,
]);

const DEVICE_EVENT_TYPES = Object.freeze([
  EVENT_TYPES.DEVICE_REGISTERED,
  EVENT_TYPES.DEVICE_REVOKED,
]);

// =============================================================================
// Frozen Aggregate Export
// =============================================================================

const OFFLINE_CONSTANTS = Object.freeze({
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
});

// =============================================================================
// Public API
// =============================================================================

module.exports = OFFLINE_CONSTANTS;