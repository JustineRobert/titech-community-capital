/**
 * ============================================================================
 * backend/models/ChatMessage.js
 * TITech Community Capital LTD
 * Enterprise Chat Message Aggregate
 * ============================================================================
 *
 * Architectural role
 * ----------------------------------------------------------------------------
 * ChatMessage is the canonical communication record for:
 *
 *   - direct messaging
 *   - group discussions
 *   - loan threads
 *   - savings discussions
 *   - transaction disputes
 *   - support conversations
 *   - administration / announcements
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * ChatMessage is:
 *   - the source of truth for persisted message content and message state;
 *   - tenant-scoped communication data;
 *   - responsible for message-level lifecycle, reactions, read receipts and
 *     moderation state.
 *
 * ChatMessage is NOT:
 *   - an authorization replacement;
 *   - a conversation-membership authority;
 *   - a financial transaction ledger;
 *   - a notification queue;
 *   - an audit-log replacement;
 *   - an object-storage URL/signing service;
 *   - a replacement for the chat service/repository boundary.
 *
 * Security principles
 * ----------------------------------------------------------------------------
 *   - Mandatory tenant isolation.
 *   - Conversation and sender authorization remain service responsibilities.
 *   - Message identity fields are immutable.
 *   - Direct uncontrolled message mutations are blocked.
 *   - Controlled mutations are tenant-scoped.
 *   - Soft deletion is the canonical normal deletion mechanism.
 *   - Hidden and deleted messages cannot be mutated through normal read/
 *     reaction workflows.
 *   - Content is sanitized as plain text.
 *   - Attachment URLs are never exposed through normal serialization.
 *   - Read-receipt and reaction collections are bounded.
 *   - Moderation history is retained in the message document.
 *   - Optimistic concurrency is enabled.
 *   - Pagination uses deterministic createdAt + _id ordering.
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
 * --------------------------------------------------------------------------
 * CONSTANTS
 * --------------------------------------------------------------------------
 */

export const MAX_CONTENT_LENGTH = 2000;
export const MAX_ATTACHMENTS = 10;
export const MAX_READ_RECEIPTS = 1000;
export const MAX_REACTIONS = 50;
export const MAX_REACTION_USERS_PER_EMOJI = 1000;
export const MAX_MODERATION_NOTES = 100;
export const MAX_METADATA_KEYS = 30;
export const MAX_READ_BATCH = 100;

export const MESSAGE_ATTACHMENT_TYPES = Object.freeze([
  'image',
  'file',
  'video',
  'other',
]);

export const MODERATION_ACTIONS = Object.freeze([
  'flag',
  'hide',
  'note',
  'delete',
  'restore',
]);

export const MESSAGE_STATUSES = Object.freeze([
  'ACTIVE',
  'HIDDEN',
  'DELETED',
]);

const PROTECTED_MESSAGE_FIELDS = new Set([
  '_id',
  'tenantId',
  'conversation',
  'sender',
  'replyTo',
  'createdAt',
]);

/*
 * --------------------------------------------------------------------------
 * HELPERS
 * --------------------------------------------------------------------------
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
    throw new mongoose.Error.CastError('ObjectId', value, name);
  }
}

function hasAttachments(doc) {
  return Array.isArray(doc.attachments) && doc.attachments.length > 0;
}

function isActiveMessage(doc) {
  return doc.status === 'ACTIVE' && doc.isDeleted === false;
}

function serializeMessage(_doc, ret) {
  if (ret && ret._id) {
    ret.id = String(ret._id);
  }

  delete ret._id;
  delete ret.__v;

  if (ret.metadata) {
    delete ret.metadata.ipAddress;
    delete ret.metadata.userAgent;
  }

  if (Array.isArray(ret.attachments)) {
    ret.attachments = ret.attachments.map((attachment) => {
      const safeAttachment = { ...attachment };

      /*
       * Never expose a stored/signed URL automatically.
       * A dedicated attachment service should issue temporary URLs.
       */
      delete safeAttachment.url;

      return safeAttachment;
    });
  }

  return ret;
}

