'use strict';

import express from 'express';
import {
  listForUser,
  markRead,
  markAllRead,
  deleteOne,
  deleteAll,
} from '../repositories/notification.repository.js';

const router = express.Router({
  strict: false,
  caseSensitive: false,
});

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function resolveUserId(req) {
  return req.user?.id || req.user?._id || req.auth?.userId || req.auth?.sub || null;
}

function resolveTenantId(req) {
  return (
    req.tenantId ||
    req.tenant?.tenantId ||
    req.tenantContext?.tenantId ||
    req.auth?.tenantId ||
    req.user?.tenantId ||
    null
  );
}

function requireNotificationContext(req, res) {
  const userId = resolveUserId(req);
  const tenantId = resolveTenantId(req);

  if (!userId || !tenantId) {
    res.status(400).json({
      success: false,
      error: {
        code: 'NOTIFICATION_CONTEXT_REQUIRED',
        message: 'Authenticated user and tenant context are required.',
      },
      requestId: req.requestId,
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
    });
    return null;
  }

  return { userId, tenantId };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const context = requireNotificationContext(req, res);
    if (!context) return;

    const result = await listForUser({
      ...context,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.status(200).json({
      success: true,
      ...result,
      requestId: req.requestId,
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
    });
  }),
);

router.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    const context = requireNotificationContext(req, res);
    if (!context) return;

    const result = await markAllRead(context);

    return res.status(200).json({
      success: true,
      ...result,
      requestId: req.requestId,
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
    });
  }),
);

router.patch(
  '/:notificationId/read',
  asyncHandler(async (req, res) => {
    const context = requireNotificationContext(req, res);
    if (!context) return;

    const notification = await markRead({
      ...context,
      notificationId: req.params.notificationId,
    });

    return res.status(200).json({
      success: true,
      notification,
      requestId: req.requestId,
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
    });
  }),
);

router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const context = requireNotificationContext(req, res);
    if (!context) return;

    const result = await deleteAll(context);

    return res.status(200).json({
      success: true,
      ...result,
      requestId: req.requestId,
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
    });
  }),
);

router.delete(
  '/:notificationId',
  asyncHandler(async (req, res) => {
    const context = requireNotificationContext(req, res);
    if (!context) return;

    const deleted = await deleteOne({
      ...context,
      notificationId: req.params.notificationId,
    });

    return res.status(deleted ? 200 : 404).json({
      success: deleted,
      deleted,
      requestId: req.requestId,
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
    });
  }),
);

export default router;
