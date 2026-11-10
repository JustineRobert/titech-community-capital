import express from 'express';
import { requireCapabilityFlag } from '../../middleware/capabilityFeatureFlag.js';
import { listPublicCampaigns, readPublicCampaign } from './faithGiving.controller.js';

const router = express.Router();
const enabled = requireCapabilityFlag('TITECH_FAITH_GIVING_ENABLED');

// These handlers emit an allow-listed public DTO only. No payment, provider,
// tenant, donor or private beneficiary data is exposed by this router.
router.get('/', enabled, listPublicCampaigns);
router.get('/:publicReference', enabled, readPublicCampaign);

export default router;