function validateUpdateFields(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) {
    return;
  }

  for (const [operator, value] of Object.entries(update)) {
    if (operator.startsWith('$')) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }

      for (const field of Object.keys(value)) {
        const rootField = field.split('.')[0];

        if (PROTECTED_MESSAGE_FIELDS.has(rootField)) {
          throw new Error(
            `Protected ChatMessage field "${rootField}" cannot be modified`
          );
        }
      }

      continue;
    }

    const rootField = operator.split('.')[0];

    if (PROTECTED_MESSAGE_FIELDS.has(rootField)) {
      throw new Error(
        `Protected ChatMessage field "${rootField}" cannot be modified`
      );
    }
  }
}

/*
 * Direct query mutations are deliberately blocked.
 *
 * Message mutations should go through the dedicated instance/static
 * operations below and ultimately through the service/repository layer.
 */
function rejectGenericMutation(next) {
  const options =
    typeof this.getOptions === 'function'
      ? this.getOptions()
      : this.options || {};

  if (options.chatMessageInternal === true) {
    try {
      validateUpdateFields(this.getUpdate());
      return next();
    } catch (error) {
      return next(error);
    }
  }

  return next(
    new Error(
      `Direct ${this.op} mutations on ChatMessage are disabled; ` +
        'use a dedicated ChatMessage operation/service'
    )
  );
}

/*
 * --------------------------------------------------------------------------
 * ATTACHMENT
 * --------------------------------------------------------------------------
 */

const AttachmentSchema = new Schema(
  {
    type: {
      type: String,
      enum: MESSAGE_ATTACHMENT_TYPES,
      required: true,
      default: 'other',
      trim: true,
    },

    /*
     * Canonical private object-storage reference.
     */
    storageKey: {
      type: String,
      trim: true,
      maxlength: 1024,
    },

    /*
     * Legacy compatibility.
     *
     * Never expose this directly through normal API serialization.
     * Prefer storageKey and generate signed URLs in the service layer.
     */
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
      lowercase: true,
      maxlength: 255,
    },

    contentHash: {
      type: String,
      trim: true,
      maxlength: 256,
      select: false,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
  }
);

AttachmentSchema.pre('validate', function validateAttachment(next) {
  const storageKey =
    typeof this.storageKey === 'string' ? this.storageKey.trim() : '';

  const url = typeof this.url === 'string' ? this.url.trim() : '';

  if (!storageKey && !url) {
    this.invalidate(
      'storageKey',
      'Attachment requires storageKey or url'
    );
  }

  next();
});

/*
 * --------------------------------------------------------------------------
 * READ RECEIPT
 * --------------------------------------------------------------------------
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

/*
 * --------------------------------------------------------------------------
 * MODERATION NOTE
 * --------------------------------------------------------------------------
 */

