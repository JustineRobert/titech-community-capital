
'use strict';

/**
 * TITech Community Capital — Loan Schedule Repository contract tests.
 *
 * File:
 * backend/tests/unit/modules/loan/repositories/loanScheduleRepository.test.cjs
 *
 * Scope:
 * - Deterministic amortization mathematics.
 * - Principal and interest reconciliation.
 * - Final-installment rounding.
 * - Due-date integrity.
 * - Input validation.
 *
 * MongoDB, database transactions and session behavior belong in the
 * integration suite, not this deterministic unit-test suite.
 */

const LoanScheduleRepository = require(
  '../../../../../modules/loan/repositories/loanScheduleRepository.js',
);

const calculateSchedule =
  LoanScheduleRepository.calculateAmortizationSchedule;

const VALID_INPUT = Object.freeze({
  principal: 100_000,
  annualInterestRate: 12,
  termMonths: 12,
  firstDueDate: new Date('2026-10-01T00:00:00.000Z'),
});

function createSchedule(overrides = {}) {
  return calculateSchedule({
    ...VALID_INPUT,
    firstDueDate: new Date(VALID_INPUT.firstDueDate.getTime()),
    ...overrides,
  });
}

function sumInstallmentField(installments, field) {
  return installments.reduce(
    (sum, installment) => sum + installment[field],
    0,
  );
}

