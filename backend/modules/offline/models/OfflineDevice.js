'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (TITech)
 * =============================================================================
 *
 * File:
 *   backend/modules/offline/models/OfflineDevice.js
 *
 * Purpose:
 *   Persistent identity and trust model for TITech offline-first devices.
 *
 * Design Principles:
 *   - Tenant isolation
 *   - Device identity
 *   - Explicit trust lifecycle
 *   - Cryptographic public-key registration
 *   - Device revocation
 *   - Sync cursor tracking
 *   - Optimistic concurrency
 *   - Replay protection metadata
 *   - Auditability
 *   - Financial safety
 *
 * IMPORTANT:
 *   An OfflineDevice represents a trusted client execution environment.
 *   It does NOT represent a financial account and MUST NOT be treated as
 *   authoritative for balances, ledger entries, or financial commitments.
 *
 *   The server remains authoritative for:
 *     - Account balances
 *     - Ledger entries
 *     - Transaction commitment
 *     - Financial authorization
 *     - Reconciliation
 *     - Idempotency state
 *
 * =============================================================================
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

// =============================================================================
// Constants
// =============================================================================

const {
  Schema,
} = mongoose;

const {
  DEVICE_STATUS,
} = require('../constants');

const MODEL_NAME = 'OfflineDevice';

const COLLECTION_NAME = 'offline_devices';

const SCHEMA_VERSION = 1;

const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const DEFAULT_SYNC_BATCH_SIZE = 100;

const DEFAULT_MAX_SYNC_ATTEMPTS = 10;

const DEFAULT_MAX_PENDING_EVENTS = 10_000;

const SUPPORTED_KEY_TYPES = Object.freeze([
  'ed25519',
]);

const SUPPORTED_KEY_ENCODINGS = Object.freeze([
  'base64',
  'base64url',
  'hex',
]);

const TRUSTED_STATUSES = Object.freeze([
  DEVICE_STATUS.ACTIVE,
]);

const TERMINAL_STATUSES = Object.freeze([
  DEVICE_STATUS.REVOKED,
  DEVICE_STATUS.COMPROMISED,
  DEVICE_STATUS.EXPIRED,
]);

// =============================================================================
// Utility Functions
// =============================================================================

function normalizeString(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();

  return normalized.length > 0
    ? normalized
    : null;
}

function normalizeLowercase(value) {
  const normalized = normalizeString(value);

  return typeof normalized === 'string'
    ? normalized.toLowerCase()
    : normalized;
}

function normalizeUppercase(value) {
  const normalized = normalizeString(value);

  return typeof normalized === 'string'
    ? normalized.toUpperCase()
    : normalized;
}

function generateDeviceFingerprint() {
  return crypto
    .createHash('sha256')
    .update(crypto.randomBytes(32))
    .digest('hex');
}

function generateRegistrationNonce() {
  return crypto.randomBytes(32).toString('hex');
}

function generateDeviceTokenHash(token) {
  if (!token) {
    return null;
  }

  return crypto
    .createHash('sha256')
    .update(String(token), 'utf8')
    .digest('hex');
}

function isValidObjectId(value) {
  return mongoose.isValidObjectId(value);
}

function isFiniteNumber(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value)
  );
}

function sanitizeDeviceName(value) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 128);
}

// =============================================================================
// Subdocuments
// =============================================================================

const PublicKeySchema = new Schema(
  {
    keyId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },

    algorithm: {
      type: String,
      enum: SUPPORTED_KEY_TYPES,
      required: true,
      default: 'ed25519',
    },

    encoding: {
      type: String,
      enum: SUPPORTED_KEY_ENCODINGS,
      required: true,
      default: 'base64',
    },

    publicKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4096,
    },

    fingerprint: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 128,
    },

    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },

    activatedAt: {
      type: Date,
      default: null,
    },

    revokedAt: {
      type: Date,
      default: null,
    },

    revokedReason: {
      type: String,
      trim: true,
      maxlength: 512,
      default: null,
    },

    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: false,
    versionKey: false,
  },
);

const SyncStateSchema = new Schema(
  {
    cursor: {
      type: String,
      trim: true,
      maxlength: 512,
      default: null,
    },

    lastSuccessfulSyncAt: {
      type: Date,
      default: null,
    },

    lastAttemptAt: {
      type: Date,
      default: null,
    },

    lastFailureAt: {
      type: Date,
      default: null,
    },

    lastFailureCode: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    lastFailureMessage: {
      type: String,
      trim: true,
      maxlength: 512,
      default: null,
    },

    consecutiveFailures: {
      type: Number,
      min: 0,
      default: 0,
    },

    totalSyncAttempts: {
      type: Number,
      min: 0,
      default: 0,
    },

    totalSuccessfulSyncs: {
      type: Number,
      min: 0,
      default: 0,
    },

    totalFailedSyncs: {
      type: Number,
      min: 0,
      default: 0,
    },

    pendingEventCount: {
      type: Number,
      min: 0,
      default: 0,
    },

    lastSequenceNumber: {
      type: Number,
      min: 0,
      default: 0,
    },

    lastEventHash: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    lastServerSequence: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    _id: false,
    versionKey: false,
  },
);