const ModerationNoteSchema = new Schema(
  {
    moderator: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },

    action: {
      type: String,
      enum: MODERATION_ACTIONS,
      required: true,
      immutable: true,
      lowercase: true,
      trim: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 1024,
      default: '',
      immutable: true,
    },

    createdAt: {
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

/*
 * --------------------------------------------------------------------------
 * REACTION
 * --------------------------------------------------------------------------
 */

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

          const userIds = value.map((userId) => String(userId));

          return new Set(userIds).size === userIds.length;
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

/*
 * --------------------------------------------------------------------------
 * MESSAGE METADATA
 * --------------------------------------------------------------------------
 */

const MessageMetadataSchema = new Schema(
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
 * --------------------------------------------------------------------------
 * CHAT MESSAGE
 * --------------------------------------------------------------------------
 */

const ChatMessageSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      immutable: true,
      index: true,
    },

    conversation: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      immutable: true,
      index: true,
    },

    sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },

    /*
     * Empty content is permitted only when attachments exist.
     */
    content: {
      type: String,
      default: '',
      trim: true,
      maxlength: [
        MAX_CONTENT_LENGTH,
        `Message cannot exceed ${MAX_CONTENT_LENGTH} characters`,
      ],
    },

    attachments: {
      type: [AttachmentSchema],
      default: [],
      validate: {
        validator(value) {
          return (
            Array.isArray(value) &&
            value.length <= MAX_ATTACHMENTS
          );
        },
        message:
          `A message cannot contain more than ${MAX_ATTACHMENTS} attachments`,
      },
    },

    replyTo: {
      type: Schema.Types.ObjectId,
      ref: 'ChatMessage',
      default: null,
      immutable: true,
      index: true,
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

          const ids = value.map((entry) => String(entry.user));

          return new Set(ids).size === ids.length;
        },
        message:
          `A message cannot contain more than ` +
          `${MAX_READ_RECEIPTS} unique read receipts`,
      },
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

          const emojis = value.map((reaction) => reaction.emoji);

          return new Set(emojis).size === emojis.length;
        },
        message:
          `A message cannot contain more than ` +
          `${MAX_REACTIONS} reaction types`,
      },
    },

    moderated: {
      type: Boolean,
      default: false,
      index: true,
    },

    moderationNotes: {
      type: [ModerationNoteSchema],
      default: [],
      validate: {
        validator(value) {
          return (
            Array.isArray(value) &&
            value.length <= MAX_MODERATION_NOTES
          );
        },
        message:
          `A message cannot contain more than ` +
          `${MAX_MODERATION_NOTES} moderation notes`,
      },
    },

    /*
     * Canonical message lifecycle.
     */
    status: {
      type: String,
      enum: MESSAGE_STATUSES,
      default: 'ACTIVE',
      index: true,
    },

    /*
     * Legacy compatibility field.
     *
     * status remains the canonical lifecycle state.
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
      type: MessageMetadataSchema,
      default: () => ({}),
    },

    /*
     * Bounded application metadata only.
     *
     * Never put financial/accounting state here.
     */
    extraMetadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: undefined,
      validate: {
        validator(value) {
          return !value || value.size <= MAX_METADATA_KEYS;
        },
        message:
          `extraMetadata cannot contain more than ` +
          `${MAX_METADATA_KEYS} keys`,
      },
    },
  },
  {
    timestamps: true,

    /*
     * Detect concurrent document edits.
     */
    optimisticConcurrency: true,

    minimize: true,

    strict: true,

    toJSON: {
      virtuals: true,
      transform: serializeMessage,
    },

    toObject: {
      virtuals: true,
      transform: serializeMessage,
    },
  }
);

/*
 * --------------------------------------------------------------------------
 * INDEXES
 * --------------------------------------------------------------------------
 */

ChatMessageSchema.index({
  tenantId: 1,
  conversation: 1,
  createdAt: -1,
  _id: -1,
});

ChatMessageSchema.index({
  tenantId: 1,
  conversation: 1,
  status: 1,
  createdAt: -1,
  _id: -1,
});

ChatMessageSchema.index({
  tenantId: 1,
  conversation: 1,
  replyTo: 1,
  createdAt: 1,
});

ChatMessageSchema.index({
  tenantId: 1,
  sender: 1,
  createdAt: -1,
});

ChatMessageSchema.index({
  tenantId: 1,
  'metadata.requestId': 1,
});

ChatMessageSchema.index({
  tenantId: 1,
  'metadata.correlationId': 1,
});

ChatMessageSchema.index({
  tenantId: 1,
  isDeleted: 1,
  createdAt: -1,
});

ChatMessageSchema.index({
  tenantId: 1,
  moderated: 1,
  createdAt: -1,
});

/*
 * --------------------------------------------------------------------------
 * DOCUMENT VALIDATION / NORMALIZATION
 * --------------------------------------------------------------------------
 */

