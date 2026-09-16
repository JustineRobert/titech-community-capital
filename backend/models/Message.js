/**
 * backend/models/Message.js
 * TITech Community Capital — Communication Message Model
 *
 * Architectural role:
 * - Stores communication messages belonging to a conversation.
 * - Supports direct/group communication, operational conversations,
 *   support communication, financial-dispute discussions, announcements,
 *   system events, replies, attachments, delivery state, read state,
 *   moderation state, and soft deletion.
 * - Provides bounded, lifecycle-aware message operations.
 *
 * Important boundaries:
 * - Conversation membership and authorization remain service/repository
 *   responsibilities; this model does not decide whether a user is allowed
 *   to post, read, edit, delete, pin, or moderate a message.
 * - Tenant authorization must be enforced by the application service and
 *   repository query boundary. The tenantId field provides persistence
 *   partitioning, not authorization by itself.
 * - AuditLog / MessageAudit remains the authoritative audit trail.
 * - This model does not perform financial mutations, ledger mutations,
 *   wallet mutations, loan mutations, or balance calculations.
 * - Read/delivery collections are bounded here, but high-scale fan-out
 *   delivery/read architectures should migrate those states to dedicated
 *   aggregates such as MessageRead.
 * - Search indexing should ultimately be handled by the search/indexing
 *   layer rather than treating searchText as an authoritative source.
 *
 * Security principles:
 * - Native ESM only.
 * - Tenant-aware persistence.
 * - Strict enum validation.
 * - Bounded message body and attachment metadata.
 * - Bounded delivery/read arrays to reduce document-growth risk.
 * - Sensitive arbitrary metadata is deliberately constrained.
 * - Lifecycle-aware mutation methods.
 * - Optimistic concurrency enabled.
 * - Hard deletion and broad query mutation are blocked at model level.
 * - Internal fields are excluded from normal JSON serialization.
 * - MongoDB operators and arbitrary update pipelines are not exposed through
 *   model-level convenience methods.
 *
 * Module format:
 * - Native ECMAScript Modules (ESM)
 *
 * Canonical communication relationships:
 * - Conversation
 * - User
 * - MessageRead
 * - MessageAudit
 * - AuditLog
 * - Notification
 * - SupportTicket
 *
 * Compatibility:
 * - Model name remains "Message".
 * - Existing Message collection usage can remain compatible.
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const MAX_BODY_LENGTH = 5_000;
const MAX_ATTACHMENT_COUNT = 20;
const MAX_DELIVERED_USERS = 2_000;
const MAX_READ_USERS = 2_000;
const MAX_METADATA_ENTRIES = 50;
const MAX_METADATA_DEPTH = 4;
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

const MESSAGE_TYPES = Object.freeze([
  'TEXT',
  'FILE',
  'IMAGE',
  'SYSTEM',
  'ANNOUNCEMENT',
  'EVENT',
  'VOICE',
  'VIDEO',
]);

const SENDER_ROLES = Object.freeze([
  'ADMIN',
  'MEMBER',
  'SUPPORT',
  'AUDITOR',
  'SYSTEM',
  'BOT',
]);

const NON_BODY_MESSAGE_TYPES = new Set([
  'FILE',
  'IMAGE',
  'VOICE',
  'VIDEO',
  'SYSTEM',
  'ANNOUNCEMENT',
  'EVENT',
]);

const SYSTEM_MESSAGE_TYPES = new Set([
  'SYSTEM',
  'EVENT',
  'ANNOUNCEMENT',
]);

const ATTACHMENT_MIME_PATTERN =
  /^(image|application|text|audio|video)\/[a-zA-Z0-9.+-]+$/;

/* ==========================================================================
 * Helpers
 * ========================================================================== */

function normalizeObjectId(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    throw new TypeError(`${fieldName} is required.`);
  }

  if (!mongoose.isValidObjectId(value)) {
    throw new TypeError(`${fieldName} must be a valid ObjectId.`);
  }

  return new mongoose.Types.ObjectId(value);
}

function normalizeOptionalObjectId(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return normalizeObjectId(value, fieldName);
}

