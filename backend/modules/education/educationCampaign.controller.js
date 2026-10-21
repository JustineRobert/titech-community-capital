import {
  createEducationCampaign,
  getPublicEducationCampaign,
  listEducationCampaigns,
  listPublicEducationCampaigns,
  publishEducationCampaign,
  reviewEducationCampaign,
  submitEducationCampaign,
  transitionEducationCampaign,
  updateEducationCampaign,
} from './educationCampaign.service.js';

function context(req) {
  return {
    tenantId: req.tenant?.tenantId || req.tenantId || req.tenantContext?.tenantId || req.user?.tenantId,
    actorId: req.user?.id || req.user?._id || req.auth?.userId,
    requestId: req.requestId,
    correlationId: req.correlationId,
  };
}

function fail(res, req, error) {
  const status = Number(error?.statusCode) || (error?.name === 'VersionError' ? 409 : error?.name === 'ValidationError' ? 422 : 500);
  return res.status(status).json({
    success: false,
    error: {
      code: error?.code || (status === 500 ? 'EDUCATION_CAMPAIGN_UNAVAILABLE' : 'EDUCATION_CAMPAIGN_ERROR'),
      message: status < 500 ? error.message : 'Education campaign operation is temporarily unavailable.',
    },
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
  });
}

function action(handler, successStatus = 200) {
  return async (req, res) => {
    try {
      const data = await handler(req, context(req));
      return res.status(successStatus).json({ success: true, data, requestId: req.requestId || null, correlationId: req.correlationId || req.requestId || null });
    } catch (error) { return fail(res, req, error); }
  };
}

export const listCampaigns = action((_req, ctx) => listEducationCampaigns(ctx));
export const createCampaign = action((req, ctx) => createEducationCampaign(req.body || {}, ctx), 201);
export const updateCampaign = action((req, ctx) => updateEducationCampaign(req.params.campaignId, req.body || {}, ctx));
export const submitCampaign = action((req, ctx) => submitEducationCampaign(req.params.campaignId, ctx), 202);
export const reviewCampaign = action((req, ctx) => reviewEducationCampaign(req.params.campaignId, req.body || {}, ctx));
export const publishCampaign = action((req, ctx) => publishEducationCampaign(req.params.campaignId, ctx));
export const pauseCampaign = action((req, ctx) => transitionEducationCampaign(req.params.campaignId, 'PAUSED', req.body || {}, ctx));
export const closeCampaign = action((req, ctx) => transitionEducationCampaign(req.params.campaignId, 'CLOSED', req.body || {}, ctx));

export async function listPublicCampaigns(req, res) {
  try {
    const data = await listPublicEducationCampaigns();
    return res.json({ success: true, data, requestId: req.requestId || null, correlationId: req.correlationId || req.requestId || null });
  } catch (error) { return fail(res, req, error); }
}

export async function readPublicCampaign(req, res) {
  try {
    const data = await getPublicEducationCampaign(req.params.publicReference);
    return res.json({ success: true, data, requestId: req.requestId || null, correlationId: req.correlationId || req.requestId || null });
  } catch (error) { return fail(res, req, error); }
}
