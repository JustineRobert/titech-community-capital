'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ZERO,
  SUPPORTED_MODES,
  normalizeAmount,
  accrueSavingsInterest,
  accrueLoanInterest,
} = require('../../../modules/finance/services/interestAccrualService.cjs');

// These tests prove the safe boundary contract. They intentionally do not
// claim monetary accrual is production-complete until the reviewed calculation
// policy and accounting transaction integration are provisioned and verified.

test('normalizes bounded monetary strings without floating point arithmetic', () => {
  assert.equal(normalizeAmount('0012.3'), '12.30');
  assert.equal(normalizeAmount('0'), '0.00');
  assert.equal(normalizeAmount(null), ZERO);
});

test('rejects malformed or negative interest amounts', () => {
  assert.throws(() => normalizeAmount('-1.00'), /non-negative decimal/);
  assert.throws(() => normalizeAmount('1.234'), /up to 2 fractional digits/);
  assert.throws(() => normalizeAmount('abc'), /non-negative decimal/);
});

test('returns an explicit NOT_CONFIGURED result instead of guessing policy', async () => {
  const result = await accrueSavingsInterest({ tenantId: 'tenant-1' });

  assert.equal(result.status, 'NOT_CONFIGURED');
  assert.equal(result.mode, 'NOT_CONFIGURED');
  assert.equal(result.processed, 0);
  assert.equal(result.totalInterest, '0.00');
  assert.equal(result.tenantId, 'tenant-1');
});

test('supports validated precalculated results for reviewed callers', async () => {
  const result = await accrueLoanInterest({
    tenantId: 'tenant-1',
    mode: 'PRECALCULATED',
    processed: 2,
    totalInterest: '10.5',
  });

  assert.equal(result.status, 'PRECALCULATED');
  assert.equal(result.processed, 2);
  assert.equal(result.totalInterest, '10.50');
});

test('rejects missing tenant and unsupported modes', async () => {
  await assert.rejects(
    () => accrueLoanInterest({}),
    /tenantId is required/,
  );

  await assert.rejects(
    () => accrueSavingsInterest({
      tenantId: 'tenant-1',
      mode: 'GUESS',
    }),
    /Unsupported interest accrual mode/,
  );

  assert.deepEqual(SUPPORTED_MODES, ['NOT_CONFIGURED', 'PRECALCULATED']);
});
