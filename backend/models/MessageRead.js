'use strict';

/**
 * ============================================================================
 * MESSAGE READ MODEL
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Stores message delivery and read receipts independently from messages to
 * support high-volume conversations, analytics, compliance investigations,
 * notification processing, and realtime synchronization.
 *
 * Supports:
 *
 * ✅ Read Receipts
 * ✅ Delivery Receipts
 * ✅ Per-User Message Tracking
 * ✅ Conversation Unread Counters
 * ✅ Notification Processing
 * ✅ Read Analytics
 * ✅ User Engagement Metrics
 * ✅ Compliance Investigations
 * ✅ Regulatory Evidence
 * ✅ Export & Reporting
 * ✅ Mobile Synchronization
 * ✅ Multi-Device Read Tracking
 * ✅ Audit & Forensics
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Enterprise Grade Validation
 * ✅ High Performance Indexing
 * ✅ Duplicate Protection
 * ✅ Analytics Ready
 * ✅ Compliance Ready
 * ✅ Notification Ready
 * ✅ Horizontal Scaling Ready
 * ✅ Realtime Ready
 * ✅ Search Optimized
 * ✅ Multi-Tenant Ready
 * ✅ Retention Policy Ready
 *
 * RELATED MODULES
 * ----------------------------------------------------------------------------
 * Message
 * Conversation
 * User
 * Notification
 * MessageAudit
 * ConversationExport
 * AuditLog
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

const MessageReadSchema = new Schema(
  {
    /*
    |--------------------------------------------------------------------------
    | Core References
    |--------------------------------------------------------------------------
    */

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

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Delivery Information
    |--------------------------------------------------------------------------
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
    |--------------------------------------------------------------------------
    | Read Information
    |--------------------------------------------------------------------------
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
    |--------------------------------------------------------------------------
    | Device Tracking
    |--------------------------------------------------------------------------
    */

    deviceId: {
      type: String,
      trim: true,
      maxlength: 255,
    },

    platform: {
      type: String,
      enum: [
        'WEB',
        'ANDROID',
        'IOS',
        'API',
        'SYSTEM',
      ],
      uppercase: true,
      default: 'WEB',
    },

    appVersion: {
      type: String,
      trim: true,
    },

    ipAddress: {
      type: String,
      trim: true,
    },

    userAgent: {
      type: String,
      trim: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Metadata
    |--------------------------------------------------------------------------
    */

    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },

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

MessageReadSchema.index(
  {
    messageId: 1,
    userId: 1,
  },
  {
    unique: true,
    name: 'message_user_unique',
  }
);

MessageReadSchema.index({
  conversationId: 1,
  userId: 1,
});

MessageReadSchema.index({
  userId: 1,
  isRead: 1,
});

MessageReadSchema.index({
  messageId: 1,
  isRead: 1,
});

MessageReadSchema.index({
  tenantId: 1,
  createdAt: -1,
});

MessageReadSchema.index({
  readAt: -1,
});

MessageReadSchema.index({
  deliveredAt: -1,
});

/*
|--------------------------------------------------------------------------
| Virtuals
|--------------------------------------------------------------------------
*/

MessageReadSchema.virtual('id').get(function () {
  return this._id.toString();
});

/*
|--------------------------------------------------------------------------
| Static Methods
|--------------------------------------------------------------------------
*/

MessageReadSchema.statics.markDelivered =
  async function ({
    messageId,
    conversationId,
    userId,
    tenantId = null,
    metadata = {},
    deviceId = null,
    platform = 'WEB',
    ipAddress = null,
    userAgent = null,
  }) {
    return this.findOneAndUpdate(
      {
        messageId,
        userId,
      },
      {
        $set: {
          conversationId,
          tenantId,
          delivered: true,
          deliveredAt: new Date(),
          metadata,
          deviceId,
          platform,
          ipAddress,
          userAgent,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );
  };

MessageReadSchema.statics.markRead =
  async function ({
    messageId,
    conversationId,
    userId,
    tenantId = null,
    metadata = {},
    deviceId = null,
    platform = 'WEB',
    ipAddress = null,
    userAgent = null,
  }) {
    return this.findOneAndUpdate(
      {
        messageId,
        userId,
      },
      {
        $set: {
          conversationId,
          tenantId,
          delivered: true,
          deliveredAt: new Date(),
          isRead: true,
          readAt: new Date(),
          metadata,
          deviceId,
          platform,
          ipAddress,
          userAgent,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );
  };

MessageReadSchema.statics.getUnreadCount =
  function (conversationId, userId) {
    return this.countDocuments({
      conversationId,
      userId,
      isRead: false,
    });
  };

MessageReadSchema.statics.getReadUsers =
  function (messageId) {
    return this.find({
      messageId,
      isRead: true,
    }).populate(
      'userId',
      'firstName lastName email profilePicture'
    );
  };

/*
|--------------------------------------------------------------------------
| Instance Methods
|--------------------------------------------------------------------------
*/

MessageReadSchema.methods.markAsRead =
  async function () {
    this.isRead = true;
    this.readAt = new Date();

    if (!this.delivered) {
      this.delivered = true;
      this.deliveredAt = new Date();
    }

    await this.save();

    return this;
  };

MessageReadSchema.methods.markAsDelivered =
  async function () {
    this.delivered = true;
    this.deliveredAt = new Date();

    await this.save();

    return this;
  };

module.exports = mongoose.model(
  'MessageRead',
  MessageReadSchema
);