ChatMessageSchema.pre('validate', function normalizeAndValidateMessage(next) {
  if (this.isModified('content')) {
    this.content = sanitizePlainText(this.content);
  }

  if (
    (!this.content || this.content.length === 0) &&
    !hasAttachments(this)
  ) {
    this.invalidate(
      'content',
      'Message must contain text or at least one attachment'
    );
  }

  if (this.isModified('attachments') && this.attachments.length > MAX_ATTACHMENTS) {
    this.invalidate(
      'attachments',
      `A message cannot contain more than ${MAX_ATTACHMENTS} attachments`
    );
  }

  if (this.isModified('readBy') && this.readBy.length > MAX_READ_RECEIPTS) {
    this.invalidate(
      'readBy',
      `A message cannot contain more than ${MAX_READ_RECEIPTS} read receipts`
    );
  }

  if (this.isModified('reactions')) {
    if (this.reactions.length > MAX_REACTIONS) {
      this.invalidate(
        'reactions',
        `A message cannot contain more than ${MAX_REACTIONS} reaction types`
      );
    }

    const emojis = new Set();

    for (const reaction of this.reactions) {
      reaction.emoji = normalizeEmoji(reaction.emoji);

      if (emojis.has(reaction.emoji)) {
        this.invalidate(
          'reactions',
          `Duplicate reaction type "${reaction.emoji}" is not allowed`
        );
      }

      emojis.add(reaction.emoji);

      if (
        Array.isArray(reaction.users) &&
        reaction.users.length > MAX_REACTION_USERS_PER_EMOJI
      ) {
        this.invalidate(
          'reactions',
          `A reaction cannot contain more than ` +
            `${MAX_REACTION_USERS_PER_EMOJI} users`
        );
      }

      if (Array.isArray(reaction.users)) {
        const userIds = reaction.users.map((userId) =>
          String(userId)
        );

        if (new Set(userIds).size !== userIds.length) {
          this.invalidate(
            'reactions',
            `Reaction "${reaction.emoji}" contains duplicate users`
          );
        }
      }
    }
  }

  if (
    this.isModified('moderationNotes') &&
    this.moderationNotes.length > MAX_MODERATION_NOTES
  ) {
    this.invalidate(
      'moderationNotes',
      `A message cannot contain more than ` +
        `${MAX_MODERATION_NOTES} moderation notes`
    );
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
});

ChatMessageSchema.pre('validate', function synchronizeLifecycle(next) {
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

  /*
   * Preserve legacy isDeleted compatibility.
   *
   * A document explicitly marked deleted cannot remain ACTIVE.
   */
  if (this.isDeleted && this.status === 'ACTIVE') {
    this.status = 'DELETED';

    if (!this.deletedAt) {
      this.deletedAt = new Date();
    }
  }

  next();
});

/*
 * --------------------------------------------------------------------------
 * QUERY SAFETY
 * --------------------------------------------------------------------------
 */

for (const method of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
]) {
  ChatMessageSchema.pre(method, rejectGenericMutation);
}

/*
 * Prevent pipeline updates completely.
 */
ChatMessageSchema.pre(
  'updateOne',
  function rejectUpdatePipeline(next) {
    if (Array.isArray(this.getUpdate())) {
      return next(
        new Error('ChatMessage update pipelines are disabled')
      );
    }

    return next();
  }
);

ChatMessageSchema.pre(
  'updateMany',
  function rejectUpdateManyPipeline(next) {
    if (Array.isArray(this.getUpdate())) {
      return next(
        new Error('ChatMessage update pipelines are disabled')
      );
    }

    return next();
  }
);

ChatMessageSchema.pre(
  'findOneAndUpdate',
  function rejectFindOneAndUpdatePipeline(next) {
    if (Array.isArray(this.getUpdate())) {
      return next(
        new Error('ChatMessage update pipelines are disabled')
      );
    }

    return next();
  }
);

/*
 * Bulk mutation is deliberately disallowed.
 */
ChatMessageSchema.pre('bulkWrite', function rejectBulkWrite(next) {
  next(
    new Error(
      'ChatMessage.bulkWrite() is disabled; use dedicated operations'
    )
  );
});

/*
 * Hard deletion is disabled.
 */
ChatMessageSchema.pre('deleteOne', function rejectDeleteOne(next) {
  next(
    new Error(
      'ChatMessage hard deletion is disabled; use softDelete()'
    )
  );
});

ChatMessageSchema.pre(
  'deleteOne',
  {
    document: true,
    query: false,
  },
  function rejectDocumentDelete(next) {
    next(
      new Error(
        'ChatMessage hard deletion is disabled; use softDelete()'
      )
    );
  }
);

