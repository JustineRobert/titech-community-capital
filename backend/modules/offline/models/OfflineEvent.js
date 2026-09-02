'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (TITech)
 * =============================================================================
 *
 * File:
 *   backend/modules/offline/models/OfflineEvent.js
 *
 * Purpose:
 *   Immutable offline-first event envelope for TITech.
 *
 * Architecture:
 *
 *   Mobile / Offline Device
 *          |
 *          | create immutable event
 *          v
 *   Local Event Store
 *          |
 *          | signed event + hash chain
 *          v
 *   Offline Sync Pipeline
 *          |
 *          | authenticate
 *          | validate
 *          | deduplicate
 *          | authorize
 *          | reconcile
 *          v
 *   TITech Server
 *          |
 *          | financial transaction boundary
 *          v
 *   Authoritative Domain / Ledger
 *
 * IMPORTANT:
 *
 *   OfflineEvent is NOT the authoritative financial ledger.
 *
 *   It represents an immutable client-originated fact/request that must be
 *   validated by the server before it can affect authoritative financial
 *   state.
 *
 * Security principles:
 *
 *   - Tenant isolation
 *   - Immutable event identity
 *   - Device-scoped sequencing
 *   - Idempotency
 *   - Cryptographic signatures
 *   - Hash-chain integrity
 *   - Replay protection
 *   - Server reconciliation
 *   - Explicit processing lifecycle
 *   - Financial safety
 *   - Auditability
 *   - Optimistic concurrency
 *
 * =============================================================================
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const {
  Schema,
} = mongoose;

// =============================================================================
// Constants
// =============================================================================

const MODEL_NAME = 'OfflineEvent';

const COLLECTION_NAME = 'offline_events';

const SCHEMA_VERSION = 1;

/**
 * Event types.
 *
 * Keep this list deliberately explicit. Unknown event types should not be
 * silently accepted into the financial synchronization pipeline.
 */
const EVENT_TYPES = Object.freeze([
  'DEVICE_REGISTERED',
  'DEVICE_TRUSTED',
  'DEVICE_REVOKED',

  'MEETING_CREATED',
  'MEETING_OPENED',
  'MEETING_CLOSED',

  'MEMBER_CHECKED_IN',
  'MEMBER_CHECKED_OUT',

  'MEMBER_CREATED',
  'MEMBER_UPDATED',

  'CONTRIBUTION_RECORDED',
  'SAVINGS_CONTRIBUTION_RECORDED',

  'WITHDRAWAL_REQUESTED',
  'WITHDRAWAL_RECORDED',

  'LOAN_APPLICATION_CREATED',
  'LOAN_REPAYMENT_RECORDED',

  'PAYMENT_RECORDED',

  'CASH_RECEIPT_RECORDED',

  'ADJUSTMENT_REQUESTED',

  'DOCUMENT_CAPTURED',

  'KYC_CAPTURED',

  'NOTIFICATION_REQUESTED',

  'CUSTOM',
]);

/**
 * Event categories provide coarse-grained authorization and routing.
 */
const EVENT_CATEGORIES = Object.freeze([
  'DEVICE',
  'MEETING',
  'MEMBER',
  'FINANCIAL',
  'LOAN',
  'SAVINGS',
  'PAYMENT',
  'KYC',
  'DOCUMENT',
  'NOTIFICATION',
  'SYSTEM',
]);

/**
 * Event processing lifecycle.
 *
 * RECEIVED
 *   Event reached the server.
 *
 * VALIDATING
 *   Server validation is running.
 *
 * ACCEPTED
 *   Event passed validation and is eligible for domain processing.
 *
 * PROCESSING
 *   Domain operation is being committed.
 *
 * APPLIED
 *   Authoritative domain state was successfully changed.
 *
 * DUPLICATE
 *   Same idempotency identity/event already processed.
 *
 * REJECTED
 *   Event failed business validation.
 *
 * CONFLICT
 *   Event conflicts with current authoritative state.
 *
 * QUARANTINED
 *   Security/integrity anomaly requiring review.
 *
 * FAILED
 *   Infrastructure or processing failure.
 */
const PROCESSING_STATUSES = Object.freeze([
  'PENDING',
  'RECEIVED',
  'VALIDATING',
  'ACCEPTED',
  'PROCESSING',
  'APPLIED',
  'DUPLICATE',
  'REJECTED',
  'CONFLICT',
  'QUARANTINED',
  'FAILED',
]);

/**
 * Synchronization states.
 */
const SYNC_STATUSES = Object.freeze([
  'LOCAL',
  'UPLOADED',
  'ACKNOWLEDGED',
  'PROCESSED',
  'REJECTED',
]);

/**
 * Signature verification states.
 */
const SIGNATURE_STATUSES = Object.freeze([
  'UNVERIFIED',
  'VALID',
  'INVALID',
  'MISSING',
  'KEY_REVOKED',
]);

/**
 * Conflict classifications.
 */
const CONFLICT_TYPES = Object.freeze([
  'NONE',
  'DUPLICATE',
  'SEQUENCE_GAP',
  'SEQUENCE_REPLAY',
  'VERSION_CONFLICT',
  'STATE_CONFLICT',
  'AUTHORIZATION_CONFLICT',
  'HASH_CHAIN_CONFLICT',
  'SIGNATURE_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'STALE_EVENT',
]);

/**
 * Financial risk classifications.
 */
const RISK_LEVELS = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

const FINANCIAL_EVENT_TYPES = new Set([
  'CONTRIBUTION_RECORDED',
  'SAVINGS_CONTRIBUTION_RECORDED',
  'WITHDRAWAL_REQUESTED',
  'WITHDRAWAL_RECORDED',
  'LOAN_APPLICATION_CREATED',
  'LOAN_REPAYMENT_RECORDED',
  'PAYMENT_RECORDED',
  'CASH_RECEIPT_RECORDED',
  'ADJUSTMENT_REQUESTED',
]);

const MAX_EVENT_PAYLOAD_BYTES = 256 * 1024;

const MAX_METADATA_BYTES = 64 * 1024;

const MAX_HASH_LENGTH = 256;

const MAX_SIGNATURE_LENGTH = 8192;

