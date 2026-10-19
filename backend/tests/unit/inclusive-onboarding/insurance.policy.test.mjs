import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionLicence,
  canTransitionEnrolment,
  assertEnrolmentTransition,
  assertClaimReviewable,
  assertLicenceOperational,
  isLicenceOperational,
  normalizeMoneyMinorUnits,
  assertLivePremiumOperationsEnabled,
} from '../../../modules/insurance/insurance.policy.js';

test('only an explicit permitted licence transition succeeds', () => {
  assert.equal(canTransitionLicence('PENDING_SUBMISSION', 'PENDING_VERIFICATION'), true);
  assert.equal(canTransitionLicence('REJECTED', 'VERIFIED'), false);
});

test('expired, suspended or unverified licences block operational capability', () => {
  assert.equal(isLicenceOperational({ licenceStatus: 'VERIFIED', licenceExpiresAt: '2027-01-01T00:00:00Z', now: new Date('2026-10-01T00:00:00Z') }), true);
  assert.equal(isLicenceOperational({ licenceStatus: 'VERIFIED', licenceExpiresAt: '2026-01-01T00:00:00Z', now: new Date('2026-10-01T00:00:00Z') }), false);
  assert.throws(() => assertLicenceOperational({ licenceStatus: 'PENDING_VERIFICATION' }), { code: 'INSURANCE_LICENCE_NOT_OPERATIONAL' });
});

test('money uses positive safe integer minor units and a three-character currency', () => {
  assert.deepEqual(normalizeMoneyMinorUnits(12500, 'ugx'), { amountMinor: 12500, currency: 'UGX' });
  assert.throws(() => normalizeMoneyMinorUnits(1.25, 'UGX'), { code: 'INSURANCE_AMOUNT_INVALID' });
  assert.throws(() => normalizeMoneyMinorUnits(Number.MAX_SAFE_INTEGER + 1, 'UGX'), { code: 'INSURANCE_AMOUNT_INVALID' });
  assert.throws(() => normalizeMoneyMinorUnits(100, 'UG'), { code: 'INSURANCE_CURRENCY_INVALID' });
});

test('live premium processing cannot activate without a canonical adapter, even if flags are true', () => {
  assert.throws(() => assertLivePremiumOperationsEnabled({}), { code: 'INSURANCE_LIVE_PREMIUM_PROCESSING_DISABLED', statusCode: 503 });
  assert.throws(() => assertLivePremiumOperationsEnabled({ TITECH_INSURANCE_LIVE_PREMIUM_PROCESSING_ENABLED: 'true', TITECH_INSURANCE_LIVE_FINANCIAL_APPROVED: 'true' }), { code: 'INSURANCE_PAYMENT_ADAPTER_NOT_REGISTERED', statusCode: 503 });
});

test('enrolment and claim decision lifecycles prevent invalid rewinds and repeated final decisions', () => {
  assert.equal(canTransitionEnrolment('SUBMITTED', 'ELIGIBLE'), true);
  assert.equal(canTransitionEnrolment('COVERAGE_ENDED', 'COVERAGE_ACTIVE'), false);
  assert.throws(() => assertEnrolmentTransition('COVERAGE_ENDED', 'COVERAGE_ACTIVE'), { code: 'INSURANCE_ENROLMENT_TRANSITION_NOT_ALLOWED' });
  assert.equal(assertClaimReviewable('SUBMITTED'), undefined);
  assert.throws(() => assertClaimReviewable('CLOSED'), { code: 'INSURANCE_CLAIM_TRANSITION_NOT_ALLOWED' });
});
