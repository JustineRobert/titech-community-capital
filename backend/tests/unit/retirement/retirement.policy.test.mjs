import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RETIREMENT_CASE_STATES,
  RETIREMENT_CASE_TRANSITIONS,
  RETIREMENT_CASE_TYPES,
  RETIREMENT_SCHEME_TYPES,
  assertProviderOutcome,
  assertRetirementCaseTransition,
  canTransitionRetirementCase,
  compareContributionAmounts,
  normalizeCurrency,
  normalizeEnum,
  normalizeMinorAmount,
} from '../../../modules/retirement/retirement.policy.js';

test('government pension, NSSF and separate employer-sponsored schemes are explicit', () => {
  assert.ok(RETIREMENT_SCHEME_TYPES.includes('UG_GOVERNMENT_PENSION'));
  assert.ok(RETIREMENT_SCHEME_TYPES.includes('NSSF_UGANDA'));
  assert.ok(RETIREMENT_SCHEME_TYPES.includes('EMPLOYER_SPONSORED'));
  assert.ok(RETIREMENT_CASE_TYPES.includes('SURVIVOR_OR_DEPENDANT_SUPPORT'));
});

test('scheme verification cannot be a generic state transition', () => {
  assert.equal(canTransitionRetirementCase('SCHEME_VERIFICATION_PENDING', 'SCHEME_VERIFIED'), true);
  assert.throws(() => assertRetirementCaseTransition('SCHEME_VERIFICATION_PENDING', 'SCHEME_VERIFIED'), { code: 'RETIREMENT_AUTHORITY_EVIDENCE_REQUIRED' });
  assert.doesNotThrow(() => assertRetirementCaseTransition('SCHEME_VERIFICATION_PENDING', 'SCHEME_VERIFIED', { authorityEvidence: true }));
});

test('identity verification requires canonical KYC evidence', () => {
  assert.throws(() => assertRetirementCaseTransition('IDENTITY_PENDING', 'IDENTITY_VERIFIED'), { code: 'RETIREMENT_IDENTITY_EVIDENCE_REQUIRED' });
  assert.doesNotThrow(() => assertRetirementCaseTransition('IDENTITY_PENDING', 'IDENTITY_VERIFIED', { identityEvidence: true }));
});

test('case transitions reject unknown or forbidden state changes', () => {
  assert.equal(RETIREMENT_CASE_STATES.includes('SCHEME_VERIFIED'), true);
  assert.equal(canTransitionRetirementCase('DRAFT', 'SCHEME_VERIFIED'), false);
  assert.equal(canTransitionRetirementCase('COMPLETED', 'SUBMITTED'), false);
  assert.equal(RETIREMENT_CASE_TRANSITIONS.DRAFT.includes('WITHDRAWN'), true);
  assert.throws(() => normalizeEnum('MADE_UP', RETIREMENT_SCHEME_TYPES, 'schemeType'), { code: 'RETIREMENT_VALUE_UNSUPPORTED' });
});

test('financial amounts use safe integer minor units, not floating point', () => {
  assert.equal(normalizeMinorAmount(0), 0);
  assert.equal(normalizeMinorAmount(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  for (const value of [-1, 1.25, Number.MAX_SAFE_INTEGER + 1, '125']) {
    assert.throws(() => normalizeMinorAmount(value), { code: 'RETIREMENT_AMOUNT_INVALID' });
  }
  assert.equal(normalizeCurrency('ugx'), 'UGX');
  assert.throws(() => normalizeCurrency('US dollars'), { code: 'RETIREMENT_CURRENCY_INVALID' });
});

test('contribution comparison matches the two amounts but does not adjudicate scheme credit', () => {
  assert.equal(compareContributionAmounts({ expectedEmployeeAmountMinor: 500, expectedEmployerAmountMinor: 1500, reportedEmployeeAmountMinor: 500, reportedEmployerAmountMinor: 1500 }), 'MATCHED');
  assert.equal(compareContributionAmounts({ expectedEmployeeAmountMinor: 500, expectedEmployerAmountMinor: 1500, reportedEmployeeAmountMinor: 400, reportedEmployerAmountMinor: 1500 }), 'MISMATCH');
});

test('provider outcome requires an attributable source and external reference', () => {
  assert.equal(assertProviderOutcome({ decision: 'PROVIDER_APPROVED', decisionSource: 'Licensed provider portal', externalDecisionReference: 'DEC-123' }), 'PROVIDER_APPROVED');
  assert.throws(() => assertProviderOutcome({ decision: 'PROVIDER_APPROVED' }), { code: 'RETIREMENT_PROVIDER_DECISION_EVIDENCE_REQUIRED' });
  assert.throws(() => assertProviderOutcome({ decision: 'APPROVED', decisionSource: 'Unknown', externalDecisionReference: 'X' }), { code: 'RETIREMENT_VALUE_UNSUPPORTED' });
});
