/**
 * backend/models/MessageRead.js
 * TITech Community Capital — Message Read/Delivery Model
 *
 * Architectural role:
 * - Stores per-user message delivery and read state independently from
 *   the Message aggregate.
 * - Supports high-volume conversations, unread counting, realtime
 *   synchronization, notification processing, engagement analytics,
 *   mobile synchronization, and communication compliance investigations.
 * - Provides one current interaction-state record per
 *   (tenant, message, user) tuple.
 *
 * Important boundaries:
 * - MessageRead is the current receipt/state aggregate, not the immutable
 *   communication audit trail.
 * - MessageAudit and AuditLog remain responsible for audit evidence.
 * - MessageRead does not authorize whether a user may receive/read a message.
 * - Tenant membership and conversation access remain service/repository
 *   responsibilities.
 * - This model does not mutate Message.deliveredTo/readBy counters.
 * - For very large fan-out workloads, unread counters may be maintained by
 *   dedicated counter infrastructure rather than recalculated from receipts.
 *
 * Security principles:
 * - Native ESM only.
 * - Tenant-aware persistence.
 * - Composite uniqueness includes tenantId.
 * - Receipt transitions are monotonic:
 *     false -> true
 *   and timestamps are not moved backward by repeated calls.
 * - Raw IP addresses and user-agent strings are not persisted.
 * - Device identifiers are stored as privacy-safe hashes/fingerprints.
 * - Metadata is bounded and sensitive fields are redacted.
 * - Generic update/delete operations are blocked.
 * - Optimistic concurrency is enabled.
 *
 * Module format:
 * - Native ECMAScript Modules (ESM)
 *
 * Related modules:
 * - Message
 * - Conversation
 * - User
 * - MessageAudit
 * - Notification
 * - AuditLog
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/* ==========================================================================
 * Constants
 * ========================================================================== */

export const MESSAGE_PLATFORMS = Object.freeze([
  'WEB',
  'ANDROID',
  'IOS',
  'API',
  'SYSTEM',
]);

const MAX_METADATA_KEYS = 50;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_ARRAY_LENGTH = 50;
const MAX_DEVICE_FINGERPRINT_LENGTH = 256;
const MAX_APP_VERSION_LENGTH = 64;

const SENSITIVE_KEY_FRAGMENTS = Object.freeze([
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
]);

/* ==========================================================================
 * Helpers
 * ========================================================================== */

function normalizeTenantId(value) {
  if (value === undefined || value === null || value === '') {
    throw new TypeError('tenantId is required.');
  }

  const normalized = String(value).trim();

  if (!normalized) {
    throw new TypeError('tenantId is required.');
  }

  return normalized;
}

function normalizeObjectId(value, fieldName) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    throw new TypeError(`${fieldName} is required.`);
  }

  if (!mongoose.isValidObjectId(value)) {
    throw new TypeError(
      `${fieldName} must be a valid ObjectId.`,
    );
  }

  return new mongoose.Types.ObjectId(value);
}

function normalizeNullableObjectId(value, fieldName) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  return normalizeObjectId(value, fieldName);
}

function normalizeNullableString(value, maxLength = 256) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function normalizeDate(value) {
  if (value === undefined || value === null) {
    return new Date();
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError('Invalid date.');
    }

    return value;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError('Invalid date.');
  }

  return parsed;
}

function isSensitiveKey(key) {
  const normalized = String(key)
    .trim()
    .toLowerCase()
    .replace(/[\s-]/g, '');

  return SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
    normalized.includes(
      fragment.replace(/[_-]/g, ''),
    ),
  );
}

function sanitizeMetadata(
  value,
  depth = 0,
) {
  if (depth > MAX_METADATA_DEPTH) {
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

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return '[BUFFER]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_METADATA_ARRAY_LENGTH)
      .map((item) =>
        sanitizeMetadata(item, depth + 1),
      );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    const output = {};

    for (const [key, childValue] of entries.slice(
      0,
      MAX_METADATA_KEYS,
    )) {
      if (isSensitiveKey(key)) {
        output[key] = '[REDACTED]';
        continue;
      }

      output[key] = sanitizeMetadata(
        childValue,
        depth + 1,
      );
    }

    if (entries.length > MAX_METADATA_KEYS) {
      output._truncatedKeys = true;
    }

    return output;
  }

  return `[UNSERIALIZABLE:${typeof value}]`;
}

