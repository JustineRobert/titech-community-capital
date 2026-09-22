/**
 * TITech Community Capital — Consent Controller
 * Role: HTTP adapter for consent operations.
 * Non-responsibilities: business rules, tenant derivation or persistence.
 * Security: tenant identity comes from trusted request context; errors are sanitized.
 */

import { getConsent, grantConsent, listConsents, withdrawConsent } from '../services/consentService.js';

function actorId(req) {
  return req.user?.id || req.user?._id || req.auth?.userId || null;
}

function contextFromRequest(req) {
  return {
    tenantId: req.tenantContext?.tenantId || req.tenantId || req.user?.tenantId,
    actorId: actorId(req),
  };
}

function sendError(res, req, error) {
  return res.status(Number(error.statusCode) || 500).json({
    success: false,
    error: {
      code: error.code || 'CONSENT_ERROR',
      message: error.statusCode && error.statusCode < 500 ? error.message : 'Consent operation failed.',
    },
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
  });
}

export async function createConsent(req, res) {
  try {
    const result = await grantConsent(req.body || {}, contextFromRequest(req));
    return res.status(201).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) {
    return sendError(res, req, error);
  }
}

export async function revokeConsent(req, res) {
  try {
    const result = await withdrawConsent(req.params.id, contextFromRequest(req));
    return res.status(200).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) {
    return sendError(res, req, error);
  }
}

export async function readConsent(req, res) {
  try {
    const result = await getConsent(req.params.id, contextFromRequest(req));
    return res.status(200).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) {
    return sendError(res, req, error);
  }
}

export async function readConsents(req, res) {
  try {
    const result = await listConsents(req.query || {}, contextFromRequest(req));
    return res.status(200).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) {
    return sendError(res, req, error);
  }
}
