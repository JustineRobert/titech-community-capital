/**
 * Chat Model - ENHANCED
 *
 * Group-based messaging with read receipts, moderation, reactions, threading
 */

const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema(
  {
    // Group context (required)
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      required: [true, 'Group is required'],
      index: true,
    },

    // Sender
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Sender is required'],
      index: true,
    },

    // Message content
    message: {
      type: String,
      required: [true, 'Message cannot be empty'],
      trim: true,
      maxlength: [1000, 'Message cannot exceed 1000 characters'],
    },

    // Message type (text, system, announcement)
    messageType: {
      type: String,
      enum: ['text', 'system', 'announcement', 'warning'],
      default: 'text',
    },

    // Read receipts: array of user IDs who have read the message
    readBy: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Moderation
    moderation: {
      flaggedByAdmins: [
        {
          admin: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
          },
          reason: String,
          flaggedAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      isHidden: {
        type: Boolean,
        default: false,
      },
      hiddenReason: String,
    },

    // Reactions (emoji reactions from other users)
    reactions: [
      {
        emoji: String,
        users: [mongoose.Schema.Types.ObjectId],
      },
    ],

    // Threading support (for sub-conversations)
    parentMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chat',
      default: null,
    },

    // Metadata
    metadata: {
      ipAddress: String,
      userAgent: String,
      edited: {
        type: Boolean,
        default: false,
      },
      editedAt: Date,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        ret.id = doc._id.toString();
        delete ret._id;
      },
    },
    toObject: { virtuals: true },
  }
);

// Indexes for efficient queries
chatSchema.index({ group: 1, createdAt: -1 });
chatSchema.index({ sender: 1, createdAt: -1 });
chatSchema.index({ 'moderation.isHidden': 1, createdAt: -1 });
chatSchema.index({ parentMessage: 1, createdAt: 1 });

/**
 * Mark message as read by user
 */
chatSchema.methods.markAsRead = async function (userId) {
  const isAlreadyRead = this.readBy.some((r) => r.user.equals(userId));

  if (!isAlreadyRead) {
    this.readBy.push({
      user: userId,
      readAt: new Date(),
    });
    await this.save();
  }

  return this;
};

/**
 * Add reaction to message
 */
chatSchema.methods.addReaction = async function (emoji, userId) {
  let reaction = this.reactions.find((r) => r.emoji === emoji);

  if (!reaction) {
    this.reactions.push({
      emoji,
      users: [userId],
    });
  } else {
    if (!reaction.users.includes(userId)) {
      reaction.users.push(userId);
    }
  }

  await this.save();
  return this;
};

/**
 * Remove reaction
 */
chatSchema.methods.removeReaction = async function (emoji, userId) {
  const reaction = this.reactions.find((r) => r.emoji === emoji);

  if (reaction) {
    reaction.users = reaction.users.filter((u) => !u.equals(userId));
    this.reactions = this.reactions.filter((r) => r.users.length > 0);
  }

  await this.save();
  return this;
};

/**
 * Flag message for moderation
 */
chatSchema.methods.flagForModeration = async function (adminId, reason) {
  this.moderation.flaggedByAdmins.push({
    admin: adminId,
    reason,
    flaggedAt: new Date(),
  });

  await this.save();
  return this;
};

/**
 * Hide message (admin only)
 */
chatSchema.methods.hideMessage = async function (adminId, reason) {
  this.moderation.isHidden = true;
  this.moderation.hiddenReason = reason;
  await this.save();
  return this;
};

/**
 * Get read count
 */
chatSchema.virtual('readCount').get(function () {
  return this.readBy.length;
});

module.exports = mongoose.model('Chat', chatSchema);