function objectIdEquals(left, right) {
  if (!left || !right) {
    return false;
  }

  return left.toString() === right.toString();
}

/* ==========================================================================
 * Schema
 * ========================================================================== */

const MessageReadSchema = new Schema(
  {
    /*
     * ------------------------------------------------------------------------
     * Tenant / core references
     * ------------------------------------------------------------------------
     */

    tenantId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },

    messageId: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      required: true,
      index: true,
    },

    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /*
     * ------------------------------------------------------------------------
     * Delivery state
     * ------------------------------------------------------------------------
     */

    delivered: {
      type: Boolean,
      default: false,
      index: true,
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    /*
     * ------------------------------------------------------------------------
     * Read state
     * ------------------------------------------------------------------------
     */

    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: {
      type: Date,
      default: null,
      index: true,
    },

    /*
     * ------------------------------------------------------------------------
     * Device / client context
     * ------------------------------------------------------------------------
     *
     * Store application-generated hashes/fingerprints rather than raw
     * identifiers or network metadata.
     */

    deviceIdHash: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_DEVICE_FINGERPRINT_LENGTH,
      select: false,
    },

    platform: {
      type: String,
      enum: MESSAGE_PLATFORMS,
      uppercase: true,
      trim: true,
      default: 'WEB',
      index: true,
    },

    appVersion: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_APP_VERSION_LENGTH,
    },

    ipAddressHash: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_DEVICE_FINGERPRINT_LENGTH,
      select: false,
    },

    userAgentHash: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_DEVICE_FINGERPRINT_LENGTH,
      select: false,
    },

    /*
     * ------------------------------------------------------------------------
     * Request tracing
     * ------------------------------------------------------------------------
     */

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

    /*
     * ------------------------------------------------------------------------
     * Metadata
     * ------------------------------------------------------------------------
     */

    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
      select: false,
    },

    /*
     * ------------------------------------------------------------------------
     * Retention
     * ------------------------------------------------------------------------
     *
     * expiresAt is metadata for the retention subsystem. Do not create an
     * automatic TTL index until approved retention/legal-hold rules require it.
     */

    expiresAt: {
      type: Date,
      default: null,
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

        delete ret.deviceIdHash;
        delete ret.ipAddressHash;
        delete ret.userAgentHash;
        delete ret.metadata;

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

/**
 * One current receipt record per tenant/message/user.
 */
MessageReadSchema.index(
  {
    tenantId: 1,
    messageId: 1,
    userId: 1,
  },
  {
    unique: true,
    name: 'tenant_message_user_unique',
  },
);

MessageReadSchema.index({
  tenantId: 1,
  conversationId: 1,
  userId: 1,
  isRead: 1,
  createdAt: -1,
});

MessageReadSchema.index({
  tenantId: 1,
  conversationId: 1,
  userId: 1,
  isRead: 1,
  messageId: 1,
});

MessageReadSchema.index({
  tenantId: 1,
  messageId: 1,
  isRead: 1,
});

MessageReadSchema.index({
  tenantId: 1,
  messageId: 1,
  delivered: 1,
});

MessageReadSchema.index({
  tenantId: 1,
  userId: 1,
  isRead: 1,
  readAt: -1,
});

MessageReadSchema.index({
  tenantId: 1,
  userId: 1,
  delivered: 1,
  deliveredAt: -1,
});

MessageReadSchema.index({
  tenantId: 1,
  requestId: 1,
});

MessageReadSchema.index({
  tenantId: 1,
  correlationId: 1,
});

MessageReadSchema.index({
  tenantId: 1,
  expiresAt: 1,
});

/* ==========================================================================
 * Virtuals
 * ========================================================================== */

MessageReadSchema.virtual('id').get(function getId() {
  return this._id.toString();
});

MessageReadSchema.virtual('read').get(function getRead() {
  return this.isRead;
});

/* ==========================================================================
 * Validation
 * ========================================================================== */

MessageReadSchema.pre(
  'validate',
  function validateMessageRead(next) {
    try {
      this.tenantId = normalizeTenantId(
        this.tenantId,
      );

      this.metadata = sanitizeMetadata(
        this.metadata
          ? Object.fromEntries(this.metadata)
          : {},
      );

      if (this.delivered && !this.deliveredAt) {
        this.deliveredAt = new Date();
      }

      if (!this.delivered) {
        this.deliveredAt = null;
      }

      if (this.isRead && !this.readAt) {
        this.readAt = new Date();
      }

      if (!this.isRead) {
        this.readAt = null;
      }

      /**
       * Read implies delivered.
       */
      if (this.isRead && !this.delivered) {
        this.delivered = true;
        this.deliveredAt =
          this.deliveredAt ?? new Date();
      }

      /**
       * A read timestamp without isRead=true is invalid.
       */
      if (this.readAt && !this.isRead) {
        return next(
          new mongoose.Error.ValidationError(
            new mongoose.Error.ValidatorError({
              path: 'readAt',
              message:
                'readAt requires isRead=true.',
            }),
          ),
        );
      }

      /**
       * A delivery timestamp without delivered=true is invalid.
       */
      if (
        this.deliveredAt &&
        !this.delivered
      ) {
        return next(
          new mongoose.Error.ValidationError(
            new mongoose.Error.ValidatorError({
              path: 'deliveredAt',
              message:
                'deliveredAt requires delivered=true.',
            }),
          ),
        );
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
 * MessageRead records are current-state aggregates rather than immutable
 * audit records, so controlled state transitions are permitted. Generic
 * updates remain blocked to prevent callers from bypassing monotonic rules
 * and tenant boundaries.
 */
MessageReadSchema.pre(
  [
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'findByIdAndDelete',
  ],
  function preventDeletion(next) {
    next(
      new mongoose.Error.MongooseError(
        'MessageRead deletion is disabled. Use the approved retention service.',
      ),
    );
  },
);

MessageReadSchema.pre(
  [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'findByIdAndUpdate',
    'replaceOne',
  ],
  function preventGenericMutation(next) {
    const options = this.getOptions();

    if (options.allowMessageReadMutation === true) {
      return next();
    }

    next(
      new mongoose.Error.MongooseError(
        'Generic MessageRead updates are disabled. Use MessageRead.markDelivered(), markRead(), or the repository.',
      ),
    );
  },
);

MessageReadSchema.pre(
  'bulkWrite',
  function preventBulkWrite(next) {
    next(
      new mongoose.Error.MongooseError(
        'bulkWrite is disabled for MessageRead.',
      ),
    );
  },
);

/* ==========================================================================
 * Controlled static state transitions
 * ========================================================================== */

/**
 * Mark a message delivered for a specific user.
 *
 * Delivery is monotonic:
 * - false -> true
 * - existing deliveredAt is preserved
 * - a later duplicate event does not move deliveredAt forward
 */
MessageReadSchema.statics.markDelivered =
  async function markDelivered({
    tenantId,
    messageId,
    conversationId,
    userId,
    metadata = {},
    deviceIdHash = null,
    platform = 'WEB',
    ipAddressHash = null,
    userAgentHash = null,
    requestId = null,
    correlationId = null,
    session = undefined,
  }) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const normalizedMessageId =
      normalizeObjectId(
        messageId,
        'messageId',
      );

    const normalizedConversationId =
      normalizeObjectId(
        conversationId,
        'conversationId',
      );

    const normalizedUserId =
      normalizeObjectId(
        userId,
        'userId',
      );

    const normalizedPlatform =
      String(platform)
        .trim()
        .toUpperCase();

    if (!MESSAGE_PLATFORMS.includes(normalizedPlatform)) {
      throw new TypeError(
        `Unsupported message platform: ${normalizedPlatform}.`,
      );
    }

    const now = new Date();

    const filter = {
      tenantId: normalizedTenantId,
      messageId: normalizedMessageId,
      userId: normalizedUserId,
    };

    const update = {
      $setOnInsert: {
        tenantId: normalizedTenantId,
        messageId: normalizedMessageId,
        conversationId: normalizedConversationId,
        userId: normalizedUserId,
      },

      $set: {
        conversationId: normalizedConversationId,
        delivered: true,
        platform: normalizedPlatform,
        deviceIdHash: normalizeNullableString(
          deviceIdHash,
          MAX_DEVICE_FINGERPRINT_LENGTH,
        ),
        ipAddressHash: normalizeNullableString(
          ipAddressHash,
          MAX_DEVICE_FINGERPRINT_LENGTH,
        ),
        userAgentHash: normalizeNullableString(
          userAgentHash,
          MAX_DEVICE_FINGERPRINT_LENGTH,
        ),
        appVersion:
          normalizeNullableString(
            undefined,
            MAX_APP_VERSION_LENGTH,
          ),
        requestId:
          normalizeNullableString(requestId),
        correlationId:
          normalizeNullableString(correlationId),
        metadata: sanitizeMetadata(metadata),
      },

      $setOnInsert: {
        tenantId: normalizedTenantId,
        messageId: normalizedMessageId,
        conversationId: normalizedConversationId,
        userId: normalizedUserId,
        deliveredAt: now,
      },
    };

    /**
     * Mongoose/MongoDB cannot contain duplicate keys in one object.
     * Build the update in separate assignments instead.
     */
    delete update.$setOnInsert;

    update.$setOnInsert = {
      tenantId: normalizedTenantId,
      messageId: normalizedMessageId,
      conversationId: normalizedConversationId,
      userId: normalizedUserId,
      deliveredAt: now,
    };

    let query = this.findOneAndUpdate(
      filter,
      update,
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        returnDocument: 'after',
        ...(session ? { session } : {}),
        allowMessageReadMutation: true,
      },
    );

    return query.exec();
  };

/**
 * Mark a message read for a specific user.
 *
 * Reading is monotonic and automatically implies delivery.
 */
MessageReadSchema.statics.markRead =
  async function markRead({
    tenantId,
    messageId,
    conversationId,
    userId,
    metadata = {},
    deviceIdHash = null,
    platform = 'WEB',
    appVersion = null,
    ipAddressHash = null,
    userAgentHash = null,
    requestId = null,
    correlationId = null,
    session = undefined,
  }) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const normalizedMessageId =
      normalizeObjectId(
        messageId,
        'messageId',
      );

    const normalizedConversationId =
      normalizeObjectId(
        conversationId,
        'conversationId',
      );

    const normalizedUserId =
      normalizeObjectId(
        userId,
        'userId',
      );

    const normalizedPlatform =
      String(platform)
        .trim()
        .toUpperCase();

    if (!MESSAGE_PLATFORMS.includes(normalizedPlatform)) {
      throw new TypeError(
        `Unsupported message platform: ${normalizedPlatform}.`,
      );
    }

    const now = new Date();

    const filter = {
      tenantId: normalizedTenantId,
      messageId: normalizedMessageId,
      userId: normalizedUserId,
    };

    const update = {
      $set: {
        conversationId: normalizedConversationId,
        delivered: true,
        isRead: true,

        platform: normalizedPlatform,

        appVersion:
          normalizeNullableString(
            appVersion,
            MAX_APP_VERSION_LENGTH,
          ),

        deviceIdHash:
          normalizeNullableString(
            deviceIdHash,
            MAX_DEVICE_FINGERPRINT_LENGTH,
          ),

        ipAddressHash:
          normalizeNullableString(
            ipAddressHash,
            MAX_DEVICE_FINGERPRINT_LENGTH,
          ),

        userAgentHash:
          normalizeNullableString(
            userAgentHash,
            MAX_DEVICE_FINGERPRINT_LENGTH,
          ),

        requestId:
          normalizeNullableString(requestId),

        correlationId:
          normalizeNullableString(correlationId),

        metadata: sanitizeMetadata(metadata),
      },

      $setOnInsert: {
        tenantId: normalizedTenantId,
        messageId: normalizedMessageId,
        conversationId: normalizedConversationId,
        userId: normalizedUserId,
        deliveredAt: now,
        readAt: now,
      },
    };

    /**
     * Existing records need monotonic timestamps:
     * $min preserves the earliest known receipt timestamp.
     */
    update.$min = {
      deliveredAt: now,
      readAt: now,
    };

    return this.findOneAndUpdate(
      filter,
      update,
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true,
        ...(session ? { session } : {}),
        allowMessageReadMutation: true,
      },
    ).exec();
  };

/* ==========================================================================
 * Controlled static queries
 * ========================================================================== */

MessageReadSchema.statics.getUnreadCount =
  async function getUnreadCount(
    tenantId,
    conversationId,
    userId,
    {
      session = undefined,
    } = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const normalizedConversationId =
      normalizeObjectId(
        conversationId,
        'conversationId',
      );

    const normalizedUserId =
      normalizeObjectId(
        userId,
        'userId',
      );

    const query = this.countDocuments({
      tenantId: normalizedTenantId,
      conversationId: normalizedConversationId,
      userId: normalizedUserId,
      isRead: false,
    });

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

MessageReadSchema.statics.getReadUsers =
  function getReadUsers(
    tenantId,
    messageId,
    {
      populateUser = false,
      session = undefined,
    } = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const normalizedMessageId =
      normalizeObjectId(
        messageId,
        'messageId',
      );

    let query = this.find({
      tenantId: normalizedTenantId,
      messageId: normalizedMessageId,
      isRead: true,
    })
      .sort({
        readAt: 1,
        _id: 1,
      });

    if (populateUser) {
      query = query.populate(
        'userId',
        'firstName lastName email profilePicture',
      );
    }

    if (session) {
      query = query.session(session);
    }

    return query;
  };

MessageReadSchema.statics.getDeliveredUsers =
  function getDeliveredUsers(
    tenantId,
    messageId,
    {
      populateUser = false,
      session = undefined,
    } = {},
  ) {
    const normalizedTenantId =
      normalizeTenantId(tenantId);

    const normalizedMessageId =
      normalizeObjectId(
        messageId,
        'messageId',
      );

    let query = this.find({
      tenantId: normalizedTenantId,
      messageId: normalizedMessageId,
      delivered: true,
    })
      .sort({
        deliveredAt: 1,
        _id: 1,
      });

    if (populateUser) {
      query = query.populate(
        'userId',
        'firstName lastName email profilePicture',
      );
    }

    if (session) {
      query = query.session(session);
    }

    return query;
  };

/* ==========================================================================
 * Controlled instance transitions
 * ========================================================================== */

MessageReadSchema.methods.markAsDelivered =
  async function markAsDelivered() {
    const now = new Date();

    if (!this.delivered) {
      this.delivered = true;
      this.deliveredAt =
        this.deliveredAt ?? now;
    }

    await this.save();

    return this;
  };

MessageReadSchema.methods.markAsRead =
  async function markAsRead() {
    const now = new Date();

    if (!this.delivered) {
      this.delivered = true;
      this.deliveredAt =
        this.deliveredAt ?? now;
    }

    if (!this.isRead) {
      this.isRead = true;
      this.readAt =
        this.readAt ?? now;
    }

    await this.save();

    return this;
  };

/* ==========================================================================
 * Safe serialization helpers
 * ========================================================================== */

MessageReadSchema.methods.toPublicJSON =
  function toPublicJSON() {
    return {
      id: this._id.toString(),
      tenantId: this.tenantId,
      messageId: this.messageId.toString(),
      conversationId:
        this.conversationId.toString(),
      userId: this.userId.toString(),

      delivered: this.delivered,
      deliveredAt: this.deliveredAt,

      isRead: this.isRead,
      readAt: this.readAt,

      platform: this.platform,
      appVersion: this.appVersion,

      requestId: this.requestId,
      correlationId: this.correlationId,

      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  };

/* ==========================================================================
 * Model export
 * ========================================================================== */

const MessageRead =
  mongoose.models.MessageRead ||
  mongoose.model(
    'MessageRead',
    MessageReadSchema,
  );

export default MessageRead;

export {
  MessageReadSchema,
  sanitizeMetadata,
};