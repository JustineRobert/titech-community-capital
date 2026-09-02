// models/Group.js
const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 100,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['savings', 'investment', 'community', 'welfare'],
      default: 'savings',
      required: true,
    },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    memberRoles: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: ['member', 'treasurer', 'secretary'], default: 'member' },
        joinedAt: { type: Date, default: Date.now },
        invitationStatus: {
          type: String,
          enum: ['pending', 'accepted', 'rejected'],
          default: 'pending',
        },
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    metadata: {
      totalInvited: { type: Number, default: 0 },
      invitationsSent: { type: Number, default: 0 },
      lastInvitationBatch: { type: Date },
      auditLog: [
        {
          action: {
            type: String,
            enum: [
              'created',
              'member_added',
              'member_removed',
              'invitation_sent',
              'invitation_accepted',
            ],
          },
          userId: mongoose.Schema.Types.ObjectId,
          timestamp: { type: Date, default: Date.now },
          details: mongoose.Schema.Types.Mixed,
        },
      ],
    },
  },
  { timestamps: true, versionKey: false }
);

groupSchema.index({ createdBy: 1, createdAt: -1 });
groupSchema.index({ type: 1 });

module.exports = mongoose.model('Group', groupSchema);
