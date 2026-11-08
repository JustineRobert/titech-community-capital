import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEduFinanceApplicationPayload } from '../eduFinanceFormPolicy.mjs';

const valid = {
  applicationType: 'TUITION_FEES',
  guardianRelationship: 'PARENT',
  schoolTenantId: 'SCHOOL-TENANT-A',
  schoolReference: 'SCH-001',
  studentBeneficiaryReference: 'STUDENT-REF-01',
  academicYearReference: '2026',
  academicTermReference: 'TERM-3',
  invoiceReference: 'INV-2026-001',
  invoiceVersion: '2',
  guardianAuthorityReference: 'GUARDIAN-EVIDENCE-01',
  guardianConsentReference: 'CONSENT-EVIDENCE-01',
  invoiceAmountUgx: '2000000',
  alreadyPaidAmountUgx: '250000',
  requestedAmountUgx: '1750000',
};

test('maps the parent intake form to the canonical UGX API contract', () => {
  const payload = buildEduFinanceApplicationPayload(valid);
  assert.equal(payload.currency, 'UGX');
  assert.equal(payload.schoolTenantId, 'school-tenant-a');
  assert.equal(payload.invoiceAmountMinor, 2_000_000);
  assert.equal(payload.alreadyPaidAmountMinor, 250_000);
  assert.equal(payload.declaredOutstandingAmountMinor, 1_750_000);
  assert.equal(payload.requestedAmountMinor, 1_750_000);
  assert.equal('studentName' in payload, false);
  assert.equal('studentNationalId' in payload, false);
});

test('rejects requests above the declared outstanding invoice amount', () => {
  assert.throws(() => buildEduFinanceApplicationPayload({ ...valid, requestedAmountUgx: '1750001' }), /outstanding invoice amount/);
});

test('rejects fractional or unsafe currency amounts', () => {
  assert.throws(() => buildEduFinanceApplicationPayload({ ...valid, invoiceAmountUgx: '2000000.50' }), /whole UGX amount/);
  assert.throws(() => buildEduFinanceApplicationPayload({ ...valid, requestedAmountUgx: '9007199254740992' }), /whole UGX amount/);
});

test('rejects unsupported applicant relationships and invalid invoice versions', () => {
  assert.throws(() => buildEduFinanceApplicationPayload({ ...valid, guardianRelationship: 'STUDENT' }), /valid parent or guardian/);
  assert.throws(() => buildEduFinanceApplicationPayload({ ...valid, invoiceVersion: '0' }), /positive whole number/);
});

test('does not permit child identity details to be added to the API payload', () => {
  const payload = buildEduFinanceApplicationPayload({ ...valid, studentName: 'not accepted', studentNationalId: 'not accepted' });
  assert.equal(Object.hasOwn(payload, 'studentName'), false);
  assert.equal(Object.hasOwn(payload, 'studentNationalId'), false);
});
