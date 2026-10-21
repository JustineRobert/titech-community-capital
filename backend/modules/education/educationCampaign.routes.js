import express from 'express';
import { requirePermission } from '../../middleware/platformPermissions.js';
import { requireCapabilityFlag } from '../../middleware/capabilityFeatureFlag.js';
import { closeCampaign, createCampaign, listCampaigns, pauseCampaign, publishCampaign, reviewCampaign, submitCampaign, updateCampaign } from './educationCampaign.controller.js';

const router = express.Router();
const enabled = requireCapabilityFlag('TITECH_EDUCATION_CAMPAIGNS_ENABLED');

router.get('/', enabled, requirePermission('education:campaign:read'), listCampaigns);
router.post('/', enabled, requirePermission('education:campaign:create'), createCampaign);
router.patch('/:campaignId', enabled, requirePermission('education:campaign:create'), updateCampaign);
router.post('/:campaignId/submit', enabled, requirePermission('education:campaign:submit'), submitCampaign);
router.post('/:campaignId/review', enabled, requirePermission('education:campaign:review'), reviewCampaign);
router.post('/:campaignId/publish', enabled, requirePermission('education:campaign:publish'), publishCampaign);
router.post('/:campaignId/pause', enabled, requirePermission('education:campaign:manage'), pauseCampaign);
router.post('/:campaignId/close', enabled, requirePermission('education:campaign:manage'), closeCampaign);

export default router;
