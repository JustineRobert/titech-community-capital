/**
 * ============================================================================
 * backend/models/Chat.js
 * TITech Community Capital LTD
 * Legacy Chat Message Compatibility Aggregate
 * ============================================================================
 *
 * Architectural role
 * ----------------------------------------------------------------------------
 * Chat is a compatibility communication aggregate retained for legacy
 * application flows that historically used:
 *
 *   - group-based messaging
 *   - read receipts
 *   - moderation
 *   - reactions
 *   - threaded messages
 *
 * The canonical message aggregate for the current TITech Community Capital
 * architecture is ChatMessage.
 *
 * Chat SHOULD therefore be treated as a compatibility boundary and should
 * progressively migrate callers to:
 *
 *   backend/models/ChatMessage.js
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Chat is NOT:
 *   - the canonical source of truth for new message implementations;
 *   - an authorization replacement;
 *   - a group-membership authority;
 *   - a financial transaction ledger;
 *   - a notification queue;
 *   - an audit-log replacement;
 *   - an object-storage service;
 *   - a tenant-membership authority.
 *
 * Security principles
 * ----------------------------------------------------------------------------
 *   - Mandatory tenant isolation.
 *   - Group and sender authorization remain service responsibilities.
 *   - Message identity fields are immutable.
 *   - Direct uncontrolled mutations are blocked.
 *   - Controlled mutations are tenant-scoped.
 *   - Soft deletion is the canonical normal deletion mechanism.
 *   - Hidden and deleted messages cannot participate in normal read/reaction
 *     operations.
 *   - Content is sanitized as plain text.
 *   - Sensitive network metadata is excluded from serialization.
 *   - Read receipts, reactions and moderation records are bounded.
 *   - Optimistic concurrency is enabled.
 *   - Deterministic pagination uses createdAt + _id ordering.
 *
 * Compatibility principles
 * ----------------------------------------------------------------------------
 *   - Legacy field names are preserved where practical.
 *   - Existing Chat imports remain valid.
 *   - No CommonJS require/module.exports is used.
 *   - New application code SHOULD prefer ChatMessage.
 *   - Financial or authorization state must never be stored in metadata.
 *
 * Module format
 * ----------------------------------------------------------------------------
 * Native ESM.
 *
 * ============================================================================
 */

'use strict';

import mongoose from 'mongoose';
import sanitizeHtml from 'sanitize-html';

const { Schema } = mongoose;

/*
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_ATTACHMENTS = 10;
export const MAX_READ_RECEIPTS = 1000;
export const MAX_REACTIONS = 50;
export const MAX_REACTION_USERS_PER_EMOJI = 1000;
export const MAX_MODERATION_FLAGS = 100;
export const MAX_METADATA_KEYS = 30;
export const MAX_READ_BATCH = 100;

export const MESSAGE_TYPES = Object.freeze([
  'text',
  'system',
  'announcement',
  'warning',
]);

export const CHAT_STATUSES = Object.freeze([
  'ACTIVE',
  'HIDDEN',
  'DELETED',
]);

const PROTECTED_FIELDS = new Set([
  '_id',
  'tenantId',
  'group',
  'sender',
  'parentMessage',
  'createdAt',
]);

/*
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function sanitizePlainText(value) {
  return sanitizeHtml(String(value ?? ''), {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
}

function normalizeEmoji(value) {
  return String(value ?? '').trim().normalize('NFC');
}

function normalizeReason(value) {
  return String(value ?? '').trim().slice(0, 1024);
}

function assertRequired(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new TypeError(`${name} is required`);
  }
}

function assertObjectId(value, name) {
  assertRequired(value, name);

  if (!mongoose.isObjectIdOrHexString(value)) {
    throw new mongoose.Error.CastError(
      'ObjectId',
      value,
      name
    );
  }
}

function assertMessageType(value) {
  if (!MESSAGE_TYPES.includes(value)) {
    throw new Error(
      `Unsupported message type: ${value}`
    );
  }
}

function isVisibleMessage(doc) {
  return (
    doc.status === 'ACTIVE' &&
    doc.isDeleted === false &&
    doc.moderation?.isHidden !== true
  );
}

function serializeChat(_doc, ret) {
  if (ret && ret._id) {
    ret.id = String(ret._id);
  }

  delete ret._id;
  delete ret.__v;

  /*
   * Never expose sensitive network metadata through standard serialization.
   */
  if (ret.metadata) {
    delete ret.metadata.ipAddress;
    delete ret.metadata.userAgent;
  }

  /*
   * Read receipts and reactions are allowed in the normal representation,
   * but private/internal metadata must never leak.
   */
  return ret;
}

