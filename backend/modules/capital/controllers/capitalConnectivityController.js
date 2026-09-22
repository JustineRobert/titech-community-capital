/**
 * TITech Community Capital — Capital Connectivity Controller
 * Role: HTTP adapter for governed capital-data sharing.
 * Non-responsibilities: underwriting, lending, payment execution or raw data extraction.
 * Security: every action depends on authenticated tenant context and action RBAC.
 */

import CapitalShareRequest from '../models/CapitalShareRequest.js';
import { approveCapitalDataShare, requestCapitalDataShare, revokeCapitalDataShare } from '../services/capitalConnectivityService.js';

function contextFromRequest(req) {
  return { tenantId: req.tenantContext?.tenantId || req.user?.tenantId || req.tenantId, actorId: req.user?.id || req.user?._id || req.auth?.userId };
}

function respondError(res, req, error) {
  return res.status(Number(error.statusCode) || 500).json({
    success: false,
    error: { code: error.code || 'CAPITAL_CONNECTIVITY_ERROR', message: error.statusCode && error.statusCode < 500 ? error.message : 'Capital connectivity operation failed.' },
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
  });
}

export async function createCapitalShare(req, res) {
  try { return res.status(201).json({ success: true, data: await requestCapitalDataShare(req.body || {}, contextFromRequest(req)) }); }
  catch (error) { return respondError(res, req, error); }
}

export async function approveCapitalShare(req, res) {
  try { return res.status(200).json({ success: true, data: await approveCapitalDataShare(req.params.id, contextFromRequest(req)) }); }
  catch (error) { return respondError(res, req, error); }
}

export async function revokeCapitalShare(req, res) {
  try { return res.status(200).json({ success: true, data: await revokeCapitalDataShare(req.params.id, req.body?.reason, contextFromRequest(req)) }); }
  catch (error) { return respondError(res, req, error); }
}

export async function listCapitalShares(req, res) {
  try {
    const tenantId = req.tenantContext?.tenantId || req.user?.tenantId || req.tenantId;
    if (!tenantId) return res.status(401).json({ success: false, error: { code: 'TENANT_CONTEXT_REQUIRED', message: 'Trusted tenant context is required.' } });
    const docs = await CapitalShareRequest.find({ tenantId: String(tenantId) }).sort({ createdAt: -1 }).limit(Math.min(Number(req.query?.limit) || 100, 250));
    return res.status(200).json({ success: true, data: docs, requestId: req.requestId || null });
  } catch (error) { return respondError(res, req, error); }
}
