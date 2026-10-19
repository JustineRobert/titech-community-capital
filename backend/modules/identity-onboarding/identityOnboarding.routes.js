import express from 'express';
import { requirePermission } from '../../middleware/platformPermissions.js';
import { requireCapabilityFlag } from '../../middleware/capabilityFeatureFlag.js';
import { grantInsuranceConsent, readInsuranceConsentRecipient, readMyCapability, readMyInsuranceConsent, readMyStatus, reviewCredential, submitAppeal, submitCredential, withdrawInsuranceConsent } from './identityOnboarding.controller.js';

const router = express.Router();

router.get('/me', readMyStatus);
router.get('/me/capability', readMyCapability);
router.get('/insurance-recipients/:recipientTenantId', requirePermission('participant:identity:read'), readInsuranceConsentRecipient);
router.get('/insurance-consent', requirePermission('participant:identity:read'), readMyInsuranceConsent);
router.post('/insurance-consent', requireCapabilityFlag('TITECH_REFUGEE_ONBOARDING_ENABLED'), requirePermission('participant:insurance-consent:grant'), grantInsuranceConsent);
router.post('/insurance-consent/:consentId/withdraw', requireCapabilityFlag('TITECH_REFUGEE_ONBOARDING_ENABLED'), requirePermission('participant:insurance-consent:grant'), withdrawInsuranceConsent);
router.post('/credentials', requireCapabilityFlag('TITECH_REFUGEE_ONBOARDING_ENABLED'), requirePermission('participant:credential:submit'), submitCredential);
router.post('/appeals', requireCapabilityFlag('TITECH_REFUGEE_ONBOARDING_ENABLED'), requirePermission('participant:appeal:submit'), submitAppeal);
router.post('/:userId/review', requireCapabilityFlag('TITECH_REFUGEE_ONBOARDING_ENABLED'), requirePermission('participant:kyc:review'), reviewCredential);

export default router;
