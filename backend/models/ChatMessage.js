// models/ChatMessage.js
'use strict';

const mongoose = require('mongoose');
const sanitizeHtml = require('sanitize-html');

const AttachmentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['image', 'file', 'video', 'other'], default: 'other' },
    url: { type: String, required: true },
    filename: { type: String },
    size: { type: Number }, // bytes
    mimeType: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const ChatMessageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    content: {
      type: String,
      required: [true, 'Message content is required'],
      trim: true,
      maxlength: [2000, 'Message cannot exceed 2000 characters'],
    },

    attachments: { type: [AttachmentSchema], default: [] },

    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', default: null, index: true },

    // For small groups this is fine; for large groups consider moving to a separate collection
    readBy: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
        readAt: { type: Date, default: Date.now },
      },
    ],

    // moderation
    moderated: { type: Boolean, default: false, index: true },
    moderationNotes: {
      type: [
        {
          moderator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          action: { type: String, enum: ['flag', 'hide', 'note', 'delete'], default: 'note' },
          reason: { type: String, maxlength: 1024 },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },

    isDeleted: { type: Boolean, default: false, index: true },

    metadata: {
      ipAddress: { type: String },
      userAgent: { type: String },
      edited: { type: Boolean, default: false },
      editedAt: { type: Date },
      //requestId: { type: String, index: true },
      requestId: { type: String, trim: true }
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform(doc, ret) { ret.id = ret._id; delete ret._id; } },
    toObject: { virtuals: true },
  }
);

// Indexes for common access patterns
ChatMessageSchema.index({ conversation: 1, createdAt: -1 });
ChatMessageSchema.index({ conversation: 1, replyTo: 1, createdAt: 1 });
ChatMessageSchema.index({ sender: 1, createdAt: -1 });

ChatMessageSchema.index({ 'metadata.requestId': 1 });

ChatMessageSchema.index({ isDeleted: 1, createdAt: -1 });

// Sanitize content before save
ChatMessageSchema.pre('save', function (next) {
  if (this.isModified('content')) {
    // keep plain text only; if you need HTML, whitelist tags carefully
    this.content = sanitizeHtml(this.content || '', { allowedTags: [], allowedAttributes: {} }).trim();
  }
  next();
});

/**
 * Atomic: mark message read by user (avoids race conditions)
 * Returns { matchedCount, modifiedCount }
 */
ChatMessageSchema.statics.markAsRead = function (messageId, userId) {
  return this.updateOne(
    { _id: messageId, 'readBy.user': { $ne: userId } },
    { $push: { readBy: { user: userId, readAt: new Date() } } }
  ).exec();
};

/**
 * Atomic: add reaction (emoji bucket) and add user to it
 * Creates the emoji bucket if missing, then adds user if not present.
 */
ChatMessageSchema.statics.addReaction = async function (messageId, emoji, userId) {
  // create bucket if missing
  await this.updateOne(
    { _id: messageId, 'reactions.emoji': { $ne: emoji } },
    { $push: { reactions: { emoji, users: [userId] } } }
  ).exec();

  // add user to existing bucket if not present
  return this.updateOne(
    { _id: messageId, 'reactions.emoji': emoji, 'reactions.users': { $ne: userId } },
    { $push: { 'reactions.$.users': userId } }
  ).exec();
};

/**
 * Atomic: remove reaction user from emoji bucket; remove bucket if empty
 */
ChatMessageSchema.statics.removeReaction = async function (messageId, emoji, userId) {
  await this.updateOne(
    { _id: messageId, 'reactions.emoji': emoji },
    { $pull: { 'reactions.$.users': userId } }
  ).exec();

  // remove empty buckets
  return this.updateOne(
    { _id: messageId },
    { $pull: { reactions: { users: { $size: 0 } } } }
  ).exec();
};

/**
 * Soft delete message (admin/moderator)
 */
ChatMessageSchema.methods.softDelete = function (moderatorId, reason) {
  this.isDeleted = true;
  this.moderated = true;
  this.moderationNotes.push({ moderator: moderatorId, action: 'delete', reason, createdAt: new Date() });
  return this.save();
};

/**
 * Convenience: add moderation note and optionally hide
 */
ChatMessageSchema.methods.addModerationNote = function (moderatorId, action = 'note', reason = '') {
  this.moderated = true;
  this.moderationNotes.push({ moderator: moderatorId, action, reason, createdAt: new Date() });
  if (action === 'hide') this.isDeleted = true;
  return this.save();
};

/**
 * Virtual readCount
 */
ChatMessageSchema.virtual('readCount').get(function () {
  return Array.isArray(this.readBy) ? this.readBy.length : 0;
});

/**
 * Recommendation: keep reactions in a compact shape to avoid large arrays.
 * Define reactions as a sparse subdocument only when needed.
 */
ChatMessageSchema.add({
  reactions: [
    {
      emoji: { type: String, trim: true },
      users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    },
  ],
});

// Export model
module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