function rejectGenericMutation(next) {
  const options =
    typeof this.getOptions === 'function'
      ? this.getOptions()
      : this.options || {};

  if (options.chatInternal === true) {
    return next();
  }

  return next(
    new Error(
      `Direct ${this.op} mutations on Chat are disabled; ` +
        'use a dedicated Chat operation/service'
    )
  );
}

/*
 * ============================================================================
 * SCHEMAS
 * ============================================================================
 */

const ReadReceiptSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },

    readAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
  }
);

const ModerationFlagSchema = new Schema(
  {
    admin: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 1024,
      default: '',
      immutable: true,
    },

    flaggedAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
  },
  {
    _id: true,
    id: false,
    strict: true,
  }
);

const ReactionSchema = new Schema(
  {
    emoji: {
      type: String,
      required: true,
      trim: true,
      maxlength: 32,
    },

    users: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: 'User',
        },
      ],
      default: [],
      validate: {
        validator(value) {
          if (
            !Array.isArray(value) ||
            value.length > MAX_REACTION_USERS_PER_EMOJI
          ) {
            return false;
          }

          const ids = value.map((id) => String(id));

          return new Set(ids).size === ids.length;
        },

        message:
          `A reaction cannot contain more than ` +
          `${MAX_REACTION_USERS_PER_EMOJI} unique users`,
      },
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
  }
);

const ModerationSchema = new Schema(
  {
    flaggedByAdmins: {
      type: [ModerationFlagSchema],
      default: [],
      validate: {
        validator(value) {
          return (
            Array.isArray(value) &&
            value.length <= MAX_MODERATION_FLAGS
          );
        },

        message:
          `A message cannot contain more than ` +
          `${MAX_MODERATION_FLAGS} moderation flags`,
      },
    },

    isHidden: {
      type: Boolean,
      default: false,
    },

    hiddenReason: {
      type: String,
      trim: true,
      maxlength: 1024,
      default: '',
    },

    hiddenAt: {
      type: Date,
      default: null,
    },

    hiddenBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
  }
);