function normalizeBody(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const body = String(value).trim();

  if (!body) {
    return null;
  }

  if (body.length > MAX_BODY_LENGTH) {
    throw new RangeError(
      `Message body cannot exceed ${MAX_BODY_LENGTH} characters.`,
    );
  }

  return body;
}

function validateMetadataValue(value, depth = 0) {
  if (depth > MAX_METADATA_DEPTH) {
    throw new RangeError('Message metadata nesting is too deep.');
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_METADATA_ENTRIES) {
      throw new RangeError(
        `Metadata arrays cannot exceed ${MAX_METADATA_ENTRIES} items.`,
      );
    }

    return value.map((item) => validateMetadataValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);

    if (entries.length > MAX_METADATA_ENTRIES) {
      throw new RangeError(
        `Metadata objects cannot exceed ${MAX_METADATA_ENTRIES} entries.`,
      );
    }

    const output = {};

    for (const [key, childValue] of entries) {
      output[key] = validateMetadataValue(childValue, depth + 1);
    }

    return output;
  }

  throw new TypeError(
    `Unsupported metadata value type: ${typeof value}.`,
  );
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) {
    return {};
  }

  return validateMetadataValue(value);
}

function normalizeAttachment(input, uploadedBy = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Attachment must be an object.');
  }

  const url = String(input.url ?? '').trim();

  if (!url) {
    throw new TypeError('Attachment URL is required.');
  }

  const mimeType =
    input.mimeType === undefined || input.mimeType === null
      ? undefined
      : String(input.mimeType).trim().toLowerCase();

  if (mimeType && !ATTACHMENT_MIME_PATTERN.test(mimeType)) {
    throw new TypeError('Invalid attachment MIME type.');
  }

  const size =
    input.size === undefined || input.size === null
      ? undefined
      : Number(input.size);

  if (
    size !== undefined &&
    (!Number.isFinite(size) ||
      size < 0 ||
      size > MAX_ATTACHMENT_SIZE)
  ) {
    throw new RangeError(
      `Attachment size must be between 0 and ${MAX_ATTACHMENT_SIZE} bytes.`,
    );
  }

  return {
    url,
    filename: input.filename
      ? String(input.filename).trim()
      : undefined,
    originalName: input.originalName
      ? String(input.originalName).trim()
      : undefined,
    mimeType,
    extension: input.extension
      ? String(input.extension).trim().toLowerCase()
      : undefined,
    size,
    checksum: input.checksum
      ? String(input.checksum).trim().toLowerCase()
      : undefined,
    uploadedBy: uploadedBy
      ? normalizeObjectId(uploadedBy, 'uploadedBy')
      : normalizeOptionalObjectId(
          input.uploadedBy,
          'uploadedBy',
        ),
    uploadedAt: input.uploadedAt
      ? new Date(input.uploadedAt)
      : new Date(),
  };
}

/* ==========================================================================
 * Attachment schema
 * ========================================================================== */

const AttachmentSchema = new Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2_048,
    },

    filename: {
      type: String,
      trim: true,
      maxlength: 255,
    },

    originalName: {
      type: String,
      trim: true,
      maxlength: 255,
    },

    mimeType: {
      type: String,
      trim: true,
      lowercase: true,
      match: [
        ATTACHMENT_MIME_PATTERN,
        'Invalid attachment MIME type.',
      ],
    },

    extension: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 20,
    },

    size: {
      type: Number,
      min: 0,
      max: MAX_ATTACHMENT_SIZE,
    },

    checksum: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 256,
    },

    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
    id: false,
  },
);

/* ==========================================================================
 * Read receipt schema
 * ========================================================================== */

const ReadReceiptSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    readAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    _id: false,
  },
);

/* ==========================================================================
 * Message schema
 * ========================================================================== */

