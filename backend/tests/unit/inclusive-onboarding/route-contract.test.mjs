import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('inclusive domain routes mount within the canonical authenticated versioned API', async () => {
  const routes = await read('../../../routes/index.js');
  assert.match(routes, /tenantAuthorization/);
  assert.match(routes, /identityOnboardingRoutes/);
  assert.match(routes, /refugeePartnerRoutes/);
  assert.match(routes, /insuranceRoutes/);
  assert.match(routes, /secureDocumentRoutes/);
  assert.match(routes, /API_PREFIX}\/participant-onboarding/);
  assert.match(routes, /API_PREFIX}\/insurance/);
});

test('new capability writes remain gated by server-side feature flags', async () => {
  const identityRoutes = await read('../../../modules/identity-onboarding/identityOnboarding.routes.js');
  const insuranceRoutes = await read('../../../modules/insurance/insurance.routes.js');
  const documentRoutes = await read('../../../modules/secure-documents/secureDocument.controller.js');
  assert.match(identityRoutes, /TITECH_REFUGEE_ONBOARDING_ENABLED/);
  assert.match(insuranceRoutes, /TITECH_INSURANCE_ONBOARDING_ENABLED/);
  assert.match(insuranceRoutes, /TITECH_INSURANCE_OPERATIONS_ENABLED/);
  assert.match(documentRoutes, /requireCapabilityFlag|capabilityEnabled/);
});

test('insurance enrolment verifies the canonical KYC record instead of trusting a caller-supplied state', async () => {
  const service = await read('../../../modules/insurance/insurance.service.js');
  assert.match(service, /KYC\.findOne/);
  assert.match(service, /status: 'VERIFIED'/);
  assert.match(service, /INSURANCE_VERIFIED_KYC_REQUIRED/);
  assert.match(service, /assertEnrolmentTransition/);
});

test('private evidence download is not granted solely because the actor uploaded claim or licence documents', async () => {
  const controller = await read('../../../modules/secure-documents/secureDocument.controller.js');
  assert.match(controller, /\['IDENTITY_CREDENTIAL', 'CONSENT_EVIDENCE', 'RETIREMENT_SUPPORT_EVIDENCE'\]\.includes\(record\.purpose\)/);
  assert.match(controller, /permittedRead\(req, record\.purpose\)/);
  const insuranceController = await read('../../../modules/insurance/insurance.controller.js');
  assert.match(insuranceController, /canReadEvidenceReferences/);
  assert.match(insuranceController, /insurance:documents:read/);
});

test('insurance data-sharing consent is versioned, explicit, withdrawable and reused by the canonical consent service', async () => {
  const identityRoutes = await read('../../../modules/identity-onboarding/identityOnboarding.routes.js');
  const identityService = await read('../../../modules/identity-onboarding/identityOnboarding.service.js');
  const insuranceService = await read('../../../modules/insurance/insurance.service.js');
  assert.match(identityRoutes, /GET|router\.get\('\/insurance-recipients/);
  assert.match(identityRoutes, /router\.get\('\/insurance-consent/);
  assert.match(identityRoutes, /router\.post\('\/insurance-consent/);
  assert.match(identityRoutes, /router\.post\('\/insurance-consent\/:consentId\/withdraw/);
  assert.match(identityService, /INSURANCE_ENROLMENT_DATA_SHARING_V1/);
  assert.match(identityService, /payload\.affirmed !== true/);
  assert.match(identityService, /grantConsent\(/);
  assert.match(identityService, /withdrawConsent\(/);
  assert.match(identityService, /noticeTextSnapshot/);
  assert.match(insuranceService, /assertActiveConsent\(/);
  assert.match(insuranceService, /INSURANCE_CONSENT_SUBJECT_MISMATCH/);
});

test('private compliance evidence upload permits only the relevant NGO and insurance action permissions', async () => {
  const controller = await read('../../../modules/secure-documents/secureDocument.controller.js');
  assert.match(controller, /OTHER_COMPLIANCE_EVIDENCE: \['refugee-partner:submit'/);
  assert.match(controller, /'insurance:product:activate'/);
  assert.match(controller, /TITECH_REFUGEE_PARTNER_ONBOARDING_ENABLED/);
  assert.match(controller, /TITECH_INSURANCE_OPERATIONS_ENABLED/);
});