const SecurityStateSchema = new Schema(
  {
    failedAuthenticationAttempts: {
      type: Number,
      min: 0,
      default: 0,
    },

    failedSignatureAttempts: {
      type: Number,
      min: 0,
      default: 0,
    },

    suspiciousActivityCount: {
      type: Number,
      min: 0,
      default: 0,
    },

    lastAuthenticationAt: {
      type: Date,
      default: null,
    },

    lastAuthenticationFailureAt: {
      type: Date,
      default: null,
    },

    lastSignatureVerificationAt: {
      type: Date,
      default: null,
    },

    lastSuspiciousActivityAt: {
      type: Date,
      default: null,
    },

    lockedUntil: {
      type: Date,
      default: null,
    },

    securityReviewRequired: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: false,
    versionKey: false,
  },
);

const CapabilitiesSchema = new Schema(
  {
    offlineEvents: {
      type: Boolean,
      default: true,
    },

    offlineMeetings: {
      type: Boolean,
      default: true,
    },

    offlineContributions: {
      type: Boolean,
      default: true,
    },

    offlineLoans: {
      type: Boolean,
      default: false,
    },

    offlineWithdrawals: {
      type: Boolean,
      default: false,
    },

    offlineFinancialEvents: {
      type: Boolean,
      default: true,
    },

    backgroundSync: {
      type: Boolean,
      default: true,
    },

    pushNotifications: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: false,
    versionKey: false,
  },
);

// =============================================================================
// Main Schema
// =============================================================================