// =============================================================================
// Utility Functions
// =============================================================================

function isNonEmptyString(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

function normalizeString(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  return value.trim();
}

function normalizeLowercase(value) {
  const normalized = normalizeString(value);

  return normalized
    ? normalized.toLowerCase()
    : null;
}

function normalizeUppercase(value) {
  const normalized = normalizeString(value);

  return normalized
    ? normalized.toUpperCase()
    : null;
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(String(value), 'utf8')
    .digest('hex');
}

function stableSerialize(value) {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (
    typeof value !== 'object' ||
    value instanceof Date
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map((item) => stableSerialize(item))
      .join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableSerialize(
          value[key],
        )}`,
    )
    .join(',')}}`;
}

function calculatePayloadHash(payload) {
  return sha256(
    stableSerialize(payload),
  );
}

function calculateEventHash(event) {
  const canonical = {
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    tenantId: event.tenantId,
    deviceId: event.deviceId,
    eventType: event.eventType,
    eventCategory: event.eventCategory,
    sequenceNumber: event.sequenceNumber,
    occurredAt: event.occurredAt
      ? new Date(event.occurredAt).toISOString()
      : null,
    idempotencyKey: event.idempotencyKey,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion,
    previousEventHash: event.previousEventHash,
    payloadHash: event.payloadHash,
  };

  return sha256(
    stableSerialize(canonical),
  );
}

function estimateJsonBytes(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  return Buffer.byteLength(
    JSON.stringify(value),
    'utf8',
  );
}

function normalizePayload(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return {};
  }

  if (
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      'OfflineEvent payload must be a plain object.',
    );
  }

  return value;
}

function isFinancialEventType(eventType) {
  return FINANCIAL_EVENT_TYPES.has(
    eventType,
  );
}

// =============================================================================
// Subdocuments
// =============================================================================

const SignatureSchema = new Schema(
  {
    algorithm: {
      type: String,
      enum: [
        'ed25519',
      ],
      default: 'ed25519',
      required: true,
    },

    keyId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },

    signature: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_SIGNATURE_LENGTH,
    },

    signedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    status: {
      type: String,
      enum: SIGNATURE_STATUSES,
      default: 'UNVERIFIED',
    },

    verifiedAt: {
      type: Date,
      default: null,
    },

    verificationError: {
      type: String,
      trim: true,
      maxlength: 512,
      default: null,
    },
  },
  {
    _id: false,
    versionKey: false,
  },
);

const ProcessingSchema = new Schema(
  {
    status: {
      type: String,
      enum: PROCESSING_STATUSES,
      default: 'PENDING',
      index: true,
    },

    receivedAt: {
      type: Date,
      default: null,
    },

    validationStartedAt: {
      type: Date,
      default: null,
    },

    acceptedAt: {
      type: Date,
      default: null,
    },

    processingStartedAt: {
      type: Date,
      default: null,
    },

    appliedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    attempts: {
      type: Number,
      min: 0,
      default: 0,
    },

    lastAttemptAt: {
      type: Date,
      default: null,
    },

    lastErrorCode: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    lastErrorMessage: {
      type: String,
      trim: true,
      maxlength: 1024,
      default: null,
    },

    rejectionCode: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 1024,
      default: null,
    },

    conflictType: {
      type: String,
      enum: CONFLICT_TYPES,
      default: 'NONE',
    },

    conflictDetails: {
      type: Schema.Types.Mixed,
      default: null,
    },

    processingNodeId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    processingTraceId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    resultingEntityId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    resultingTransactionId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    resultingLedgerEntryId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },
  },
  {
    _id: false,
    versionKey: false,
  },
);

const FinancialContextSchema = new Schema(
  {
    isFinancial: {
      type: Boolean,
      default: false,
    },

    currency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 16,
      default: null,
    },

    amountMinor: {
      type: Schema.Types.Decimal128,
      default: null,
    },

    financialOperation: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 128,
      default: null,
    },

    accountId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    memberId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    walletId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    loanId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    savingsPlanId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    riskLevel: {
      type: String,
      enum: RISK_LEVELS,
      default: 'LOW',
    },

    requiresServerAuthorization: {
      type: Boolean,
      default: true,
    },

    requiresReconciliation: {
      type: Boolean,
      default: true,
    },

    ledgerCommitted: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: false,
    versionKey: false,
  },
);

