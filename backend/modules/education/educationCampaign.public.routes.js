import express from 'express';
import { requireCapabilityFlag } from '../../middleware/capabilityFeatureFlag.js';
import { listPublicCampaigns, readPublicCampaign } from './educationCampaign.controller.js';

const router = express.Router();
const enabled = requireCapabilityFlag('TITECH_EDUCATION_CAMPAIGNS_ENABLED');

// Public read-only allowlist. This router deliberately exposes no beneficiary,
// tenant, evidence, audit, contribution, payment or disbursement mutations.
router.get('/', enabled, listPublicCampaigns);
router.get('/:publicReference', enabled, readPublicCampaign);

export default router;
