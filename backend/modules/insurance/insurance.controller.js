import * as service from './insurance.service.js';
import { hasPermission } from '../../middleware/platformPermissions.js';

function context(req) {
  return {
    tenantId: req.tenant?.tenantId || req.tenantId || req.tenantContext?.tenantId || req.user?.tenantId,
    actorId: req.user?.id || req.user?._id || req.auth?.userId,
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
  };
}
function sendError(res, req, error) {
  const status = Number(error?.statusCode) || 500;
  return res.status(status).json({
    success: false,
    error: { code: error?.code || 'INSURANCE_OPERATION_FAILED', message: status < 500 ? error.message : 'Insurance operation is temporarily unavailable.' },
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
  });
}
function handler(operation, status = 200, argumentBuilder = (req) => [req.body || {}, context(req)]) {
  return async (req, res) => {
    try {
      const result = await service[operation](...argumentBuilder(req));
      return res.status(status).json({ success: true, data: result, requestId: req.requestId || null, correlationId: req.correlationId || req.requestId || null });
    } catch (error) { return sendError(res, req, error); }
  };
}

export const getInstitution = handler('getInstitutionProfile', 200, (req) => [context(req)]);
export const submitInstitution = handler('submitInstitutionProfile', 202);
export const reviewLicence = handler('recordLicenceReview', 200);
export const createProduct = handler('createInsuranceProduct', 201);
export const activateProduct = handler('activateInsuranceProduct', 200, (req) => [req.params.productId, req.body || {}, context(req)]);
export const listProducts = handler('listInsuranceProducts', 200, (req) => [context(req)]);
export const createEnrolment = handler('createInsuranceEnrolment', 201);
export const recordEnrolmentDecision = handler('recordInsuranceEnrolmentDecision', 200, (req) => [req.params.enrolmentId, req.body || {}, context(req)]);
export const listEnrolments = handler('listInsuranceEnrolments', 200, (req) => [context(req)]);
export const createPremium = handler('createPremiumObligation', 201);
export const listPremiums = handler('listPremiumObligations', 200, (req) => [context(req)]);
export const createClaim = handler('createInsuranceClaim', 201);
export const recordClaimDecision = handler('recordInsurerClaimDecision', 200, (req) => [req.params.claimId, req.body || {}, context(req)]);
export async function listClaims(req, res) {
  try {
    const records = await service.listInsuranceClaims(context(req));
    const canReadEvidenceReferences = hasPermission(req.user, 'insurance:documents:read') || hasPermission(req.user, 'insurance:claims:review');
    const data = records.map((record) => {
      if (canReadEvidenceReferences) return record;
      const { evidenceReferences: _privateEvidenceReferences, ...safe } = record;
      return safe;
    });
    return res.status(200).json({ success: true, data, requestId: req.requestId || null, correlationId: req.correlationId || req.requestId || null });
  } catch (error) { return sendError(res, req, error); }
}
export const readiness = handler('getInsuranceOperationalReadiness', 200, (req) => [context(req)]);