const OfflineDeviceSchema = new Schema(
  {
    // -------------------------------------------------------------------------
    // Schema / Domain Metadata
    // -------------------------------------------------------------------------

    schemaVersion: {
      type: Number,
      required: true,
      default: SCHEMA_VERSION,
      min: 1,
    },

    system: {
      type: String,
      required: true,
      immutable: true,
      default: 'TITech',
      enum: ['TITech'],
    },

    // -------------------------------------------------------------------------
    // Tenant Isolation
    // -------------------------------------------------------------------------

    tenantId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Device Identity
    // -------------------------------------------------------------------------

    deviceId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      immutable: true,
    },

    deviceFingerprint: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 128,
      immutable: true,
    },

    deviceName: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
      set: sanitizeDeviceName,
    },

    deviceType: {
      type: String,
      trim: true,
      maxlength: 64,
      default: 'mobile',
    },

    platform: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
    },

    platformVersion: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
    },

    appVersion: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
    },

    clientVersion: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Ownership
    // -------------------------------------------------------------------------

    registeredByUserId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    assignedUserId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    groupId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Trust Lifecycle
    // -------------------------------------------------------------------------

    status: {
      type: String,
      required: true,
      enum: Object.values(DEVICE_STATUS),
      default: DEVICE_STATUS.PENDING,
      index: true,
    },

    trusted: {
      type: Boolean,
      default: false,
      index: true,
    },

    trustedAt: {
      type: Date,
      default: null,
    },

    trustExpiresAt: {
      type: Date,
      default: null,
    },

    revokedAt: {
      type: Date,
      default: null,
    },

    revokedByUserId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    revokedReason: {
      type: String,
      trim: true,
      maxlength: 512,
      default: null,
    },

    suspensionReason: {
      type: String,
      trim: true,
      maxlength: 512,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Cryptographic Identity
    // -------------------------------------------------------------------------

    keyId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    keyAlgorithm: {
      type: String,
      enum: SUPPORTED_KEY_TYPES,
      default: 'ed25519',
    },

    publicKeyEncoding: {
      type: String,
      enum: SUPPORTED_KEY_ENCODINGS,
      default: 'base64',
    },

    publicKey: {
      type: String,
      trim: true,
      maxlength: 4096,
      default: null,
    },

    publicKeyFingerprint: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 128,
      default: null,
    },

    publicKeys: {
      type: [PublicKeySchema],
      default: [],
    },

    registrationNonce: {
      type: String,
      trim: true,
      maxlength: 128,
      default: generateRegistrationNonce,
    },

    // -------------------------------------------------------------------------
    // Device Token Security
    // -------------------------------------------------------------------------

    deviceTokenHash: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 128,
      select: false,
      default: null,
    },

    tokenIssuedAt: {
      type: Date,
      default: null,
    },

    tokenExpiresAt: {
      type: Date,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Sync State
    // -------------------------------------------------------------------------

    sync: {
      type: SyncStateSchema,
      required: true,
      default: () => ({}),
    },

    // -------------------------------------------------------------------------
    // Security State
    // -------------------------------------------------------------------------

    security: {
      type: SecurityStateSchema,
      required: true,
      default: () => ({}),
    },

    // -------------------------------------------------------------------------
    // Capabilities
    // -------------------------------------------------------------------------

    capabilities: {
      type: CapabilitiesSchema,
      required: true,
      default: () => ({}),
    },

    // -------------------------------------------------------------------------
    // Clock / Replay Protection
    // -------------------------------------------------------------------------

    maxClockSkewMs: {
      type: Number,
      min: 0,
      max: 24 * 60 * 60 * 1000,
      default: DEFAULT_MAX_CLOCK_SKEW_MS,
    },

    lastClientTimestamp: {
      type: Date,
      default: null,
    },

    lastSeenSequence: {
      type: Number,
      min: 0,
      default: 0,
    },

    lastSeenEventId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Operational Limits
    // -------------------------------------------------------------------------

    maxSyncBatchSize: {
      type: Number,
      min: 1,
      max: 500,
      default: DEFAULT_SYNC_BATCH_SIZE,
    },

    maxPendingEvents: {
      type: Number,
      min: 1,
      max: 100_000,
      default: DEFAULT_MAX_PENDING_EVENTS,
    },

    maxSyncAttempts: {
      type: Number,
      min: 1,
      max: 100,
      default: DEFAULT_MAX_SYNC_ATTEMPTS,
    },

    // -------------------------------------------------------------------------
    // Network / Runtime Metadata
    // -------------------------------------------------------------------------

    lastIpAddress: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    lastUserAgent: {
      type: String,
      trim: true,
      maxlength: 1024,
      default: null,
    },

    lastSeenAt: {
      type: Date,
      default: null,
      index: true,
    },

    lastAuthenticatedAt: {
      type: Date,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Registration / Lifecycle
    // -------------------------------------------------------------------------

    registeredAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },

    activatedAt: {
      type: Date,
      default: null,
    },

    suspendedAt: {
      type: Date,
      default: null,
    },

    expiredAt: {
      type: Date,
      default: null,
    },

    lastUpdatedByUserId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Audit Metadata
    // -------------------------------------------------------------------------

    createdBy: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
      immutable: true,
    },

    updatedBy: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    auditVersion: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    collection: COLLECTION_NAME,

    timestamps: true,

    versionKey: '__v',

    optimisticConcurrency: true,

    strict: 'throw',

    minimize: false,

    toJSON: {
      virtuals: true,

      transform(_doc, ret) {
        delete ret.deviceTokenHash;
        delete ret.registrationNonce;

        /*
         * Never expose private cryptographic material through ordinary
         * serialization. Public keys and fingerprints are safe to expose
         * according to the surrounding authorization policy.
         */
        return ret;
      },
    },

    toObject: {
      virtuals: true,
    },
  },
);

// =============================================================================
// Indexes
// =============================================================================

/**
 * Canonical tenant/device identity.
 *
 * A device ID is only unique inside a tenant boundary.
 */
OfflineDeviceSchema.index(
  {
    tenantId: 1,
    deviceId: 1,
  },
  {
    unique: true,
    name: 'uniq_offline_device_tenant_device',
  },
);

/**
 * Device fingerprint must also be tenant-scoped.
 */
OfflineDeviceSchema.index(
  {
    tenantId: 1,
    deviceFingerprint: 1,
  },
  {
    unique: true,
    name: 'uniq_offline_device_tenant_fingerprint',
  },
);

/**
 * Public-key fingerprint uniqueness within a tenant.
 */
OfflineDeviceSchema.index(
  {
    tenantId: 1,
    publicKeyFingerprint: 1,
  },
  {
    unique: true,
    sparse: true,
    name: 'uniq_offline_device_tenant_public_key',
  },
);

/**
 * Operational lookup.
 */
OfflineDeviceSchema.index(
  {
    tenantId: 1,
    status: 1,
    trusted: 1,
  },
  {
    name: 'idx_offline_device_trust_state',
  },
);

/**
 * User → devices lookup.
 */
OfflineDeviceSchema.index(
  {
    tenantId: 1,
    assignedUserId: 1,
    status: 1,
  },
  {
    name: 'idx_offline_device_user_status',
  },
);

/**
 * Group → devices lookup.
 */
OfflineDeviceSchema.index(
  {
    tenantId: 1,
    groupId: 1,
    status: 1,
  },
  {
    name: 'idx_offline_device_group_status',
  },
);

/**
 * Sync monitoring.
 */
OfflineDeviceSchema.index(
  {
    tenantId: 1,
    'sync.lastSuccessfulSyncAt': 1,
  },
  {
    name: 'idx_offline_device_last_sync',
  },
);

