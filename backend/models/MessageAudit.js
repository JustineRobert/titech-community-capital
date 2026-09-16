 /**
  * backend/models/MessageAudit.js
  * TITech Community Capital — Message Audit Model
  *
  * Architectural role:
  * - Immutable communication-domain audit/event stream for messages,
  *   conversations, participants, announcements, exports, attachments,
  *   and communication security events.
  * - Preserves structured before/after evidence required for operational,
  *   forensic, compliance, and incident-response workflows.
  * - Complements, but does not replace, the platform-wide AuditLog model.
  *
  * Important boundaries:
  * - AuditLog.js remains the canonical platform-wide audit trail.
  * - MessageAudit is the communication-domain detail/event stream.
  * - This model does not authorize message or conversation operations.
  * - This model does not perform business-domain mutations.
  * - This model does not replace the Message, Conversation, or other
  *   domain aggregates.
  * - Tenant authorization remains a service/repository responsibility.
  * - Raw credentials, tokens, passwords, cookies, authorization headers,
  *   payment credentials, and other secrets must never be stored here.
  * - Raw IP addresses and raw user-agent strings are intentionally not
  *   persisted. Services should provide privacy-safe hashes/fingerprints.
  *
  * Security principles:
  * - Native ESM only.
  * - Append-only audit semantics.
  * - Hard deletion disabled.
  * - Generic update operations disabled.
  * - Tenant partitioning is explicit.
  * - Metadata and evidence are bounded.
  * - Sensitive keys are redacted.
  * - Request/correlation tracing is supported.
  * - Privacy-preserving network/device fingerprints are supported.
  * - Optimistic concurrency is enabled.
  * - Deterministic indexes support operational and forensic searches.
  *
  * Module format:
  * - Native ECMAScript Modules (ESM)
  *
  * Canonical platform audit relationship:
  * - Message/Conversation Service
  *       ↓
  *   MessageAudit
  *       ↓
  *   AuditLog (for platform-wide accountability where required)
  */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/* ==========================================================================
 * Constants
 * ========================================================================== */

export const MESSAGE_AUDIT_ACTIONS = Object.freeze([
  'MESSAGE_CREATED',
  'MESSAGE_EDITED',
  'MESSAGE_DELETED',
  'MESSAGE_RESTORED',
  'MESSAGE_PINNED',
  'MESSAGE_UNPINNED',
  'MESSAGE_READ',
  'MESSAGE_DELIVERED',

  'CONVERSATION_CREATED',
  'CONVERSATION_UPDATED',
  'CONVERSATION_ARCHIVED',
  'CONVERSATION_LOCKED',
  'CONVERSATION_DELETED',
  'CONVERSATION_RESTORED',

  'PARTICIPANT_ADDED',
  'PARTICIPANT_REMOVED',

  'ADMIN_ADDED',
  'ADMIN_REMOVED',

  'ANNOUNCEMENT_POSTED',

  'EXPORT_PERFORMED',
  'EXPORT_DOWNLOADED',

  'ATTACHMENT_UPLOADED',
  'ATTACHMENT_DELETED',

  'ACCESS_DENIED',
  'SECURITY_EVENT',
  'SYSTEM_EVENT',
]);

export const MESSAGE_AUDIT_ACTORS = Object.freeze([
  'MEMBER',
  'ADMIN',
  'SUPPORT',
  'AUDITOR',
  'SYSTEM',
  'BOT',
]);

export const MESSAGE_AUDIT_SEVERITIES = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export const MESSAGE_AUDIT_STATUSES = Object.freeze([
  'SUCCESS',
  'FAILED',
  'PARTIAL',
]);

export const LINKED_ENTITY_TYPES = Object.freeze([
  'GROUP',
  'LOAN',
  'SAVINGS',
  'TRANSACTION',
  'SUPPORT',
]);

const MAX_REASON_LENGTH = 2_000;
const MAX_TAGS = 30;
const MAX_TAG_LENGTH = 64;
const MAX_METADATA_KEYS = 50;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_ARRAY_LENGTH = 50;
const MAX_EVIDENCE_KEYS = 100;
const MAX_EVIDENCE_DEPTH = 5;

const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwd',
  'passcode',
  'secret',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'id_token',
  'idtoken',
  'authorization',
  'cookie',
  'set-cookie',
  'api_key',
  'apikey',
  'private_key',
  'privatekey',
  'otp',
  'totp',
  'pin',
  'cvv',
  'pan',
];

