import test from 'node:test';
import assert from 'node:assert/strict';
import { finiteMetricOrNull, nonNegativeMetricOrNull, formatUnavailable } from '../frontend/src/utils/financialMetric.js';

test('preserves a real numeric zero', () => {
  assert.equal(finiteMetricOrNull(0), 0);
  assert.equal(finiteMetricOrNull('0'), 0);
  assert.equal(nonNegativeMetricOrNull(0), 0);
});

test('represents missing and invalid values as unavailable', () => {
  for (const value of [null, undefined, '', '   ', 'not-a-number', NaN, Infinity, true]) {
    assert.equal(finiteMetricOrNull(value), null, `value ${String(value)} should be unavailable`);
    assert.equal(formatUnavailable(value, (number) => String(number)), 'Unavailable');
  }
});

test('does not treat negative values as non-negative balances', () => {
  assert.equal(nonNegativeMetricOrNull(-1), null);
});
