import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACT_CATEGORIES,
  DEMO_INTERESTS,
  INSTITUTION_TYPES,
  canTransitionInstitutionalLeadStatus,
  fingerprintInstitutionalLeadPayload,
  isValidInstitutionalLeadSubmissionKey,
  validateInstitutionalLeadStatusChange,
  validateInstitutionalLeadSubmission,
} from '../../../utils/institutionalLeadValidation.js';

const validDemo = Object.freeze({
  type: 'DEMO',
  name: '  Amina Example  ',
  email: 'AMINA@example.org',
  organization: 'Example SACCO',
  role: 'Operations Lead',
  organizationType: 'SACCO',
  country: 'Uganda',
  primaryInterest: 'RECONCILIATION_REPORTING',
  monthlyVolume: '1000_10000',
  preferredDate: '2027-02-03',
  timezone: 'Africa/Kampala',
  consentToContact: true,
});

test('valid demo request is normalized and purpose-limited', () => {
  const result = validateInstitutionalLeadSubmission(validDemo);
  assert.equal(result.ok, true);
  assert.equal(result.data.name, 'Amina Example');
  assert.equal(result.data.email, 'amina@example.org');
  assert.equal(result.data.organization, 'Example SACCO');
  assert.equal(result.data.consent.accepted, true);
  assert.equal(result.data.source, 'PUBLIC_WEBSITE');
  assert.equal(result.data.type, 'DEMO');
});

test('demo request rejects missing consent and required institutional context', () => {
  const result = validateInstitutionalLeadSubmission({ ...validDemo, consentToContact: false, organization: '', country: '' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.consentToContact);
  assert.ok(result.errors.organization);
  assert.ok(result.errors.country);
});

test('invalid email, unknown enums and invalid date fail closed', () => {
  const result = validateInstitutionalLeadSubmission({
    ...validDemo,
    email: 'not-an-email',
    organizationType: 'BANK_EVERYWHERE',
    primaryInterest: 'SEND_MONEY_NOW',
    preferredDate: '2027-02-31',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.email);
  assert.ok(result.errors.organizationType);
  assert.ok(result.errors.primaryInterest);
  assert.ok(result.errors.preferredDate);
});

test('contact request requires category, subject, message and consent', () => {
  const result = validateInstitutionalLeadSubmission({
    type: 'CONTACT',
    name: 'Sam Example',
    email: 'sam@example.org',
    category: 'TECHNICAL_INTEGRATION',
    subject: 'Integration question',
    message: 'Please contact me about a file import workflow.',
    consentToContact: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.category, 'TECHNICAL_INTEGRATION');
  assert.equal(result.data.country, '');
});

test('oversized content and malformed request body are rejected', () => {
  assert.equal(validateInstitutionalLeadSubmission(null).ok, false);
  const result = validateInstitutionalLeadSubmission({ ...validDemo, message: 'x'.repeat(2501) });
  assert.equal(result.ok, false);
  assert.ok(result.errors.message);
});

test('status transition input requires optimistic-concurrency precondition', () => {
  assert.equal(validateInstitutionalLeadStatusChange({ status: 'RESOLVED', expectedStatus: 'NEW', note: 'closed' }).ok, true);
  assert.equal(validateInstitutionalLeadStatusChange({ status: 'NEW', expectedStatus: 'NEW' }).ok, false);
  assert.equal(validateInstitutionalLeadStatusChange({ status: 'HACKED', expectedStatus: 'NEW' }).ok, false);
  assert.equal(validateInstitutionalLeadStatusChange({ status: 'RESOLVED' }).ok, false);
});

test('allowlist constants are explicit and non-empty', () => {
  assert.ok(INSTITUTION_TYPES.includes('SACCO'));
  assert.ok(DEMO_INTERESTS.includes('RECONCILIATION_REPORTING'));
  assert.ok(CONTACT_CATEGORIES.includes('PRIVACY_SECURITY'));
});


test('submission fingerprint remains stable across server-generated consent timestamps', () => {
  const first = validateInstitutionalLeadSubmission(validDemo);
  const second = validateInstitutionalLeadSubmission(validDemo);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(fingerprintInstitutionalLeadPayload(first.data), fingerprintInstitutionalLeadPayload(second.data));
  assert.notEqual(
    fingerprintInstitutionalLeadPayload(first.data),
    fingerprintInstitutionalLeadPayload({ ...second.data, message: 'different purpose or content' }),
  );
});

test('submission keys are bounded and status transitions follow the declared workflow', () => {
  assert.equal(isValidInstitutionalLeadSubmissionKey('12345678-1234-1234'), true);
  assert.equal(isValidInstitutionalLeadSubmissionKey('short'), false);
  assert.equal(isValidInstitutionalLeadSubmissionKey('x'.repeat(129)), false);
  assert.equal(canTransitionInstitutionalLeadStatus('NEW', 'TRIAGED'), true);
  assert.equal(canTransitionInstitutionalLeadStatus('RESOLVED', 'TRIAGED'), true);
  assert.equal(canTransitionInstitutionalLeadStatus('RESOLVED', 'ASSIGNED'), false);
  assert.equal(canTransitionInstitutionalLeadStatus('NEW', 'NEW'), false);
});