/* ==========================================================================
 * Helpers
 * ========================================================================== */

function normalizeString(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();

  return normalized.length > 0
    ? normalized
    : undefined;
}

function normalizeNullableString(value) {
  return normalizeString(value) ?? null;
}

function normalizeObjectId(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (!mongoose.isValidObjectId(value)) {
    throw new TypeError(
      `${fieldName} must be a valid ObjectId.`,
    );
  }

  return new mongoose.Types.ObjectId(value);
}

function isSensitiveKey(key) {
  const normalized = String(key)
    .trim()
    .toLowerCase()
    .replace(/[\s-]/g, '');

  return SENSITIVE_KEY_PATTERNS.some((pattern) =>
    normalized.includes(pattern.replace(/[_-]/g, '')),
  );
}

function sanitizeValue(
  value,
  {
    depth = 0,
    maxDepth = MAX_METADATA_DEPTH,
    maxKeys = MAX_METADATA_KEYS,
    maxArrayLength = MAX_METADATA_ARRAY_LENGTH,
  } = {},
) {
  if (depth > maxDepth) {
    return '[TRUNCATED]';
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return '[BUFFER]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, maxArrayLength)
      .map((item) =>
        sanitizeValue(item, {
          depth: depth + 1,
          maxDepth,
          maxKeys,
          maxArrayLength,
        }),
      );
  }

  if (typeof value === 'object') {
    const output = {};
    const entries = Object.entries(value).slice(0, maxKeys);

    for (const [key, childValue] of entries) {
      if (isSensitiveKey(key)) {
        output[key] = '[REDACTED]';
        continue;
      }

      output[key] = sanitizeValue(childValue, {
        depth: depth + 1,
        maxDepth,
        maxKeys,
        maxArrayLength,
      });
    }

    if (Object.keys(value).length > maxKeys) {
      output._truncatedKeys = true;
    }

    return output;
  }

  return `[UNSERIALIZABLE:${typeof value}]`;
}

function sanitizeMetadata(value) {
  return sanitizeValue(value ?? {}, {
    depth: 0,
    maxDepth: MAX_METADATA_DEPTH,
    maxKeys: MAX_METADATA_KEYS,
    maxArrayLength: MAX_METADATA_ARRAY_LENGTH,
  });
}

function sanitizeEvidence(value) {
  return sanitizeValue(value, {
    depth: 0,
    maxDepth: MAX_EVIDENCE_DEPTH,
    maxKeys: MAX_EVIDENCE_KEYS,
    maxArrayLength: MAX_METADATA_ARRAY_LENGTH,
  });
}

function normalizeTags(tags) {
  if (tags === undefined || tags === null) {
    return [];
  }

  if (!Array.isArray(tags)) {
    throw new TypeError('tags must be an array.');
  }

  if (tags.length > MAX_TAGS) {
    throw new RangeError(
      `A MessageAudit record cannot contain more than ${MAX_TAGS} tags.`,
    );
  }

  return [
    ...new Set(
      tags
        .map((tag) => String(tag).trim().toUpperCase())
        .filter(Boolean)
        .map((tag) => tag.slice(0, MAX_TAG_LENGTH)),
    ),
  ];
}

function normalizeNetworkFingerprint(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();

  return normalized.length > 0
    ? normalized.slice(0, 256)
    : null;
}

/* ==========================================================================
 * Schema
 * ========================================================================== */

