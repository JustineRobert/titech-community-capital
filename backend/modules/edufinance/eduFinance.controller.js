import { listMyEduFinanceApplications, submitEduFinanceApplication } from './eduFinance.service.js';

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
      code: error?.code || 'EDUFINANCE_ERROR',
      message: status < 500 ? error.message : 'EduFinance application intake is temporarily unavailable.',
    },
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
  });
}

export async function submitApplication(req, res) {
  try {
    const payload = { ...(req.body || {}), idempotencyKey: req.get?.('Idempotency-Key') || req.body?.idempotencyKey };
    const data = await submitEduFinanceApplication(payload, context(req));
    return res.status(202).json({ success: true, data, requestId: req.requestId || null, correlationId: req.correlationId || req.requestId || null });
  } catch (error) {
    return fail(res, req, error);
  }
}

export async function listMyApplications(req, res) {
  try {
    const data = await listMyEduFinanceApplications(context(req));
    return res.json({ success: true, data, requestId: req.requestId || null, correlationId: req.correlationId || req.requestId || null });
  } catch (error) {
    return fail(res, req, error);
  }
}