ChatMessageSchema.pre('deleteMany', function rejectDeleteMany(next) {
  next(
    new Error(
      'ChatMessage hard deletion is disabled; use controlled retention workflow'
    )
  );
});

ChatMessageSchema.pre(
  'findOneAndDelete',
  function rejectFindOneAndDelete(next) {
    next(
      new Error(
        'ChatMessage hard deletion is disabled; use controlled retention workflow'
      )
    );
  }
);

ChatMessageSchema.pre('replaceOne', function rejectReplaceOne(next) {
  /*
   * This hook is retained explicitly so replacement cannot become an
   * accidental bypass if another middleware changes mutation options.
   */
  const options =
    typeof this.getOptions === 'function'
      ? this.getOptions()
      : this.options || {};

  if (options.chatMessageInternal !== true) {
    return next(
      new Error(
        'ChatMessage replacement is disabled'
      )
    );
  }

  return next();
});

ChatMessageSchema.pre(
  'findOneAndReplace',
  function rejectFindOneAndReplace(next) {
    const options =
      typeof this.getOptions === 'function'
        ? this.getOptions()
        : this.options || {};

    if (options.chatMessageInternal !== true) {
      return next(
        new Error(
          'ChatMessage replacement is disabled'
        )
      );
    }

    return next();
  }
);

/*
 * --------------------------------------------------------------------------
 * VIRTUALS
 * --------------------------------------------------------------------------
 */

ChatMessageSchema.virtual('readCount').get(function readCount() {
  return Array.isArray(this.readBy) ? this.readBy.length : 0;
});