const MetadataSchema = new Schema(
  {
    ipAddress: {
      type: String,
      trim: true,
      maxlength: 128,
      select: false,
    },

    userAgent: {
      type: String,
      trim: true,
      maxlength: 1024,
      select: false,
    },

    edited: {
      type: Boolean,
      default: false,
    },

    editedAt: {
      type: Date,
      default: null,
    },

    requestId: {
      type: String,
      trim: true,
      maxlength: 128,
    },

    correlationId: {
      type: String,
      trim: true,
      maxlength: 128,
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
  }
);

/*
 * ============================================================================
 * CHAT SCHEMA
 * ============================================================================
 */

const ChatSchema = new Schema(
  {
    /*
     * Tenant is mandatory for the current multi-tenant architecture.
     *
     * Legacy Chat documents created before tenant enforcement may therefore
     * require a migration before they can pass validation.
     */
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      immutable: true,
      index: true,
    },

    /*
     * Legacy aggregate naming is preserved.
     *
     * This is the group that owns the communication context.
     */
    group: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      required: [true, 'Group is required'],
      immutable: true,
      index: true,
    },

    sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Sender is required'],
      immutable: true,
      index: true,
    },

    /*
     * Canonical persisted text field for this legacy model.
     */
    message: {
      type: String,
      default: '',
      trim: true,
      maxlength: [
        MAX_MESSAGE_LENGTH,
        `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`,
      ],
    },

    messageType: {
      type: String,
      enum: MESSAGE_TYPES,
      default: 'text',
      required: true,
      lowercase: true,
      trim: true,
    },

    /*
     * Optional attachment compatibility support.
     *
     * ChatMessage is preferred for new attachment-aware implementations.
     */
    attachments: {
      type: [
        {
          type: {
            type: String,
            enum: [
              'image',
              'file',
              'video',
              'other',
            ],
            default: 'other',
            required: true,
          },

          storageKey: {
            type: String,
            trim: true,
            maxlength: 1024,
          },

          url: {
            type: String,
            trim: true,
            maxlength: 4096,
            select: false,
          },

          filename: {
            type: String,
            trim: true,
            maxlength: 255,
          },

          size: {
            type: Number,
            min: 0,
            max: 100 * 1024 * 1024,
          },

          mimeType: {
            type: String,
            trim: true,
            maxlength: 255,
            lowercase: true,
          },

          contentHash: {
            type: String,
            trim: true,
            maxlength: 256,
            select: false,
          },
        },
      ],
      default: [],
      validate: {
        validator(value) {
          return (
            Array.isArray(value) &&
            value.length <= MAX_ATTACHMENTS
          );
        },

        message:
          `A message cannot contain more than ` +
          `${MAX_ATTACHMENTS} attachments`,
      },
    },

    readBy: {
      type: [ReadReceiptSchema],
      default: [],
      validate: {
        validator(value) {
          if (
            !Array.isArray(value) ||
            value.length > MAX_READ_RECEIPTS
          ) {
            return false;
          }

          const ids = value.map((entry) =>
            String(entry.user)
          );

          return new Set(ids).size === ids.length;
        },

        message:
          `A message cannot contain more than ` +
          `${MAX_READ_RECEIPTS} unique read receipts`,
      },
    },

    moderation: {
      type: ModerationSchema,
      default: () => ({}),
    },

    reactions: {
      type: [ReactionSchema],
      default: [],
      validate: {
        validator(value) {
          if (
            !Array.isArray(value) ||
            value.length > MAX_REACTIONS
          ) {
            return false;
          }

          const emojis = value.map(
            (reaction) => reaction.emoji
          );

          return (
            new Set(emojis).size === emojis.length
          );
        },

        message:
          `A message cannot contain more than ` +
          `${MAX_REACTIONS} unique reaction types`,
      },
    },

    /*
     * Legacy threaded-message relation.
     */
    parentMessage: {
      type: Schema.Types.ObjectId,
      ref: 'Chat',
      default: null,
      immutable: true,
      index: true,
    },

    /*
     * Canonical lifecycle.
     */
    status: {
      type: String,
      enum: CHAT_STATUSES,
      default: 'ACTIVE',
      index: true,
    },

    /*
     * Compatibility representation for legacy callers.
     */
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
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

    metadata: {
      type: MetadataSchema,
      default: () => ({}),
    },

    extraMetadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: undefined,
      validate: {
        validator(value) {
          return (
            !value ||
            value.size <= MAX_METADATA_KEYS
          );
        },

        message:
          `extraMetadata cannot contain more than ` +
          `${MAX_METADATA_KEYS} keys`,
      },
    },
  },
  {
    timestamps: true,

    optimisticConcurrency: true,

    minimize: true,

    strict: true,

    versionKey: true,

    toJSON: {
      virtuals: true,
      transform: serializeChat,
    },

    toObject: {
      virtuals: true,
      transform: serializeChat,
    },
  }
);

/*
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

ChatSchema.index({
  tenantId: 1,
  group: 1,
  createdAt: -1,
  _id: -1,
});

ChatSchema.index({
  tenantId: 1,
  group: 1,
  status: 1,
  createdAt: -1,
  _id: -1,
});

ChatSchema.index({
  tenantId: 1,
  sender: 1,
  createdAt: -1,
});

ChatSchema.index({
  tenantId: 1,
  group: 1,
  parentMessage: 1,
  createdAt: 1,
  _id: 1,
});

ChatSchema.index({
  tenantId: 1,
  'moderation.isHidden': 1,
  createdAt: -1,
});

ChatSchema.index({
  tenantId: 1,
  isDeleted: 1,
  createdAt: -1,
});

ChatSchema.index({
  tenantId: 1,
  'metadata.requestId': 1,
});

ChatSchema.index({
  tenantId: 1,
  'metadata.correlationId': 1,
});

/*
 * ============================================================================
 * DOCUMENT VALIDATION / NORMALIZATION
 * ============================================================================
 */

