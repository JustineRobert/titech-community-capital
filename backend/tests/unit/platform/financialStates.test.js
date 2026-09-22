import test from 'node:test';
import assert from 'node:assert/strict';
import { PAYMENT_STATES, canTransitionPayment, isFinancialFinality, isSettlementState } from '../../../modules/platform/domain/financialStates.js';

test('payment acceptance is not settlement', () => {
  assert.equal(isSettlementState(PAYMENT_STATES.ACCEPTED), false);
  assert.equal(isFinancialFinality(PAYMENT_STATES.ACCEPTED), false);
});

test('settled is final financial state', () => {
  assert.equal(isSettlementState(PAYMENT_STATES.SETTLED), true);
  assert.equal(isFinancialFinality(PAYMENT_STATES.SETTLED), true);
});

test('unknown or timeout state must resolve before settlement', () => {
  assert.equal(canTransitionPayment(PAYMENT_STATES.TIMEOUT, PAYMENT_STATES.SETTLED), false);
  assert.equal(canTransitionPayment(PAYMENT_STATES.TIMEOUT, PAYMENT_STATES.PENDING), true);
});
