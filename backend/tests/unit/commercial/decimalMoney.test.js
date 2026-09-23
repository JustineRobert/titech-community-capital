import test from 'node:test';
import assert from 'node:assert/strict';
import decimalMoney from '../../../commercial/services/billing/decimalMoney.cjs';

const { normalizeDecimal, compare } = decimalMoney;

test('normalizeDecimal canonicalizes integer and fractional values', () => {
  assert.deepEqual(normalizeDecimal('0012.3400'), {
    sign: 1,
    whole: '12',
    fraction: '34',
  });
});

test('compare handles positive and negative decimals without floating point', () => {
  assert.equal(compare('10.20', '10.2'), 0);
  assert.equal(compare('10.21', '10.20'), 1);
  assert.equal(compare('-10.21', '-10.20'), -1);
  assert.equal(compare('-10.20', '10.20'), -1);
});

test('zero normalization remains sign-stable', () => {
  assert.deepEqual(normalizeDecimal('-0.000'), {
    sign: 1,
    whole: '0',
    fraction: '',
  });
});
