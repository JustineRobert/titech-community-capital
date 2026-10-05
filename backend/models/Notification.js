'use strict';

/**
 * TITech Community Capital
 * Canonical notification persistence model.
 *
 * This model is intentionally limited to notification persistence concerns.
 * Delivery/orchestration remains owned by the existing notification service.
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const NotificationSchema = new Schema(
  {
    notificationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    type: {
      type: String,
      required: true,
      index: true,
    },

    channel: {
      type: String,
      enum: ['IN_APP', 'EMAIL', 'SMS', 'PUSH', 'WEBHOOK'],
      default: 'IN_APP',
      index: true,
    },

    priority: {
      type: String,
      enum: ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'],
      default: 'NORMAL',
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },

    status: {
      type: String,
      enum: ['PENDING', 'SENT', 'FAILED', 'READ'],
      default: 'PENDING',
      index: true,
    },

    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'notifications',
    timestamps: true,
    versionKey: false,
  },
);

NotificationSchema.index({
  tenantId: 1,
  userId: 1,
  createdAt: -1,
});

NotificationSchema.index({
  tenantId: 1,
  userId: 1,
  status: 1,
  createdAt: -1,
});

const Notification =
  mongoose.models.Notification ||
  mongoose.model('Notification', NotificationSchema);

export default Notification;
export { NotificationSchema };
