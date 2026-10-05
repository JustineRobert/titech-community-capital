'use strict';

import mongoose from 'mongoose';
import Notification from '../models/Notification.js';

function normalizeObjectId(value, fieldName) {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (!mongoose.isValidObjectId(value)) {
    const error = new Error(`${fieldName} is invalid.`);
    error.code = 'NOTIFICATION_CONTEXT_INVALID';
    error.statusCode = 400;
    throw error;
  }

  return new mongoose.Types.ObjectId(String(value));
}

function toReadModel(notification) {
  if (!notification) {
    return null;
  }

  return {
    ...notification,
    _id: String(notification._id),
    notificationId: String(notification.notificationId),
    tenantId: String(notification.tenantId),
    userId: String(notification.userId),
    read: notification.status === 'READ',
    readAt: notification.readAt || null,
  };
}

export async function listForUser({
  tenantId,
  userId,
  page = 1,
  limit = 20,
}) {
  const tenantObjectId = normalizeObjectId(tenantId, 'tenantId');
  const userObjectId = normalizeObjectId(userId, 'userId');

  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(
    100,
    Math.max(1, Number.parseInt(limit, 10) || 20),
  );

  const documents = await Notification.find({
    tenantId: tenantObjectId,
    userId: userObjectId,
  })
    .sort({ createdAt: -1, _id: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit + 1)
    .lean();

  const hasMore = documents.length > safeLimit;
  const notifications = documents
    .slice(0, safeLimit)
    .map(toReadModel);

  const unreadCount = await Notification.countDocuments({
    tenantId: tenantObjectId,
    userId: userObjectId,
    status: { $ne: 'READ' },
  });

  return {
    notifications,
    unreadCount,
    hasMore,
    page: safePage,
    limit: safeLimit,
  };
}

export async function markRead({
  tenantId,
  userId,
  notificationId,
}) {
  const tenantObjectId = normalizeObjectId(tenantId, 'tenantId');
  const userObjectId = normalizeObjectId(userId, 'userId');

  const filter = {
    tenantId: tenantObjectId,
    userId: userObjectId,
    $or: [],
  };

  if (mongoose.isValidObjectId(notificationId)) {
    filter.$or.push({ _id: new mongoose.Types.ObjectId(String(notificationId)) });
  }

  filter.$or.push({ notificationId: String(notificationId) });

  const document = await Notification.findOneAndUpdate(
    filter,
    {
      $set: {
        status: 'READ',
        readAt: new Date(),
      },
    },
    { new: true },
  ).lean();

  if (!document) {
    const error = new Error('Notification not found.');
    error.code = 'NOTIFICATION_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  return toReadModel(document);
}

export async function markAllRead({
  tenantId,
  userId,
}) {
  const tenantObjectId = normalizeObjectId(tenantId, 'tenantId');
  const userObjectId = normalizeObjectId(userId, 'userId');
  const readAt = new Date();

  const result = await Notification.updateMany(
    {
      tenantId: tenantObjectId,
      userId: userObjectId,
      status: { $ne: 'READ' },
    },
    {
      $set: {
        status: 'READ',
        readAt,
      },
    },
  );

  return {
    modifiedCount: result.modifiedCount || 0,
    readAt: readAt.toISOString(),
  };
}

export async function deleteOne({
  tenantId,
  userId,
  notificationId,
}) {
  const tenantObjectId = normalizeObjectId(tenantId, 'tenantId');
  const userObjectId = normalizeObjectId(userId, 'userId');

  const filter = {
    tenantId: tenantObjectId,
    userId: userObjectId,
    $or: [],
  };

  if (mongoose.isValidObjectId(notificationId)) {
    filter.$or.push({ _id: new mongoose.Types.ObjectId(String(notificationId)) });
  }

  filter.$or.push({ notificationId: String(notificationId) });

  const result = await Notification.deleteOne(filter);

  return result.deletedCount === 1;
}

export async function deleteAll({
  tenantId,
  userId,
}) {
  const tenantObjectId = normalizeObjectId(tenantId, 'tenantId');
  const userObjectId = normalizeObjectId(userId, 'userId');

  const result = await Notification.deleteMany({
    tenantId: tenantObjectId,
    userId: userObjectId,
  });

  return {
    deletedCount: result.deletedCount || 0,
  };
}
