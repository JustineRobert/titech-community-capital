import express from 'express';
import { requirePermission } from '../../middleware/platformPermissions.js';
import { requireCapabilityFlag } from '../../middleware/capabilityFeatureFlag.js';
import { readPartner, reviewPartner, submitPartner } from './refugeePartner.controller.js';
const router = express.Router();
router.get('/me', requirePermission('refugee-partner:read'), readPartner);
router.post('/', requireCapabilityFlag('TITECH_REFUGEE_PARTNER_ONBOARDING_ENABLED'), requirePermission('refugee-partner:submit'), submitPartner);
router.post('/review', requireCapabilityFlag('TITECH_REFUGEE_PARTNER_ONBOARDING_ENABLED'), requirePermission('refugee-partner:review'), reviewPartner);
export default router;
