import test from 'node:test';
import assert from 'node:assert/strict';
import { addMoney, addQuantity, calculateAllocations, compareQuantity, normalizeCurrency, normalizeMoney, normalizeQuantity } from '../../../modules/agriculture/domain/agriculture.domain.js';

test('agriculture domain keeps money exact to cents', () => {
  assert.equal(normalizeMoney('1000'), '1000.00');
  assert.equal(addMoney('1000.10', '0.20', '9.70'), '1010.00');
});

test('explicit allocation must balance exactly', () => {
  const result = calculateAllocations({
    amount: '100.00',
    rule: 'EXPLICIT',
    recipients: [
      { accountId: '507f1f77bcf86cd799439011', purpose: 'PRODUCER', amount: '80.00' },
      { accountId: '507f1f77bcf86cd799439012', purpose: 'FEES', amount: '20.00' },
    ],
  });
  assert.equal(result.reduce((sum, item) => addMoney(sum, item.amount), '0.00'), '100.00');
});

test('equal allocation is deterministic and cent-balanced', () => {
  const result = calculateAllocations({
    amount: '100.01',
    rule: 'EQUAL',
    recipients: [
      { accountId: '507f1f77bcf86cd799439013', purpose: 'PRODUCER' },
      { accountId: '507f1f77bcf86cd799439014', purpose: 'PRODUCER' },
      { accountId: '507f1f77bcf86cd799439015', purpose: 'GROUP' },
    ],
  });
  assert.equal(result.reduce((sum, item) => addMoney(sum, item.amount), '0.00'), '100.01');
  assert.deepEqual(result.map((item) => item.amount), ['33.34', '33.34', '33.33']);
});

test('weighted allocation is deterministic and cent-balanced', () => {
  const result = calculateAllocations({
    amount: '100.00',
    rule: 'WEIGHTED',
    recipients: [
      { accountId: '507f1f77bcf86cd799439016', purpose: 'PRODUCER', weight: '2' },
      { accountId: '507f1f77bcf86cd799439017', purpose: 'GROUP', weight: '1' },
    ],
  });
  assert.deepEqual(result.map((item) => item.amount), ['66.67', '33.33']);
});

test('currency validation fails closed', () => {
  assert.throws(() => normalizeCurrency('UG'), /currency/i);
});


test('agriculture quantities use a separate six-decimal exact representation', () => {
  assert.equal(normalizeQuantity('10.125'), '10.125000');
  assert.equal(addQuantity('10.125000', '0.000125'), '10.125125');
  assert.equal(compareQuantity('10.125125', '10.125124'), 1);
});

test('quantity precision rejects excessive fractional digits', () => {
  assert.throws(() => normalizeQuantity('1.1234567'), /quantity/i);
});