/**
 * Devices requiring security attention.
 */
OfflineDeviceSchema.index(
  {
    tenantId: 1,
    'security.securityReviewRequired': 1,
    status: 1,
  },
  {
    name: 'idx_offline_device_security_review',
  },
);

/**
 * Recently active devices.
 */
OfflineDeviceSchema.index(
  {
    tenantId: 1,
    lastSeenAt: -1,
  },
  {
    name: 'idx_offline_device_last_seen',
  },
);

// =============================================================================
// Virtuals
// =============================================================================

OfflineDeviceSchema.virtual('isTrusted').get(function isTrusted() {
  return (
    this.status === DEVICE_STATUS.ACTIVE &&
    this.trusted === true &&
    !this.isTrustExpired()
  );
});

OfflineDeviceSchema.virtual('isRevoked').get(function isRevoked() {
  return [
    DEVICE_STATUS.REVOKED,
    DEVICE_STATUS.COMPROMISED,
  ].includes(this.status);
});

OfflineDeviceSchema.virtual('isTerminal').get(function isTerminal() {
  return TERMINAL_STATUSES.includes(this.status);
});

OfflineDeviceSchema.virtual('hasPendingEvents').get(
  function hasPendingEvents() {
    return (
      Number(this.sync?.pendingEventCount || 0) > 0
    );
  },
);

// =============================================================================
// Instance Methods
// =============================================================================

OfflineDeviceSchema.methods.isTrustExpired =
  function isTrustExpired(referenceDate = new Date()) {
    if (!this.trustExpiresAt) {
      return false;
    }

    return this.trustExpiresAt.getTime() <= referenceDate.getTime();
  };

OfflineDeviceSchema.methods.isOperational =
  function isOperational(referenceDate = new Date()) {
    if (
      this.status !== DEVICE_STATUS.ACTIVE ||
      this.trusted !== true
    ) {
      return false;
    }

    if (this.isTrustExpired(referenceDate)) {
      return false;
    }

    if (
      this.security?.lockedUntil &&
      this.security.lockedUntil.getTime() >
        referenceDate.getTime()
    ) {
      return false;
    }

    return true;
  };

OfflineDeviceSchema.methods.canSync =
  function canSync(referenceDate = new Date()) {
    return this.isOperational(referenceDate);
  };

OfflineDeviceSchema.methods.canCreateOfflineEvents =
  function canCreateOfflineEvents() {
    return (
      this.isOperational() &&
      this.capabilities?.offlineEvents === true
    );
  };

OfflineDeviceSchema.methods.canCreateFinancialEvents =
  function canCreateFinancialEvents() {
    return (
      this.isOperational() &&
      this.capabilities?.offlineFinancialEvents === true
    );
  };

OfflineDeviceSchema.methods.canCreateLoans =
  function canCreateLoans() {
    return (
      this.isOperational() &&
      this.capabilities?.offlineLoans === true
    );
  };

OfflineDeviceSchema.methods.canCreateWithdrawals =
  function canCreateWithdrawals() {
    return (
      this.isOperational() &&
      this.capabilities?.offlineWithdrawals === true
    );
  };

OfflineDeviceSchema.methods.markSeen =
  function markSeen(metadata = {}) {
    this.lastSeenAt = new Date();

    if (metadata.ipAddress) {
      this.lastIpAddress =
        normalizeString(metadata.ipAddress);
    }

    if (metadata.userAgent) {
      this.lastUserAgent =
        normalizeString(metadata.userAgent);
    }

    if (metadata.clientVersion) {
      this.clientVersion =
        normalizeString(metadata.clientVersion);
    }

    return this;
  };

OfflineDeviceSchema.methods.markAuthenticated =
  function markAuthenticated() {
    const now = new Date();

    this.lastAuthenticatedAt = now;

    this.security.lastAuthenticationAt = now;

    this.security.failedAuthenticationAttempts = 0;

    return this.markSeen();
  };

OfflineDeviceSchema.methods.recordAuthenticationFailure =
  function recordAuthenticationFailure() {
    const now = new Date();

    this.security.failedAuthenticationAttempts += 1;

    this.security.lastAuthenticationFailureAt = now;

    return this.markSeen();
  };

OfflineDeviceSchema.methods.recordSignatureFailure =
  function recordSignatureFailure() {
    const now = new Date();

    this.security.failedSignatureAttempts += 1;

    this.security.lastSuspiciousActivityAt = now;

    this.security.suspiciousActivityCount += 1;

    return this;
  };

OfflineDeviceSchema.methods.markSecurityReviewRequired =
  function markSecurityReviewRequired() {
    this.security.securityReviewRequired = true;

    return this;
  };

OfflineDeviceSchema.methods.clearSecurityReview =
  function clearSecurityReview() {
    this.security.securityReviewRequired = false;

    return this;
  };

