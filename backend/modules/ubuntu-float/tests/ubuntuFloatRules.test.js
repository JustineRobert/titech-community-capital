import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADVANCE_APPLICATION_STATUS,
  assertNoticeAcknowledgement,
  normalizeCurrency,
  validateAgentHierarchy,
  validateAmountMinorUnits,
  validateNonNegativeAmountMinorUnits,
} from '../domain/ubuntuFloatRules.js';
import { getUbuntuFloatCapabilities } from '../domain/capabilities.js';

test('money amount validation accepts exact positive integer minor-unit strings only', () => {
  assert.equal(validateAmountMinorUnits('100000'), '100000');
  assert.equal(validateAmountMinorUnits(100), '100');
  for (const invalid of ['0', '-1', '1.5', '01', '1e3', 'NaN', 'Infinity', '', 1.5, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.throws(() => validateAmountMinorUnits(invalid), { code: 'UBUNTFLOAT_AMOUNT_INVALID' });
  }
});

test('float-position observations allow zero but not negative or fractional amounts', () => {
  assert.equal(validateNonNegativeAmountMinorUnits('0'), '0');
  assert.equal(validateNonNegativeAmountMinorUnits('150'), '150');
  assert.throws(() => validateNonNegativeAmountMinorUnits('-1'), { code: 'UBUNTFLOAT_AMOUNT_INVALID' });
  assert.throws(() => validateNonNegativeAmountMinorUnits('1.1'), { code: 'UBUNTFLOAT_AMOUNT_INVALID' });
});

test('currency codes normalize to uppercase and reject malformed codes', () => {
  assert.equal(normalizeCurrency('ugx'), 'UGX');
  assert.throws(() => normalizeCurrency('UG'), { code: 'UBUNTFLOAT_CURRENCY_INVALID' });
  assert.throws(() => normalizeCurrency('UGX;DROP'), { code: 'UBUNTFLOAT_CURRENCY_INVALID' });
});

test('agent hierarchy requires a root head office and a parent above each child', () => {
  assert.deepEqual(validateAgentHierarchy({ level: 'HEAD_OFFICE' }), { level: 'HEAD_OFFICE', parentLevel: null });
  assert.deepEqual(validateAgentHierarchy({ level: 'OUTLET', parentLevel: 'AGENT' }), { level: 'OUTLET', parentLevel: 'AGENT' });
  assert.throws(() => validateAgentHierarchy({ level: 'HEAD_OFFICE', parentLevel: 'SUPER_AGENT' }), { code: 'UBUNTFLOAT_HIERARCHY_INVALID' });
  assert.throws(() => validateAgentHierarchy({ level: 'AGENT', parentLevel: 'OUTLET' }), { code: 'UBUNTFLOAT_HIERARCHY_INVALID' });
  assert.throws(() => validateAgentHierarchy({ level: 'AGENT' }), { code: 'UBUNTFLOAT_PARENT_REQUIRED' });
});

test('advance notice requires explicit acknowledgement and a non-empty version', () => {
  assert.equal(assertNoticeAcknowledgement({ acknowledged: true, noticeVersion: 'NOTICE_2026_01' }), 'NOTICE_2026_01');
  assert.throws(() => assertNoticeAcknowledgement({ acknowledged: false, noticeVersion: 'NOTICE_2026_01' }), { code: 'UBUNTFLOAT_NOTICE_ACKNOWLEDGEMENT_REQUIRED' });
  assert.throws(() => assertNoticeAcknowledgement({ acknowledged: true, noticeVersion: '' }), { code: 'UBUNTFLOAT_FIELD_REQUIRED' });
});

test('advance application status contract includes unknown settlement and refuses to equate it to success', () => {
  assert.equal(ADVANCE_APPLICATION_STATUS.DISBURSEMENT_UNKNOWN, 'DISBURSEMENT_UNKNOWN');
  assert.notEqual(ADVANCE_APPLICATION_STATUS.DISBURSEMENT_UNKNOWN, ADVANCE_APPLICATION_STATUS.DISBURSED);
});

test('live money-moving capabilities remain hard-disabled even when application flags are true', () => {
  const capabilities = getUbuntuFloatCapabilities({
    TITECH_UBUNTFLOAT_CORE_ENABLED: 'true',
    TITECH_UBUNTFLOAT_ADVANCE_APPLICATIONS_ENABLED: 'true',
    TITECH_UBUNTFLOAT_LIVE_DISBURSEMENTS_ENABLED: 'true',
    TITECH_UBUNTFLOAT_SWAP_LIVE_ENABLED: 'true',
  });
  assert.equal(capabilities.capabilities.coreAgentManagement.enabled, true);
  assert.equal(capabilities.capabilities.advanceApplications.enabled, true);
  assert.equal(capabilities.capabilities.liveDisbursement.enabled, false);
  assert.equal(capabilities.capabilities.swapLiveTransfers.enabled, false);
  assert.equal(capabilities.capabilities.communitySavingsRecovery.enabled, false);
  assert.equal(capabilities.organization, 'TITech Capital LTD');
});
