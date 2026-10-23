import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAgentTransition,
  assertValidAgentParent,
  normalizeAgentCode,
  normalizeAgentRole,
  normalizeAmountMinor,
  normalizeCurrency,
  normalizeFloatProvider,
  normalizeManualFloatAttestation,
} from '../../../modules/ubuntu-float/ubuntuFloat.policy.js';

test('agent roles and codes are normalized and bounded', () => {
  assert.equal(normalizeAgentRole(' agent '), 'AGENT');
  assert.equal(normalizeAgentCode('outlet_001'), 'OUTLET_001');
  assert.throws(() => normalizeAgentRole('LENDER'), { code: 'UBUNTFLOAT_AGENT_ROLE_INVALID' });
  assert.throws(() => normalizeAgentCode('x'), { code: 'UBUNTFLOAT_AGENT_CODE_INVALID' });
});

test('hierarchy rules allow only defined parent-child relationships', () => {
  assert.equal(assertValidAgentParent('HEAD_OFFICE', null), true);
  assert.equal(assertValidAgentParent('SUPER_AGENT', 'HEAD_OFFICE'), true);
  assert.equal(assertValidAgentParent('SUB_AGENT', 'SUPER_AGENT'), true);
  assert.equal(assertValidAgentParent('AGENT', 'SUB_AGENT'), true);
  assert.equal(assertValidAgentParent('OUTLET', 'AGENT'), true);
  assert.throws(() => assertValidAgentParent('OUTLET', 'SUPER_AGENT'), { code: 'UBUNTFLOAT_AGENT_PARENT_INVALID' });
  assert.throws(() => assertValidAgentParent('HEAD_OFFICE', 'AGENT'), { code: 'UBUNTFLOAT_AGENT_PARENT_INVALID' });
});

test('agent lifecycle rejects illegal state jumps', () => {
  assert.equal(assertAgentTransition('PENDING_REVIEW', 'ACTIVE'), true);
  assert.equal(assertAgentTransition('ACTIVE', 'SUSPENDED'), true);
  assert.throws(() => assertAgentTransition('REJECTED', 'ACTIVE'), { code: 'UBUNTFLOAT_AGENT_TRANSITION_NOT_ALLOWED' });
  assert.throws(() => assertAgentTransition('PENDING_REVIEW', 'POSTED'), { code: 'UBUNTFLOAT_AGENT_TRANSITION_NOT_ALLOWED' });
});

test('financial observations accept exact non-negative integers only', () => {
  assert.equal(normalizeAmountMinor(0), 0);
  assert.equal(normalizeAmountMinor('100000'), 100000);
  assert.throws(() => normalizeAmountMinor(1.1), { code: 'UBUNTFLOAT_AMOUNT_INVALID' });
  assert.throws(() => normalizeAmountMinor(-1), { code: 'UBUNTFLOAT_AMOUNT_INVALID' });
  assert.throws(() => normalizeAmountMinor(Number.MAX_SAFE_INTEGER + 1), { code: 'UBUNTFLOAT_AMOUNT_INVALID' });
  assert.equal(normalizeCurrency('ugx'), 'UGX');
  assert.throws(() => normalizeCurrency('UG'), { code: 'UBUNTFLOAT_CURRENCY_INVALID' });
});

test('provider-specific observations validate the provider catalogue', () => {
  assert.equal(normalizeFloatProvider('mtn_momo'), 'MTN_MOMO');
  assert.throws(() => normalizeFloatProvider('ALL_PROVIDERS'), { code: 'UBUNTFLOAT_PROVIDER_UNSUPPORTED' });
});

test('manual observations cannot self-assert provider verification', () => {
  const result = normalizeManualFloatAttestation({
    provider: 'MTN_MOMO', currency: 'UGX', reportedAmountMinor: 250000,
    attestationReference: 'MANUAL-CHECK-001', verificationStatus: 'PROVIDER_CONFIRMED', sourceType: 'PROVIDER_API',
  });
  assert.equal(result.sourceType, 'MANUAL_ATTESTATION');
  assert.equal(result.verificationStatus, 'UNVERIFIED_MANUAL_ATTESTATION');
  assert.equal(result.reportedAmountMinor, 250000);
  assert.throws(() => normalizeManualFloatAttestation({ provider: 'MTN_MOMO', currency: 'UGX', reportedAmountMinor: 12, attestationReference: '' }), { code: 'UBUNTFLOAT_ATTESTATION_REFERENCE_REQUIRED' });
});
