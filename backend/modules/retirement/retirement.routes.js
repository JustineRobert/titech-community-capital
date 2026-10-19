import express from 'express';
import { requireCapabilityFlag } from '../../middleware/capabilityFeatureFlag.js';
import { hasPermission, requirePermission } from '../../middleware/platformPermissions.js';
import {
  capabilities, createCase, createContribution, createFinancialSupport, getCaseOwnerOrStaff,
  listCases, listContributions, listFinancialSupport, listMyCases, listMyFinancialSupport,
  readiness, reconcileContribution, recordProviderOutcome, recordSchemeCredit,
  recordSchemeVerification, transitionCase,
} from './retirement.controller.js';

const router = express.Router();
const enabled = requireCapabilityFlag('TITECH_RETIREMENT_SUPPORT_ENABLED');
function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication required.' }, requestId: req.requestId || null });
    if (!permissions.some((permission) => hasPermission(req.user, permission))) return res.status(403).json({ success: false, error: { code: 'PERMISSION_DENIED', message: 'Permission denied.' }, requestId: req.requestId || null });
    return next();
  };
}

router.get('/readiness', requireAnyPermission('retirement:case:read:own', 'retirement:case:read'), readiness);
router.get('/capabilities', requireAnyPermission('retirement:case:read:own', 'retirement:case:read'), capabilities);
router.get('/me', requirePermission('retirement:case:read:own'), listMyCases);
router.post('/cases', enabled, requireAnyPermission('retirement:case:create:own', 'retirement:case:create'), createCase);
router.get('/cases', requirePermission('retirement:case:read'), listCases);
router.get('/cases/:caseId', getCaseOwnerOrStaff);
router.post('/cases/:caseId/transition', enabled, requirePermission('retirement:case:review'), transitionCase);
router.post('/cases/:caseId/verification', enabled, requirePermission('retirement:verification:record'), recordSchemeVerification);
router.get('/contributions', requireAnyPermission('retirement:contribution:read', 'retirement:case:read:own'), listContributions);
router.post('/contributions', enabled, requirePermission('retirement:contribution:create'), createContribution);
router.post('/contributions/:contributionId/reconcile', enabled, requirePermission('retirement:contribution:reconcile'), reconcileContribution);
router.post('/contributions/:contributionId/scheme-credit', enabled, requirePermission('retirement:contribution:record-credit'), recordSchemeCredit);
router.get('/financial-support/me', requirePermission('retirement:financial-support:read:own'), listMyFinancialSupport);
router.post('/financial-support', enabled, requirePermission('retirement:financial-support:create:own'), createFinancialSupport);
router.get('/financial-support', requirePermission('retirement:financial-support:read'), listFinancialSupport);
router.post('/financial-support/:applicationId/provider-outcome', enabled, requirePermission('retirement:financial-support:provider-outcome'), recordProviderOutcome);

export default router;
