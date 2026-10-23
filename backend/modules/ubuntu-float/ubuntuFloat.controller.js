import {
  createUbuntuFloatAgent,
  listUbuntuFloatAgents,
  listUbuntuFloatPositionObservations,
  recordUbuntuFloatManualAttestation,
  reviewUbuntuFloatAgent,
} from './ubuntuFloat.service.js';

function context(req) {
  return {
    tenantId: req.tenant?.tenantId || req.tenantId || req.tenantContext?.tenantId || req.user?.tenantId,
    actorId: req.user?.id || req.user?._id || req.auth?.userId,
    requestId: req.requestId,
    correlationId: req.correlationId,
  };
}
function fail(res, req, error) {
  const status = Number(error?.statusCode) || 500;
  return res.status(status).json({
    success: false,
    error: {
      code: error?.code || 'UBUNTFLOAT_OPERATION_UNAVAILABLE',
      message: status < 500 ? error.message : 'UbuntuFloat operation is temporarily unavailable.',
    },
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
  });
}

export async function listAgents(req, res) {
  try { return res.json({ success: true, data: await listUbuntuFloatAgents(context(req), req.query || {}) }); }
  catch (error) { return fail(res, req, error); }
}
export async function createAgent(req, res) {
  try { return res.status(202).json({ success: true, data: await createUbuntuFloatAgent(req.body || {}, context(req)) }); }
  catch (error) { return fail(res, req, error); }
}
export async function reviewAgent(req, res) {
  try { return res.json({ success: true, data: await reviewUbuntuFloatAgent(req.params.agentId, req.body || {}, context(req)) }); }
  catch (error) { return fail(res, req, error); }
}
export async function listPositionObservations(req, res) {
  try { return res.json({ success: true, data: await listUbuntuFloatPositionObservations(context(req), req.query || {}) }); }
  catch (error) { return fail(res, req, error); }
}
export async function createPositionAttestation(req, res) {
  try { return res.status(202).json({ success: true, data: await recordUbuntuFloatManualAttestation(req.body || {}, context(req)) }); }
  catch (error) { return fail(res, req, error); }
}