OfflineDeviceSchema.methods.updateSyncSuccess =
  function updateSyncSuccess({
    cursor = null,
    sequence = null,
    eventHash = null,
    serverSequence = null,
    processedCount = 0,
  } = {}) {
    const now = new Date();

    this.sync.lastSuccessfulSyncAt = now;
    this.sync.lastAttemptAt = now;
    this.sync.lastFailureAt = null;
    this.sync.lastFailureCode = null;
    this.sync.lastFailureMessage = null;

    this.sync.consecutiveFailures = 0;

    this.sync.totalSyncAttempts += 1;
    this.sync.totalSuccessfulSyncs += 1;

    if (cursor !== null) {
      this.sync.cursor = cursor;
    }

    if (Number.isInteger(sequence)) {
      this.sync.lastSequenceNumber = Math.max(
        this.sync.lastSequenceNumber,
        sequence,
      );

      this.lastSeenSequence = Math.max(
        this.lastSeenSequence,
        sequence,
      );
    }

    if (isNonEmptyString(eventHash)) {
      this.sync.lastEventHash = eventHash;
    }

    if (Number.isInteger(serverSequence)) {
      this.sync.lastServerSequence = Math.max(
        this.sync.lastServerSequence,
        serverSequence,
      );
    }

    if (Number.isInteger(processedCount)) {
      this.sync.pendingEventCount = Math.max(
        0,
        this.sync.pendingEventCount - processedCount,
      );
    }

    this.markSeen();

    return this;
  };

OfflineDeviceSchema.methods.updateSyncFailure =
  function updateSyncFailure({
    code = 'OFFLINE_SYNC_FAILED',
    message = null,
  } = {}) {
    const now = new Date();

    this.sync.lastAttemptAt = now;
    this.sync.lastFailureAt = now;

    this.sync.lastFailureCode =
      normalizeString(code);

    this.sync.lastFailureMessage =
      normalizeString(message);

    this.sync.consecutiveFailures += 1;

    this.sync.totalSyncAttempts += 1;
    this.sync.totalFailedSyncs += 1;

    this.markSeen();

    return this;
  };

OfflineDeviceSchema.methods.setPendingEventCount =
  function setPendingEventCount(count) {
    if (
      !Number.isInteger(count) ||
      count < 0
    ) {
      throw new TypeError(
        'pending event count must be a non-negative integer.',
      );
    }

    if (count > this.maxPendingEvents) {
      throw new RangeError(
        'Pending event count exceeds the configured device limit.',
      );
    }

    this.sync.pendingEventCount = count;

    return this;
  };

OfflineDeviceSchema.methods.advanceSequence =
  function advanceSequence(sequence) {
    if (
      !Number.isInteger(sequence) ||
      sequence < 0
    ) {
      throw new TypeError(
        'Sequence must be a non-negative integer.',
      );
    }

    if (sequence <= this.lastSeenSequence) {
      return false;
    }

    this.lastSeenSequence = sequence;

    this.sync.lastSequenceNumber = Math.max(
      this.sync.lastSequenceNumber,
      sequence,
    );

    return true;
  };

OfflineDeviceSchema.methods.revoke =
  function revoke({
    reason = 'Device revoked.',
    revokedByUserId = null,
    status = DEVICE_STATUS.REVOKED,
  } = {}) {
    if (
      ![
        DEVICE_STATUS.REVOKED,
        DEVICE_STATUS.COMPROMISED,
      ].includes(status)
    ) {
      throw new Error(
        'Invalid terminal device status.',
      );
    }

    const now = new Date();

    this.status = status;

    this.trusted = false;

    this.revokedAt = now;

    this.revokedByUserId =
      normalizeString(revokedByUserId);

    this.revokedReason =
      normalizeString(reason);

    this.security.securityReviewRequired =
      false;

    return this;
  };

OfflineDeviceSchema.methods.suspend =
  function suspend(reason = 'Device suspended.') {
    this.status = DEVICE_STATUS.SUSPENDED;

    this.trusted = false;

    this.suspendedAt = new Date();

    this.suspensionReason =
      normalizeString(reason);

    return this;
  };

OfflineDeviceSchema.methods.activate =
  function activate({
    trustExpiresAt = null,
  } = {}) {
    this.status = DEVICE_STATUS.ACTIVE;

    this.trusted = true;

    const now = new Date();

    this.trustedAt =
      this.trustedAt || now;

    this.activatedAt =
      this.activatedAt || now;

    this.suspendedAt = null;

    this.suspensionReason = null;

    if (trustExpiresAt) {
      this.trustExpiresAt =
        new Date(trustExpiresAt);
    }

    return this;
  };

