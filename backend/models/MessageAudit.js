'use strict';

/**
 * ============================================================================
 * MESSAGE AUDIT MODEL
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Provides immutable audit logging and forensic tracking for all conversation
 * and message activities across TITechChat.
 *
 * Supports:
 *
 * ✅ Message Creation Auditing
 * ✅ Message Editing Auditing
 * ✅ Message Deletion Auditing
 * ✅ Conversation Lifecycle Auditing
 * ✅ Announcement Auditing
 * ✅ Export Activity Tracking
 * ✅ Participant Management Tracking
 * ✅ Security Investigations
 * ✅ Fraud Investigations
 * ✅ Regulatory Compliance
 * ✅ Evidence Preservation
 * ✅ User Activity Analytics
 * ✅ Administrative Accountability
 * ✅ Incident Response
 * ✅ BoU & SACCO Compliance Reporting
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Immutable Audit Records
 * ✅ High Performance Indexing
 * ✅ Compliance Ready
 * ✅ Multi-Tenant Ready
 * ✅ Security Event Logging
 * ✅ Search Optimized
 * ✅ Analytics Ready
 * ✅ Export Ready
 * ✅ Long-Term Retention Ready
 * ✅ Event-Sourcing Friendly
 * ✅ Horizontal Scaling Ready
 *
 * RELATED MODULES
 * ----------------------------------------------------------------------------
 * Conversation
 * Message
 * User
 * Notification
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
| Constants
|--------------------------------------------------------------------------
*/

const AUDIT_ACTIONS = [
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
];

/*
|--------------------------------------------------------------------------
| Schema
|--------------------------------------------------------------------------
*/

const MessageAuditSchema = new Schema(
  {
    action: {
      type: String,
      required: true,
      enum: AUDIT_ACTIONS,
      uppercase: true,
      index: true,
    },

    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      index: true,
      default: null,
    },

    messageId: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      index: true,
      default: null,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      default: null,
    },

    actingAs: {
      type: String,
      enum: [
        'MEMBER',
        'ADMIN',
        'SUPPORT',
        'AUDITOR',
        'SYSTEM',
        'BOT',
      ],
      uppercase: true,
      default: 'MEMBER',
    },

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },

    linkedEntityType: {
      type: String,
      enum: [
        'GROUP',
        'LOAN',
        'SAVINGS',
        'TRANSACTION',
        'SUPPORT',
      ],
      uppercase: true,
      default: null,
      index: true,
    },

    linkedEntityId: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    ipAddress: {
      type: String,
      trim: true,
    },

    userAgent: {
      type: String,
      trim: true,
    },

    deviceId: {
      type: String,
      trim: true,
    },

    requestId: {
      type: String,
      trim: true,
      index: true,
    },

    correlationId: {
      type: String,
      trim: true,
      index: true,
    },

    severity: {
      type: String,
      enum: [
        'LOW',
        'MEDIUM',
        'HIGH',
        'CRITICAL',
      ],
      default: 'LOW',
      uppercase: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        'SUCCESS',
        'FAILED',
        'PARTIAL',
      ],
      default: 'SUCCESS',
      uppercase: true,
      index: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },

    before: {
      type: Schema.Types.Mixed,
      default: null,
    },

    after: {
      type: Schema.Types.Mixed,
      default: null,
    },

    tags: [
      {
        type: String,
        trim: true,
        uppercase: true,
      },
    ],

    expiresAt: {
      type: Date,
      default: null,
      index: true,
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

MessageAuditSchema.index({
  action: 1,
  createdAt: -1,
});

MessageAuditSchema.index({
  conversationId: 1,
  createdAt: -1,
});

MessageAuditSchema.index({
  messageId: 1,
  createdAt: -1,
});

MessageAuditSchema.index({
  userId: 1,
  createdAt: -1,
});

MessageAuditSchema.index({
  linkedEntityType: 1,
  linkedEntityId: 1,
});

MessageAuditSchema.index({
  severity: 1,
  status: 1,
});

MessageAuditSchema.index({
  tenantId: 1,
  createdAt: -1,
});

MessageAuditSchema.index({
  requestId: 1,
});

MessageAuditSchema.index({
  correlationId: 1,
});

/*
|--------------------------------------------------------------------------
| Virtuals
|--------------------------------------------------------------------------
*/

MessageAuditSchema.virtual('id').get(function () {
  return this._id.toString();
});

/*
|--------------------------------------------------------------------------
| Static Methods
|--------------------------------------------------------------------------
*/

MessageAuditSchema.statics.log = function ({
  action,
  conversationId = null,
  messageId = null,
  userId = null,
  actingAs = 'MEMBER',
  tenantId = null,
  linkedEntityType = null,
  linkedEntityId = null,
  ipAddress = null,
  userAgent = null,
  requestId = null,
  correlationId = null,
  severity = 'LOW',
  status = 'SUCCESS',
  reason = null,
  metadata = {},
  before = null,
  after = null,
  tags = [],
}) {
  return this.create({
    action,
    conversationId,
    messageId,
    userId,
    actingAs,
    tenantId,
    linkedEntityType,
    linkedEntityId,
    ipAddress,
    userAgent,
    requestId,
    correlationId,
    severity,
    status,
    reason,
    metadata,
    before,
    after,
    tags,
  });
};

/*
|--------------------------------------------------------------------------
| Query Helpers
|--------------------------------------------------------------------------
*/

MessageAuditSchema.query.byConversation =
  function (conversationId) {
    return this.where({
      conversationId,
    });
  };

MessageAuditSchema.query.byMessage =
  function (messageId) {
    return this.where({
      messageId,
    });
  };

MessageAuditSchema.query.byUser =
  function (userId) {
    return this.where({
      userId,
    });
  };

module.exports = mongoose.model(
  'MessageAudit',
  MessageAuditSchema
);