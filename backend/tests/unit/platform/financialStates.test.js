
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAYMENT_STATES,
  canTransitionPayment,
  isFinancialFinality,
  isSettlementState,
} from '../../../modules/platform/domain/financialStates.js';

const UNKNOWN_PAYMENT_STATE = '__UNKNOWN_PAYMENT_STATE__';

test('PAYMENT_STATES defines valid, non-empty state names', () => {
  const states = Object.values(PAYMENT_STATES);

  assert.ok(
    states.length > 0,
    'At least one payment state must be defined',
  );

  for (const state of states) {
    assert.equal(
      typeof state,
      'string',
      'Every payment state must be represented by a string',
    );

    assert.ok(
      state.trim().length > 0,
      'Payment states must not be empty strings',
    );
  }
});

test('payment acceptance is neither settlement nor financial finality', () => {
  assert.equal(
    isSettlementState(PAYMENT_STATES.ACCEPTED),
    false,
    'Provider acceptance must not be reported as settlement',
  );

  assert.equal(
    isFinancialFinality(PAYMENT_STATES.ACCEPTED),
    false,
    'Provider acceptance must not be reported as financial finality',
  );
});

test('settled is recognized as a settlement and financial-finality state', () => {
  assert.equal(
    isSettlementState(PAYMENT_STATES.SETTLED),
    true,
    'SETTLED must be recognized as a settlement state',
  );

  assert.equal(
    isFinancialFinality(PAYMENT_STATES.SETTLED),
    true,
    'SETTLED must be recognized as financial finality',
  );
});

test('timeout remains unresolved until the payment outcome is established', () => {
  assert.equal(
    isSettlementState(PAYMENT_STATES.TIMEOUT),
    false,
    'A timeout is not evidence of settlement',
  );

  assert.equal(
    isFinancialFinality(PAYMENT_STATES.TIMEOUT),
    false,
    'A timeout is not proof of a final financial outcome',
  );

  assert.equal(
    canTransitionPayment(
      PAYMENT_STATES.TIMEOUT,
      PAYMENT_STATES.SETTLED,
    ),
    false,
    'An unresolved timeout must not transition directly to settled',
  );

  assert.equal(
    canTransitionPayment(
      PAYMENT_STATES.TIMEOUT,
      PAYMENT_STATES.PENDING,
    ),
    true,
    'The existing contract permits timeout resolution back to pending',
  );
});

test('settled payments cannot regress into earlier payment states', () => {
  const previousStates = [
    PAYMENT_STATES.PENDING,
    PAYMENT_STATES.ACCEPTED,
    PAYMENT_STATES.TIMEOUT,
  ];

  for (const targetState of previousStates) {
    assert.equal(
      canTransitionPayment(
        PAYMENT_STATES.SETTLED,
        targetState,
      ),
      false,
      `SETTLED must not regress to ${targetState}`,
    );
  }
});

test('unknown payment states fail closed', () => {
  assert.equal(
    isSettlementState(UNKNOWN_PAYMENT_STATE),
    false,
    'Unknown states must not be treated as settlement',
  );

  assert.equal(
    isFinancialFinality(UNKNOWN_PAYMENT_STATE),
    false,
    'Unknown states must not be treated as financial finality',
  );

  assert.equal(
    canTransitionPayment(
      UNKNOWN_PAYMENT_STATE,
      PAYMENT_STATES.SETTLED,
    ),
    false,
    'An unknown source state must not authorize settlement',
  );

  assert.equal(
    canTransitionPayment(
      PAYMENT_STATES.PENDING,
      UNKNOWN_PAYMENT_STATE,
    ),
    false,
    'An unknown destination state must not be authorized',
  );

  assert.equal(
    canTransitionPayment(
      PAYMENT_STATES.TIMEOUT,
      UNKNOWN_PAYMENT_STATE,
    ),
    false,
    'An unresolved payment must not transition to an unknown state',
  );
});

test('invalid inputs do not authorize financial transitions', () => {
  const invalidStates = [
    undefined,
    null,
    '',
    42,
    {},
  ];

  for (const invalidState of invalidStates) {
    assert.equal(
      isSettlementState(invalidState),
      false,
      'Invalid state input must not be recognized as settlement',
    );

    assert.equal(
      isFinancialFinality(invalidState),
      false,
      'Invalid state input must not be recognized as finality',
    );

    assert.equal(
      canTransitionPayment(
        invalidState,
        PAYMENT_STATES.SETTLED,
      ),
      false,
      'An invalid source must not authorize settlement',
    );

    assert.equal(
      canTransitionPayment(
        PAYMENT_STATES.PENDING,
        invalidState,
      ),
      false,
      'An invalid target must not authorize a transition',
    );
  }
});

test('classification helpers return boolean results for declared states', () => {
  for (const state of Object.values(PAYMENT_STATES)) {
    assert.equal(
      typeof isSettlementState(state),
      'boolean',
      `Settlement classification for ${state} must be boolean`,
    );

    assert.equal(
      typeof isFinancialFinality(state),
      'boolean',
      `Financial-finality classification for ${state} must be boolean`,
    );
  }
});
