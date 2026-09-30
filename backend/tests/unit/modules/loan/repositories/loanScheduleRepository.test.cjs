'use strict';

/**
 * TITech Community Capital — Loan Schedule Repository contract tests.
 *
 * These tests cover deterministic schedule mathematics without replacing the
 * MongoDB integration boundary. Database/session behavior belongs in the
 * integration suite.
 */

const LoanScheduleRepository = require('../../../../../modules/loan/repositories/loanScheduleRepository.js');

describe('LoanScheduleRepository — deterministic contract', () => {
  test('zero-interest schedule preserves principal exactly', () => {
    const result = LoanScheduleRepository.calculateAmortizationSchedule({
      principal: 1_000_000,
      annualInterestRate: 0,
      termMonths: 4,
      firstDueDate: new Date('2026-10-01T00:00:00Z'),
    });

    expect(result.installments).toHaveLength(4);
    expect(result.totalPrincipal).toBe(1_000_000);
    expect(result.totalInterest).toBe(0);
    expect(result.totalAmount).toBe(1_000_000);
    expect(
      result.installments.reduce((sum, item) => sum + item.principal, 0),
    ).toBe(1_000_000);
  });

  test('interest-bearing schedule closes principal with rounding residue in final installment', () => {
    const result = LoanScheduleRepository.calculateAmortizationSchedule({
      principal: 100_000,
      annualInterestRate: 12,
      termMonths: 12,
      firstDueDate: new Date('2026-10-01T00:00:00Z'),
    });

    expect(result.installments).toHaveLength(12);
    expect(result.totalPrincipal).toBe(100_000);
    expect(result.totalInterest).toBeGreaterThan(0);
    expect(result.totalAmount).toBeCloseTo(
      result.totalPrincipal + result.totalInterest,
      2,
    );

    const principalSum = result.installments.reduce(
      (sum, item) => sum + item.principal,
      0,
    );

    const interestSum = result.installments.reduce(
      (sum, item) => sum + item.interest,
      0,
    );

    expect(principalSum).toBeCloseTo(100_000, 2);
    expect(interestSum).toBe(result.totalInterest);
  });

  test('uses canonical due-date sequence', () => {
    const result = LoanScheduleRepository.calculateAmortizationSchedule({
      principal: 60_000,
      annualInterestRate: 0,
      termMonths: 3,
      firstDueDate: new Date('2026-10-15T12:00:00Z'),
    });

    expect(result.installments.map((item) => item.dueDate.toISOString())).toEqual([
      '2026-10-15T12:00:00.000Z',
      '2026-11-15T12:00:00.000Z',
      '2026-12-15T12:00:00.000Z',
    ]);
  });
});
