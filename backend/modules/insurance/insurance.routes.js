import express from 'express';
import { requirePermission } from '../../middleware/platformPermissions.js';
import { requireCapabilityFlag } from '../../middleware/capabilityFeatureFlag.js';
import {
  activateProduct, createClaim, createEnrolment, createPremium, createProduct,
  getInstitution, listClaims, listEnrolments, listPremiums, listProducts,
  readiness, recordClaimDecision, recordEnrolmentDecision, reviewLicence, submitInstitution,
} from './insurance.controller.js';

const router = express.Router();

router.get('/institution', requirePermission('insurance:institution:read'), getInstitution);
router.post('/institution', requireCapabilityFlag('TITECH_INSURANCE_ONBOARDING_ENABLED'), requirePermission('insurance:institution:submit'), submitInstitution);
router.post('/licence/review', requireCapabilityFlag('TITECH_INSURANCE_ONBOARDING_ENABLED'), requirePermission('insurance:licence:review'), reviewLicence);
router.get('/readiness', requirePermission('insurance:institution:read'), readiness);
router.get('/products', requirePermission('insurance:product:read'), listProducts);
router.post('/products', requireCapabilityFlag('TITECH_INSURANCE_OPERATIONS_ENABLED'), requirePermission('insurance:product:create'), createProduct);
router.post('/products/:productId/activate', requireCapabilityFlag('TITECH_INSURANCE_OPERATIONS_ENABLED'), requirePermission('insurance:product:activate'), activateProduct);
router.get('/enrolments', requirePermission('insurance:enrolment:read'), listEnrolments);
router.post('/enrolments', requireCapabilityFlag('TITECH_INSURANCE_OPERATIONS_ENABLED'), requirePermission('insurance:enrolment:create'), createEnrolment);
router.post('/enrolments/:enrolmentId/decision', requireCapabilityFlag('TITECH_INSURANCE_OPERATIONS_ENABLED'), requirePermission('insurance:enrolment:decision:record'), recordEnrolmentDecision);
router.get('/premiums', requirePermission('insurance:premium:read'), listPremiums);
router.post('/premiums', requireCapabilityFlag('TITECH_INSURANCE_OPERATIONS_ENABLED'), requirePermission('insurance:premium:create'), createPremium);
router.get('/claims', requirePermission('insurance:claims:read'), listClaims);
router.post('/claims', requireCapabilityFlag('TITECH_INSURANCE_OPERATIONS_ENABLED'), requirePermission('insurance:claims:create'), createClaim);
router.post('/claims/:claimId/decision-reference', requireCapabilityFlag('TITECH_INSURANCE_OPERATIONS_ENABLED'), requirePermission('insurance:claims:decision:record'), recordClaimDecision);

export default router;