const MessageAuditSchema = new Schema(
  {
    action: {
      type: String,
      required: true,
      enum: MESSAGE_AUDIT_ACTIONS,
      uppercase: true,
      trim: true,
      index: true,
    },

    /**
     * Keep tenant type aligned with Message.js and the current tenancy
     * subsystem. Changing this requires an explicit migration.
     */
    tenantId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },

    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
      index: true,
    },

    messageId: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
      index: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    actingAs: {
      type: String,
      enum: MESSAGE_AUDIT_ACTORS,
      required: true,
      uppercase: true,
      default: 'MEMBER',
      trim: true,
    },

    linkedEntityType: {
      type: String,
      enum: LINKED_ENTITY_TYPES,
      default: null,
      uppercase: true,
      trim: true,
      index: true,
    },

    linkedEntityId: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    /**
     * Privacy-preserving network/device identifiers.
     *
     * Store an application-generated keyed hash/fingerprint instead of raw
     * IP/User-Agent values.
     */
    ipAddressHash: {
      type: String,
      default: null,
      trim: true,
      maxlength: 256,
      select: false,
    },

    userAgentHash: {
      type: String,
      default: null,
      trim: true,
      maxlength: 256,
      select: false,
    },

    deviceIdHash: {
      type: String,
      default: null,
      trim: true,
      maxlength: 256,
      select: false,
    },

    requestId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 256,
      index: true,
    },

    correlationId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 256,
      index: true,
    },

    severity: {
      type: String,
      enum: MESSAGE_AUDIT_SEVERITIES,
      default: 'LOW',
      uppercase: true,
      trim: true,
      index: true,
    },

    status: {
      type: String,
      enum: MESSAGE_AUDIT_STATUSES,
      default: 'SUCCESS',
      uppercase: true,
      trim: true,
      index: true,
    },

    reason: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_REASON_LENGTH,
    },

    /**
     * Structured contextual metadata.
     *
     * This is not the authoritative audit trail and must never contain
     * credentials or arbitrary request payloads.
     */
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
      select: false,
    },

    /**
     * Before/after snapshots are optional compliance evidence.
     *
     * They should contain only domain-safe fields selected by the service,
     * never full user documents or unfiltered request payloads.
     */
    before: {
      type: Schema.Types.Mixed,
      default: null,
      select: false,
    },

    after: {
      type: Schema.Types.Mixed,
      default: null,
      select: false,
    },

    tags: {
      type: [
        {
          type: String,
          trim: true,
          uppercase: true,
          maxlength: MAX_TAG_LENGTH,
        },
      ],
      default: [],
      validate: {
        validator(value) {
          return value.length <= MAX_TAGS;
        },
        message: `A MessageAudit record cannot contain more than ${MAX_TAGS} tags.`,
      },
    },

    /**
     * Optional retention timestamp.
     *
     * A TTL index must only be added when the organization's regulatory,
     * legal-hold, and retention requirements explicitly allow automated
     * expiration of this audit stream.
     */
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    /**
     * Legal/compliance hold.
     *
     * Records under legal hold must not be automatically purged.
     * Enforcement of actual retention deletion remains a service/job
     * responsibility.
     */
    legalHold: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,

    optimisticConcurrency: true,

    versionKey: '__v',

    strict: 'throw',

    toJSON: {
      virtuals: true,
      versionKey: false,

      transform(doc, ret) {
        ret.id = ret._id.toString();

        delete ret._id;
        delete ret.__v;

        /**
         * Internal privacy/security fields remain excluded from ordinary API
         * serialization even when explicitly selected for investigations.
         */
        delete ret.ipAddressHash;
        delete ret.userAgentHash;
        delete ret.deviceIdHash;
        delete ret.metadata;
        delete ret.before;
        delete ret.after;

        return ret;
      },
    },

    toObject: {
      virtuals: true,
      versionKey: false,

      transform(doc, ret) {
        ret.id = ret._id.toString();

        delete ret._id;
        delete ret.__v;

        return ret;
      },
    },
  },
);

/* ==========================================================================
 * Indexes
 * ========================================================================== */

MessageAuditSchema.index({
  tenantId: 1,
  createdAt: -1,
  _id: -1,
});

MessageAuditSchema.index({
  tenantId: 1,
  action: 1,
  createdAt: -1,
  _id: -1,
});

MessageAuditSchema.index({
  tenantId: 1,
  conversationId: 1,
  createdAt: -1,
  _id: -1,
});

MessageAuditSchema.index({
  tenantId: 1,
  messageId: 1,
  createdAt: -1,
  _id: -1,
});

MessageAuditSchema.index({
  tenantId: 1,
  userId: 1,
  createdAt: -1,
  _id: -1,
});

MessageAuditSchema.index({
  tenantId: 1,
  linkedEntityType: 1,
  linkedEntityId: 1,
  createdAt: -1,
});

MessageAuditSchema.index({
  tenantId: 1,
  severity: 1,
  status: 1,
  createdAt: -1,
});

MessageAuditSchema.index({
  tenantId: 1,
  requestId: 1,
  createdAt: -1,
});

MessageAuditSchema.index({
  tenantId: 1,
  correlationId: 1,
  createdAt: -1,
});

MessageAuditSchema.index({
  tenantId: 1,
  tags: 1,
  createdAt: -1,
});

/* ==========================================================================
 * Virtuals
 * ========================================================================== */

