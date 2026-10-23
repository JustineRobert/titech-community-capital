import {
  createAdvanceApplication,
  createAgent,
  getUbuntuFloatCapabilities,
  listAgents,
  listOwnAdvanceApplications,
  listPositionObservations,
  recordManualPositionObservation,
} from '../services/ubuntuFloatService.js';

function requestContext(req) {
  return {
    tenantId: req.tenantContext?.tenantId || req.user?.tenantId || req.tenantId,
    actorId: req.user?.id || req.user?._id || req.auth?.userId,
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
  };
}

function respondError(res, req, error) {
  const statusCode = Number(error?.statusCode) || 500;
  return res.status(statusCode).json({
    success: false,
    error: {
      code: error?.code || 'UBUNTFLOAT_OPERATION_FAILED',
      message: statusCode < 500 ? error.message : 'UbuntuFloat operation failed.',
    },
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
  });
}

function wrap(handler) {
  return async (req, res) => {
    try { return await handler(req, res); }
    catch (error) { return respondError(res, req, error); }
  };
}

export const getCapabilities = wrap(async (req, res) => res.status(200).json({ success: true, data: getUbuntuFloatCapabilities(), requestId: req.requestId || null }));
export const getAgents = wrap(async (req, res) => res.status(200).json({ success: true, data: await listAgents(requestContext(req), { limit: req.query?.limit }), requestId: req.requestId || null }));
export const postAgent = wrap(async (req, res) => res.status(201).json({ success: true, data: await createAgent(req.body || {}, requestContext(req)), requestId: req.requestId || null }));
export const getPositions = wrap(async (req, res) => res.status(200).json({ success: true, data: await listPositionObservations(req.params.agentId, requestContext(req), { limit: req.query?.limit }), requestId: req.requestId || null }));
export const postPosition = wrap(async (req, res) => res.status(201).json({ success: true, data: await recordManualPositionObservation(req.params.agentId, req.body || {}, requestContext(req)), requestId: req.requestId || null }));
export const getMyAdvanceApplications = wrap(async (req, res) => res.status(200).json({ success: true, data: await listOwnAdvanceApplications(requestContext(req), { limit: req.query?.limit }), requestId: req.requestId || null }));
export const postAdvanceApplication = wrap(async (req, res) => res.status(201).json({
  success: true,
  data: await createAdvanceApplication(req.body || {}, requestContext(req), { noticeVersion: process.env.TITECH_UBUNTFLOAT_NOTICE_VERSION || '' }),
  requestId: req.requestId || null,
}));