ChatSchema.pre(
  'validate',
  function normalizeAndValidateChat(next) {
    if (this.isModified('message')) {
      this.message = sanitizePlainText(
        this.message
      );
    }

    if (
      this.message.length === 0 &&
      this.attachments.length === 0
    ) {
      this.invalidate(
        'message',
        'Chat message must contain text or at least one attachment'
      );
    }

    assertMessageType(this.messageType);

    if (
      this.isModified('reactions')
    ) {
      const seenEmojis = new Set();

      for (const reaction of this.reactions) {
        reaction.emoji = normalizeEmoji(
          reaction.emoji
        );

        if (
          !reaction.emoji ||
          reaction.emoji.length > 32
        ) {
          this.invalidate(
            'reactions',
            'Reaction emoji is invalid'
          );
        }

        if (
          seenEmojis.has(reaction.emoji)
        ) {
          this.invalidate(
            'reactions',
            `Duplicate reaction type "${reaction.emoji}" is not allowed`
          );
        }

        seenEmojis.add(
          reaction.emoji
        );
      }
    }

    if (
      this.extraMetadata &&
      this.extraMetadata.size > MAX_METADATA_KEYS
    ) {
      this.invalidate(
        'extraMetadata',
        `extraMetadata cannot contain more than ${MAX_METADATA_KEYS} keys`
      );
    }

    next();
  }
);

ChatSchema.pre(
  'validate',
  function synchronizeLifecycle(next) {
    if (
      this.status === 'HIDDEN' ||
      this.status === 'DELETED'
    ) {
      this.isDeleted = true;

      if (!this.deletedAt) {
        this.deletedAt = new Date();
      }
    }

    if (this.status === 'ACTIVE') {
      this.isDeleted = false;
      this.deletedAt = null;
      this.deletedBy = null;
    }

    if (
      this.isDeleted &&
      this.status === 'ACTIVE'
    ) {
      this.status = 'DELETED';

      if (!this.deletedAt) {
        this.deletedAt = new Date();
      }
    }

    next();
  }
);

/*
 * ============================================================================
 * QUERY MUTATION SAFETY
 * ============================================================================
 */

for (const method of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
]) {
  ChatSchema.pre(
    method,
    rejectGenericMutation
  );
}

ChatSchema.pre(
  'bulkWrite',
  function rejectBulkWrite(next) {
    next(
      new Error(
        'Chat.bulkWrite() is disabled; use dedicated Chat operations'
      )
    );
  }
);

ChatSchema.pre(
  'updateOne',
  function rejectUpdatePipeline(next) {
    if (Array.isArray(this.getUpdate())) {
      return next(
        new Error(
          'Chat update pipelines are disabled'
        )
      );
    }

    return next();
  }
);

ChatSchema.pre(
  'updateMany',
  function rejectUpdateManyPipeline(next) {
    if (Array.isArray(this.getUpdate())) {
      return next(
        new Error(
          'Chat update pipelines are disabled'
        )
      );
    }

    return next();
  }
);

ChatSchema.pre(
  'findOneAndUpdate',
  function rejectFindOneAndUpdatePipeline(next) {
    if (Array.isArray(this.getUpdate())) {
      return next(
        new Error(
          'Chat update pipelines are disabled'
        )
      );
    }

    return next();
  }
);

/*
 * ============================================================================
 * HARD DELETE PROTECTION
 * ============================================================================
 */

ChatSchema.pre(
  'deleteOne',
  function rejectQueryDeleteOne(next) {
    next(
      new Error(
        'Chat hard deletion is disabled; use softDelete()'
      )
    );
  }
);

ChatSchema.pre(
  'deleteOne',
  {
    document: true,
    query: false,
  },
  function rejectDocumentDeleteOne(next) {
    next(
      new Error(
        'Chat hard deletion is disabled; use softDelete()'
      )
    );
  }
);

