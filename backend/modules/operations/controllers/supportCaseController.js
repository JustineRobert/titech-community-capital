/**
 * TITech Community Capital — Operations Case Controller
 * Role: HTTP adapter for support/incident workflows.
 * Non-responsibilities: financial mutation, provider control or root-cause inference.
 * Security: linked financial evidence is referenced, never rewritten here.
 */

import { createSupportCase, listSupportCases, transitionSupportCase } from '../services/supportCaseService.js';

function ctx(req) { return { tenantId: req.tenantContext?.tenantId || req.user?.tenantId || req.tenantId, actorId: req.user?.id || req.user?._id || req.auth?.userId }; }
function error(res, req, err) { return res.status(Number(err.statusCode) || 500).json({ success: false, error: { code: err.code || 'CASE_ERROR', message: err.statusCode && err.statusCode < 500 ? err.message : 'Support case operation failed.' }, requestId: req.requestId || null }); }

export async function createCase(req, res) { try { return res.status(201).json({ success: true, data: await createSupportCase(req.body || {}, ctx(req)) }); } catch (err) { return error(res, req, err); } }
export async function listCases(req, res) { try { return res.status(200).json({ success: true, data: await listSupportCases(req.query || {}, ctx(req)) }); } catch (err) { return error(res, req, err); } }
export async function transitionCase(req, res) { try { return res.status(200).json({ success: true, data: await transitionSupportCase(req.params.id, req.body?.status, req.body?.note, req.body?.evidenceRefs || [], ctx(req)) }); } catch (err) { return error(res, req, err); } }
