import assert from 'node:assert/strict';
import test from 'node:test';

import {
  previewRecurrenceDates,
  RECURRENCE_FREQUENCIES,
  scheduledDateAtIndex,
} from '../backend/services/savings/recurrenceRules.js';
import {
  calculateSimpleInterestMinorUnits,
  countAccrualDays,
  FIXED_DEPOSIT_DAY_COUNT_BASIS,
  FIXED_DEPOSIT_ROUNDING_MODE,
} from '../backend/services/savings/fixedDepositRules.js';

const utc = 'Africa/Kampala';

test('recurrence supports daily, weekly, fortnightly, monthly and quarterly dates', () => {
  assert.equal(scheduledDateAtIndex({ frequency: RECURRENCE_FREQUENCIES.DAILY, anchorDate: '2026-10-11', occurrenceIndex: 2 }), '2026-10-13');
  assert.equal(scheduledDateAtIndex({ frequency: RECURRENCE_FREQUENCIES.WEEKLY, anchorDate: '2026-10-11', occurrenceIndex: 2 }), '2026-10-25');
  assert.equal(scheduledDateAtIndex({ frequency: RECURRENCE_FREQUENCIES.FORTNIGHTLY, anchorDate: '2026-10-11', occurrenceIndex: 2 }), '2026-11-08');
  assert.equal(scheduledDateAtIndex({ frequency: RECURRENCE_FREQUENCIES.MONTHLY, anchorDate: '2026-10-11', occurrenceIndex: 2 }), '2026-12-11');
  assert.equal(scheduledDateAtIndex({ frequency: RECURRENCE_FREQUENCIES.QUARTERLY, anchorDate: '2026-10-11', occurrenceIndex: 2 }), '2027-04-11');
});

test('monthly recurrence clamps month ends but retains the original anchor day', () => {
  assert.equal(scheduledDateAtIndex({ frequency: 'MONTHLY', anchorDate: '2024-01-31', occurrenceIndex: 1 }), '2024-02-29');
  assert.equal(scheduledDateAtIndex({ frequency: 'MONTHLY', anchorDate: '2024-01-31', occurrenceIndex: 2 }), '2024-03-31');
  assert.equal(scheduledDateAtIndex({ frequency: 'MONTHLY', anchorDate: '2023-01-31', occurrenceIndex: 1 }), '2023-02-28');
  assert.equal(scheduledDateAtIndex({ frequency: 'QUARTERLY', anchorDate: '2024-02-29', occurrenceIndex: 4 }), '2025-02-28');
});

test('preview enforces a valid IANA zone, end date, count limit and stable occurrence key', () => {
  const preview = previewRecurrenceDates({
    frequency: 'MONTHLY', anchorDate: '2026-01-31', count: 5, endDate: '2026-03-31', timeZone: utc, planId: 'plan-123',
  });
  assert.deepEqual(preview.map((x) => x.scheduledDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(preview[1].occurrenceKey, 'plan-123:2026-02-28');
  assert.throws(() => previewRecurrenceDates({ frequency: 'DAILY', anchorDate: '2026-01-01', count: 1, timeZone: 'Not/AZone' }), { code: 'INVALID_TIME_ZONE' });
  assert.throws(() => previewRecurrenceDates({ frequency: 'DAILY', anchorDate: '2026-01-01', count: 121, timeZone: utc }), { code: 'INVALID_PREVIEW_COUNT' });
  assert.throws(() => scheduledDateAtIndex({ frequency: 'HOURLY', anchorDate: '2026-01-01', occurrenceIndex: 1 }), { code: 'UNSUPPORTED_FREQUENCY' });
  assert.throws(() => scheduledDateAtIndex({ frequency: 'DAILY', anchorDate: '2026-02-30', occurrenceIndex: 1 }), { code: 'INVALID_DATE' });
});

test('fixed-deposit accrual days require an explicit inclusive/exclusive end-date policy', () => {
  assert.equal(countAccrualDays({ startDate: '2024-02-28', endDate: '2024-03-01', endDateInclusive: false }), 2);
  assert.equal(countAccrualDays({ startDate: '2024-02-28', endDate: '2024-03-01', endDateInclusive: true }), 3);
  assert.throws(() => countAccrualDays({ startDate: '2024-02-28', endDate: '2024-03-01' }), { code: 'ACCRUAL_INCLUSIVITY_REQUIRED' });
});

test('fixed-deposit interest uses integer arithmetic and explicit approved calculation terms', () => {
  const result = calculateSimpleInterestMinorUnits({
    principalMinorUnits: '1000000',
    annualRateBps: 1000,
    accrualDays: 365,
    dayCountBasis: FIXED_DEPOSIT_DAY_COUNT_BASIS.ACTUAL_365_FIXED,
    interestMethod: 'SIMPLE',
    roundingMode: FIXED_DEPOSIT_ROUNDING_MODE.HALF_UP,
  });
  assert.equal(result.interestMinorUnits, '100000');
  assert.equal(result.dayCountBasis, 'ACTUAL_365_FIXED');
  assert.throws(() => calculateSimpleInterestMinorUnits({
    principalMinorUnits: 1000,
    annualRateBps: 1000,
    accrualDays: 365,
    dayCountBasis: FIXED_DEPOSIT_DAY_COUNT_BASIS.ACTUAL_365_FIXED,
    interestMethod: 'COMPOUND',
    roundingMode: FIXED_DEPOSIT_ROUNDING_MODE.HALF_UP,
  }), { code: 'UNSUPPORTED_INTEREST_METHOD' });
  assert.throws(() => calculateSimpleInterestMinorUnits({
    principalMinorUnits: 1000,
    annualRateBps: 1000,
    accrualDays: 365,
    dayCountBasis: 'UNAPPROVED_BASIS',
    interestMethod: 'SIMPLE',
    roundingMode: FIXED_DEPOSIT_ROUNDING_MODE.HALF_UP,
  }), { code: 'UNSUPPORTED_DAY_COUNT_BASIS' });
});