OfflineDeviceSchema.methods.expire =
  function expire() {
    this.status = DEVICE_STATUS.EXPIRED;

    this.trusted = false;

    this.expiredAt = new Date();

    return this;
  };

OfflineDeviceSchema.methods.addPublicKey =
  function addPublicKey({
    keyId,
    algorithm = 'ed25519',
    encoding = 'base64',
    publicKey,
    fingerprint,
  }) {
    if (!isNonEmptyString(keyId)) {
      throw new TypeError(
        'keyId is required.',
      );
    }

    if (!isNonEmptyString(publicKey)) {
      throw new TypeError(
        'publicKey is required.',
      );
    }

    if (!isNonEmptyString(fingerprint)) {
      throw new TypeError(
        'fingerprint is required.',
      );
    }

    const existing =
      this.publicKeys.find(
        (key) =>
          key.keyId === keyId &&
          key.active === true,
      );

    if (existing) {
      throw new Error(
        'An active public key with this keyId already exists.',
      );
    }

    this.publicKeys.push({
      keyId,
      algorithm,
      encoding,
      publicKey,
      fingerprint:
        fingerprint.toLowerCase(),
      createdAt: new Date(),
      activatedAt: new Date(),
      revokedAt: null,
      revokedReason: null,
      active: true,
    });

    this.keyId = keyId;
    this.keyAlgorithm = algorithm;
    this.publicKeyEncoding = encoding;
    this.publicKey = publicKey;
    this.publicKeyFingerprint =
      fingerprint.toLowerCase();

    return this;
  };

OfflineDeviceSchema.methods.revokePublicKey =
  function revokePublicKey(
    keyId,
    reason = 'Public key revoked.',
  ) {
    const key =
      this.publicKeys.find(
        (entry) =>
          entry.keyId === keyId &&
          entry.active === true,
      );

    if (!key) {
      return false;
    }

    key.active = false;

    key.revokedAt = new Date();

    key.revokedReason =
      normalizeString(reason);

    if (this.keyId === keyId) {
      this.keyId = null;
      this.publicKey = null;
      this.publicKeyFingerprint = null;
    }

    return true;
  };

OfflineDeviceSchema.methods.hasActivePublicKey =
  function hasActivePublicKey() {
    return this.publicKeys.some(
      (key) => key.active === true,
    );
  };

OfflineDeviceSchema.methods.setDeviceToken =
  function setDeviceToken(token) {
    if (!isNonEmptyString(token)) {
      throw new TypeError(
        'Device token must be a non-empty string.',
      );
    }

    this.deviceTokenHash =
      generateDeviceTokenHash(token);

    this.tokenIssuedAt = new Date();

    return this;
  };

OfflineDeviceSchema.methods.verifyDeviceToken =
  function verifyDeviceToken(token) {
    if (
      !isNonEmptyString(token) ||
      !this.deviceTokenHash
    ) {
      return false;
    }

    const candidate =
      generateDeviceTokenHash(token);

    const expected =
      Buffer.from(
        this.deviceTokenHash,
        'hex',
      );

    const actual =
      Buffer.from(
        candidate,
        'hex',
      );

    if (
      expected.length !== actual.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      expected,
      actual,
    );
  };

OfflineDeviceSchema.methods.isClientTimestampAcceptable =
  function isClientTimestampAcceptable(
    clientTimestamp,
    referenceDate = new Date(),
  ) {
    const timestamp =
      clientTimestamp instanceof Date
        ? clientTimestamp
        : new Date(clientTimestamp);

    if (
      Number.isNaN(timestamp.getTime())
    ) {
      return false;
    }

    const difference =
      Math.abs(
        referenceDate.getTime() -
        timestamp.getTime(),
      );

    return difference <= this.maxClockSkewMs;
  };

