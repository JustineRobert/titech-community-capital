/**
 * Deterministic, side-effect-free recurrence rules for future savings plans.
 *
 * This module calculates local calendar dates only. It does not persist plans,
 * create payment intents, contact providers, claim work, or post financial
 * records. Those operations must use the canonical financial transaction and
 * provider/outbox paths once an end-to-end scheduled-collection workflow exists.
 *
 * Month-end policy: the original anchor day is retained. If a target month does
 * not contain that day, that occurrence is clamped to the month's last day. The
 * next occurrence is still calculated from the original anchor, not the prior
 * clamped occurrence (e.g. Jan 31 -> Feb 28/29 -> Mar 31).
 */

export const RECURRENCE_FREQUENCIES = Object.freeze({
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  FORTNIGHTLY: 'FORTNIGHTLY',
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
});

const MAX_PREVIEW_COUNT = 120;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export class RecurrenceRuleError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RecurrenceRuleError';
    this.code = code;
  }
}

export function parseDateOnly(value, fieldName = 'date') {
  if (typeof value !== 'string') {
    throw new RecurrenceRuleError(`${fieldName} must use YYYY-MM-DD format.`, 'INVALID_DATE');
  }

  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new RecurrenceRuleError(`${fieldName} must use YYYY-MM-DD format.`, 'INVALID_DATE');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1) {
    throw new RecurrenceRuleError(`${fieldName} is not a valid calendar date.`, 'INVALID_DATE');
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RecurrenceRuleError(`${fieldName} is not a valid calendar date.`, 'INVALID_DATE');
  }

  return Object.freeze({ year, month, day, epochDay: Math.floor(parsed.getTime() / DAY_MS) });
}

export function isValidIanaTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

function formatDateOnly(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(dateOnly, days) {
  const parsed = parseDateOnly(dateOnly);
  const date = new Date((parsed.epochDay + days) * DAY_MS);
  return formatDateOnly(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addAnchoredMonths(anchorDate, monthOffset) {
  const anchor = parseDateOnly(anchorDate, 'anchorDate');
  const totalMonthIndex = anchor.year * 12 + (anchor.month - 1) + monthOffset;
  const year = Math.floor(totalMonthIndex / 12);
  const month = (totalMonthIndex % 12) + 1;
  if (year < 1000 || year > 9999) {
    throw new RecurrenceRuleError('Generated recurrence date is outside the supported calendar range.', 'DATE_OUT_OF_RANGE');
  }

  // Construct day zero of the following month to retrieve the target month's
  // last day without relying on local timezone conversion.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return formatDateOnly(year, month, Math.min(anchor.day, lastDay));
}

export function scheduledDateAtIndex({ frequency, anchorDate, occurrenceIndex }) {
  const anchor = parseDateOnly(anchorDate, 'anchorDate');
  if (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 0 || occurrenceIndex > 100000) {
    throw new RecurrenceRuleError('occurrenceIndex must be an integer from 0 to 100000.', 'INVALID_OCCURRENCE_INDEX');
  }

  const normalizedFrequency = String(frequency || '').toUpperCase();
  switch (normalizedFrequency) {
    case RECURRENCE_FREQUENCIES.DAILY:
      return addDays(anchorDate, occurrenceIndex);
    case RECURRENCE_FREQUENCIES.WEEKLY:
      return addDays(anchorDate, occurrenceIndex * 7);
    case RECURRENCE_FREQUENCIES.FORTNIGHTLY:
      return addDays(anchorDate, occurrenceIndex * 14);
    case RECURRENCE_FREQUENCIES.MONTHLY:
      return addAnchoredMonths(anchorDate, occurrenceIndex);
    case RECURRENCE_FREQUENCIES.QUARTERLY:
      return addAnchoredMonths(anchorDate, occurrenceIndex * 3);
    default:
      throw new RecurrenceRuleError(`Unsupported recurrence frequency: ${normalizedFrequency || '(empty)'}.`, 'UNSUPPORTED_FREQUENCY');
  }
}

/**
 * Generate a bounded preview without side effects.
 *
 * `timeZone` is validated and must be persisted with an authorized plan. Dates
 * are calendar dates, not UTC execution instants; a worker must convert a due
 * date/time into an instant using the institution-approved local execution
 * window and timezone policy before attempting to collect funds.
 */
export function previewRecurrenceDates({
  frequency,
  anchorDate,
  count,
  endDate = null,
  timeZone,
  planId = null,
}) {
  parseDateOnly(anchorDate, 'anchorDate');
  if (!isValidIanaTimeZone(timeZone)) {
    throw new RecurrenceRuleError('timeZone must be a valid IANA timezone.', 'INVALID_TIME_ZONE');
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_PREVIEW_COUNT) {
    throw new RecurrenceRuleError(`count must be an integer from 1 to ${MAX_PREVIEW_COUNT}.`, 'INVALID_PREVIEW_COUNT');
  }
  if (endDate !== null) parseDateOnly(endDate, 'endDate');
  if (endDate && endDate < anchorDate) {
    throw new RecurrenceRuleError('endDate cannot precede anchorDate.', 'END_DATE_BEFORE_START');
  }

  const normalizedFrequency = String(frequency || '').toUpperCase();
  const occurrences = [];
  for (let occurrenceIndex = 0; occurrenceIndex < count; occurrenceIndex += 1) {
    const scheduledDate = scheduledDateAtIndex({
      frequency: normalizedFrequency,
      anchorDate,
      occurrenceIndex,
    });
    if (endDate && scheduledDate > endDate) break;
    occurrences.push(Object.freeze({
      occurrenceIndex,
      scheduledDate,
      occurrenceKey: planId === null ? null : `${String(planId)}:${scheduledDate}`,
      timeZone: timeZone.trim(),
    }));
  }
  return Object.freeze(occurrences);
}

export const RECURRENCE_RULE_LIMITS = Object.freeze({
  maxPreviewCount: MAX_PREVIEW_COUNT,
  monthEndPolicy: 'CLAMP_TO_LAST_VALID_DAY_USING_ORIGINAL_ANCHOR_DAY',
  occurrenceIdentity: 'PLAN_ID_PLUS_SCHEDULED_LOCAL_DATE',
});
