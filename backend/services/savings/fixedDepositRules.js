/**
 * Exact, side-effect-free fixed-deposit calculation primitives.
 *
 * No product defaults are supplied. Callers must pass the institution-approved
 * day-count basis, accrual-day count/inclusivity decision, simple-interest
 * method, and rounding policy from an immutable terms snapshot. This module
 * does not activate deposits, mutate balances, post ledgers, or initiate payout.
 */

export const FIXED_DEPOSIT_DAY_COUNT_BASIS = Object.freeze({
  ACTUAL_360: 'ACTUAL_360',
  ACTUAL_365_FIXED: 'ACTUAL_365_FIXED',
});

export const FIXED_DEPOSIT_ROUNDING_MODE = Object.freeze({
  HALF_UP: 'HALF_UP',
  DOWN: 'DOWN',
});

export class FixedDepositRuleError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FixedDepositRuleError';
    this.code = code;
  }
}

function parseMinorUnits(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) return BigInt(value);
  throw new FixedDepositRuleError('principalMinorUnits must be a non-negative integer in minor units.', 'INVALID_PRINCIPAL_MINOR_UNITS');
}

function parseDateOnly(value, fieldName) {
  if (typeof value !== 'string' || !/^(\d{4})-(\d{2})-(\d{2})$/.test(value)) {
    throw new FixedDepositRuleError(`${fieldName} must use YYYY-MM-DD format.`, 'INVALID_DATE');
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1) {
    throw new FixedDepositRuleError(`${fieldName} is not a valid calendar date.`, 'INVALID_DATE');
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new FixedDepositRuleError(`${fieldName} is not a valid calendar date.`, 'INVALID_DATE');
  }
  return Math.floor(date.getTime() / (24 * 60 * 60 * 1000));
}

/**
 * Count calendar days between dates with an explicit maturity inclusivity rule.
 * For example, 2024-02-28 to 2024-03-01 counts 2 days exclusive and 3 inclusive.
 */
export function countAccrualDays({ startDate, endDate, endDateInclusive }) {
  if (typeof endDateInclusive !== 'boolean') {
    throw new FixedDepositRuleError('endDateInclusive must be explicitly selected by approved product terms.', 'ACCRUAL_INCLUSIVITY_REQUIRED');
  }
  const startDay = parseDateOnly(startDate, 'startDate');
  const endDay = parseDateOnly(endDate, 'endDate');
  if (endDay < startDay) {
    throw new FixedDepositRuleError('endDate cannot precede startDate.', 'END_DATE_BEFORE_START');
  }
  return endDay - startDay + (endDateInclusive ? 1 : 0);
}

/**
 * Calculate non-compounded interest with integer arithmetic only.
 *
 * Formula: principal minor units × annual rate (basis points) × accrual days /
 * (10,000 × approved day-count denominator). The result is returned as a
 * decimal integer string so it is safe to serialize without Number conversion.
 */
export function calculateSimpleInterestMinorUnits({
  principalMinorUnits,
  annualRateBps,
  accrualDays,
  dayCountBasis,
  interestMethod,
  roundingMode,
}) {
  const principal = parseMinorUnits(principalMinorUnits);
  if (principal <= 0n) {
    throw new FixedDepositRuleError('principalMinorUnits must be greater than zero.', 'INVALID_PRINCIPAL_MINOR_UNITS');
  }
  if (!Number.isSafeInteger(annualRateBps) || annualRateBps < 0) {
    throw new FixedDepositRuleError('annualRateBps must be a non-negative safe integer.', 'INVALID_ANNUAL_RATE_BPS');
  }
  if (!Number.isSafeInteger(accrualDays) || accrualDays < 0) {
    throw new FixedDepositRuleError('accrualDays must be a non-negative safe integer.', 'INVALID_ACCRUAL_DAYS');
  }
  if (interestMethod !== 'SIMPLE') {
    throw new FixedDepositRuleError('Only explicitly configured SIMPLE interest is supported by this primitive.', 'UNSUPPORTED_INTEREST_METHOD');
  }

  const denominatorByBasis = {
    [FIXED_DEPOSIT_DAY_COUNT_BASIS.ACTUAL_360]: 360n,
    [FIXED_DEPOSIT_DAY_COUNT_BASIS.ACTUAL_365_FIXED]: 365n,
  };
  const dayCountDenominator = denominatorByBasis[dayCountBasis];
  if (!dayCountDenominator) {
    throw new FixedDepositRuleError('An explicitly supported institution-approved day-count basis is required.', 'UNSUPPORTED_DAY_COUNT_BASIS');
  }
  if (!Object.values(FIXED_DEPOSIT_ROUNDING_MODE).includes(roundingMode)) {
    throw new FixedDepositRuleError('An explicit supported rounding mode is required.', 'UNSUPPORTED_ROUNDING_MODE');
  }

  const numerator = principal * BigInt(annualRateBps) * BigInt(accrualDays);
  const denominator = 10000n * dayCountDenominator;
  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = roundingMode === FIXED_DEPOSIT_ROUNDING_MODE.HALF_UP && remainder * 2n >= denominator
    ? whole + 1n
    : whole;

  return Object.freeze({
    interestMinorUnits: rounded.toString(),
    dayCountBasis,
    accrualDays,
    annualRateBps,
    interestMethod,
    roundingMode,
  });
}
