/**
 * TITech Community Capital — Capital Connectivity Routes
 * Role: authenticated tenant-scoped API for permissioned capital-data sharing.
 * Non-responsibilities: lending, custody and payment settlement.
 */

import express from 'express';
import { requirePermission } from '../../middleware/platformPermissions.js';
import { approveCapitalShare, createCapitalShare, listCapitalShares, revokeCapitalShare } from './controllers/capitalConnectivityController.js';

const router = express.Router();
router.get('/share-requests', requirePermission('capital:share:read'), listCapitalShares);
router.post('/share-requests', requirePermission('capital:share:create'), createCapitalShare);
router.post('/share-requests/:id/approve', requirePermission('capital:share:approve'), approveCapitalShare);
router.post('/share-requests/:id/revoke', requirePermission('capital:share:revoke'), revokeCapitalShare);
export default router;