ChatSchema.pre(
  'deleteMany',
  function rejectDeleteMany(next) {
    next(
      new Error(
        'Chat hard deletion is disabled; use controlled retention workflow'
      )
    );
  }
);

ChatSchema.pre(
  'findOneAndDelete',
  function rejectFindOneAndDelete(next) {
    next(
      new Error(
        'Chat hard deletion is disabled; use controlled retention workflow'
      )
    );
  }
);

ChatSchema.pre(
  'replaceOne',
  function rejectReplacement(next) {
    const options =
      typeof this.getOptions === 'function'
        ? this.getOptions()
        : this.options || {};

    if (options.chatInternal !== true) {
      return next(
        new Error(
          'Chat replacement is disabled'
        )
      );
    }

    return next();
  }
);

ChatSchema.pre(
  'findOneAndReplace',
  function rejectFindOneReplacement(next) {
    const options =
      typeof this.getOptions === 'function'
        ? this.getOptions()
        : this.options || {};

    if (options.chatInternal !== true) {
      return next(
        new Error(
          'Chat replacement is disabled'
        )
      );
    }

    return next();
  }
);

/*
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

ChatSchema.virtual('readCount')
  .get(function readCount() {
    return Array.isArray(this.readBy)
      ? this.readBy.length
      : 0;
  });

ChatSchema.virtual('reactionCount')
  .get(function reactionCount() {
    if (!Array.isArray(this.reactions)) {
      return 0;
    }

    return this.reactions.reduce(
      (total, reaction) =>
        total +
        (Array.isArray(reaction.users)
          ? reaction.users.length
          : 0),
      0
    );
  });

ChatSchema.virtual('isVisible')
  .get(function isVisible() {
    return isVisibleMessage(this);
  });

/*
 * ============================================================================
 * INSTANCE METHODS
 * ============================================================================
 */

/**
 * --------------------------------------------------------------------------
 * Mark message read
 * --------------------------------------------------------------------------
 *
 * Service-level authorization is still required before calling this method.
 */
ChatSchema.methods.markAsRead =
  async function markAsRead(
    tenantId,
    userId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    if (
      String(this.tenantId) !==
      String(tenantId)
    ) {
      throw new Error(
        'Chat message does not belong to the supplied tenant'
      );
    }

    if (!isVisibleMessage(this)) {
      return this;
    }

    const alreadyRead = this.readBy.some(
      (receipt) =>
        String(receipt.user) ===
        String(userId)
    );

    if (alreadyRead) {
      return this;
    }

    if (
      this.readBy.length >=
      MAX_READ_RECEIPTS
    ) {
      throw new Error(
        `A message cannot contain more than ${MAX_READ_RECEIPTS} read receipts`
      );
    }

    this.readBy.push({
      user: userId,
      readAt: new Date(),
    });

    await this.save({
      session: options.session,
    });

    return this;
  };

/**
 * --------------------------------------------------------------------------
 * Add reaction
 * --------------------------------------------------------------------------
 */
ChatSchema.methods.addReaction =
  async function addReaction(
    tenantId,
    emoji,
    userId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    if (
      String(this.tenantId) !==
      String(tenantId)
    ) {
      throw new Error(
        'Chat message does not belong to the supplied tenant'
      );
    }

    if (!isVisibleMessage(this)) {
      throw new Error(
        'Hidden or deleted messages cannot receive reactions'
      );
    }

    const normalizedEmoji =
      normalizeEmoji(emoji);

    if (
      !normalizedEmoji ||
      normalizedEmoji.length > 32
    ) {
      throw new Error(
        'Invalid reaction emoji'
      );
    }

    let reaction =
      this.reactions.find(
        (item) =>
          item.emoji ===
          normalizedEmoji
      );

    if (!reaction) {
      if (
        this.reactions.length >=
        MAX_REACTIONS
      ) {
        throw new Error(
          `A message cannot contain more than ${MAX_REACTIONS} reaction types`
        );
      }

      reaction = {
        emoji: normalizedEmoji,
        users: [],
      };

      this.reactions.push(
        reaction
      );
    }

    const alreadyReacted =
      reaction.users.some(
        (id) =>
          String(id) ===
          String(userId)
      );

    if (
      !alreadyReacted
    ) {
      if (
        reaction.users.length >=
        MAX_REACTION_USERS_PER_EMOJI
      ) {
        throw new Error(
          `Reaction "${normalizedEmoji}" has reached its maximum user count`
        );
      }

      reaction.users.push(
        userId
      );
    }

    await this.save({
      session: options.session,
    });

    return this;
  };