OfflineDeviceSchema.methods.toSafeJSON =
  function toSafeJSON() {
    return {
      id: this._id,
      tenantId: this.tenantId,
      deviceId: this.deviceId,
      deviceFingerprint: this.deviceFingerprint,
      deviceName: this.deviceName,
      deviceType: this.deviceType,
      platform: this.platform,
      platformVersion: this.platformVersion,
      appVersion: this.appVersion,
      clientVersion: this.clientVersion,

      status: this.status,
      trusted: this.trusted,
      trustedAt: this.trustedAt,
      trustExpiresAt: this.trustExpiresAt,
      revokedAt: this.revokedAt,

      assignedUserId: this.assignedUserId,
      groupId: this.groupId,

      keyId: this.keyId,
      keyAlgorithm: this.keyAlgorithm,
      publicKeyEncoding:
        this.publicKeyEncoding,
      publicKeyFingerprint:
        this.publicKeyFingerprint,

      sync: this.sync,

      capabilities: this.capabilities,

      lastSeenAt: this.lastSeenAt,
      lastAuthenticatedAt:
        this.lastAuthenticatedAt,

      registeredAt: this.registeredAt,
      activatedAt: this.activatedAt,

      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  };

// =============================================================================
// Static Methods
// =============================================================================

OfflineDeviceSchema.statics.findByTenantAndDevice =
  function findByTenantAndDevice(
    tenantId,
    deviceId,
  ) {
    return this.findOne({
      tenantId: normalizeString(tenantId),
      deviceId: normalizeString(deviceId),
    });
  };

OfflineDeviceSchema.statics.findTrustedDevice =
  function findTrustedDevice(
    tenantId,
    deviceId,
  ) {
    return this.findOne({
      tenantId: normalizeString(tenantId),
      deviceId: normalizeString(deviceId),
      status: DEVICE_STATUS.ACTIVE,
      trusted: true,
    });
  };

OfflineDeviceSchema.statics.findByFingerprint =
  function findByFingerprint(
    tenantId,
    fingerprint,
  ) {
    return this.findOne({
      tenantId: normalizeString(tenantId),
      deviceFingerprint:
        normalizeLowercase(fingerprint),
    });
  };

OfflineDeviceSchema.statics.findByPublicKeyFingerprint =
  function findByPublicKeyFingerprint(
    tenantId,
    fingerprint,
  ) {
    return this.findOne({
      tenantId: normalizeString(tenantId),
      publicKeyFingerprint:
        normalizeLowercase(fingerprint),
    });
  };

OfflineDeviceSchema.statics.findUserDevices =
  function findUserDevices(
    tenantId,
    userId,
    {
      includeInactive = false,
    } = {},
  ) {
    const filter = {
      tenantId: normalizeString(tenantId),
      assignedUserId: normalizeString(userId),
    };

    if (!includeInactive) {
      filter.status = DEVICE_STATUS.ACTIVE;
      filter.trusted = true;
    }

    return this.find(filter)
      .sort({
        lastSeenAt: -1,
        createdAt: -1,
      });
  };

OfflineDeviceSchema.statics.findSecurityReviewDevices =
  function findSecurityReviewDevices(
    tenantId,
  ) {
    return this.find({
      tenantId: normalizeString(tenantId),
      'security.securityReviewRequired': true,
    }).sort({
      lastSeenAt: -1,
    });
  };

OfflineDeviceSchema.statics.createRegistration =
  async function createRegistration({
    tenantId,
    deviceId,
    deviceFingerprint,
    deviceName = null,
    deviceType = 'mobile',
    platform = null,
    platformVersion = null,
    appVersion = null,
    clientVersion = null,
    registeredByUserId = null,
    assignedUserId = null,
    groupId = null,
    createdBy = null,
  }) {
    if (!isNonEmptyString(tenantId)) {
      throw new TypeError(
        'tenantId is required.',
      );
    }

    if (!isNonEmptyString(deviceId)) {
      throw new TypeError(
        'deviceId is required.',
      );
    }

    const fingerprint =
      normalizeLowercase(
        deviceFingerprint,
      ) || generateDeviceFingerprint();

    return this.create({
      tenantId,
      deviceId,
      deviceFingerprint: fingerprint,

      deviceName,
      deviceType,

      platform,
      platformVersion,
      appVersion,
      clientVersion,

      registeredByUserId,
      assignedUserId,
      groupId,

      status: DEVICE_STATUS.PENDING,
      trusted: false,

      registrationNonce:
        generateRegistrationNonce(),

      createdBy,
      updatedBy: createdBy,
      lastUpdatedByUserId: createdBy,
    });
  };

OfflineDeviceSchema.statics.revokeDevice =
  async function revokeDevice(
    tenantId,
    deviceId,
    {
      reason = 'Device revoked.',
      revokedByUserId = null,
      status = DEVICE_STATUS.REVOKED,
    } = {},
  ) {
    const device =
      await this.findOne({
        tenantId: normalizeString(tenantId),
        deviceId: normalizeString(deviceId),
      });

    if (!device) {
      return null;
    }

    device.revoke({
      reason,
      revokedByUserId,
      status,
    });

    await device.save();

    return device;
  };

OfflineDeviceSchema.statics.countPendingEvents =
  async function countPendingEvents(
    tenantId,
  ) {
    const result =
      await this.aggregate([
        {
          $match: {
            tenantId: normalizeString(tenantId),
            status: DEVICE_STATUS.ACTIVE,
          },
        },
        {
          $group: {
            _id: null,
            count: {
              $sum: '$sync.pendingEventCount',
            },
          },
        },
      ]);

    return result[0]?.count || 0;
  };

// =============================================================================
// Query Helpers
// =============================================================================

OfflineDeviceSchema.query.forTenant =
  function forTenant(tenantId) {
    return this.where({
      tenantId: normalizeString(tenantId),
    });
  };

OfflineDeviceSchema.query.trusted =
  function trusted() {
    return this.where({
      status: DEVICE_STATUS.ACTIVE,
      trusted: true,
    });
  };

OfflineDeviceSchema.query.active =
  function active() {
    return this.where({
      status: DEVICE_STATUS.ACTIVE,
    });
  };

OfflineDeviceSchema.query.needingSecurityReview =
  function needingSecurityReview() {
    return this.where({
      'security.securityReviewRequired': true,
    });
  };

// =============================================================================
// Middleware
// =============================================================================

/**
 * Normalize selected fields before validation.
 */
OfflineDeviceSchema.pre(
  'validate',
  function normalizeFields(next) {
    try {
      this.tenantId =
        normalizeString(this.tenantId);

      this.deviceId =
        normalizeString(this.deviceId);

      this.deviceFingerprint =
        normalizeLowercase(
          this.deviceFingerprint,
        );

      this.deviceName =
        sanitizeDeviceName(
          this.deviceName,
        );

      this.assignedUserId =
        normalizeString(
          this.assignedUserId,
        );

      this.registeredByUserId =
        normalizeString(
          this.registeredByUserId,
        );

      this.groupId =
        normalizeString(
          this.groupId,
        );

      this.updatedBy =
        normalizeString(
          this.updatedBy,
        );

      this.lastUpdatedByUserId =
        normalizeString(
          this.lastUpdatedByUserId,
        );

      next();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Enforce trust-state invariants.
 */
OfflineDeviceSchema.pre(
  'validate',
  function enforceTrustInvariants(next) {
    try {
      if (this.status === DEVICE_STATUS.ACTIVE) {
        if (!this.trusted) {
          this.trusted = true;
        }

        if (!this.trustedAt) {
          this.trustedAt = new Date();
        }

        if (!this.activatedAt) {
          this.activatedAt = new Date();
        }
      }

      if (
        TERMINAL_STATUSES.includes(
          this.status,
        )
      ) {
        this.trusted = false;
      }

      if (
        this.status === DEVICE_STATUS.REVOKED ||
        this.status === DEVICE_STATUS.COMPROMISED
      ) {
        if (!this.revokedAt) {
          this.revokedAt = new Date();
        }
      }

      if (
        this.sync.pendingEventCount >
        this.maxPendingEvents
      ) {
        return next(
          new RangeError(
            'Device pending event count exceeds its configured maximum.',
          ),
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Maintain an application-level audit version.
 */
OfflineDeviceSchema.pre(
  'save',
  function incrementAuditVersion(next) {
    if (this.isNew) {
      this.auditVersion = 1;
    } else if (this.isModified()) {
      this.auditVersion =
        Number(this.auditVersion || 0) + 1;
    }

    next();
  },
);

/**
 * Prevent accidental changes to immutable identity fields.
 *
 * Mongoose's immutable option already protects these under normal document
 * saves. This additional guard protects the domain contract when fields are
 * explicitly changed in application code.
 */
OfflineDeviceSchema.pre(
  'save',
  function protectIdentity(next) {
    if (!this.isNew) {
      if (this.isModified('tenantId')) {
        return next(
          new Error(
            'OfflineDevice tenantId is immutable.',
          ),
        );
      }

      if (this.isModified('deviceId')) {
        return next(
          new Error(
            'OfflineDevice deviceId is immutable.',
          ),
        );
      }

      if (
        this.isModified(
          'deviceFingerprint',
        )
      ) {
        return next(
          new Error(
            'OfflineDevice deviceFingerprint is immutable.',
          ),
        );
      }
    }

    next();
  },
);

/**
 * Do not allow a revoked/compromised device to silently regain trust through
 * a generic update operation.
 */
OfflineDeviceSchema.pre(
  'save',
  function protectTerminalTrust(next) {
    if (!this.isNew) {
      const wasTerminal =
        this.$locals?.wasTerminalStatus === true;

      if (
        wasTerminal &&
        this.status === DEVICE_STATUS.ACTIVE
      ) {
        return next(
          new Error(
            'A terminal offline device cannot be reactivated through a generic save operation.',
          ),
        );
      }
    }

    next();
  },
);

// =============================================================================
// Model Creation
// =============================================================================

const OfflineDevice =
  mongoose.models[MODEL_NAME] ||
  mongoose.model(
    MODEL_NAME,
    OfflineDeviceSchema,
  );

// =============================================================================
// Public Exports
// =============================================================================

module.exports = OfflineDevice;

// Expose schema for controlled migrations/tests without creating a second model.
module.exports.schema =
  OfflineDeviceSchema;

// Expose immutable model metadata.
module.exports.MODEL_NAME =
  MODEL_NAME;

module.exports.COLLECTION_NAME =
  COLLECTION_NAME;

module.exports.SCHEMA_VERSION =
  SCHEMA_VERSION;