MessageAuditSchema.virtual('id').get(function getId() {
  return this._id.toString();
});

/* ==========================================================================
 * Validation middleware
 * ========================================================================== */

MessageAuditSchema.pre(
  'validate',
  function validateMessageAudit(next) {
    try {
      this.metadata = sanitizeMetadata(
        this.metadata
          ? Object.fromEntries(this.metadata)
          : {},
      );

      if (this.before !== null) {
        this.before = sanitizeEvidence(this.before);
      }

      if (this.after !== null) {
        this.after = sanitizeEvidence(this.after);
      }

      this.tags = normalizeTags(this.tags);

      this.reason = normalizeNullableString(
        this.reason,
      );

      if (
        this.action === 'ACCESS_DENIED' &&
        this.status === 'SUCCESS'
      ) {
        return next(
          new mongoose.Error.ValidationError(
            new mongoose.Error.ValidatorError({
              path: 'status',
              message:
                'ACCESS_DENIED events cannot have SUCCESS status.',
            }),
          ),
        );
      }

      if (
        this.action === 'SECURITY_EVENT' &&
        this.severity === 'LOW'
      ) {
        /**
         * Do not reject such events automatically because severity is a
         * business classification, but allow the service layer to escalate
         * appropriately.
         */
      }

      if (
        this.legalHold === true &&
        this.expiresAt !== null
      ) {
        /**
         * Keep expiresAt intact for legal/audit visibility, but retention
         * jobs must explicitly skip legalHold=true.
         */
      }

      next();
    } catch (error) {
      next(error);
    }
  },
);

/* ==========================================================================
 * Mutation protection
 * ========================================================================== */

/**
 * Audit records are append-only.
 */
MessageAuditSchema.pre(
  [
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'findByIdAndDelete',
  ],
  function preventHardDelete(next) {
    next(
      new mongoose.Error.MongooseError(
        'Hard deletion of MessageAudit records is disabled.',
      ),
    );
  },
);

/**
 * Generic mutation is blocked so callers cannot bypass audit semantics.
 */
MessageAuditSchema.pre(
  [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'findByIdAndUpdate',
    'replaceOne',
  ],
  function preventMutation(next) {
    const options = this.getOptions();

    if (options.allowAuditMutation === true) {
      return next();
    }

    next(
      new mongoose.Error.MongooseError(
        'MessageAudit records are append-only. Use MessageAudit.log().',
      ),
    );
  },
);

MessageAuditSchema.pre(
  'bulkWrite',
  function preventBulkWrite(next) {
    next(
      new mongoose.Error.MongooseError(
        'bulkWrite is disabled for MessageAudit.',
      ),
    );
  },
);

/* ==========================================================================
 * Static creation API
 * ========================================================================== */

/**
 * Append one communication audit event.
 *
 * Authorization and business validation belong to the calling service.
 */
MessageAuditSchema.statics.log = async function log(input = {}) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    throw new TypeError(
      'MessageAudit.log input must be an object.',
    );
  }

  const {
    action,
    tenantId,
    conversationId = null,
    messageId = null,
    userId = null,
    actingAs = 'MEMBER',
    linkedEntityType = null,
    linkedEntityId = null,

    /**
     * These names deliberately differ from the old model's raw storage
     * fields. Application code should hash these values before calling this
     * method.
     */
    ipAddressHash = null,
    userAgentHash = null,
    deviceIdHash = null,

    requestId = null,
    correlationId = null,
    severity = 'LOW',
    status = 'SUCCESS',
    reason = null,
    metadata = {},
    before = null,
    after = null,
    tags = [],
    expiresAt = null,
    legalHold = false,

    session = undefined,
  } = input;

  const normalizedAction =
    normalizeString(action)?.toUpperCase();

  if (!normalizedAction) {
    throw new TypeError(
      'MessageAudit action is required.',
    );
  }

  if (!MESSAGE_AUDIT_ACTIONS.includes(normalizedAction)) {
    throw new TypeError(
      `Unsupported MessageAudit action: ${normalizedAction}.`,
    );
  }

  const normalizedTenantId =
    normalizeString(tenantId);

  if (!normalizedTenantId) {
    throw new TypeError(
      'tenantId is required for MessageAudit records.',
    );
  }

  const document = {
    action: normalizedAction,
    tenantId: normalizedTenantId,

    conversationId: normalizeObjectId(
      conversationId,
      'conversationId',
    ),

    messageId: normalizeObjectId(
      messageId,
      'messageId',
    ),

    userId: normalizeObjectId(
      userId,
      'userId',
    ),

    actingAs: String(actingAs).trim().toUpperCase(),

    linkedEntityType:
      normalizeString(linkedEntityType)?.toUpperCase() ??
      null,

    linkedEntityId: normalizeObjectId(
      linkedEntityId,
      'linkedEntityId',
    ),

    ipAddressHash:
      normalizeNetworkFingerprint(ipAddressHash),

    userAgentHash:
      normalizeNetworkFingerprint(userAgentHash),

    deviceIdHash:
      normalizeNetworkFingerprint(deviceIdHash),

    requestId:
      normalizeNullableString(requestId),

    correlationId:
      normalizeNullableString(correlationId),

    severity:
      String(severity).trim().toUpperCase(),

    status:
      String(status).trim().toUpperCase(),

    reason:
      normalizeNullableString(reason),

    metadata:
      sanitizeMetadata(metadata),

    before:
      before === null
        ? null
        : sanitizeEvidence(before),

    after:
      after === null
        ? null
        : sanitizeEvidence(after),

    tags: normalizeTags(tags),

    expiresAt:
      expiresAt === null
        ? null
        : new Date(expiresAt),

    legalHold: Boolean(legalHold),
  };

  const auditRecord = new this(document);

  if (session) {
    await auditRecord.save({ session });
  } else {
    await auditRecord.save();
  }

  return auditRecord;
};

