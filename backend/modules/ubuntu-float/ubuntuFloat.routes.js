import express from 'express';
import { requirePermission } from '../../middleware/platformPermissions.js';
import { requireCapabilityFlag } from '../../middleware/capabilityFeatureFlag.js';
import {
  createAgent,
  createPositionAttestation,
  getCapabilities,
  listAgents,
  listPositionObservations,
  reviewAgent,
} from './ubuntuFloat.controller.js';

const router = express.Router();
const coreEnabled = requireCapabilityFlag('TITECH_UBUNTFLOAT_CORE_ENABLED');

// Capability discovery is deliberately available when the operational core is
// disabled, so the client can report server truth instead of receiving 404.
router.get('/capabilities', requirePermission('ubuntu-float:agent:read'), getCapabilities);
router.get('/agents', coreEnabled, requirePermission('ubuntu-float:agent:read'), listAgents);
router.post('/agents', coreEnabled, requirePermission('ubuntu-float:agent:create'), createAgent);
router.post('/agents/:agentId/review', coreEnabled, requirePermission('ubuntu-float:agent:review'), reviewAgent);
router.get('/positions', coreEnabled, requirePermission('ubuntu-float:position:read'), listPositionObservations);
router.post('/positions/manual-attestations', coreEnabled, requirePermission('ubuntu-float:position:attest'), createPositionAttestation);

export default router;