/**
 * --------------------------------------------------------------------------
 * Remove reaction
 * --------------------------------------------------------------------------
 */
ChatSchema.methods.removeReaction =
  async function removeReaction(
    tenantId,
    emoji,
    userId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    if (
      String(this.tenantId) !==
      String(tenantId)
    ) {
      throw new Error(
        'Chat message does not belong to the supplied tenant'
      );
    }

    const normalizedEmoji =
      normalizeEmoji(emoji);

    if (!normalizedEmoji) {
      throw new Error(
        'Reaction emoji is required'
      );
    }

    const reaction =
      this.reactions.find(
        (item) =>
          item.emoji ===
          normalizedEmoji
      );

    if (!reaction) {
      return this;
    }

    reaction.users =
      reaction.users.filter(
        (id) =>
          String(id) !==
          String(userId)
      );

    this.reactions =
      this.reactions.filter(
        (item) =>
          item.users.length > 0
      );

    await this.save({
      session: options.session,
    });

    return this;
  };

/**
 * --------------------------------------------------------------------------
 * Flag for moderation
 * --------------------------------------------------------------------------
 */
ChatSchema.methods.flagForModeration =
  async function flagForModeration(
    tenantId,
    adminId,
    reason = '',
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      adminId,
      'adminId'
    );

    if (
      String(this.tenantId) !==
      String(tenantId)
    ) {
      throw new Error(
        'Chat message does not belong to the supplied tenant'
      );
    }

    if (
      this.moderation.flaggedByAdmins.length >=
      MAX_MODERATION_FLAGS
    ) {
      throw new Error(
        `A message cannot contain more than ${MAX_MODERATION_FLAGS} moderation flags`
      );
    }

    this.moderation.flaggedByAdmins.push({
      admin: adminId,
      reason:
        normalizeReason(reason),
      flaggedAt: new Date(),
    });

    await this.save({
      session: options.session,
    });

    return this;
  };

/**
 * --------------------------------------------------------------------------
 * Hide message
 * --------------------------------------------------------------------------
 */
ChatSchema.methods.hideMessage =
  async function hideMessage(
    tenantId,
    adminId,
    reason = 'Message hidden',
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      adminId,
      'adminId'
    );

    if (
      String(this.tenantId) !==
      String(tenantId)
    ) {
      throw new Error(
        'Chat message does not belong to the supplied tenant'
      );
    }

    if (
      this.status ===
      'DELETED'
    ) {
      throw new Error(
        'Deleted messages cannot be hidden'
      );
    }

    const now = new Date();

    this.status = 'HIDDEN';
    this.isDeleted = true;

    this.deletedAt = now;
    this.deletedBy = adminId;

    this.moderation.isHidden = true;
    this.moderation.hiddenReason =
      normalizeReason(reason);
    this.moderation.hiddenAt = now;
    this.moderation.hiddenBy =
      adminId;

    await this.save({
      session: options.session,
    });

    return this;
  };

/**
 * --------------------------------------------------------------------------
 * Restore hidden message
 * --------------------------------------------------------------------------
 */