/**
 * Record an access-denied communication event.
 */
MessageAuditSchema.statics.logAccessDenied =
  function logAccessDenied(input = {}) {
    return this.log({
      ...input,
      action: 'ACCESS_DENIED',
      status: 'FAILED',
      severity:
        input.severity ?? 'HIGH',
    });
  };

/**
 * Record a security event.
 */
MessageAuditSchema.statics.logSecurityEvent =
  function logSecurityEvent(input = {}) {
    return this.log({
      ...input,
      action: 'SECURITY_EVENT',
      severity:
        input.severity ?? 'HIGH',
    });
  };

/* ==========================================================================
 * Query helpers
 * ========================================================================== */

MessageAuditSchema.query.byTenant =
  function byTenant(tenantId) {
    if (!tenantId) {
      throw new TypeError(
        'tenantId is required.',
      );
    }

    return this.where({
      tenantId: String(tenantId).trim(),
    });
  };

MessageAuditSchema.query.byConversation =
  function byConversation(conversationId) {
    if (!mongoose.isValidObjectId(conversationId)) {
      throw new TypeError(
        'conversationId must be a valid ObjectId.',
      );
    }

    return this.where({
      conversationId,
    });
  };

MessageAuditSchema.query.byMessage =
  function byMessage(messageId) {
    if (!mongoose.isValidObjectId(messageId)) {
      throw new TypeError(
        'messageId must be a valid ObjectId.',
      );
    }

    return this.where({
      messageId,
    });
  };

MessageAuditSchema.query.byUser =
  function byUser(userId) {
    if (!mongoose.isValidObjectId(userId)) {
      throw new TypeError(
        'userId must be a valid ObjectId.',
      );
    }

    return this.where({
      userId,
    });
  };

MessageAuditSchema.query.byAction =
  function byAction(action) {
    const normalized =
      normalizeString(action)?.toUpperCase();

    if (!MESSAGE_AUDIT_ACTIONS.includes(normalized)) {
      throw new TypeError(
        `Unsupported MessageAudit action: ${normalized}.`,
      );
    }

    return this.where({
      action: normalized,
    });
  };

MessageAuditSchema.query.byCorrelationId =
  function byCorrelationId(correlationId) {
    const normalized =
      normalizeString(correlationId);

    if (!normalized) {
      throw new TypeError(
        'correlationId is required.',
      );
    }

    return this.where({
      correlationId: normalized,
    });
  };

MessageAuditSchema.query.byRequestId =
  function byRequestId(requestId) {
    const normalized =
      normalizeString(requestId);

    if (!normalized) {
      throw new TypeError(
        'requestId is required.',
      );
    }

    return this.where({
      requestId: normalized,
    });
  };

/* ==========================================================================
 * Model export
 * ========================================================================== */

const MessageAudit =
  mongoose.models.MessageAudit ||
  mongoose.model(
    'MessageAudit',
    MessageAuditSchema,
  );

export default MessageAudit;