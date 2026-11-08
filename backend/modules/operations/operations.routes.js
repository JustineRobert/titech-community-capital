/**
 * TITech Community Capital — Operations Routes
 * Role: authenticated tenant-scoped support/incident API boundary.
 * Non-responsibilities: ledger mutation or provider execution.
 */

import express from 'express';
import { requirePermission } from '../../middleware/platformPermissions.js';
import { createCase, getCase, listCases, transitionCase } from './controllers/supportCaseController.js';

const router = express.Router();
router.get('/cases', requirePermission('support:case:read'), listCases);
router.get('/cases/:id', requirePermission('support:case:read'), getCase);
router.post('/cases', requirePermission('support:case:create'), createCase);
router.post('/cases/:id/transition', requirePermission('support:case:transition'), transitionCase);
export default router;
