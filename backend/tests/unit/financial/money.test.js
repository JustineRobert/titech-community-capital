import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertDecimal,
  normalizeDecimal,
  add,
  subtract,
  compare,
  isPositive,
  isZero,
} from '../../../services/financial/money.js';

test('normalizes exact decimal strings without floating point', () => {
  assert.equal(normalizeDecimal('00010.5000'), '10.5');
  assert.equal(add('0.10', '0.20'), '0.3');
  assert.equal(add('999999999999999999.99', '0.01'), '1000000000000000000');
  assert.equal(subtract('1000.00', '0.01'), '999.99');
});

test('compares monetary values exactly', () => {
  assert.equal(compare('1.230', '1.23'), 0);
  assert.equal(compare('1.24', '1.23'), 1);
  assert.equal(compare('1.22', '1.23'), -1);
  assert.equal(isPositive('0.01'), true);
  assert.equal(isZero('0.00'), true);
});

test('rejects floating point, scientific notation, negative, and malformed values', () => {
  for (const value of ['1e3', '-1', 'NaN', 'Infinity', '1.2.3', '']) {
    assert.throws(() => assertDecimal(value));
  }
  assert.throws(() => assertDecimal(0.1));
});
