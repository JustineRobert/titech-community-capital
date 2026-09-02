'use strict';

/**
 * ============================================================================
 * CONVERSATION MODEL
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Central conversation registry powering all communication workflows across
 * ACFOS. Conversations are tightly coupled to business entities and serve as
 * the communication backbone for loans, savings, support, transactions,
 * governance, and member collaboration.
 *
 * Supports:
 *
 * ✅ Direct Messaging (DM)
 * ✅ Group Discussions
 * ✅ Loan Collaboration Threads
 * ✅ Savings Threads
 * ✅ Transaction Dispute Threads
 * ✅ Support Ticket Conversations
 * ✅ Administrative Announcement Channels
 * ✅ Read & Unread Tracking
 * ✅ Pinned Messages
 * ✅ Conversation Metadata
 * ✅ Soft Delete & Archiving
 * ✅ Compliance & Audit Trails
 * ✅ Multi-Tenant Collaboration
 * ✅ Realtime Chat Integration
 * ✅ Notification Engine Integration
 * ✅ AI Assistant Integration
 * ✅ Regulatory Investigation Support
 * ✅ Communication Evidence Preservation
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Enterprise Grade Validation
 * ✅ High Performance Indexing
 * ✅ Multi-Tenant Ready
 * ✅ Audit & Compliance Ready
 * ✅ Event Sourcing Friendly
 * ✅ Socket.IO Ready
 * ✅ Analytics Ready
 * ✅ Search Ready
 * ✅ Export Ready
 * ✅ Retention Policy Ready
 * ✅ Horizontal Scaling Ready
 *
 * RELATED MODULES
 * ----------------------------------------------------------------------------
 * User
 * Loan
 * Savings
 * Transaction
 * SupportTicket
 * Group
 * Notification
 * Message
 * MessageRead
 * MessageAudit
 * ConversationExport
 * AuditLog
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

const CONVERSATION_TYPES = [
  'DM',
  'GROUP',
  'LOAN',
  'SAVINGS',
  'SUPPORT',
  'TRANSACTION',
  'ANNOUNCEMENT',
  'ADMIN',
  'LOAN-THREAD',
  'TRANSACTION-THREAD',
  'SAVINGS-THREAD',
  'ADMIN-ANNOUNCEMENT',
];

const LINKED_ENTITY_TYPES = [
  'GROUP',
  'LOAN',
  'SAVINGS',
  'TRANSACTION',
  'SUPPORT',
];

const CONVERSATION_STATUSES = [
  'ACTIVE',
  'ARCHIVED',
  'LOCKED',
  'CLOSED',
];

const conversationSchema = new Schema(
  {
    type: {
      type: String,
      enum: CONVERSATION_TYPES,
      default: 'DM',
      uppercase: true,
      trim: true,
      required: true,
      index: true,
    },

    title: {
      type: String,
      trim: true,
      maxlength: 255,
      default: null,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 5000,
      default: null,
    },

    participants: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: 'User',
        },
      ],
      validate: [
        {
          validator(value) {
            return Array.isArray(value) && value.length > 0;
          },
          message:
            'Conversation must contain at least one participant.',
        },
      ],
      index: true,
      required: true,
    },

    admins: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    linkedEntityType: {
      type: String,
      enum: LINKED_ENTITY_TYPES,
      uppercase: true,
      default: null,
      index: true,
    },

    linkedEntityId: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: CONVERSATION_STATUSES,
      default: 'ACTIVE',
      uppercase: true,
      index: true,
    },

    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },

    lastMessageAt: {
      type: Date,
      default: null,
      index: true,
    },

    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    pinnedMessageIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Message',
      },
    ],

    unreadCounts: {
      type: Map,
      of: Number,
      default: {},
    },

    metadata: {
      name: {
        type: String,
        trim: true,
      },

      description: {
        type: String,
        trim: true,
      },

      avatarUrl: {
        type: String,
        trim: true,
      },

      extra: {
        type: Schema.Types.Mixed,
        default: {},
      },
    },

    isAnnouncementChannel: {
      type: Boolean,
      default: false,
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    softDeleted: {
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

    archivedAt: {
      type: Date,
      default: null,
    },

    archivedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    lockedAt: {
      type: Date,
      default: null,
    },

    lockedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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

conversationSchema.index({
  participants: 1,
  type: 1,
});

conversationSchema.index({
  linkedEntityType: 1,
  linkedEntityId: 1,
});

conversationSchema.index({
  status: 1,
  lastActivityAt: -1,
});

conversationSchema.index({
  createdBy: 1,
  createdAt: -1,
});

conversationSchema.index({
  isActive: 1,
  isDeleted: 1,
});

conversationSchema.index({
  lastMessageAt: -1,
});

conversationSchema.index({
  type: 1,
  status: 1,
  lastActivityAt: -1,
});

/*
|--------------------------------------------------------------------------
| Virtuals
|--------------------------------------------------------------------------
*/

conversationSchema.virtual('id').get(function id() {
  return this._id.toString();
});

/*
|--------------------------------------------------------------------------
| Static Methods
|--------------------------------------------------------------------------
*/

conversationSchema.statics.findOrCreateDM =
  async function findOrCreateDM(userA, userB) {
    const existing = await this.findOne({
      type: 'DM',
      participants: {
        $all: [userA, userB],
        $size: 2,
      },
      isDeleted: false,
    });

    if (existing) {
      return existing;
    }

    return this.create({
      type: 'DM',
      participants: [userA, userB],
      createdBy: userA,
    });
  };

conversationSchema.statics.findByLinkedEntity =
  function findByLinkedEntity(type, entityId) {
    return this.findOne({
      linkedEntityType: type,
      linkedEntityId: entityId,
      isDeleted: false,
    });
  };

/*
|--------------------------------------------------------------------------
| Instance Methods
|--------------------------------------------------------------------------
*/

conversationSchema.methods.touch =
  async function touch(lastMessageId = null) {
    this.lastActivityAt = new Date();
    this.lastMessageAt = new Date();

    if (lastMessageId) {
      this.lastMessage = lastMessageId;
    }

    return this.save();
  };

conversationSchema.methods.archive =
  async function archive(userId) {
    this.status = 'ARCHIVED';
    this.archivedAt = new Date();
    this.archivedBy = userId;

    return this.save();
  };

conversationSchema.methods.lock =
  async function lock(userId) {
    this.status = 'LOCKED';
    this.lockedAt = new Date();
    this.lockedBy = userId;

    return this.save();
  };

conversationSchema.methods.softDelete =
  async function softDelete(userId) {
    this.isDeleted = true;
    this.softDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = userId;
    this.isActive = false;

    return this.save();
  };

conversationSchema.methods.incrementUnread =
  async function incrementUnread(userId) {
    const current =
      this.unreadCounts.get(userId.toString()) || 0;

    this.unreadCounts.set(
      userId.toString(),
      current + 1
    );

    return this.save();
  };

conversationSchema.methods.clearUnread =
  async function clearUnread(userId) {
    this.unreadCounts.set(
      userId.toString(),
      0
    );

    return this.save();
  };

/*
|--------------------------------------------------------------------------
| Query Middleware
|--------------------------------------------------------------------------
*/

conversationSchema.pre(/^find/, function preFind(next) {
  if (!this.getQuery().includeDeleted) {
    this.where({
      isDeleted: false,
    });
  }

  next();
});

module.exports = mongoose.model(
  'Conversation',
  conversationSchema
);
