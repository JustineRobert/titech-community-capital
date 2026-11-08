/**
 * TITech Community Capital — Operations Case Controller
 * Role: HTTP adapter for tenant-scoped support / incident workflows.
 * Non-responsibilities: financial mutation, provider control or root-cause inference.
 */

import {
  createSupportCase,
  getSupportCase,
  listSupportCases,
  transitionSupportCase,
} from '../services/supportCaseService.js';

function context(req) {
  return {
    tenantId: req.tenantContext?.tenantId || req.user?.tenantId || req.tenantId,
    actorId: req.user?.id || req.user?._id || req.auth?.userId,
    requestId: req.requestId || req.id || req.headers?.['x-request-id'] || null,
    correlationId: req.correlationId || req.headers?.['x-correlation-id'] || null,
  };
}

function sendError(res, req, error) {
  const status = Number(error?.statusCode) || 500;
  return res.status(status).json({
    success: false,
    error: {
      code: error?.code || 'CASE_ERROR',
      message: status < 500 ? error.message : (error.code === 'SUPPORT_CASE_AUDIT_PENDING' ? error.message : 'Support case operation failed.'),
      ...(error.code === 'SUPPORT_CASE_AUDIT_PENDING' ? { committed: true, resourceId: error.resourceId || null } : {}),
    },
    requestId: req.requestId || req.id || null,
    correlationId: req.correlationId || null,
  });
}

export async function createCase(req, res) {
  try {
    const data = await createSupportCase(req.body || {}, context(req));
    return res.status(201).json({ success: true, data, requestId: req.requestId || null, correlationId: req.correlationId || null });
  } catch (error) {
    return sendError(res, req, error);
  }
}

export async function listCases(req, res) {
  try {
    const data = await listSupportCases(req.query || {}, context(req));
    return res.status(200).json({ success: true, data, requestId: req.requestId || null, correlationId: req.correlationId || null });
  } catch (error) {
    return sendError(res, req, error);
  }
}

export async function getCase(req, res) {
  try {
    const data = await getSupportCase(req.params.id, context(req));
    return res.status(200).json({ success: true, data, requestId: req.requestId || null, correlationId: req.correlationId || null });
  } catch (error) {
    return sendError(res, req, error);
  }
}

export async function transitionCase(req, res) {
  try {
    const data = await transitionSupportCase(
      req.params.id,
      req.body?.status,
      req.body?.note,
      req.body?.evidenceRefs || [],
      context(req),
    );
    return res.status(200).json({ success: true, data, requestId: req.requestId || null, correlationId: req.correlationId || null });
  } catch (error) {
    return sendError(res, req, error);
  }
}
