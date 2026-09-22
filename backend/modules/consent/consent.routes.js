/**
 * TITech Community Capital — Consent Routes
 * Role: authenticated, tenant-scoped consent API boundary.
 * Non-responsibilities: consent decisions, storage or financial processing.
 */

import express from 'express';
import { requirePermission } from '../../middleware/platformPermissions.js';
import { createConsent, readConsent, readConsents, revokeConsent } from './controllers/consentController.js';

const router = express.Router();

router.get('/', requirePermission('consent:read'), readConsents);
router.post('/', requirePermission('consent:grant'), createConsent);
router.get('/:id', requirePermission('consent:read'), readConsent);
router.post('/:id/withdraw', requirePermission('consent:withdraw'), revokeConsent);

export default router;
