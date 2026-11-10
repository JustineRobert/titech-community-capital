import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const service = await readFile(new URL('../../../modules/insurance/insurance.service.js', import.meta.url), 'utf8');
const consentService = await readFile(new URL('../../../modules/consent/services/consentService.js', import.meta.url), 'utf8');
const consentRepository = await readFile(new URL('../../../modules/consent/repositories/consentRepository.js', import.meta.url), 'utf8');

const mutationNames = [
  'submitInstitutionProfile',
  'recordLicenceReview',
  'createInsuranceProduct',
  'activateInsuranceProduct',
  'createInsuranceEnrolment',
  'recordInsuranceEnrolmentDecision',
  'createPremiumObligation',
  'createInsuranceClaim',
  'recordInsurerClaimDecision',
];

test('insurer state changes use MongoDB transactions and bind audit writes to the same session', () => {
  assert.match(service, /const session = await mongoose\.startSession\(\)/);
  assert.match(service, /session\.withTransaction\(/);
  assert.match(service, /await session\.endSession\(\)/);
  assert.match(service, /session,\s*\n\s*\}\);/);

  for (const name of mutationNames) {
    const start = service.indexOf(`export async function ${name}(`);
    assert.notEqual(start, -1, `missing mutation ${name}`);
    const nextExport = service.indexOf('\nexport async function ', start + 1);
    const end = nextExport === -1 ? service.length : nextExport;
    const body = service.slice(start, end);
    assert.match(body, /withAuditTransaction\(async\s*\(session\)\s*=>/s, `${name} must use a transaction`);
    assert.match(body, /audit\(ctx,[\s\S]*?session\)/, `${name} must include its audit write in the transaction`);
  }
});

test('insurance persistence reads and writes carry the transaction session', () => {
  assert.match(service, /profile\.save\(\{ session \}\)/);
  assert.match(service, /product\.save\(\{ session \}\)/);
  assert.match(service, /enrolment\.save\(\{ session \}\)/);
  assert.match(service, /premium\.save\(\{ session \}\)/);
  assert.match(service, /claim\.save\(\{ session \}\)/);
  assert.match(service, /requiredPrivateEvidence\([\s\S]*?session\s*\}\)/);
  assert.doesNotMatch(service, /\.(?:save|create)\(\s*\)/);
});

test('cross-tenant consent is checked in the same session as insurer enrolment', () => {
  assert.match(consentService, /requiredCategories = \[\], session = null/);
  assert.match(consentService, /id: consentId, session/);
  assert.match(consentRepository, /findById\(\{ tenantId, id, session = null \}\)/);
  assert.match(consentRepository, /query\.session\(session\)/);
  assert.match(service, /recipient: ctx\.tenantId,[\s\S]*?requiredCategories:[\s\S]*?session,/);
});