ChatSchema.methods.restoreMessage =
  async function restoreMessage(
    tenantId,
    adminId,
    reason = 'Message restored',
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      adminId,
      'adminId'
    );

    if (
      String(this.tenantId) !==
      String(tenantId)
    ) {
      throw new Error(
        'Chat message does not belong to the supplied tenant'
      );
    }

    if (
      this.status ===
      'DELETED'
    ) {
      throw new Error(
        'A deleted message requires controlled administrative review before restoration'
      );
    }

    if (
      this.status !==
      'HIDDEN'
    ) {
      return this;
    }

    if (
      this.moderation.flaggedByAdmins.length >=
      MAX_MODERATION_FLAGS
    ) {
      throw new Error(
        `A message cannot contain more than ${MAX_MODERATION_FLAGS} moderation flags`
      );
    }

    this.status = 'ACTIVE';
    this.isDeleted = false;

    this.deletedAt = null;
    this.deletedBy = null;

    this.moderation.isHidden =
      false;

    this.moderation.hiddenReason =
      '';

    this.moderation.hiddenAt =
      null;

    this.moderation.hiddenBy =
      null;

    /*
     * Preserve the restoration reason as a moderation flag/audit-compatible
     * compatibility record. Full canonical moderation history belongs in the
     * service/audit layer.
     */
    this.moderation.flaggedByAdmins.push({
      admin: adminId,
      reason:
        normalizeReason(reason),
      flaggedAt: new Date(),
    });

    await this.save({
      session: options.session,
    });

    return this;
  };

/**
 * --------------------------------------------------------------------------
 * Soft delete
 * --------------------------------------------------------------------------
 */
ChatSchema.methods.softDelete =
  async function softDelete(
    tenantId,
    adminId,
    reason = 'Message deleted',
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      adminId,
      'adminId'
    );

    if (
      String(this.tenantId) !==
      String(tenantId)
    ) {
      throw new Error(
        'Chat message does not belong to the supplied tenant'
      );
    }

    if (
      this.status ===
      'DELETED'
    ) {
      return this;
    }

    const now = new Date();

    this.status = 'DELETED';
    this.isDeleted = true;

    this.deletedAt = now;
    this.deletedBy = adminId;

    this.moderation.isHidden = true;
    this.moderation.hiddenReason =
      normalizeReason(reason);
    this.moderation.hiddenAt =
      now;
    this.moderation.hiddenBy =
      adminId;

    await this.save({
      session: options.session,
    });

    return this;
  };

/**
 * --------------------------------------------------------------------------
 * Edit message
 * --------------------------------------------------------------------------
 */
ChatSchema.methods.editMessage =
  async function editMessage(
    tenantId,
    editorId,
    newMessage,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      editorId,
      'editorId'
    );

    if (
      String(this.tenantId) !==
      String(tenantId)
    ) {
      throw new Error(
        'Chat message does not belong to the supplied tenant'
      );
    }

    if (!isVisibleMessage(this)) {
      throw new Error(
        'Hidden or deleted messages cannot be edited'
      );
    }

    if (
      String(editorId) !==
        String(this.sender) &&
      options.allowModeratorEdit !== true
    ) {
      throw new Error(
        'Only the message sender may edit this message'
      );
    }

    const sanitized =
      sanitizePlainText(
        newMessage
      );

    if (
      sanitized.length >
      MAX_MESSAGE_LENGTH
    ) {
      throw new Error(
        `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`
      );
    }

    if (
      !sanitized &&
      this.attachments.length === 0
    ) {
      throw new Error(
        'Edited message cannot be empty'
      );
    }

    this.message =
      sanitized;

    if (!this.metadata) {
      this.metadata = {};
    }

    this.metadata.edited =
      true;

    this.metadata.editedAt =
      new Date();

    await this.save({
      session: options.session,
    });

    return this;
  };

/*
 * ============================================================================
 * STATIC OPERATIONS
 * ============================================================================
 */

/**
 * Find one Chat message within a tenant.
 *
 * This is intentionally tenant-scoped.
 */
ChatSchema.statics.findTenantChat =
  function findTenantChat(
    tenantId,
    chatId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      chatId,
      'chatId'
    );

    const filter = {
      _id: chatId,
      tenantId,
    };

    if (
      options.includeDeleted !== true
    ) {
      filter.status = 'ACTIVE';
      filter.isDeleted = false;
      filter['moderation.isHidden'] =
        false;
    }

    const query =
      this.findOne(filter);

    if (options.session) {
      query.session(
        options.session
      );
    }

    return query.exec();
  };

/**
 * Find group conversation messages.
 */
