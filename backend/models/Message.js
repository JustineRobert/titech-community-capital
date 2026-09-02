'use strict';

/**
 * ============================================================================
 * MESSAGE MODEL
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Stores all messages exchanged within TITechChat conversations.
 *
 * Supports:
 *
 * ✅ Direct Messages
 * ✅ Group Discussions
 * ✅ Loan Communication Threads
 * ✅ Savings Discussions
 * ✅ Transaction Dispute Conversations
 * ✅ Support Ticket Communication
 * ✅ Administrative Announcements
 * ✅ Message Replies & Threading
 * ✅ Attachments & File Sharing
 * ✅ Read Receipts
 * ✅ Delivery Tracking
 * ✅ Message Editing
 * ✅ Soft Deletion
 * ✅ System Generated Messages
 * ✅ Audit & Compliance Metadata
 * ✅ Regulatory Evidence Preservation
 * ✅ AI Assistant Context Generation
 * ✅ Search & Analytics
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Enterprise Grade Validation
 * ✅ High Performance Indexing
 * ✅ Audit Ready
 * ✅ Realtime Ready
 * ✅ Export Ready
 * ✅ Retention Policy Ready
 * ✅ Fraud Investigation Ready
 * ✅ Compliance Ready
 * ✅ Notification Engine Ready
 * ✅ Horizontal Scaling Ready
 * ✅ Search Optimized
 *
 * RELATED MODULES
 * ----------------------------------------------------------------------------
 * Conversation
 * User
 * Notification
 * MessageRead
 * MessageAudit
 * ConversationExport
 * AuditLog
 * SupportTicket
 * Loan
 * Savings
 * Transaction
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

/*
|--------------------------------------------------------------------------
| Attachment Schema
|--------------------------------------------------------------------------
*/

const AttachmentSchema = new Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
    },

    filename: {
      type: String,
      trim: true,
    },

    originalName: {
      type: String,
      trim: true,
    },

    mimeType: {
      type: String,
      trim: true,
      match: [
        /^(image|application|text|audio|video)\//,
        'Invalid attachment mime type.',
      ],
    },

    extension: {
      type: String,
      trim: true,
      lowercase: true,
    },

    size: {
      type: Number,
      min: 0,
      max: 20 * 1024 * 1024, // 20MB
    },

    checksum: {
      type: String,
      trim: true,
    },

    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },

    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  }
);

/*
|--------------------------------------------------------------------------
| Read Receipt Schema
|--------------------------------------------------------------------------
*/

const ReadReceiptSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    readAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  }
);

/*
|--------------------------------------------------------------------------
| Message Schema
|--------------------------------------------------------------------------
*/

const MessageSchema = new Schema(
  {
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
      enum: [
        'ADMIN',
        'MEMBER',
        'SUPPORT',
        'AUDITOR',
        'SYSTEM',
        'BOT',
      ],
      required: true,
      uppercase: true,
      trim: true,
    },

    body: {
      type: String,
      trim: true,
      maxlength: [
        5000,
        'Message cannot exceed 5000 characters.',
      ],
    },

    messageType: {
      type: String,
      enum: [
        'TEXT',
        'FILE',
        'IMAGE',
        'SYSTEM',
        'ANNOUNCEMENT',
        'EVENT',
        'VOICE',
        'VIDEO',
      ],
      default: 'TEXT',
      uppercase: true,
      index: true,
    },

    replyTo: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
      index: true,
    },

    attachments: [AttachmentSchema],

    deliveredTo: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    readBy: [ReadReceiptSchema],

    deliveredCount: {
      type: Number,
      default: 0,
    },

    readCount: {
      type: Number,
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
    },

    systemMetadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },

    auditMetadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },

    moderationMetadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },

    searchText: {
      type: String,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,

    toJSON: {
      virtuals: true,

      transform(doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },

    toObject: {
      virtuals: true,
    },
  }
);

/*
|--------------------------------------------------------------------------
| Indexes
|--------------------------------------------------------------------------
*/

MessageSchema.index({
  conversationId: 1,
  createdAt: -1,
});

MessageSchema.index({
  senderId: 1,
  createdAt: -1,
});

MessageSchema.index({
  messageType: 1,
});

MessageSchema.index({
  isDeleted: 1,
});

MessageSchema.index({
  createdAt: -1,
});

MessageSchema.index({
  conversationId: 1,
  messageType: 1,
  createdAt: -1,
});

MessageSchema.index({
  body: 'text',
});

/*
|--------------------------------------------------------------------------
| Virtuals
|--------------------------------------------------------------------------
*/

MessageSchema.virtual('id').get(function () {
  return this._id.toString();
});

/*
|--------------------------------------------------------------------------
| Static Methods
|--------------------------------------------------------------------------
*/

MessageSchema.statics.findConversationMessages =
  function (conversationId, limit = 50, page = 1) {
    return this.find({
      conversationId,
      isDeleted: false,
    })
      .sort({
        createdAt: -1,
      })
      .skip((page - 1) * limit)
      .limit(limit);
  };

/*
|--------------------------------------------------------------------------
| Instance Methods
|--------------------------------------------------------------------------
*/

MessageSchema.methods.markAsRead =
  async function (userId) {
    const alreadyRead = this.readBy.some(
      r => r.user.equals(userId)
    );

    if (!alreadyRead) {
      this.readBy.push({
        user: userId,
        readAt: new Date(),
      });

      this.readCount =
        this.readBy.length;

      await this.save();
    }

    return this;
  };

MessageSchema.methods.markAsDelivered =
  async function (userId) {
    const exists =
      this.deliveredTo.some(
        id => id.equals(userId)
      );

    if (!exists) {
      this.deliveredTo.push(userId);

      this.deliveredCount =
        this.deliveredTo.length;

      await this.save();
    }

    return this;
  };

MessageSchema.methods.softDelete =
  async function (userId) {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = userId;

    await this.save();

    return this;
  };

MessageSchema.methods.editMessage =
  async function (
    newBody,
    userId
  ) {
    if (
      !newBody ||
      !newBody.trim()
    ) {
      throw new Error(
        'Message body cannot be empty.'
      );
    }

    this.body = newBody.trim();
    this.isEdited = true;
    this.editedAt = new Date();
    this.editedBy = userId;

    await this.save();

    return this;
  };

MessageSchema.methods.addAttachment =
  async function (
    attachment,
    userId
  ) {
    if (!attachment.url) {
      throw new Error(
        'Attachment must contain a URL.'
      );
    }

    this.attachments.push({
      ...attachment,
      uploadedBy: userId,
      uploadedAt: new Date(),
    });

    await this.save();

    return this;
  };

MessageSchema.methods.pin =
  async function () {
    this.isPinned = true;
    await this.save();
    return this;
  };

MessageSchema.methods.unpin =
  async function () {
    this.isPinned = false;
    await this.save();
    return this;
  };

/*
|--------------------------------------------------------------------------
| Middleware
|--------------------------------------------------------------------------
*/

MessageSchema.pre('save', function (next) {
  if (this.body) {
    this.searchText =
      this.body.toLowerCase();
  }

  next();
});

MessageSchema.pre(/^find/, function (next) {
  if (!this.getQuery().includeDeleted) {
    this.where({
      isDeleted: false,
    });
  }

  next();
});

module.exports = mongoose.model(
  'Message',
  MessageSchema
);