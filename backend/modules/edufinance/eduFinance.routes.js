import express from 'express';
import { requirePermission } from '../../middleware/platformPermissions.js';
import { requireCapabilityFlag } from '../../middleware/capabilityFeatureFlag.js';
import { listMyApplications, submitApplication } from './eduFinance.controller.js';

const router = express.Router();
const enabled = requireCapabilityFlag('TITECH_EDUFINANCE_APPLICATIONS_ENABLED');

router.get('/applications/me', enabled, requirePermission('edufinance:application:read:own'), listMyApplications);
router.post('/applications', enabled, requirePermission('edufinance:application:create:own'), submitApplication);

export default router;