function assertFiniteNonNegative(value, description) {
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(0);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${description} must be finite and nonnegative`);
  }
}

describe('LoanScheduleRepository — deterministic contract', () => {
  test('zero-interest schedule preserves principal exactly', () => {
    const principal = 1_000_000;

    const result = createSchedule({
      principal,
      annualInterestRate: 0,
      termMonths: 4,
      firstDueDate: new Date('2026-10-01T00:00:00.000Z'),
    });

    expect(result.installments).toHaveLength(4);
    expect(result.totalPrincipal).toBe(principal);
    expect(result.totalInterest).toBe(0);
    expect(result.totalAmount).toBe(principal);

    expect(
      sumInstallmentField(result.installments, 'principal'),
    ).toBe(principal);

    expect(
      sumInstallmentField(result.installments, 'interest'),
    ).toBe(0);

    for (const installment of result.installments) {
      expect(installment.principal).toBe(250_000);
      expect(installment.interest).toBe(0);
    }
  });

  test(
    'interest-bearing schedule reconciles principal, interest and total amount',
    () => {
      const principal = 100_000;

      const result = createSchedule({
        principal,
        annualInterestRate: 12,
        termMonths: 12,
        firstDueDate: new Date('2026-10-01T00:00:00.000Z'),
      });

      expect(result.installments).toHaveLength(12);
      expect(result.totalPrincipal).toBe(principal);
      expect(result.totalInterest).toBeGreaterThan(0);

      assertFiniteNonNegative(
        result.totalPrincipal,
        'Total principal',
      );

      assertFiniteNonNegative(
        result.totalInterest,
        'Total interest',
      );

      assertFiniteNonNegative(
        result.totalAmount,
        'Total repayment amount',
      );

      const principalSum = sumInstallmentField(
        result.installments,
        'principal',
      );

      const interestSum = sumInstallmentField(
        result.installments,
        'interest',
      );

      expect(principalSum).toBeCloseTo(principal, 2);
      expect(interestSum).toBeCloseTo(result.totalInterest, 2);

      expect(result.totalAmount).toBeCloseTo(
        result.totalPrincipal + result.totalInterest,
        2,
      );

      const installmentTotal = result.installments.reduce(
        (sum, installment) =>
          sum + installment.principal + installment.interest,
        0,
      );

      expect(installmentTotal).toBeCloseTo(
        result.totalAmount,
        2,
      );
    },
  );

  test(
    'every installment has valid nonnegative principal and interest',
    () => {
      const result = createSchedule();

      expect(result.installments.length).toBe(
        VALID_INPUT.termMonths,
      );

      for (const [index, installment] of
        result.installments.entries()) {
        assertFiniteNonNegative(
          installment.principal,
          `Installment ${index + 1} principal`,
        );

        assertFiniteNonNegative(
          installment.interest,
          `Installment ${index + 1} interest`,
        );

        expect(installment.dueDate).toBeInstanceOf(Date);

        expect(Number.isNaN(installment.dueDate.getTime()))
          .toBe(false);
      }
    },
  );

  test(
    'final installment absorbs principal rounding residue',
    () => {
      const principal = 100_000;

      const result = createSchedule({
        principal,
        annualInterestRate: 12,
        termMonths: 12,
      });

      const installments = result.installments;
      const precedingPrincipal = sumInstallmentField(
        installments.slice(0, -1),
        'principal',
      );

      const finalInstallment = installments[installments.length - 1];

      expect(finalInstallment.principal).toBeCloseTo(
        principal - precedingPrincipal,
        2,
      );

      expect(
        sumInstallmentField(installments, 'principal'),
      ).toBeCloseTo(principal, 2);
    },
  );

  test('zero-interest schedule has no rounding drift for equal installments', () => {
    const result = createSchedule({
      principal: 600,
      annualInterestRate: 0,
      termMonths: 3,
    });

    expect(
      result.installments.map((item) => item.principal),
    ).toEqual([200, 200, 200]);

    expect(result.totalPrincipal).toBe(600);
    expect(result.totalInterest).toBe(0);
    expect(result.totalAmount).toBe(600);
  });

  test('uses canonical monthly due-date sequence', () => {
    const result = createSchedule({
      principal: 60_000,
      annualInterestRate: 0,
      termMonths: 3,
      firstDueDate: new Date('2026-10-15T12:00:00.000Z'),
    });

    expect(
      result.installments.map((item) => item.dueDate.toISOString()),
    ).toEqual([
      '2026-10-15T12:00:00.000Z',
      '2026-11-15T12:00:00.000Z',
      '2026-12-15T12:00:00.000Z',
    ]);
  });

  test('due dates are strictly chronological', () => {
    const result = createSchedule({
      termMonths: 12,
    });

    const timestamps = result.installments.map(
      (item) => item.dueDate.getTime(),
    );

    for (let index = 1; index < timestamps.length; index += 1) {
      expect(timestamps[index]).toBeGreaterThan(
        timestamps[index - 1],
      );
    }
  });

  test('schedule calculation does not mutate the supplied due date', () => {
    const firstDueDate = new Date(
      '2026-10-15T12:00:00.000Z',
    );

    const originalTimestamp = firstDueDate.getTime();

    createSchedule({
      firstDueDate,
      termMonths: 6,
    });

    expect(firstDueDate.getTime()).toBe(originalTimestamp);
  });

  test('identical inputs produce identical schedules', () => {
    const input = {
      principal: 100_000,
      annualInterestRate: 12,
      termMonths: 12,
      firstDueDate: new Date('2026-10-15T12:00:00.000Z'),
    };

    const first = calculateSchedule({
      ...input,
      firstDueDate: new Date(input.firstDueDate.getTime()),
    });

    const second = calculateSchedule({
      ...input,
      firstDueDate: new Date(input.firstDueDate.getTime()),
    });

    expect(second).toEqual(first);
  });

  test('rejects invalid principal, interest rate, term and date inputs', () => {
    const invalidCases = [
      {
        description: 'zero principal',
        overrides: { principal: 0 },
      },
      {
        description: 'negative principal',
        overrides: { principal: -1 },
      },
      {
        description: 'non-finite principal',
        overrides: { principal: Infinity },
      },
      {
        description: 'NaN principal',
        overrides: { principal: NaN },
      },
      {
        description: 'negative interest rate',
        overrides: { annualInterestRate: -1 },
      },
      {
        description: 'non-finite interest rate',
        overrides: { annualInterestRate: Infinity },
      },
      {
        description: 'NaN interest rate',
        overrides: { annualInterestRate: NaN },
      },
      {
        description: 'zero repayment term',
        overrides: { termMonths: 0 },
      },
      {
        description: 'negative repayment term',
        overrides: { termMonths: -1 },
      },
      {
        description: 'fractional repayment term',
        overrides: { termMonths: 1.5 },
      },
      {
        description: 'non-finite repayment term',
        overrides: { termMonths: Infinity },
      },
      {
        description: 'invalid due date',
        overrides: { firstDueDate: new Date(NaN) },
      },
    ];

    for (const { description, overrides } of invalidCases) {
      expect(() => createSchedule(overrides)).toThrow(
        undefined,
      );
    }
  });
});
