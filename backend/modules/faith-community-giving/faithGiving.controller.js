import {
  cancelFaithGivingPledge,
  createFaithGivingCampaign,
  createFaithGivingExpenseRequest,
  createFaithGivingPledge,
  createPublicFaithGivingPledge,
  getPublicFaithGivingCampaign,
  listFaithGivingCampaigns,
  listFaithGivingExpenseRequests,
  listFaithGivingPledges,
  listPublicFaithGivingCampaigns,
  publishFaithGivingCampaign,
  reviewFaithGivingCampaign,
  reviewFaithGivingExpenseRequest,
  submitFaithGivingCampaign,
  transitionFaithGivingCampaign,
  updateFaithGivingCampaign,
} from './faithGiving.service.js';

function context(req) {
  return {
    tenantId: req.tenant?.tenantId || req.tenantId || req.tenantContext?.tenantId || req.user?.tenantId || req.auth?.tenantId,
    actorId: req.user?.id || req.user?._id || req.auth?.userId || req.auth?.sub,
    requestId: req.requestId,
    correlationId: req.correlationId,
  };
}

function fail(res, req, error) {
  const databaseUnavailable = [
    'MongooseServerSelectionError', 'MongoServerSelectionError',
    'MongoNetworkError', 'MongoTopologyClosedError', 'MongoPoolClearedError',
  ].includes(error?.name)
    || ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'].includes(error?.code)
    || /buffering timed out|server selection timed out|topology was destroyed/i.test(String(error?.message || ''));
  const status = Number(error?.statusCode)
    || (databaseUnavailable ? 503 : error?.name === 'VersionError' ? 409 : error?.name === 'ValidationError' ? 422 : 500);
  const unavailable = status >= 500;
  return res.status(status).json({
    success: false,
    error: {
      code: databaseUnavailable ? 'FAITH_GIVING_DEPENDENCY_UNAVAILABLE' : error?.code || (unavailable ? 'FAITH_GIVING_UNAVAILABLE' : 'FAITH_GIVING_ERROR'),
      message: unavailable ? 'Faith & Community Giving is temporarily unavailable. Retry after its data service is restored.' : error.message,
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
    } catch (error) {
      return fail(res, req, error);
    }
  };
}

export const listCampaigns = action((_req, ctx) => listFaithGivingCampaigns(ctx));
export const createCampaign = action((req, ctx) => createFaithGivingCampaign(req.body || {}, ctx), 201);
export const updateCampaign = action((req, ctx) => updateFaithGivingCampaign(req.params.campaignId, req.body || {}, ctx));
export const submitCampaign = action((req, ctx) => submitFaithGivingCampaign(req.params.campaignId, ctx), 202);
export const reviewCampaign = action((req, ctx) => reviewFaithGivingCampaign(req.params.campaignId, req.body || {}, ctx));
export const publishCampaign = action((req, ctx) => publishFaithGivingCampaign(req.params.campaignId, ctx));
export const pauseCampaign = action((req, ctx) => transitionFaithGivingCampaign(req.params.campaignId, 'PAUSED', req.body || {}, ctx));
export const closeCampaign = action((req, ctx) => transitionFaithGivingCampaign(req.params.campaignId, 'CLOSED', req.body || {}, ctx));
export const listPledges = action((req, ctx) => listFaithGivingPledges(req.params.campaignId, ctx));
export const createPledge = action((req, ctx) => createFaithGivingPledge(req.params.campaignId, req.body || {}, req.get('idempotency-key'), ctx), 201);
export const createPublicPledge = action((req, ctx) => createPublicFaithGivingPledge(req.params.publicReference, req.body || {}, req.get('idempotency-key'), ctx), 201);
export const cancelPledge = action((req, ctx) => cancelFaithGivingPledge(req.params.campaignId, req.params.pledgeId, ctx));
export const listExpenseRequests = action((req, ctx) => listFaithGivingExpenseRequests(req.params.campaignId, ctx));
export const createExpenseRequest = action((req, ctx) => createFaithGivingExpenseRequest(req.params.campaignId, req.body || {}, ctx), 201);
export const reviewExpenseRequest = action((req, ctx) => reviewFaithGivingExpenseRequest(req.params.campaignId, req.params.expenseId, req.body || {}, ctx));

export async function listPublicCampaigns(req, res) {
  try {
    const data = await listPublicFaithGivingCampaigns();
    return res.json({ success: true, data, requestId: req.requestId || null, correlationId: req.correlationId || req.requestId || null });
  } catch (error) {
    return fail(res, req, error);
  }
}

export async function readPublicCampaign(req, res) {
  try {
    const data = await getPublicFaithGivingCampaign(req.params.publicReference);
    return res.json({ success: true, data, requestId: req.requestId || null, correlationId: req.correlationId || req.requestId || null });
  } catch (error) {
    return fail(res, req, error);
  }
}