const MessageSchema = new Schema(
  {
    /**
     * Tenant partition.
     *
     * Keep this aligned with the project's canonical tenancy identifier type.
     * If the rest of the tenancy subsystem uses String identifiers, change
     * this field intentionally at migration time rather than silently
     * converting existing identifiers.
     */
    tenantId: {
      type: String,
      required: true,
      trim: true,
      index: true,
      maxlength: 128,
    },

    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },

    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    senderRole: {
      type: String,
      enum: SENDER_ROLES,
      required: true,
      uppercase: true,
      trim: true,
    },

    body: {
      type: String,
      trim: true,
      maxlength: [
        MAX_BODY_LENGTH,
        `Message cannot exceed ${MAX_BODY_LENGTH} characters.`,
      ],
      default: null,
    },

    messageType: {
      type: String,
      enum: MESSAGE_TYPES,
      default: 'TEXT',
      uppercase: true,
      trim: true,
      index: true,
    },

    replyTo: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
      index: true,
    },

    attachments: {
      type: [AttachmentSchema],
      default: [],
      validate: {
        validator(value) {
          return value.length <= MAX_ATTACHMENT_COUNT;
        },
        message: `A message cannot contain more than ${MAX_ATTACHMENT_COUNT} attachments.`,
      },
    },

    deliveredTo: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: 'User',
        },
      ],
      default: [],
      validate: {
        validator(value) {
          return value.length <= MAX_DELIVERED_USERS;
        },
        message: `A message cannot have more than ${MAX_DELIVERED_USERS} delivery recipients.`,
      },
    },

    readBy: {
      type: [ReadReceiptSchema],
      default: [],
      validate: {
        validator(value) {
          return value.length <= MAX_READ_USERS;
        },
        message: `A message cannot have more than ${MAX_READ_USERS} read receipts.`,
      },
    },

    /**
     * These are derived counters and should only be maintained by controlled
     * service/model mutation methods.
     */
    deliveredCount: {
      type: Number,
      min: 0,
      default: 0,
    },

    readCount: {
      type: Number,
      min: 0,
      default: 0,
    },

    editedAt: {
      type: Date,
      default: null,
    },

    editedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    isEdited: {
      type: Boolean,
      default: false,
      index: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    isPinned: {
      type: Boolean,
      default: false,
      index: true,
    },

    isSystemGenerated: {
      type: Boolean,
      default: false,
      index: true,
    },

    /**
     * Operational/system metadata.
     *
     * Intentionally bounded. Do not put credentials, tokens, raw request
     * objects, or arbitrary user-controlled payloads here.
     */
    systemMetadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
      select: false,
    },

    /**
     * Audit metadata should not be treated as the canonical audit trail.
     * Detailed compliance evidence belongs in MessageAudit/AuditLog.
     */
    auditMetadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
      select: false,
    },

    /**
     * Moderation state used by communication services.
     * Detailed moderation history belongs in a dedicated audit/event stream.
     */
    moderationMetadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
      select: false,
    },

    /**
     * Derived search projection.
     * Do not rely on this field as the authoritative message content.
     */
    searchText: {
      type: String,
      default: null,
      select: false,
      maxlength: MAX_BODY_LENGTH,
    },
  },
  {
    timestamps: true,

    /**
     * Optimistic concurrency prevents silent lost updates when a message is
     * modified from multiple application instances.
     */
    optimisticConcurrency: true,

    versionKey: '__v',

    strict: 'throw',

    toJSON: {
      virtuals: true,
      versionKey: false,

      transform(doc, ret) {
        ret.id = ret._id.toString();

        delete ret._id;
        delete ret.searchText;
        delete ret.systemMetadata;
        delete ret.auditMetadata;
        delete ret.moderationMetadata;
        delete ret.__v;

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

MessageSchema.index({
  tenantId: 1,
  conversationId: 1,
  createdAt: -1,
  _id: -1,
});

MessageSchema.index({
  tenantId: 1,
  senderId: 1,
  createdAt: -1,
  _id: -1,
});

MessageSchema.index({
  tenantId: 1,
  messageType: 1,
  createdAt: -1,
});

MessageSchema.index({
  tenantId: 1,
  isDeleted: 1,
  createdAt: -1,
});

MessageSchema.index({
  tenantId: 1,
  conversationId: 1,
  messageType: 1,
  createdAt: -1,
  _id: -1,
});

MessageSchema.index({
  tenantId: 1,
  replyTo: 1,
  createdAt: 1,
});

MessageSchema.index({
  tenantId: 1,
  isPinned: 1,
  createdAt: -1,
});

MessageSchema.index(
  {
    body: 'text',
  },
  {
    name: 'message_body_text',
    weights: {
      body: 10,
    },
  },
);

/* ==========================================================================
 * Virtuals
 * ========================================================================== */

MessageSchema.virtual('id').get(function getId() {
  return this._id.toString();
});

MessageSchema.virtual('hasAttachments').get(function hasAttachments() {
  return Array.isArray(this.attachments) && this.attachments.length > 0;
});

MessageSchema.virtual('hasBody').get(function hasBody() {
  return Boolean(this.body && this.body.trim());
});

MessageSchema.virtual('deliveryComplete').get(function deliveryComplete() {
  return (
    Number.isFinite(this.deliveredCount) &&
    this.deliveredCount > 0
  );
});

/* ==========================================================================
 * Validation middleware
 * ========================================================================== */

MessageSchema.pre('validate', function validateMessage(next) {
  try {
    const body = normalizeBody(this.body);

    this.body = body;

    this.systemMetadata = normalizeMetadata(
      Object.fromEntries(
        this.systemMetadata ?? [],
      ),
    );

    this.auditMetadata = normalizeMetadata(
      Object.fromEntries(
        this.auditMetadata ?? [],
      ),
    );

    this.moderationMetadata = normalizeMetadata(
      Object.fromEntries(
        this.moderationMetadata ?? [],
      ),
    );

    if (
      this.messageType === 'TEXT' &&
      !body
    ) {
      return next(
        new mongoose.Error.ValidationError(
          new mongoose.Error.ValidatorError({
            path: 'body',
            message: 'Text messages must contain a body.',
          }),
        ),
      );
    }

    if (
      this.messageType !== 'TEXT' &&
      !body &&
      this.attachments.length === 0 &&
      !NON_BODY_MESSAGE_TYPES.has(this.messageType)
    ) {
      return next(
        new mongoose.Error.ValidationError(
          new mongoose.Error.ValidatorError({
            path: 'body',
            message: 'Message requires body or attachment content.',
          }),
        ),
      );
    }

    if (
      SYSTEM_MESSAGE_TYPES.has(this.messageType) &&
      this.senderRole !== 'SYSTEM' &&
      this.senderRole !== 'BOT'
    ) {
      return next(
        new mongoose.Error.ValidationError(
          new mongoose.Error.ValidatorError({
            path: 'senderRole',
            message:
              'System, event, and announcement messages must use SYSTEM or BOT sender roles.',
          }),
        ),
      );
    }

    if (
      this.isSystemGenerated &&
      !['SYSTEM', 'BOT'].includes(this.senderRole)
    ) {
      return next(
        new mongoose.Error.ValidationError(
          new mongoose.Error.ValidatorError({
            path: 'isSystemGenerated',
            message:
              'System-generated messages must use SYSTEM or BOT sender roles.',
          }),
        ),
      );
    }

    if (
      this.deliveredCount < 0 ||
      this.readCount < 0
    ) {
      return next(
        new mongoose.Error.ValidationError(
          new mongoose.Error.ValidatorError({
            path: 'deliveredCount',
            message: 'Message counters cannot be negative.',
          }),
        ),
      );
    }

    this.deliveredCount = this.deliveredTo.length;
    this.readCount = this.readBy.length;

    if (this.isDeleted) {
      if (!this.deletedAt) {
        this.deletedAt = new Date();
      }

      if (!this.deletedBy) {
        return next(
          new mongoose.Error.ValidationError(
            new mongoose.Error.ValidatorError({
              path: 'deletedBy',
              message:
                'deletedBy is required for a deleted message.',
            }),
          ),
        );
      }
    }

    if (!this.isDeleted) {
      this.deletedAt = this.deletedAt ?? null;
      this.deletedBy = this.deletedBy ?? null;
    }

    next();
  } catch (error) {
    next(error);
  }
});

/**
 * Maintain the search projection only from current body content.
 */
MessageSchema.pre('save', function prepareSearchProjection(next) {
  if (this.isModified('body')) {
    this.searchText = this.body
      ? this.body.toLocaleLowerCase()
      : null;
  }

  if (this.isDeleted) {
    this.searchText = null;
  }

  next();
});

/* ==========================================================================
 * Query safety
 * ========================================================================== */

/**
 * Prevent accidental hard deletion of communication evidence.
 */
MessageSchema.pre(
  ['deleteOne', 'deleteMany', 'findOneAndDelete', 'findByIdAndDelete'],
  function preventHardDelete(next) {
    next(
      new mongoose.Error.MongooseError(
        'Hard deletion of messages is disabled. Use softDelete().',
      ),
    );
  },
);

/**
 * Prevent generic updates from bypassing lifecycle controls.
 *
 * Dedicated repository/service operations should be used for message
 * mutation because update operators can otherwise bypass validation,
 * authorization, read/delivery uniqueness, and lifecycle rules.
 */
MessageSchema.pre(
  [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'findByIdAndUpdate',
    'replaceOne',
  ],
  function preventGenericUpdate(next) {
    const options = this.getOptions();

    if (options.allowMessageMutation === true) {
      return next();
    }

    next(
      new mongoose.Error.MongooseError(
        'Generic message updates are disabled. Use a controlled Message mutation method.',
      ),
    );
  },
);

MessageSchema.pre('bulkWrite', function preventBulkWrite(next) {
  next(
    new mongoose.Error.MongooseError(
      'bulkWrite is disabled for Message. Use a controlled message repository.',
    ),
  );
});

/* ==========================================================================
 * Controlled query helpers
 * ========================================================================== */

MessageSchema.statics.findConversationMessages = function findConversationMessages(
  tenantId,
  conversationId,
  {
    limit = 50,
    before = null,
    includeDeleted = false,
  } = {},
) {
  if (!tenantId) {
    throw new TypeError('tenantId is required.');
  }

  if (!mongoose.isValidObjectId(conversationId)) {
    throw new TypeError('conversationId must be a valid ObjectId.');
  }

  const safeLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 50, 1),
    100,
  );

  const filter = {
    tenantId: String(tenantId).trim(),
    conversationId,
  };

  if (!includeDeleted) {
    filter.isDeleted = false;
  }

  if (before) {
    const beforeDate = new Date(before);

    if (Number.isNaN(beforeDate.getTime())) {
      throw new TypeError('Invalid before timestamp.');
    }

    filter.createdAt = {
      $lt: beforeDate,
    };
  }

  return this.find(filter)
    .sort({
      createdAt: -1,
      _id: -1,
    })
    .limit(safeLimit);
};

/* ==========================================================================
 * Controlled instance mutation methods
 * ========================================================================== */

/**
 * Mark a user as having received this message.
 *
 * For large installations, move delivery state to MessageDelivery /
 * MessageRead rather than allowing this embedded array to grow indefinitely.
 */
MessageSchema.methods.markAsDelivered = async function markAsDelivered(
  userId,
) {
  if (this.isDeleted) {
    return this;
  }

  const normalizedUserId = normalizeObjectId(
    userId,
    'userId',
  );

  const exists = this.deliveredTo.some(
    (id) => id.equals(normalizedUserId),
  );

  if (!exists) {
    if (this.deliveredTo.length >= MAX_DELIVERED_USERS) {
      throw new RangeError(
        `Delivery recipient limit of ${MAX_DELIVERED_USERS} has been reached.`,
      );
    }

    this.deliveredTo.push(normalizedUserId);
    this.deliveredCount = this.deliveredTo.length;

    await this.save();
  }

  return this;
};

/**
 * Mark a user as having read this message.
 */
MessageSchema.methods.markAsRead = async function markAsRead(
  userId,
) {
  if (this.isDeleted) {
    return this;
  }

  const normalizedUserId = normalizeObjectId(
    userId,
    'userId',
  );

  const existing = this.readBy.find(
    (receipt) => receipt.user.equals(normalizedUserId),
  );

  if (!existing) {
    if (this.readBy.length >= MAX_READ_USERS) {
      throw new RangeError(
        `Read recipient limit of ${MAX_READ_USERS} has been reached.`,
      );
    }

    this.readBy.push({
      user: normalizedUserId,
      readAt: new Date(),
    });

    this.readCount = this.readBy.length;

    await this.save();
  }

  return this;
};

/**
 * Soft-delete a message.
 */
MessageSchema.methods.softDelete = async function softDelete(
  userId,
) {
  if (this.isDeleted) {
    return this;
  }

  const normalizedUserId = normalizeObjectId(
    userId,
    'userId',
  );

  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = normalizedUserId;
  this.isPinned = false;
  this.searchText = null;

  await this.save();

  return this;
};

/**
 * Restore a previously soft-deleted message.
 *
 * Restoration authorization belongs to the service layer.
 */
MessageSchema.methods.restore = async function restore() {
  if (!this.isDeleted) {
    return this;
  }

  this.isDeleted = false;
  this.deletedAt = null;
  this.deletedBy = null;

  if (this.body) {
    this.searchText = this.body.toLocaleLowerCase();
  }

  await this.save();

  return this;
};

/**
 * Edit textual message content.
 */
MessageSchema.methods.editMessage = async function editMessage(
  newBody,
  userId,
) {
  if (this.isDeleted) {
    throw new Error(
      'Deleted messages cannot be edited.',
    );
  }

  if (
    ['SYSTEM', 'EVENT', 'ANNOUNCEMENT'].includes(
      this.messageType,
    )
  ) {
    throw new Error(
      'System, event, and announcement messages cannot be edited through Message.editMessage().',
    );
  }

  const body = normalizeBody(newBody);

  if (!body) {
    throw new Error(
      'Message body cannot be empty.',
    );
  }

  const normalizedUserId = normalizeObjectId(
    userId,
    'userId',
  );

  this.body = body;
  this.isEdited = true;
  this.editedAt = new Date();
  this.editedBy = normalizedUserId;

  await this.save();

  return this;
};

/**
 * Add an attachment.
 */
MessageSchema.methods.addAttachment = async function addAttachment(
  attachment,
  userId,
) {
  if (this.isDeleted) {
    throw new Error(
      'Deleted messages cannot receive new attachments.',
    );
  }

  if (this.attachments.length >= MAX_ATTACHMENT_COUNT) {
    throw new RangeError(
      `A message cannot contain more than ${MAX_ATTACHMENT_COUNT} attachments.`,
    );
  }

  const normalizedUserId = normalizeObjectId(
    userId,
    'userId',
  );

  this.attachments.push(
    normalizeAttachment(
      attachment,
      normalizedUserId,
    ),
  );

  await this.save();

  return this;
};

/**
 * Pin a message.
 */
MessageSchema.methods.pin = async function pin() {
  if (this.isDeleted) {
    throw new Error(
      'Deleted messages cannot be pinned.',
    );
  }

  this.isPinned = true;

  await this.save();

  return this;
};

/**
 * Unpin a message.
 */
MessageSchema.methods.unpin = async function unpin() {
  if (!this.isPinned) {
    return this;
  }

  this.isPinned = false;

  await this.save();

  return this;
};

/* ==========================================================================
 * Public model helpers
 * ========================================================================== */

/**
 * Returns a minimal safe representation suitable for APIs.
 */
MessageSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    tenantId: this.tenantId,
    conversationId: this.conversationId.toString(),
    senderId: this.senderId.toString(),
    senderRole: this.senderRole,
    body: this.body,
    messageType: this.messageType,
    replyTo: this.replyTo
      ? this.replyTo.toString()
      : null,
    attachments: this.attachments,
    deliveredCount: this.deliveredCount,
    readCount: this.readCount,
    isEdited: this.isEdited,
    isDeleted: this.isDeleted,
    isPinned: this.isPinned,
    isSystemGenerated: this.isSystemGenerated,
    editedAt: this.editedAt,
    deletedAt: this.deletedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

/* ==========================================================================
 * Model export
 * ========================================================================== */

const Message =
  mongoose.models.Message ||
  mongoose.model('Message', MessageSchema);

export default Message;

export {
  AttachmentSchema,
  ReadReceiptSchema,
  MessageSchema,
  MAX_BODY_LENGTH,
  MAX_ATTACHMENT_COUNT,
  MAX_DELIVERED_USERS,
  MAX_READ_USERS,
};