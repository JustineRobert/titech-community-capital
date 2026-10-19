import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY_CREDENTIAL_TYPES,
  normalizeCredentialType,
  canTransitionKycStatus,
  assertKycTransition,
  decideServiceCapability,
} from '../../../modules/identity-onboarding/identity.policy.js';

test('approved identity routes include refugee and asylum-seeker credentials without removing national ID', () => {
  assert.ok(IDENTITY_CREDENTIAL_TYPES.includes('NATIONAL_ID'));
  assert.ok(IDENTITY_CREDENTIAL_TYPES.includes('REFUGEE_ID'));
  assert.ok(IDENTITY_CREDENTIAL_TYPES.includes('ASYLUM_SEEKER_CERTIFICATE'));
  assert.equal(normalizeCredentialType('refugee_id'), 'REFUGEE_ID');
});

test('unknown credential types fail closed', () => {
  assert.throws(() => normalizeCredentialType('UNAPPROVED_ID'), { code: 'IDENTITY_CREDENTIAL_TYPE_UNSUPPORTED' });
});

test('KYC transitions are explicit and cannot jump from rejected directly to verified', () => {
  assert.equal(canTransitionKycStatus('PENDING', 'UNDER_REVIEW'), true);
  assert.equal(canTransitionKycStatus('REJECTED', 'VERIFIED'), false);
  assert.throws(() => assertKycTransition('REJECTED', 'VERIFIED'), { code: 'KYC_TRANSITION_NOT_ALLOWED' });
  assert.equal(canTransitionKycStatus('REJECTED', 'APPEALED'), true);
});

test('identity verification and capability access are distinct', () => {
  assert.equal(decideServiceCapability({ kycStatus: 'PENDING', capability: 'COMMUNITY_PRE_REGISTRATION' }).allowed, true);
  assert.equal(decideServiceCapability({ kycStatus: 'PENDING', capability: 'INSURANCE_ENROLMENT' }).allowed, false);
  assert.equal(decideServiceCapability({ kycStatus: 'VERIFIED', capability: 'INSURANCE_ENROLMENT' }).allowed, true);
  assert.equal(decideServiceCapability({ kycStatus: 'VERIFIED', capability: 'UNDEFINED_ACTION' }).allowed, false);
});
