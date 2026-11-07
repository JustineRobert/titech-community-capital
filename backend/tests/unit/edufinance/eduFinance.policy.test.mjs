import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertEduFinanceApplicationTransition,
  canTransitionEduFinanceApplication,
  initialEduFinanceReadiness,
  normalizeEduFinanceAmount,
  validateEduFinanceApplication,
} from '../../../modules/edufinance/eduFinance.policy.js';

const validApplication = Object.freeze({
  applicationType: 'TUITION_FEES',
  currency: 'UGX',
  guardianRelationship: 'PARENT',
  schoolTenantId: 'school-tenant-01',
  schoolReference: 'school-001',
  studentBeneficiaryReference: 'student-ref-001',
  academicYearReference: '2026',
  academicTermReference: 'TERM-3-2026',
  invoiceReference: 'INV-2026-1001',
  invoiceVersion: 1,
  guardianAuthorityReference: 'guardian-proof-001',
  guardianConsentReference: 'consent-proof-001',
  invoiceAmountMinor: 2_000_000,
  alreadyPaidAmountMinor: 250_000,
  requestedAmountMinor: 1_750_000,
});

test('valid parent application is normalized and capped at the declared invoice outstanding', () => {
  const result = validateEduFinanceApplication(validApplication);
  assert.equal(result.currency, 'UGX');
  assert.equal(result.declaredOutstandingAmountMinor, 1_750_000);
  assert.equal(result.requestedAmountMinor, 1_750_000);
  assert.equal(result.schoolTenantId, 'school-tenant-01');
});

test('student beneficiary cannot be made the borrower', () => {
  assert.throws(
    () => validateEduFinanceApplication({ ...validApplication, studentIsBorrower: true }),
    { code: 'EDUFINANCE_STUDENT_CANNOT_BE_BORROWER', statusCode: 422 },
  );
});

test('unnecessary student identity fields are rejected', () => {
  assert.throws(
    () => validateEduFinanceApplication({ ...validApplication, studentNationalId: 'TEST-ID' }),
    { code: 'EDUFINANCE_STUDENT_DATA_MINIMIZATION', statusCode: 422 },
  );
});

test('requested financing cannot exceed declared outstanding fees', () => {
  assert.throws(
    () => validateEduFinanceApplication({ ...validApplication, requestedAmountMinor: 1_750_001 }),
    { code: 'EDUFINANCE_REQUEST_EXCEEDS_DECLARED_OUTSTANDING', statusCode: 422 },
  );
});

test('declared payments cannot exceed invoice total', () => {
  assert.throws(
    () => validateEduFinanceApplication({ ...validApplication, alreadyPaidAmountMinor: 2_000_001 }),
    { code: 'EDUFINANCE_PAID_EXCEEDS_INVOICE', statusCode: 422 },
  );
});

test('money values reject decimals, unsafe integers and negative amounts', () => {
  for (const value of [12.5, Number.MAX_SAFE_INTEGER + 1, -1, '1.25', '']) {
    assert.throws(() => normalizeEduFinanceAmount(value, 'amount'));
  }
});

test('only configured currency and recognized guardian relationships are accepted', () => {
  assert.throws(
    () => validateEduFinanceApplication({ ...validApplication, currency: 'KES' }),
    { code: 'EDUFINANCE_CURRENCY_NOT_ENABLED' },
  );
  assert.throws(
    () => validateEduFinanceApplication({ ...validApplication, guardianRelationship: 'STUDENT' }),
    { code: 'EDUFINANCE_GUARDIAN_RELATIONSHIP_INVALID' },
  );
});

test('required guardian authority, consent, invoice and academic references are enforced', () => {
  for (const field of ['guardianAuthorityReference', 'guardianConsentReference', 'invoiceReference', 'academicTermReference']) {
    assert.throws(
      () => validateEduFinanceApplication({ ...validApplication, [field]: '  ' }),
      (error) => error.code?.startsWith('EDUFINANCE_') && error.statusCode === 400,
    );
  }
});

test('initial server readiness does not imply verification, credit approval or financial execution', () => {
  assert.deepEqual(initialEduFinanceReadiness(), {
    schoolVerificationStatus: 'PENDING_PARTNER_VERIFICATION',
    invoiceVerificationStatus: 'PENDING_PARTNER_VERIFICATION',
    guardianAuthorityVerificationStatus: 'PENDING_REVIEW',
    lenderDecisionStatus: 'NOT_REQUESTED',
    loanAccountStatus: 'NOT_CREATED',
    disbursementStatus: 'NOT_STARTED',
    repaymentStatus: 'NOT_STARTED',
  });
});

test('application transitions are explicit and terminal states cannot be reopened', () => {
  assert.equal(canTransitionEduFinanceApplication('SUBMITTED', 'NEEDS_MORE_INFORMATION'), true);
  assert.equal(canTransitionEduFinanceApplication('SUBMITTED', 'APPROVED'), false);
  assert.equal(canTransitionEduFinanceApplication('WITHDRAWN', 'SUBMITTED'), false);
  assert.throws(() => assertEduFinanceApplicationTransition('SUBMITTED', 'APPROVED'), { code: 'EDUFINANCE_APPLICATION_TRANSITION_NOT_ALLOWED' });
});
