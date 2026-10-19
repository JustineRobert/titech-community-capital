import { hasPermission } from '../../middleware/platformPermissions.js';
import * as service from './retirement.service.js';

function context(req) {
  return {
    tenantId: req.tenant?.tenantId || req.tenantId || req.tenantContext?.tenantId || req.user?.tenantId,
    actorId: req.user?.id || req.user?._id || req.auth?.userId,
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
    canAssist: hasPermission(req.user, 'retirement:case:create') || hasPermission(req.user, 'participant:assisted-onboarding:create'),
    canReadAllCases: hasPermission(req.user, 'retirement:case:read'),
    canReadAllContributions: hasPermission(req.user, 'retirement:contribution:read') || hasPermission(req.user, 'retirement:case:read'),
    canReadAllFinancialSupport: hasPermission(req.user, 'retirement:financial-support:read'),
  };
}
function sendError(res, req, error) {
  const status = Number(error?.statusCode) || 500;
  return res.status(status).json({
    success: false,
    error: { code: error?.code || 'RETIREMENT_OPERATION_FAILED', message: status < 500 ? error.message : 'Retirement-support operation is temporarily unavailable.' },
    requestId: req.requestId || null,
    correlationId: req.correlationId || req.requestId || null,
  });
}
function handler(operation, status = 200, args = (req) => [req.body || {}, context(req)]) {
  return async (req, res) => {
    try {
      const result = await service[operation](...args(req));
      return res.status(status).json({ success: true, data: result, requestId: req.requestId || null, correlationId: req.correlationId || req.requestId || null });
    } catch (error) { return sendError(res, req, error); }
  };
}

export const readiness = handler('getRetirementReadiness');

export function capabilities(req, res) {
  const result = {
    canReadCaseQueue: hasPermission(req.user, 'retirement:case:read'),
    canReviewCases: hasPermission(req.user, 'retirement:case:review'),
    canRecordSchemeVerification: hasPermission(req.user, 'retirement:verification:record'),
    canCreateContributions: hasPermission(req.user, 'retirement:contribution:create'),
    canReconcileContributions: hasPermission(req.user, 'retirement:contribution:reconcile'),
    canRecordSchemeCredit: hasPermission(req.user, 'retirement:contribution:record-credit'),
    canReadSupportQueue: hasPermission(req.user, 'retirement:financial-support:read'),
    canRecordProviderOutcome: hasPermission(req.user, 'retirement:financial-support:provider-outcome'),
  };
  return res.status(200).json({ success: true, data: result, requestId: req.requestId || null, correlationId: req.correlationId || req.requestId || null });
}
export const createCase = handler('createRetirementCase', 202);
export const listMyCases = handler('listMyRetirementCases', 200, (req) => [context(req)]);
export const listCases = handler('listRetirementCases', 200, (req) => [context(req)]);
export const getCase = handler('getRetirementCase', 200, (req) => [req.params.caseId, context(req)]);
export const transitionCase = handler('transitionRetirementCase', 200, (req) => [req.params.caseId, req.body || {}, context(req)]);
export const recordSchemeVerification = handler('recordSchemeVerification', 200, (req) => [req.params.caseId, req.body || {}, context(req)]);
export const createContribution = handler('createContributionRecord', 201);
export const listContributions = handler('listRetirementContributions', 200, (req) => [context(req)]);
export const reconcileContribution = handler('reconcileContributionRecord', 200, (req) => [req.params.contributionId, req.body || {}, context(req)]);
export const recordSchemeCredit = handler('recordOfficialSchemeCredit', 200, (req) => [req.params.contributionId, req.body || {}, context(req)]);
export const createFinancialSupport = handler('createFinancialSupportApplication', 201);
export const listMyFinancialSupport = handler('listMyFinancialSupportApplications', 200, (req) => [context(req)]);
export const listFinancialSupport = handler('listFinancialSupportApplications', 200, (req) => [context(req)]);
export const recordProviderOutcome = handler('recordFinancialSupportProviderOutcome', 200, (req) => [req.params.applicationId, req.body || {}, context(req)]);

// A resource can be read by its owner or a specifically authorized case officer.
export async function getCaseOwnerOrStaff(req, res) {
  try {
    const permissions = ['retirement:case:read:own', 'retirement:case:read'];
    if (!permissions.some((permission) => hasPermission(req.user, permission))) {
      return res.status(403).json({ success: false, error: { code: 'PERMISSION_DENIED', message: 'Permission denied.' }, requestId: req.requestId || null });
    }
    const data = await service.getRetirementCase(req.params.caseId, context(req));
    return res.status(200).json({ success: true, data, requestId: req.requestId || null, correlationId: req.correlationId || req.requestId || null });
  } catch (error) { return sendError(res, req, error); }
}