ChatMessageSchema.virtual('reactionCount').get(function reactionCount() {
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

ChatMessageSchema.virtual('isVisible').get(function isVisible() {
  return isActiveMessage(this);
});

/*
 * --------------------------------------------------------------------------
 * INSTANCE METHODS
 * --------------------------------------------------------------------------
 */

ChatMessageSchema.methods.editContent = async function editContent(
  newContent,
  editorId,
  options = {}
) {
  if (!isActiveMessage(this)) {
    throw new Error(
      'Deleted or hidden messages cannot be edited'
    );
  }

  assertObjectId(editorId, 'editorId');

  const isSender =
    String(editorId) === String(this.sender);

  if (!isSender && options.allowModeratorEdit !== true) {
    throw new Error(
      'Only the message sender may edit this message'
    );
  }

  const sanitized = sanitizePlainText(newContent);

  if (sanitized.length > MAX_CONTENT_LENGTH) {
    throw new Error(
      `Edited message cannot exceed ${MAX_CONTENT_LENGTH} characters`
    );
  }

  if (!sanitized && !hasAttachments(this)) {
    throw new Error(
      'Edited message cannot be empty'
    );
  }

  this.content = sanitized;

  if (!this.metadata) {
    this.metadata = {};
  }

  this.metadata.edited = true;
  this.metadata.editedAt = new Date();

  return this.save({
    session: options.session,
  });
};

ChatMessageSchema.methods.softDelete = async function softDelete(
  moderatorId,
  reason = 'Message deleted',
  options = {}
) {
  assertObjectId(moderatorId, 'moderatorId');

  if (this.status === 'DELETED') {
    return this;
  }

  if (
    this.moderationNotes.length >=
    MAX_MODERATION_NOTES
  ) {
    throw new Error(
      `A message cannot contain more than ` +
        `${MAX_MODERATION_NOTES} moderation notes`
    );
  }

  const now = new Date();

  this.status = 'DELETED';
  this.isDeleted = true;
  this.deletedAt = now;
  this.deletedBy = moderatorId;
  this.moderated = true;

  this.moderationNotes.push({
    moderator: moderatorId,
    action: 'delete',
    reason: normalizeReason(reason),
    createdAt: now,
  });

  return this.save({
    session: options.session,
  });
};

ChatMessageSchema.methods.hide = async function hide(
  moderatorId,
  reason = 'Message hidden',
  options = {}
) {
  assertObjectId(moderatorId, 'moderatorId');

  if (this.status === 'DELETED') {
    throw new Error(
      'Deleted messages cannot be hidden again'
    );
  }

  if (this.status === 'HIDDEN') {
    return this;
  }

  if (
    this.moderationNotes.length >=
    MAX_MODERATION_NOTES
  ) {
    throw new Error(
      `A message cannot contain more than ` +
        `${MAX_MODERATION_NOTES} moderation notes`
    );
  }

  const now = new Date();

  this.status = 'HIDDEN';
  this.isDeleted = true;
  this.deletedAt = now;
  this.deletedBy = moderatorId;
  this.moderated = true;

  this.moderationNotes.push({
    moderator: moderatorId,
    action: 'hide',
    reason: normalizeReason(reason),
    createdAt: now,
  });

  return this.save({
    session: options.session,
  });
};

ChatMessageSchema.methods.restore = async function restore(
  moderatorId,
  reason = 'Message restored',
  options = {}
) {
  assertObjectId(moderatorId, 'moderatorId');

  if (this.status === 'DELETED') {
    throw new Error(
      'A deleted message requires controlled administrative review before restoration'
    );
  }

  if (this.status !== 'HIDDEN') {
    return this;
  }

  if (
    this.moderationNotes.length >=
    MAX_MODERATION_NOTES
  ) {
    throw new Error(
      `A message cannot contain more than ` +
        `${MAX_MODERATION_NOTES} moderation notes`
    );
  }

  this.status = 'ACTIVE';
  this.isDeleted = false;
  this.deletedAt = null;
  this.deletedBy = null;
  this.moderated = true;

  this.moderationNotes.push({
    moderator: moderatorId,
    action: 'restore',
    reason: normalizeReason(reason),
    createdAt: new Date(),
  });

  return this.save({
    session: options.session,
  });
};

ChatMessageSchema.methods.addModerationNote =
  async function addModerationNote(
    moderatorId,
    action = 'note',
    reason = '',
    options = {}
  ) {
    assertObjectId(moderatorId, 'moderatorId');

    const normalizedAction = String(action)
      .trim()
      .toLowerCase();

    if (!MODERATION_ACTIONS.includes(normalizedAction)) {
      throw new Error(
        `Unsupported moderation action: ${action}`
      );
    }

    if (
      this.moderationNotes.length >=
      MAX_MODERATION_NOTES
    ) {
      throw new Error(
        `A message cannot contain more than ` +
          `${MAX_MODERATION_NOTES} moderation notes`
      );
    }

    const now = new Date();

    this.moderated = true;

    if (normalizedAction === 'hide') {
      this.status = 'HIDDEN';
      this.isDeleted = true;
      this.deletedAt ??= now;
      this.deletedBy ??= moderatorId;
    }

    if (normalizedAction === 'delete') {
      this.status = 'DELETED';
      this.isDeleted = true;
      this.deletedAt ??= now;
      this.deletedBy ??= moderatorId;
    }

    if (normalizedAction === 'restore') {
      if (this.status === 'DELETED') {
        throw new Error(
          'A deleted message cannot be restored by a normal moderation note'
        );
      }

      if (this.status !== 'HIDDEN') {
        throw new Error(
          'Only hidden messages can be restored'
        );
      }

      this.status = 'ACTIVE';
      this.isDeleted = false;
      this.deletedAt = null;
      this.deletedBy = null;
    }

    this.moderationNotes.push({
      moderator: moderatorId,
      action: normalizedAction,
      reason: normalizeReason(reason),
      createdAt: now,
    });

    return this.save({
      session: options.session,
    });
  };

/*
 * --------------------------------------------------------------------------
 * STATIC OPERATIONS
 * --------------------------------------------------------------------------
 */

ChatMessageSchema.statics.markAsRead =
  async function markAsRead(
    tenantId,
    messageId,
    userId,
    options = {}
  ) {
    assertObjectId(tenantId, 'tenantId');
    assertObjectId(messageId, 'messageId');
    assertObjectId(userId, 'userId');

    const query = this.updateOne(
      {
        _id: messageId,
        tenantId,
        status: 'ACTIVE',
        isDeleted: false,

        /*
         * Idempotency.
         */
        'readBy.user': {
          $ne: userId,
        },

        /*
         * Atomic capacity protection.
         */
        $expr: {
          $lt: [
            {
              $size: {
                $ifNull: ['$readBy', []],
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
        chatMessageInternal: true,
        session: options.session,
      }
    );

    return query.exec();
  };

ChatMessageSchema.statics.markManyAsRead =
  async function markManyAsRead(
    tenantId,
    messageIds,
    userId,
    options = {}
  ) {
    assertObjectId(tenantId, 'tenantId');
    assertObjectId(userId, 'userId');

    if (!Array.isArray(messageIds)) {
      throw new TypeError(
        'messageIds must be an array'
      );
    }

    const ids = [
      ...new Set(
        messageIds.map((id) => String(id))
      ),
    ];

    if (ids.length === 0) {
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
      };
    }

    if (ids.length > MAX_READ_BATCH) {
      throw new RangeError(
        `A read receipt batch cannot contain more than ` +
          `${MAX_READ_BATCH} messages`
      );
    }

    ids.forEach((id) =>
      assertObjectId(id, 'messageId')
    );

    const query = this.updateMany(
      {
        tenantId,
        _id: {
          $in: ids,
        },
        status: 'ACTIVE',
        isDeleted: false,
        'readBy.user': {
          $ne: userId,
        },
        $expr: {
          $lt: [
            {
              $size: {
                $ifNull: ['$readBy', []],
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
        chatMessageInternal: true,
        session: options.session,
      }
    );

    return query.exec();
  };

ChatMessageSchema.statics.addReaction =
  async function addReaction(
    tenantId,
    messageId,
    emoji,
    userId,
    options = {}
  ) {
    assertObjectId(tenantId, 'tenantId');
    assertObjectId(messageId, 'messageId');
    assertObjectId(userId, 'userId');

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

    /*
     * First add the user to an existing reaction bucket.
     *
     * The filter prevents:
     * - hidden/deleted mutations
     * - duplicate users
     * - exceeding the per-emoji limit
     */
    const existingResult =
      await this.updateOne(
        {
          _id: messageId,
          tenantId,
          status: 'ACTIVE',
          isDeleted: false,

          reactions: {
            $elemMatch: {
              emoji: normalizedEmoji,
              users: {
                $ne: userId,
              },
            },
          },

          $expr: {
            $lt: [
              {
                $size: {
                  $ifNull: [
                    {
                      $let: {
                        vars: {
                          matchingReactions: {
                            $filter: {
                              input: {
                                $ifNull: [
                                  '$reactions',
                                  [],
                                ],
                              },
                              as: 'reaction',
                              cond: {
                                $eq: [
                                  '$$reaction.emoji',
                                  normalizedEmoji,
                                ],
                              },
                            },
                          },
                        },
                        in: {
                          $ifNull: [
                            {
                              $arrayElemAt: [
                                '$$matchingReactions.users',
                                0,
                              ],
                            },
                            [],
                          ],
                        },
                      },
                    },
                    [],
                  ],
                },
              },
              MAX_REACTION_USERS_PER_EMOJI,
            ],
          },
        },
        {
          $push: {
            'reactions.$.users': userId,
          },
        },
        {
          runValidators: true,
          chatMessageInternal: true,
          session: options.session,
        }
      );

    if (existingResult.modifiedCount > 0) {
      return existingResult;
    }

    /*
     * Create a new reaction bucket.
     *
     * The reaction-type ceiling is enforced atomically.
     */
    return this.updateOne(
      {
        _id: messageId,
        tenantId,
        status: 'ACTIVE',
        isDeleted: false,

        'reactions.emoji': {
          $ne: normalizedEmoji,
        },

        $expr: {
          $lt: [
            {
              $size: {
                $ifNull: ['$reactions', []],
              },
            },
            MAX_REACTIONS,
          ],
        },
      },
      {
        $push: {
          reactions: {
            emoji: normalizedEmoji,
            users: [userId],
          },
        },
      },
      {
        runValidators: true,
        chatMessageInternal: true,
        session: options.session,
      }
    ).exec();
  };

ChatMessageSchema.statics.removeReaction =
  async function removeReaction(
    tenantId,
    messageId,
    emoji,
    userId,
    options = {}
  ) {
    assertObjectId(tenantId, 'tenantId');
    assertObjectId(messageId, 'messageId');
    assertObjectId(userId, 'userId');

    const normalizedEmoji =
      normalizeEmoji(emoji);

    if (!normalizedEmoji) {
      throw new Error(
        'Reaction emoji is required'
      );
    }

    /*
     * Remove the user from the bucket.
     */
    await this.updateOne(
      {
        _id: messageId,
        tenantId,
        status: 'ACTIVE',
        isDeleted: false,
        reactions: {
          $elemMatch: {
            emoji: normalizedEmoji,
            users: userId,
          },
        },
      },
      {
        $pull: {
          'reactions.$.users': userId,
        },
      },
      {
        runValidators: true,
        chatMessageInternal: true,
        session: options.session,
      }
    ).exec();

    /*
     * Remove the reaction type when no users remain.
     */
    return this.updateOne(
      {
        _id: messageId,
        tenantId,
        status: 'ACTIVE',
        isDeleted: false,
      },
      {
        $pull: {
          reactions: {
            emoji: normalizedEmoji,
            users: {
              $size: 0,
            },
          },
        },
      },
      {
        runValidators: true,
        chatMessageInternal: true,
        session: options.session,
      }
    ).exec();
  };

ChatMessageSchema.statics.findConversationMessages =
  function findConversationMessages(
    tenantId,
    conversationId,
    options = {}
  ) {
    assertObjectId(tenantId, 'tenantId');
    assertObjectId(conversationId, 'conversationId');

    const {
      before = null,
      beforeId = null,
      limit = 50,
      includeDeleted = false,
      session = undefined,
    } = options;

    const safeLimit = Math.min(
      Math.max(Number(limit) || 50, 1),
      100
    );

    const filter = {
      tenantId,
      conversation: conversationId,
    };

    if (!includeDeleted) {
      filter.status = 'ACTIVE';
      filter.isDeleted = false;
    }

    /*
     * Cursor pagination using:
     *
     *   createdAt DESC
     *   _id DESC
     *
     * beforeId makes same-timestamp records deterministic.
     */
    if (before !== null && before !== undefined) {
      const beforeDate =
        before instanceof Date
          ? before
          : new Date(before);

      if (Number.isNaN(beforeDate.getTime())) {
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

ChatMessageSchema.statics.findTenantMessage =
  function findTenantMessage(
    tenantId,
    messageId,
    options = {}
  ) {
    assertObjectId(tenantId, 'tenantId');
    assertObjectId(messageId, 'messageId');

    const filter = {
      _id: messageId,
      tenantId,
    };

    if (options.includeDeleted !== true) {
      filter.status = 'ACTIVE';
      filter.isDeleted = false;
    }

    const query = this.findOne(filter);

    if (options.session) {
      query.session(options.session);
    }

    return query.exec();
  };

ChatMessageSchema.statics.countUnreadForUser =
  function countUnreadForUser(
    tenantId,
    conversationId,
    userId,
    options = {}
  ) {
    assertObjectId(tenantId, 'tenantId');
    assertObjectId(
      conversationId,
      'conversationId'
    );
    assertObjectId(userId, 'userId');

    const query = this.countDocuments({
      tenantId,
      conversation: conversationId,
      status: 'ACTIVE',
      isDeleted: false,
      'readBy.user': {
        $ne: userId,
      },
    });

    if (options.session) {
      query.session(options.session);
    }

    return query.exec();
  };

/*
 * --------------------------------------------------------------------------
 * MODEL
 * --------------------------------------------------------------------------
 */

const ChatMessage =
  mongoose.models.ChatMessage ||
  mongoose.model(
    'ChatMessage',
    ChatMessageSchema
  );

export {
  AttachmentSchema,
  ReadReceiptSchema,
  ModerationNoteSchema,
  ReactionSchema,
  MessageMetadataSchema,
  ChatMessageSchema,
};

export default ChatMessage;