const DeviceContextSchema = new Schema(
  {
    deviceId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },

    deviceFingerprint: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 128,
    },

    keyId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },

    clientVersion: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
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

    localDatabaseVersion: {
      type: Number,
      min: 0,
      default: 0,
    },

    localSequence: {
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

// =============================================================================
// Main Schema
// =============================================================================

const OfflineEventSchema = new Schema(
  {
    // -------------------------------------------------------------------------
    // Schema / System Identity
    // -------------------------------------------------------------------------

    schemaVersion: {
      type: Number,
      required: true,
      immutable: true,
      default: SCHEMA_VERSION,
      min: 1,
    },

    system: {
      type: String,
      required: true,
      immutable: true,
      default: 'TITech',
      enum: [
        'TITech',
      ],
    },

    // -------------------------------------------------------------------------
    // Event Identity
    // -------------------------------------------------------------------------

    eventId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      immutable: true,
    },

    eventType: {
      type: String,
      required: true,
      enum: EVENT_TYPES,
      immutable: true,
    },

    eventCategory: {
      type: String,
      required: true,
      enum: EVENT_CATEGORIES,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Tenant Boundary
    // -------------------------------------------------------------------------

    tenantId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      immutable: true,
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
      index: true,
    },

    deviceFingerprint: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 128,
      immutable: true,
    },

    deviceContext: {
      type: DeviceContextSchema,
      required: true,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Actor Identity
    // -------------------------------------------------------------------------

    actorType: {
      type: String,
      enum: [
        'USER',
        'DEVICE',
        'SYSTEM',
      ],
      required: true,
      immutable: true,
      default: 'USER',
    },

    actorId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
      immutable: true,
    },

    memberId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Aggregate Identity
    // -------------------------------------------------------------------------

    aggregateType: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
      immutable: true,
    },

    aggregateId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
      immutable: true,
    },

    aggregateVersion: {
      type: Number,
      min: 0,
      default: null,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Device Ordering
    // -------------------------------------------------------------------------

    sequenceNumber: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Event Timing
    // -------------------------------------------------------------------------

    occurredAt: {
      type: Date,
      required: true,
      immutable: true,
      index: true,
    },

    receivedAt: {
      type: Date,
      default: null,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Idempotency
    // -------------------------------------------------------------------------

    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 256,
      immutable: true,
      index: true,
    },

    idempotencyFingerprint: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 128,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Payload
    // -------------------------------------------------------------------------

    payload: {
      type: Schema.Types.Mixed,
      required: true,
      immutable: true,
    },

    payloadHash: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: MAX_HASH_LENGTH,
      immutable: true,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Hash Chain
    // -------------------------------------------------------------------------

    previousEventHash: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: MAX_HASH_LENGTH,
      default: null,
      immutable: true,
    },

    eventHash: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: MAX_HASH_LENGTH,
      immutable: true,
      index: true,
    },

    hashAlgorithm: {
      type: String,
      enum: [
        'sha256',
      ],
      default: 'sha256',
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Cryptographic Signature
    // -------------------------------------------------------------------------

    signature: {
      type: SignatureSchema,
      default: null,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Financial Context
    // -------------------------------------------------------------------------

    financial: {
      type: FinancialContextSchema,
      required: true,
      default: () => ({}),
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Processing Lifecycle
    // -------------------------------------------------------------------------

    processing: {
      type: ProcessingSchema,
      required: true,
      default: () => ({}),
    },

    // -------------------------------------------------------------------------
    // Synchronization
    // -------------------------------------------------------------------------

    syncStatus: {
      type: String,
      enum: SYNC_STATUSES,
      required: true,
      default: 'LOCAL',
      index: true,
    },

    syncCursor: {
      type: String,
      trim: true,
      maxlength: 512,
      default: null,
    },

    uploadedAt: {
      type: Date,
      default: null,
    },

    acknowledgedAt: {
      type: Date,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Replay Protection
    // -------------------------------------------------------------------------

    replayProtected: {
      type: Boolean,
      default: true,
    },

    replayCheckedAt: {
      type: Date,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Audit
    // -------------------------------------------------------------------------

    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },

    updatedAt: {
      type: Date,
      default: Date.now,
    },

    auditVersion: {
      type: Number,
      min: 1,
      default: 1,
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
        /*
         * Keep event payload and public verification metadata available.
         * Sensitive infrastructure/runtime fields are not exposed here.
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
 * Canonical event identity.
 *
 * The same eventId must never be accepted twice within a tenant.
 */
OfflineEventSchema.index(
  {
    tenantId: 1,
    eventId: 1,
  },
  {
    unique: true,
    name: 'uniq_offline_event_tenant_event_id',
  },
);

/**
 * Device sequence is the primary ordering mechanism for the offline event
 * stream.
 */
OfflineEventSchema.index(
  {
    tenantId: 1,
    deviceId: 1,
    sequenceNumber: 1,
  },
  {
    unique: true,
    name: 'uniq_offline_event_device_sequence',
  },
);

/**
 * Idempotency identity.
 *
 * This protects retries of the same business operation.
 */
OfflineEventSchema.index(
  {
    tenantId: 1,
    idempotencyFingerprint: 1,
  },
  {
    unique: true,
    name: 'uniq_offline_event_idempotency',
  },
);

/**
 * Event hash should be globally unique inside a tenant.
 */
OfflineEventSchema.index(
  {
    tenantId: 1,
    eventHash: 1,
  },
  {
    unique: true,
    name: 'uniq_offline_event_hash',
  },
);

/**
 * Device synchronization queries.
 */
OfflineEventSchema.index(
  {
    tenantId: 1,
    deviceId: 1,
    syncStatus: 1,
    sequenceNumber: 1,
  },
  {
    name: 'idx_offline_event_device_sync',
  },
);

/**
 * Processing queue.
 */
OfflineEventSchema.index(
  {
    tenantId: 1,
    'processing.status': 1,
    createdAt: 1,
  },
  {
    name: 'idx_offline_event_processing_queue',
  },
);

/**
 * Financial reconciliation queue.
 */
OfflineEventSchema.index(
  {
    tenantId: 1,
    'financial.isFinancial': 1,
    'financial.requiresReconciliation': 1,
    'processing.status': 1,
  },
  {
    name: 'idx_offline_event_financial_reconciliation',
  },
);

/**
 * Aggregate history.
 */
OfflineEventSchema.index(
  {
    tenantId: 1,
    aggregateType: 1,
    aggregateId: 1,
    sequenceNumber: 1,
  },
  {
    name: 'idx_offline_event_aggregate_history',
  },
);

/**
 * Security investigation.
 */
OfflineEventSchema.index(
  {
    tenantId: 1,
    'signature.status': 1,
    createdAt: -1,
  },
  {
    name: 'idx_offline_event_signature_status',
  },
);

/**
 * Recent events.
 */
OfflineEventSchema.index(
  {
    tenantId: 1,
    createdAt: -1,
  },
  {
    name: 'idx_offline_event_created_at',
  },
);

// =============================================================================
// Virtuals
// =============================================================================

OfflineEventSchema.virtual('isFinancialEvent')
  .get(function isFinancialEvent() {
    return (
      this.financial?.isFinancial === true ||
      isFinancialEventType(
        this.eventType,
      )
    );
  });

OfflineEventSchema.virtual('isProcessed')
  .get(function isProcessed() {
    return (
      this.processing?.status === 'APPLIED' ||
      this.processing?.status === 'DUPLICATE'
    );
  });

OfflineEventSchema.virtual('isRejected')
  .get(function isRejected() {
    return [
      'REJECTED',
      'CONFLICT',
      'QUARANTINED',
    ].includes(
      this.processing?.status,
    );
  });

OfflineEventSchema.virtual('requiresAttention')
  .get(function requiresAttention() {
    return (
      this.processing?.status === 'QUARANTINED' ||
      this.processing?.status === 'CONFLICT' ||
      this.signature?.status === 'INVALID'
    );
  });

OfflineEventSchema.virtual('hasValidSignature')
  .get(function hasValidSignature() {
    return (
      this.signature?.status === 'VALID'
    );
  });

// =============================================================================
// Instance Methods
// =============================================================================

/**
 * Returns the canonical event representation used for hashing.
 */
OfflineEventSchema.methods.getCanonicalRepresentation =
  function getCanonicalRepresentation() {
    return {
      schemaVersion: this.schemaVersion,
      eventId: this.eventId,
      tenantId: this.tenantId,
      deviceId: this.deviceId,
      eventType: this.eventType,
      eventCategory: this.eventCategory,
      sequenceNumber: this.sequenceNumber,
      occurredAt: this.occurredAt
        ? new Date(
            this.occurredAt,
          ).toISOString()
        : null,
      idempotencyKey: this.idempotencyKey,
      aggregateType: this.aggregateType,
      aggregateId: this.aggregateId,
      aggregateVersion:
        this.aggregateVersion,
      previousEventHash:
        this.previousEventHash,
      payloadHash: this.payloadHash,
    };
  };

/**
 * Recalculate event hash.
 */
OfflineEventSchema.methods.calculateEventHash =
  function calculateEventHashForDocument() {
    return calculateEventHash(this);
  };

/**
 * Verify payload integrity.
 */
OfflineEventSchema.methods.verifyPayloadHash =
  function verifyPayloadHash() {
    const calculated =
      calculatePayloadHash(
        this.payload,
      );

    return (
      calculated === this.payloadHash
    );
  };

/**
 * Verify event hash integrity.
 */
OfflineEventSchema.methods.verifyEventHash =
  function verifyEventHash() {
    const calculated =
      this.calculateEventHash();

    return (
      calculated === this.eventHash
    );
  };

/**
 * Verify complete local integrity.
 */
OfflineEventSchema.methods.verifyIntegrity =
  function verifyIntegrity() {
    return (
      this.verifyPayloadHash() &&
      this.verifyEventHash()
    );
  };

/**
 * Mark the event as received by the server.
 */
OfflineEventSchema.methods.markReceived =
  function markReceived() {
    if (
      this.processing.status !== 'PENDING' &&
      this.processing.status !== 'RECEIVED'
    ) {
      return this;
    }

    const now = new Date();

    this.processing.status = 'RECEIVED';

    this.processing.receivedAt =
      this.processing.receivedAt || now;

    this.receivedAt =
      this.receivedAt || now;

    this.syncStatus = 'UPLOADED';

    this.uploadedAt =
      this.uploadedAt || now;

    return this;
  };

/**
 * Begin validation.
 */
OfflineEventSchema.methods.beginValidation =
  function beginValidation() {
    this.processing.status = 'VALIDATING';

    this.processing.validationStartedAt =
      new Date();

    this.processing.attempts += 1;

    this.processing.lastAttemptAt =
      new Date();

    return this;
  };

/**
 * Mark validation as accepted.
 */
OfflineEventSchema.methods.markAccepted =
  function markAccepted() {
    const now = new Date();

    this.processing.status = 'ACCEPTED';

    this.processing.acceptedAt = now;

    this.processing.lastErrorCode = null;

    this.processing.lastErrorMessage = null;

    return this;
  };

/**
 * Begin domain processing.
 */
OfflineEventSchema.methods.beginProcessing =
  function beginProcessing({
    processingNodeId = null,
    processingTraceId = null,
  } = {}) {
    this.processing.status = 'PROCESSING';

    this.processing.processingStartedAt =
      new Date();

    this.processing.attempts += 1;

    this.processing.lastAttemptAt =
      new Date();

    if (processingNodeId) {
      this.processing.processingNodeId =
        normalizeString(
          processingNodeId,
        );
    }

    if (processingTraceId) {
      this.processing.processingTraceId =
        normalizeString(
          processingTraceId,
        );
    }

    return this;
  };

/**
 * Mark event as successfully applied.
 *
 * Note:
 * This means the authoritative domain transaction has already committed.
 */
OfflineEventSchema.methods.markApplied =
  function markApplied({
    resultingEntityId = null,
    resultingTransactionId = null,
    resultingLedgerEntryId = null,
  } = {}) {
    const now = new Date();

    this.processing.status = 'APPLIED';

    this.processing.appliedAt = now;

    this.processing.completedAt = now;

    this.syncStatus = 'PROCESSED';

    this.acknowledgedAt =
      this.acknowledgedAt || now;

    this.processing.resultingEntityId =
      normalizeString(
        resultingEntityId,
      );

    this.processing.resultingTransactionId =
      normalizeString(
        resultingTransactionId,
      );

    this.processing.resultingLedgerEntryId =
      normalizeString(
        resultingLedgerEntryId,
      );

    return this;
  };

/**
 * Mark as duplicate.
 */
OfflineEventSchema.methods.markDuplicate =
  function markDuplicate({
    resultingEntityId = null,
    resultingTransactionId = null,
    resultingLedgerEntryId = null,
  } = {}) {
    const now = new Date();

    this.processing.status = 'DUPLICATE';

    this.processing.completedAt = now;

    this.syncStatus = 'PROCESSED';

    this.acknowledgedAt =
      this.acknowledgedAt || now;

    this.processing.conflictType =
      'DUPLICATE';

    this.processing.resultingEntityId =
      normalizeString(
        resultingEntityId,
      );

    this.processing.resultingTransactionId =
      normalizeString(
        resultingTransactionId,
      );

    this.processing.resultingLedgerEntryId =
      normalizeString(
        resultingLedgerEntryId,
      );

    return this;
  };

/**
 * Reject event.
 */
OfflineEventSchema.methods.reject =
  function reject({
    code = 'OFFLINE_EVENT_REJECTED',
    reason = 'Offline event rejected.',
  } = {}) {
    const now = new Date();

    this.processing.status = 'REJECTED';

    this.processing.completedAt = now;

    this.processing.rejectionCode =
      normalizeUppercase(code);

    this.processing.rejectionReason =
      normalizeString(reason);

    this.syncStatus = 'REJECTED';

    return this;
  };

/**
 * Mark event as conflicting.
 */
OfflineEventSchema.methods.markConflict =
  function markConflict({
    type = 'STATE_CONFLICT',
    details = null,
    code = 'OFFLINE_EVENT_CONFLICT',
    reason = 'Offline event conflicts with authoritative state.',
  } = {}) {
    if (!CONFLICT_TYPES.includes(type)) {
      throw new TypeError(
        `Unsupported conflict type: ${type}`,
      );
    }

    this.processing.status = 'CONFLICT';

    this.processing.completedAt =
      new Date();

    this.processing.conflictType = type;

    this.processing.conflictDetails =
      details;

    this.processing.rejectionCode =
      normalizeUppercase(code);

    this.processing.rejectionReason =
      normalizeString(reason);

    this.syncStatus = 'REJECTED';

    return this;
  };

/**
 * Quarantine event after a security/integrity anomaly.
 */
OfflineEventSchema.methods.quarantine =
  function quarantine({
    reason = 'Offline event quarantined for security review.',
    code = 'OFFLINE_EVENT_QUARANTINED',
  } = {}) {
    this.processing.status = 'QUARANTINED';

    this.processing.completedAt =
      new Date();

    this.processing.rejectionCode =
      normalizeUppercase(code);

    this.processing.rejectionReason =
      normalizeString(reason);

    this.syncStatus = 'REJECTED';

    return this;
  };

/**
 * Record processing failure.
 */
OfflineEventSchema.methods.recordFailure =
  function recordFailure({
    code = 'OFFLINE_EVENT_PROCESSING_FAILED',
    message = null,
  } = {}) {
    this.processing.status = 'FAILED';

    this.processing.lastErrorCode =
      normalizeUppercase(code);

    this.processing.lastErrorMessage =
      normalizeString(message);

    this.processing.lastAttemptAt =
      new Date();

    return this;
  };

/**
 * Mark cryptographic signature as verified.
 */
OfflineEventSchema.methods.markSignatureValid =
  function markSignatureValid() {
    if (!this.signature) {
      throw new Error(
        'Cannot mark signature valid when no signature exists.',
      );
    }

    this.signature.status = 'VALID';

    this.signature.verifiedAt =
      new Date();

    this.signature.verificationError =
      null;

    return this;
  };

/**
 * Mark cryptographic signature as invalid.
 */
OfflineEventSchema.methods.markSignatureInvalid =
  function markSignatureInvalid(
    reason = 'Signature verification failed.',
  ) {
    if (!this.signature) {
      throw new Error(
        'Cannot mark signature invalid when no signature exists.',
      );
    }

    this.signature.status = 'INVALID';

    this.signature.verifiedAt =
      new Date();

    this.signature.verificationError =
      normalizeString(reason);

    this.processing.status =
      'QUARANTINED';

    return this;
  };

/**
 * Verify the event is still eligible for financial processing.
 */
OfflineEventSchema.methods.isEligibleForFinancialProcessing =
  function isEligibleForFinancialProcessing() {
    if (!this.isFinancialEvent) {
      return false;
    }

    if (!this.verifyIntegrity()) {
      return false;
    }

    if (
      !this.signature ||
      this.signature.status !== 'VALID'
    ) {
      return false;
    }

    if (
      this.processing.status ===
      'QUARANTINED'
    ) {
      return false;
    }

    if (
      this.processing.status ===
      'REJECTED'
    ) {
      return false;
    }

    if (
      this.processing.status ===
      'DUPLICATE'
    ) {
      return false;
    }

    if (
      this.processing.status ===
      'APPLIED'
    ) {
      return false;
    }

    return true;
  };

/**
 * Determine whether an event is replayed against a known sequence.
 */
OfflineEventSchema.methods.isSequenceReplay =
  function isSequenceReplay(
    lastAcceptedSequence,
  ) {
    if (
      !Number.isInteger(
        lastAcceptedSequence,
      )
    ) {
      throw new TypeError(
        'lastAcceptedSequence must be an integer.',
      );
    }

    return (
      this.sequenceNumber <=
      lastAcceptedSequence
    );
  };

/**
 * Determine whether a sequence gap exists.
 */
OfflineEventSchema.methods.hasSequenceGap =
  function hasSequenceGap(
    expectedSequence,
  ) {
    if (
      !Number.isInteger(
        expectedSequence,
      )
    ) {
      throw new TypeError(
        'expectedSequence must be an integer.',
      );
    }

    return (
      this.sequenceNumber >
      expectedSequence
    );
  };

/**
 * Produce a safe synchronization acknowledgement.
 */
OfflineEventSchema.methods.toSyncAcknowledgement =
  function toSyncAcknowledgement() {
    return {
      eventId: this.eventId,
      deviceId: this.deviceId,
      sequenceNumber:
        this.sequenceNumber,
      eventHash: this.eventHash,
      syncStatus: this.syncStatus,
      processingStatus:
        this.processing.status,
      idempotencyKey:
        this.idempotencyKey,
      conflictType:
        this.processing.conflictType,
      resultingEntityId:
        this.processing.resultingEntityId,
      resultingTransactionId:
        this.processing.resultingTransactionId,
      resultingLedgerEntryId:
        this.processing.resultingLedgerEntryId,
    };
  };

/**
 * Produce a safe API representation.
 */
OfflineEventSchema.methods.toSafeJSON =
  function toSafeJSON() {
    return {
      id: this._id,

      schemaVersion:
        this.schemaVersion,

      system: this.system,

      eventId:
        this.eventId,

      eventType:
        this.eventType,

      eventCategory:
        this.eventCategory,

      tenantId:
        this.tenantId,

      deviceId:
        this.deviceId,

      actorType:
        this.actorType,

      actorId:
        this.actorId,

      memberId:
        this.memberId,

      aggregateType:
        this.aggregateType,

      aggregateId:
        this.aggregateId,

      aggregateVersion:
        this.aggregateVersion,

      sequenceNumber:
        this.sequenceNumber,

      occurredAt:
        this.occurredAt,

      idempotencyKey:
        this.idempotencyKey,

      payload:
        this.payload,

      payloadHash:
        this.payloadHash,

      previousEventHash:
        this.previousEventHash,

      eventHash:
        this.eventHash,

      signature:
        this.signature,

      financial:
        this.financial,

      processing:
        this.processing,

      syncStatus:
        this.syncStatus,

      syncCursor:
        this.syncCursor,

      createdAt:
        this.createdAt,

      updatedAt:
        this.updatedAt,
    };
  };

// =============================================================================
// Static Methods
// =============================================================================

/**
 * Find an event by tenant + event ID.
 */
OfflineEventSchema.statics.findByEventId =
  function findByEventId(
    tenantId,
    eventId,
  ) {
    return this.findOne({
      tenantId:
        normalizeString(tenantId),

      eventId:
        normalizeString(eventId),
    });
  };

/**
 * Find an event by idempotency identity.
 */
OfflineEventSchema.statics.findByIdempotencyKey =
  function findByIdempotencyKey(
    tenantId,
    idempotencyKey,
  ) {
    const normalizedTenant =
      normalizeString(tenantId);

    const normalizedKey =
      normalizeString(idempotencyKey);

    return this.findOne({
      tenantId: normalizedTenant,

      idempotencyFingerprint:
        sha256(
          `${normalizedTenant}:${normalizedKey}`,
        ),
    });
  };

/**
 * Find an event by event hash.
 */
OfflineEventSchema.statics.findByEventHash =
  function findByEventHash(
    tenantId,
    eventHash,
  ) {
    return this.findOne({
      tenantId:
        normalizeString(tenantId),

      eventHash:
        normalizeLowercase(eventHash),
    });
  };

/**
 * Find a device event at a specific sequence.
 */
OfflineEventSchema.statics.findByDeviceSequence =
  function findByDeviceSequence(
    tenantId,
    deviceId,
    sequenceNumber,
  ) {
    return this.findOne({
      tenantId:
        normalizeString(tenantId),

      deviceId:
        normalizeString(deviceId),

      sequenceNumber,
    });
  };

/**
 * Get the most recent event from a device.
 */
OfflineEventSchema.statics.findLatestForDevice =
  function findLatestForDevice(
    tenantId,
    deviceId,
  ) {
    return this.findOne({
      tenantId:
        normalizeString(tenantId),

      deviceId:
        normalizeString(deviceId),
    }).sort({
      sequenceNumber: -1,
    });
  };

/**
 * Find the next expected device sequence.
 */
OfflineEventSchema.statics.getNextDeviceSequence =
  async function getNextDeviceSequence(
    tenantId,
    deviceId,
  ) {
    const latest =
      await this.findLatestForDevice(
        tenantId,
        deviceId,
      );

    return (
      Number(
        latest?.sequenceNumber || 0,
      ) + 1
    );
  };

/**
 * Find pending events for synchronization.
 */
OfflineEventSchema.statics.findPendingForDevice =
  function findPendingForDevice(
    tenantId,
    deviceId,
    {
      limit = 100,
    } = {},
  ) {
    const safeLimit = Math.min(
      Math.max(
        Number(limit) || 100,
        1,
      ),
      500,
    );

    return this.find({
      tenantId:
        normalizeString(tenantId),

      deviceId:
        normalizeString(deviceId),

      syncStatus: {
        $in: [
          'LOCAL',
          'UPLOADED',
          'ACKNOWLEDGED',
        ],
      },

      'processing.status': {
        $nin: [
          'APPLIED',
          'DUPLICATE',
          'REJECTED',
          'QUARANTINED',
        ],
      },
    })
      .sort({
        sequenceNumber: 1,
      })
      .limit(safeLimit);
  };

/**
 * Find events awaiting processing.
 */
OfflineEventSchema.statics.findProcessingQueue =
  function findProcessingQueue(
    tenantId,
    {
      limit = 100,
    } = {},
  ) {
    const safeLimit = Math.min(
      Math.max(
        Number(limit) || 100,
        1,
      ),
      500,
    );

    return this.find({
      tenantId:
        normalizeString(tenantId),

      'processing.status': {
        $in: [
          'RECEIVED',
          'ACCEPTED',
          'FAILED',
        ],
      },
    })
      .sort({
        createdAt: 1,
      })
      .limit(safeLimit);
  };

/**
 * Find financial events requiring reconciliation.
 */
OfflineEventSchema.statics.findFinancialReconciliationQueue =
  function findFinancialReconciliationQueue(
    tenantId,
    {
      limit = 100,
    } = {},
  ) {
    const safeLimit = Math.min(
      Math.max(
        Number(limit) || 100,
        1,
      ),
      500,
    );

    return this.find({
      tenantId:
        normalizeString(tenantId),

      'financial.isFinancial': true,

      'financial.requiresReconciliation':
        true,

      'processing.status': {
        $in: [
          'ACCEPTED',
          'PROCESSING',
          'FAILED',
          'CONFLICT',
        ],
      },
    })
      .sort({
        createdAt: 1,
      })
      .limit(safeLimit);
  };

/**
 * Build a new immutable event.
 *
 * This method performs deterministic hash/idempotency derivation before the
 * event is persisted.
 */
OfflineEventSchema.statics.buildEvent =
  function buildEvent({
    tenantId,
    eventId,
    eventType,
    eventCategory,
    deviceId,
    deviceFingerprint,
    deviceContext,
    actorType = 'USER',
    actorId = null,
    memberId = null,
    aggregateType = null,
    aggregateId = null,
    aggregateVersion = null,
    sequenceNumber,
    occurredAt = new Date(),
    idempotencyKey,
    payload = {},
    metadata = {},
    previousEventHash = null,
    signature = null,
    financial = {},
  }) {
    if (!isNonEmptyString(tenantId)) {
      throw new TypeError(
        'tenantId is required.',
      );
    }

    if (!isNonEmptyString(eventId)) {
      throw new TypeError(
        'eventId is required.',
      );
    }

    if (!EVENT_TYPES.includes(eventType)) {
      throw new TypeError(
        `Unsupported offline event type: ${eventType}`,
      );
    }

    if (!EVENT_CATEGORIES.includes(
      eventCategory,
    )) {
      throw new TypeError(
        `Unsupported offline event category: ${eventCategory}`,
      );
    }

    if (!isNonEmptyString(deviceId)) {
      throw new TypeError(
        'deviceId is required.',
      );
    }

    if (
      !Number.isInteger(
        sequenceNumber,
      ) ||
      sequenceNumber < 1
    ) {
      throw new TypeError(
        'sequenceNumber must be a positive integer.',
      );
    }

    if (!isNonEmptyString(idempotencyKey)) {
      throw new TypeError(
        'idempotencyKey is required.',
      );
    }

    const normalizedPayload =
      normalizePayload(payload);

    const normalizedMetadata =
      normalizePayload(metadata);

    const payloadBytes =
      estimateJsonBytes(
        normalizedPayload,
      );

    if (
      payloadBytes >
      MAX_EVENT_PAYLOAD_BYTES
    ) {
      throw new RangeError(
        `Offline event payload exceeds ${MAX_EVENT_PAYLOAD_BYTES} bytes.`,
      );
    }

    const metadataBytes =
      estimateJsonBytes(
        normalizedMetadata,
      );

    if (
      metadataBytes >
      MAX_METADATA_BYTES
    ) {
      throw new RangeError(
        `Offline event metadata exceeds ${MAX_METADATA_BYTES} bytes.`,
      );
    }

    const normalizedTenant =
      normalizeString(tenantId);

    const normalizedIdempotencyKey =
      normalizeString(idempotencyKey);

    const idempotencyFingerprint =
      sha256(
        `${normalizedTenant}:${normalizedIdempotencyKey}`,
      );

    const normalizedDeviceContext = {
      deviceId:
        normalizeString(deviceId),

      deviceFingerprint:
        normalizeLowercase(
          deviceFingerprint,
        ),

      keyId:
        normalizeString(
          deviceContext?.keyId,
        ),

      clientVersion:
        normalizeString(
          deviceContext?.clientVersion,
        ),

      platform:
        normalizeString(
          deviceContext?.platform,
        ),

      platformVersion:
        normalizeString(
          deviceContext?.platformVersion,
        ),

      localDatabaseVersion:
        Number(
          deviceContext?.localDatabaseVersion ||
          0,
        ),

      localSequence:
        Number(
          deviceContext?.localSequence ||
          sequenceNumber,
        ),
    };

    const payloadHash =
      calculatePayloadHash(
        normalizedPayload,
      );

    const eventData = {
      schemaVersion:
        SCHEMA_VERSION,

      system:
        'TITech',

      eventId:
        normalizeString(eventId),

      eventType,

      eventCategory,

      tenantId:
        normalizedTenant,

      deviceId:
        normalizeString(deviceId),

      deviceFingerprint:
        normalizeLowercase(
          deviceFingerprint,
        ),

      deviceContext:
        normalizedDeviceContext,

      actorType,

      actorId:
        normalizeString(actorId),

      memberId:
        normalizeString(memberId),

      aggregateType:
        normalizeString(
          aggregateType,
        ),

      aggregateId:
        normalizeString(
          aggregateId,
        ),

      aggregateVersion:
        aggregateVersion === null
          ? null
          : Number(
              aggregateVersion,
            ),

      sequenceNumber,

      occurredAt:
        new Date(occurredAt),

      idempotencyKey:
        normalizedIdempotencyKey,

      idempotencyFingerprint,

      payload:
        normalizedPayload,

      payloadHash,

      metadata:
        normalizedMetadata,

      previousEventHash:
        normalizeLowercase(
          previousEventHash,
        ),

      hashAlgorithm:
        'sha256',

      signature,

      financial: {
        isFinancial:
          financial.isFinancial === true ||
          isFinancialEventType(
            eventType,
          ),

        currency:
          normalizeUppercase(
            financial.currency,
          ),

        amountMinor:
          financial.amountMinor ??
          null,

        financialOperation:
          normalizeUppercase(
            financial.financialOperation,
          ),

        accountId:
          normalizeString(
            financial.accountId,
          ),

        memberId:
          normalizeString(
            financial.memberId ||
            memberId,
          ),

        walletId:
          normalizeString(
            financial.walletId,
          ),

        loanId:
          normalizeString(
            financial.loanId,
          ),

        savingsPlanId:
          normalizeString(
            financial.savingsPlanId,
          ),

        riskLevel:
          RISK_LEVELS.includes(
            financial.riskLevel,
          )
            ? financial.riskLevel
            : 'LOW',

        requiresServerAuthorization:
          financial.requiresServerAuthorization !==
          false,

        requiresReconciliation:
          financial.requiresReconciliation !==
          false,

        ledgerCommitted:
          false,
      },

      processing: {
        status:
          'PENDING',
      },

      syncStatus:
        'LOCAL',

      replayProtected:
        true,
    };

    eventData.eventHash =
      calculateEventHash(
        eventData,
      );

    return new this(eventData);
  };

/**
 * Create and persist an event.
 */
OfflineEventSchema.statics.createEvent =
  async function createEvent(options) {
    const event =
      this.buildEvent(options);

    return event.save();
  };

// =============================================================================
// Query Helpers
// =============================================================================

OfflineEventSchema.query.forTenant =
  function forTenant(tenantId) {
    return this.where({
      tenantId:
        normalizeString(tenantId),
    });
  };

OfflineEventSchema.query.forDevice =
  function forDevice(deviceId) {
    return this.where({
      deviceId:
        normalizeString(deviceId),
    });
  };

OfflineEventSchema.query.pending =
  function pending() {
    return this.where({
      'processing.status': {
        $in: [
          'PENDING',
          'RECEIVED',
          'VALIDATING',
          'ACCEPTED',
          'PROCESSING',
          'FAILED',
        ],
      },
    });
  };

OfflineEventSchema.query.financial =
  function financial() {
    return this.where({
      'financial.isFinancial': true,
    });
  };

OfflineEventSchema.query.applied =
  function applied() {
    return this.where({
      'processing.status': 'APPLIED',
    });
  };

OfflineEventSchema.query.quarantined =
  function quarantined() {
    return this.where({
      'processing.status': 'QUARANTINED',
    });
  };

// =============================================================================
// Middleware
// =============================================================================

/**
 * Normalize fields before validation.
 */
OfflineEventSchema.pre(
  'validate',
  function normalizeFields(next) {
    try {
      this.tenantId =
        normalizeString(
          this.tenantId,
        );

      this.eventId =
        normalizeString(
          this.eventId,
        );

      this.deviceId =
        normalizeString(
          this.deviceId,
        );

      this.deviceFingerprint =
        normalizeLowercase(
          this.deviceFingerprint,
        );

      this.actorId =
        normalizeString(
          this.actorId,
        );

      this.memberId =
        normalizeString(
          this.memberId,
        );

      this.aggregateType =
        normalizeString(
          this.aggregateType,
        );

      this.aggregateId =
        normalizeString(
          this.aggregateId,
        );

      this.idempotencyKey =
        normalizeString(
          this.idempotencyKey,
        );

      this.idempotencyFingerprint =
        normalizeLowercase(
          this.idempotencyFingerprint,
        );

      this.previousEventHash =
        normalizeLowercase(
          this.previousEventHash,
        );

      this.eventHash =
        normalizeLowercase(
          this.eventHash,
        );

      next();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Enforce payload and metadata size limits.
 */
OfflineEventSchema.pre(
  'validate',
  function enforcePayloadLimits(next) {
    try {
      const payloadBytes =
        estimateJsonBytes(
          this.payload,
        );

      if (
        payloadBytes >
        MAX_EVENT_PAYLOAD_BYTES
      ) {
        return next(
          new RangeError(
            `Offline event payload exceeds ${MAX_EVENT_PAYLOAD_BYTES} bytes.`,
          ),
        );
      }

      const metadataBytes =
        estimateJsonBytes(
          this.metadata,
        );

      if (
        metadataBytes >
        MAX_METADATA_BYTES
      ) {
        return next(
          new RangeError(
            `Offline event metadata exceeds ${MAX_METADATA_BYTES} bytes.`,
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
 * Enforce financial-event invariants.
 */
OfflineEventSchema.pre(
  'validate',
  function enforceFinancialInvariants(next) {
    try {
      const shouldBeFinancial =
        isFinancialEventType(
          this.eventType,
        );

      if (
        shouldBeFinancial &&
        this.financial.isFinancial !== true
      ) {
        this.financial.isFinancial = true;
      }

      if (
        this.financial.isFinancial === true
      ) {
        /*
         * Offline financial events can be captured offline, but server-side
         * authorization and reconciliation remain mandatory.
         */
        this.financial.requiresServerAuthorization =
          true;

        this.financial.requiresReconciliation =
          true;

        /*
         * The event itself can never declare that the ledger was committed.
         */
        this.financial.ledgerCommitted =
          false;
      }

      next();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Recompute integrity fields for newly created events.
 *
 * Existing events are intentionally protected from mutation.
 */
OfflineEventSchema.pre(
  'validate',
  function initializeIntegrity(next) {
    try {
      if (this.isNew) {
        this.payloadHash =
          calculatePayloadHash(
            this.payload,
          );

        this.idempotencyFingerprint =
          sha256(
            `${this.tenantId}:${this.idempotencyKey}`,
          );

        this.eventHash =
          calculateEventHash(
            this,
          );
      }

      next();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Strong immutability guard.
 *
 * Once persisted, the event's identity, payload, ordering, hash chain and
 * cryptographic identity must never change.
 *
 * Processing/synchronization fields remain mutable because the server needs
 * to transition the event through its lifecycle.
 */
OfflineEventSchema.pre(
  'save',
  function protectImmutableEvent(next) {
    try {
      if (!this.isNew) {
        const immutableFields = [
          'schemaVersion',
          'system',

          'eventId',
          'eventType',
          'eventCategory',

          'tenantId',

          'deviceId',
          'deviceFingerprint',
          'deviceContext',

          'actorType',
          'actorId',
          'memberId',

          'aggregateType',
          'aggregateId',
          'aggregateVersion',

          'sequenceNumber',

          'occurredAt',

          'idempotencyKey',
          'idempotencyFingerprint',

          'payload',
          'payloadHash',
          'metadata',

          'previousEventHash',
          'eventHash',
          'hashAlgorithm',

          'signature',

          'financial',
        ];

        for (
          const field of immutableFields
        ) {
          if (this.isModified(field)) {
            return next(
              new Error(
                `OfflineEvent immutable field cannot be modified: ${field}`,
              ),
            );
          }
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Maintain audit version.
 */
OfflineEventSchema.pre(
  'save',
  function incrementAuditVersion(next) {
    if (this.isNew) {
      this.auditVersion = 1;
    } else if (
      this.isModified()
    ) {
      this.auditVersion =
        Number(
          this.auditVersion || 0,
        ) + 1;
    }

    next();
  },
);

/**
 * Maintain updatedAt for explicit saves.
 */
OfflineEventSchema.pre(
  'save',
  function updateTimestamp(next) {
    this.updatedAt = new Date();

    next();
  },
);

// =============================================================================
// Model Creation
// =============================================================================

const OfflineEvent =
  mongoose.models[MODEL_NAME] ||
  mongoose.model(
    MODEL_NAME,
    OfflineEventSchema,
  );

// =============================================================================
// Public Exports
// =============================================================================

module.exports = OfflineEvent;

module.exports.schema =
  OfflineEventSchema;

module.exports.MODEL_NAME =
  MODEL_NAME;

module.exports.COLLECTION_NAME =
  COLLECTION_NAME;

module.exports.SCHEMA_VERSION =
  SCHEMA_VERSION;

module.exports.EVENT_TYPES =
  EVENT_TYPES;

module.exports.EVENT_CATEGORIES =
  EVENT_CATEGORIES;

module.exports.PROCESSING_STATUSES =
  PROCESSING_STATUSES;

module.exports.SYNC_STATUSES =
  SYNC_STATUSES;

module.exports.SIGNATURE_STATUSES =
  SIGNATURE_STATUSES;

module.exports.CONFLICT_TYPES =
  CONFLICT_TYPES;

module.exports.RISK_LEVELS =
  RISK_LEVELS;