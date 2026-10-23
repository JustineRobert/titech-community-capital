import express from 'express';
import { requirePermission } from '../../middleware/platformPermissions.js';
import { requireCapabilityFlag } from '../../middleware/capabilityFeatureFlag.js';
import {
  createAgent,
  createPositionAttestation,
  listAgents,
  listPositionObservations,
  reviewAgent,
} from './ubuntuFloat.controller.js';

const router = express.Router();
const coreEnabled = requireCapabilityFlag('TITECH_UBUNTFLOAT_CORE_ENABLED');

router.get('/agents', coreEnabled, requirePermission('ubuntu-float:agent:read'), listAgents);
router.post('/agents', coreEnabled, requirePermission('ubuntu-float:agent:create'), createAgent);
router.post('/agents/:agentId/review', coreEnabled, requirePermission('ubuntu-float:agent:review'), reviewAgent);
router.get('/positions', coreEnabled, requirePermission('ubuntu-float:position:read'), listPositionObservations);
router.post('/positions/manual-attestations', coreEnabled, requirePermission('ubuntu-float:position:attest'), createPositionAttestation);

export default router;