ChatSchema.statics.findGroupMessages =
  function findGroupMessages(
    tenantId,
    groupId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      groupId,
      'groupId'
    );

    const {
      limit = 50,
      before = null,
      beforeId = null,
      includeDeleted = false,
      session = undefined,
    } = options;

    const safeLimit = Math.min(
      Math.max(
        Number(limit) || 50,
        1
      ),
      100
    );

    const filter = {
      tenantId,
      group: groupId,
    };

    if (
      includeDeleted !== true
    ) {
      filter.status = 'ACTIVE';
      filter.isDeleted = false;
      filter['moderation.isHidden'] =
        false;
    }

    if (
      before !== null &&
      before !== undefined
    ) {
      const beforeDate =
        before instanceof Date
          ? before
          : new Date(before);

      if (
        Number.isNaN(
          beforeDate.getTime()
        )
      ) {
        throw new TypeError(
          'before must be a valid date'
        );
      }

      if (beforeId) {
        assertObjectId(
          beforeId,
          'beforeId'
        );

        filter.$or = [
          {
            createdAt: {
              $lt: beforeDate,
            },
          },
          {
            createdAt: beforeDate,
            _id: {
              $lt: beforeId,
            },
          },
        ];
      } else {
        filter.createdAt = {
          $lt: beforeDate,
        };
      }
    }

    const query = this.find(filter)
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .limit(safeLimit)
      .lean();

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Mark one message read using an atomic update.
 *
 * This method deliberately uses a private internal mutation flag because
 * direct query mutation is otherwise blocked by middleware.
 */
ChatSchema.statics.markAsRead =
  async function markAsRead(
    tenantId,
    chatId,
    userId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      chatId,
      'chatId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    return this.updateOne(
      {
        _id: chatId,
        tenantId,
        status: 'ACTIVE',
        isDeleted: false,
        'moderation.isHidden': false,
        'readBy.user': {
          $ne: userId,
        },
        $expr: {
          $lt: [
            {
              $size: {
                $ifNull: [
                  '$readBy',
                  [],
                ],
              },
            },
            MAX_READ_RECEIPTS,
          ],
        },
      },
      {
        $push: {
          readBy: {
            user: userId,
            readAt: new Date(),
          },
        },
      },
      {
        runValidators: true,
        chatInternal: true,
        session: options.session,
      }
    ).exec();
  };

/**
 * Mark many group messages read.
 */
ChatSchema.statics.markManyAsRead =
  async function markManyAsRead(
    tenantId,
    chatIds,
    userId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    if (
      !Array.isArray(chatIds)
    ) {
      throw new TypeError(
        'chatIds must be an array'
      );
    }

    const ids = [
      ...new Set(
        chatIds.map(
          (id) => String(id)
        )
      ),
    ];

    if (
      ids.length === 0
    ) {
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
      };
    }

    if (
      ids.length >
      MAX_READ_BATCH
    ) {
      throw new RangeError(
        `A read receipt batch cannot contain more than ${MAX_READ_BATCH} messages`
      );
    }

    ids.forEach((id) =>
      assertObjectId(
        id,
        'chatId'
      )
    );

    return this.updateMany(
      {
        tenantId,
        _id: {
          $in: ids,
        },
        status: 'ACTIVE',
        isDeleted: false,
        'moderation.isHidden': false,
        'readBy.user': {
          $ne: userId,
        },
        $expr: {
          $lt: [
            {
              $size: {
                $ifNull: [
                  '$readBy',
                  [],
                ],
              },
            },
            MAX_READ_RECEIPTS,
          ],
        },
      },
      {
        $push: {
          readBy: {
            user: userId,
            readAt: new Date(),
          },
        },
      },
      {
        runValidators: true,
        chatInternal: true,
        session: options.session,
      }
    ).exec();
  };

/*
 * ============================================================================
 * MODEL
 * ============================================================================
 */

const Chat =
  mongoose.models.Chat ||
  mongoose.model(
    'Chat',
    ChatSchema
  );

export {
  ReadReceiptSchema,
  ModerationFlagSchema,
  ReactionSchema,
  ModerationSchema,
  MetadataSchema,
  ChatSchema,
};

export default Chat;