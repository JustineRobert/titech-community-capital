import express from 'express';
import { requirePermission } from '../../middleware/platformPermissions.js';
import { requireCapabilityFlag } from '../../middleware/capabilityFeatureFlag.js';
import {
  cancelPledge,
  closeCampaign,
  createCampaign,
  createExpenseRequest,
  createPledge,
  createPublicPledge,
  listCampaigns,
  listExpenseRequests,
  listPledges,
  pauseCampaign,
  publishCampaign,
  reviewCampaign,
  reviewExpenseRequest,
  submitCampaign,
  updateCampaign,
} from './faithGiving.controller.js';

const router = express.Router();
const enabled = requireCapabilityFlag('TITECH_FAITH_GIVING_ENABLED');

function requireIdempotencyKey(req, res, next) {
  const key = String(req.get('idempotency-key') || '').trim();
  if (!key || key.length > 128) {
    return res.status(400).json({ success: false, error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'A valid Idempotency-Key header is required.' }, requestId: req.requestId || null });
  }
  return next();
}

// Records a tenant-owned pledge only; it does not collect money or accept goods.
router.post('/public/:publicReference/pledges', enabled, requirePermission('faith-giving:pledge:create'), requireIdempotencyKey, createPublicPledge);

router.get('/', enabled, requirePermission('faith-giving:campaign:read'), listCampaigns);
router.post('/', enabled, requirePermission('faith-giving:campaign:create'), createCampaign);
router.patch('/:campaignId', enabled, requirePermission('faith-giving:campaign:create'), updateCampaign);
router.post('/:campaignId/submit', enabled, requirePermission('faith-giving:campaign:submit'), submitCampaign);
router.post('/:campaignId/review', enabled, requirePermission('faith-giving:campaign:review'), reviewCampaign);
router.post('/:campaignId/publish', enabled, requirePermission('faith-giving:campaign:publish'), publishCampaign);
router.post('/:campaignId/pause', enabled, requirePermission('faith-giving:campaign:manage'), pauseCampaign);
router.post('/:campaignId/close', enabled, requirePermission('faith-giving:campaign:manage'), closeCampaign);

router.get('/:campaignId/pledges', enabled, requirePermission('faith-giving:pledge:read'), listPledges);
router.post('/:campaignId/pledges', enabled, requirePermission('faith-giving:pledge:create'), requireIdempotencyKey, createPledge);
router.post('/:campaignId/pledges/:pledgeId/cancel', enabled, requirePermission('faith-giving:pledge:create'), cancelPledge);

router.get('/:campaignId/expenses', enabled, requirePermission('faith-giving:expense:read'), listExpenseRequests);
router.post('/:campaignId/expenses', enabled, requirePermission('faith-giving:expense:create'), createExpenseRequest);
router.post('/:campaignId/expenses/:expenseId/review', enabled, requirePermission('faith-giving:expense:review'), reviewExpenseRequest);

export default router;
