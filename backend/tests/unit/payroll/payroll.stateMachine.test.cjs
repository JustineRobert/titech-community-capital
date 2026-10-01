'use strict';

const {
  canTransition,
  assertTransition,
  assertMakerCheckerSeparation,
} = require('../../../modules/payroll/payroll.stateMachine.cjs');

describe('TITech payroll lifecycle state machine', () => {
  test('requires approval before processing', () => {
    expect(canTransition('PENDING_APPROVAL', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'PROCESSING')).toBe(true);
    expect(canTransition('UPLOADED', 'PROCESSING')).toBe(false);
    expect(() => assertTransition('UPLOADED', 'PROCESSING')).toThrow('cannot transition');
  });

  test('prevents maker from approving their own batch', () => {
    expect(() => assertMakerCheckerSeparation('user-1', 'user-1')).toThrow('cannot approve');
    expect(() => assertMakerCheckerSeparation('user-1', 'user-2')).not.toThrow();
  });

  test('allows controlled terminal completion path', () => {
    expect(canTransition('PROCESSING', 'SETTLEMENT_PENDING')).toBe(true);
    expect(canTransition('SETTLEMENT_PENDING', 'SETTLED')).toBe(true);
    expect(canTransition('SETTLED', 'RECONCILING')).toBe(true);
    expect(canTransition('RECONCILING', 'RECONCILED')).toBe(true);
    expect(canTransition('RECONCILED', 'COMPLETED')).toBe(true);
    expect(canTransition('COMPLETED', 'PROCESSING')).toBe(false);
  });
});
