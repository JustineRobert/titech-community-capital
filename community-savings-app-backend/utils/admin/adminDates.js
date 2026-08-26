'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Date/Time Utility
 * ============================================================================
 *
 * File:
 *   backend/utils/admin/adminDates.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical date/time normalization and date-range utility for TITech
 * Community Capital administrative services.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Strict date parsing
 * - UTC normalization
 * - ISO serialization
 * - Timestamp validation
 * - Date comparisons
 * - Date arithmetic
 * - Start/end of day
 * - Start/end of week
 * - Start/end of month
 * - Start/end of quarter
 * - Start/end of year
 * - Reporting periods
 * - Rolling periods
 * - Time-zone-aware reporting boundaries
 * - Date-range validation
 * - Financial ageing helpers
 * - Loan ageing helpers
 * - Calendar helpers
 *
 * Architecture
 * ----------------------------------------------------------------------------
 * This utility:
 *
 * ✓ Standardizes dates entering TITech admin services
 * ✓ Provides deterministic UTC persistence values
 * ✓ Supports IANA time zones for reporting boundaries
 * ✓ Keeps date calculations out of controllers/repositories
 * ✓ Prevents invalid or ambiguous date input
 *
 * It MUST NOT:
 *
 * ✗ authorize users
 * ✗ enforce tenant isolation
 * ✗ decide financial eligibility
 * ✗ mutate financial balances
 * ✗ calculate accounting entries
 * ✗ alter authoritative business timestamps
 *
 * Important
 * ----------------------------------------------------------------------------
 * JavaScript Date represents an absolute instant in UTC internally.
 *
 * Time-zone conversion is therefore used only when determining calendar
 * boundaries such as:
 *
 *   "Africa/Kampala local day"
 *   "Africa/Kampala local month"
 *
 * Persisted timestamps should remain ISO/UTC.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All ACFOS references have been replaced with TITech Community Capital.
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const UTILITY_NAME =
  'AdminDates';

const UTILITY_VERSION =
  '2026.1';

const APPLICATION_NAME =
  'TITech Community Capital LTD';

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const DAY_MS =
  24 *
  60 *
  60 *
  1000;

const WEEK_MS =
  7 *
  DAY_MS;

const DEFAULT_TIME_ZONE =
  'UTC';

const DEFAULT_LOCALE =
  'en-US';

const MAX_RANGE_DAYS =
  3660;

const MAX_DATE_OFFSET_DAYS =
  10000;

/**
 * ============================================================================
 * ERROR
 * ============================================================================
 */

class AdminDatesError extends Error {
  constructor(
    message,
    {
      code =
        'ADMIN_DATES_ERROR',

      statusCode =
        400,

      field =
        null,

      details =
        null,

      cause =
        null,
    } = {},
  ) {
    super(message);

    this.name =
      'AdminDatesError';

    this.code =
      code;

    this.statusCode =
      statusCode;

    this.field =
      field;

    this.details =
      details;

    this.cause =
      cause;

    this.isDateError =
      true;
  }
}

/**
 * ============================================================================
 * BASIC HELPERS
 * ============================================================================
 */

function normalizeString(
  value,
  fallback = null,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const normalized =
    String(
      value,
    ).trim();

  return (
    normalized ||
    fallback
  );
}

function assertDateObject(
  value,
  field =
    'date',
) {
  if (
    !(value instanceof Date)
  ) {
    throw new AdminDatesError(
      `${field} must be a Date instance.`,
      {
        code:
          'INVALID_DATE_OBJECT',

        field,
      },
    );
  }

  if (
    Number.isNaN(
      value.getTime(),
    )
  ) {
    throw new AdminDatesError(
      `${field} is invalid.`,
      {
        code:
          'INVALID_DATE_VALUE',

        field,
      },
    );
  }

  return true;
}

/**
 * ============================================================================
 * STRICT DATE PARSING
 * ============================================================================
 *
 * Supported:
 *
 *   Date
 *   millisecond timestamp
 *   ISO 8601 string
 *   YYYY-MM-DD
 *
 * Date-only values are interpreted as UTC midnight rather than server-local
 * midnight.
 * ============================================================================
 */

function toDate(
  value,
  {
    field =
      'date',

    required =
      true,

    defaultValue =
      null,

    allowDateOnly =
      true,

    allowTimestamp =
      true,
  } = {},
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    if (
      required
    ) {
      throw new AdminDatesError(
        `${field} is required.`,
        {
          code:
            'DATE_REQUIRED',

          field,
        },
      );
    }

    return defaultValue;
  }

  if (
    value instanceof Date
  ) {
    assertDateObject(
      value,
      field,
    );

    return new Date(
      value.getTime(),
    );
  }

  if (
    typeof value ===
    'number'
  ) {
    if (
      !allowTimestamp ||
      !Number.isFinite(
        value,
      )
    ) {
      throw new AdminDatesError(
        `${field} contains an invalid timestamp.`,
        {
          code:
            'INVALID_TIMESTAMP',

          field,
        },
      );
    }

    const date =
      new Date(
        value,
      );

    assertDateObject(
      date,
      field,
    );

    return date;
  }

  if (
    typeof value !==
    'string'
  ) {
    throw new AdminDatesError(
      `${field} must be a Date, ISO string, or timestamp.`,
      {
        code:
          'INVALID_DATE_TYPE',

        field,
      },
    );
  }

  const normalized =
    value.trim();

  if (
    !normalized
  ) {
    if (
      required
    ) {
      throw new AdminDatesError(
        `${field} is required.`,
        {
          code:
            'DATE_REQUIRED',

          field,
        },
      );
    }

    return defaultValue;
  }

  if (
    allowDateOnly &&
    /^\d{4}-\d{2}-\d{2}$/.test(
      normalized,
    )
  ) {
    const date =
      new Date(
        `${normalized}T00:00:00.000Z`,
      );

    assertDateObject(
      date,
      field,
    );

    return date;
  }

  /**
   * Reject non-ISO style ambiguous formats such as:
   *
   *   08/26/2026
   *   26-08-2026
   *   August 26 2026
   *
   * Administrative financial/reporting APIs should not depend on locale-
   * dependent parsing.
   */
  if (
    !isIsoDateString(
      normalized,
    )
  ) {
    throw new AdminDatesError(
      `${field} must use an ISO 8601 date/time value.`,
      {
        code:
          'NON_ISO_DATE',

        field,
      },
    );
  }

  const date =
    new Date(
      normalized,
    );

  assertDateObject(
    date,
    field,
  );

  return date;
}

function isIsoDateString(
  value,
) {
  return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(
    value,
  );
}

/**
 * ============================================================================
 * DATE SERIALIZATION
 * ============================================================================
 */

function toISOString(
  value,
  options = {},
) {
  const date =
    toDate(
      value,
      options,
    );

  return date
    ? date.toISOString()
    : null;
}

function toTimestamp(
  value,
  options = {},
) {
  const date =
    toDate(
      value,
      options,
    );

  return date
    ? date.getTime()
    : null;
}

function cloneDate(
  value,
  field =
    'date',
) {
  return toDate(
    value,
    {
      field,
      required: true,
    },
  );
}

/**
 * ============================================================================
 * COMPARISON
 * ============================================================================
 */

function compare(
  left,
  right,
) {
  const firstDate =
    toDate(
      left,
      {
        field:
          'left',
      },
    );

  const secondDate =
    toDate(
      right,
      {
        field:
          'right',
      },
    );

  if (
    firstDate.getTime() <
    secondDate.getTime()
  ) {
    return -1;
  }

  if (
    firstDate.getTime() >
    secondDate.getTime()
  ) {
    return 1;
  }

  return 0;
}

function isBefore(
  left,
  right,
) {
  return (
    compare(
      left,
      right,
    ) < 0
  );
}

function isAfter(
  left,
  right,
) {
  return (
    compare(
      left,
      right,
    ) > 0
  );
}

function isEqual(
  left,
  right,
) {
  return (
    compare(
      left,
      right,
    ) === 0
  );
}

function minDate(
  ...values
) {
  const dates =
    values
      .filter(
        (
          value,
        ) =>
          value !==
            null &&
          value !==
            undefined,
      )
      .map(
        (
          value,
        ) =>
          toDate(
            value,
          ),
      );

  if (
    dates.length ===
    0
  ) {
    return null;
  }

  return new Date(
    Math.min(
      ...dates.map(
        (
          date,
        ) =>
          date.getTime(),
      ),
    ),
  );
}

function maxDate(
  ...values
) {
  const dates =
    values
      .filter(
        (
          value,
        ) =>
          value !==
            null &&
          value !==
            undefined,
      )
      .map(
        (
          value,
        ) =>
          toDate(
            value,
          ),
      );

  if (
    dates.length ===
    0
  ) {
    return null;
  }

  return new Date(
    Math.max(
      ...dates.map(
        (
          date,
        ) =>
          date.getTime(),
      ),
    ),
  );
}

/**
 * ============================================================================
 * DIFFERENCE HELPERS
 * ============================================================================
 */

function differenceMs(
  left,
  right,
) {
  const firstDate =
    toDate(
      left,
    );

  const secondDate =
    toDate(
      right,
    );

  return (
    secondDate.getTime() -
    firstDate.getTime()
  );
}

function differenceSeconds(
  left,
  right,
) {
  return (
    differenceMs(
      left,
      right,
    ) / 1000
  );
}

function differenceMinutes(
  left,
  right,
) {
  return (
    differenceMs(
      left,
      right,
    ) /
    (
      60 *
      1000
    )
  );
}

function differenceHours(
  left,
  right,
) {
  return (
    differenceMs(
      left,
      right,
    ) /
    (
      60 *
      60 *
      1000
    )
  );
}

function differenceDays(
  left,
  right,
) {
  return (
    differenceMs(
      left,
      right,
    ) / DAY_MS
  );
}

function elapsedDays(
  from,
  {
    now =
      new Date(),
  } = {},
) {
  const start =
    toDate(
      from,
    );

  const end =
    toDate(
      now,
    );

  return Math.max(
    0,
    Math.floor(
      (
        end.getTime() -
        start.getTime()
      ) /
        DAY_MS,
    ),
  );
}

/**
 * ============================================================================
 * DATE ARITHMETIC
 * ============================================================================
 */

function addMilliseconds(
  value,
  amount,
) {
  const date =
    toDate(
      value,
    );

  const delta =
    Number(
      amount,
    );

  if (
    !Number.isFinite(
      delta,
    )
  ) {
    throw new AdminDatesError(
      'Amount must be a finite number.',
      {
        code:
          'INVALID_DATE_OFFSET',
      },
    );
  }

  return new Date(
    date.getTime() +
      delta,
  );
}

function addSeconds(
  value,
  amount,
) {
  return addMilliseconds(
    value,
    Number(amount) *
      1000,
  );
}

function addMinutes(
  value,
  amount,
) {
  return addMilliseconds(
    value,
    Number(amount) *
      60 *
      1000,
  );
}

function addHours(
  value,
  amount,
) {
  return addMilliseconds(
    value,
    Number(amount) *
      60 *
      60 *
      1000,
  );
}

function addDays(
  value,
  amount,
) {
  const date =
    toDate(
      value,
    );

  const days =
    Number(
      amount,
    );

  if (
    !Number.isInteger(
      days,
    ) ||
    Math.abs(days) >
      MAX_DATE_OFFSET_DAYS
  ) {
    throw new AdminDatesError(
      'Day offset is outside the supported range.',
      {
        code:
          'INVALID_DAY_OFFSET',
      },
    );
  }

  const result =
    new Date(
      date.getTime(),
    );

  result.setUTCDate(
    result.getUTCDate() +
      days,
  );

  return result;
}

function addWeeks(
  value,
  amount,
) {
  return addDays(
    value,
    Number(amount) *
      7,
  );
}

function addMonths(
  value,
  amount,
) {
  const date =
    toDate(
      value,
    );

  const months =
    Number(
      amount,
    );

  if (
    !Number.isInteger(
      months,
    ) ||
    Math.abs(months) >
      MAX_DATE_OFFSET_DAYS
  ) {
    throw new AdminDatesError(
      'Month offset is outside the supported range.',
      {
        code:
          'INVALID_MONTH_OFFSET',
      },
    );
  }

  /**
   * Preserve end-of-month semantics.
   *
   * 31 Jan + 1 month => last day of February,
   * not March 3.
   */
  const originalDay =
    date.getUTCDate();

  const result =
    new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        1,
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
        date.getUTCMilliseconds(),
      ),
    );

  result.setUTCMonth(
    result.getUTCMonth() +
      months,
  );

  const lastDay =
    new Date(
      Date.UTC(
        result.getUTCFullYear(),
        result.getUTCMonth() +
          1,
        0,
      ),
    ).getUTCDate();

  result.setUTCDate(
    Math.min(
      originalDay,
      lastDay,
    ),
  );

  return result;
}

function addYears(
  value,
  amount,
) {
  const date =
    toDate(
      value,
    );

  const years =
    Number(
      amount,
    );

  if (
    !Number.isInteger(
      years,
    ) ||
    Math.abs(years) >
      MAX_DATE_OFFSET_DAYS
  ) {
    throw new AdminDatesError(
      'Year offset is outside the supported range.',
      {
        code:
          'INVALID_YEAR_OFFSET',
      },
    );
  }

  const result =
    new Date(
      date.getTime(),
    );

  result.setUTCFullYear(
    result.getUTCFullYear() +
      years,
  );

  /**
   * Handle leap-day rollover.
   */
  if (
    date.getUTCMonth() ===
      1 &&
    date.getUTCDate() ===
      29 &&
    result.getUTCMonth() !==
      1
  ) {
    result.setUTCMonth(
      1,
      28,
    );
  }

  return result;
}

/**
 * ============================================================================
 * UTC CALENDAR BOUNDARIES
 * ============================================================================
 */

function startOfDay(
  value =
    new Date(),
) {
  const date =
    toDate(
      value,
    );

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
}

function endOfDay(
  value =
    new Date(),
) {
  return new Date(
    startOfDay(
      value,
    ).getTime() +
      DAY_MS -
      1,
  );
}

function startOfWeek(
  value =
    new Date(),
  {
    weekStartsOn =
      1,
  } = {},
) {
  const date =
    startOfDay(
      value,
    );

  const day =
    date.getUTCDay();

  const normalizedStart =
    Number(
      weekStartsOn,
    );

  if (
    !Number.isInteger(
      normalizedStart,
    ) ||
    normalizedStart <
      0 ||
    normalizedStart >
      6
  ) {
    throw new AdminDatesError(
      'weekStartsOn must be between 0 and 6.',
      {
        code:
          'INVALID_WEEK_START',
      },
    );
  }

  const offset =
    (
      day -
      normalizedStart +
      7
    ) % 7;

  return addDays(
    date,
    -offset,
  );
}

function endOfWeek(
  value =
    new Date(),
  options = {},
) {
  return endOfDay(
    addDays(
      startOfWeek(
        value,
        options,
      ),
      6,
    ),
  );
}

function startOfMonth(
  value =
    new Date(),
) {
  const date =
    toDate(
      value,
    );

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      1,
      0,
      0,
      0,
      0,
    ),
  );
}

function endOfMonth(
  value =
    new Date(),
) {
  const date =
    toDate(
      value,
    );

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() +
        1,
      0,
      23,
      59,
      59,
      999,
    ),
  );
}

function startOfQuarter(
  value =
    new Date(),
) {
  const date =
    toDate(
      value,
    );

  const quarter =
    Math.floor(
      date.getUTCMonth() /
        3,
    );

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      quarter *
        3,
      1,
      0,
      0,
      0,
      0,
    ),
  );
}

function endOfQuarter(
  value =
    new Date(),
) {
  return new Date(
    addMonths(
      startOfQuarter(
        value,
      ),
      3,
    ).getTime() -
      1,
  );
}

function startOfYear(
  value =
    new Date(),
) {
  const date =
    toDate(
      value,
    );

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      0,
      1,
      0,
      0,
      0,
      0,
    ),
  );
}

function endOfYear(
  value =
    new Date(),
) {
  return new Date(
    Date.UTC(
      toDate(
        value,
      ).getUTCFullYear(),
      11,
      31,
      23,
      59,
      59,
      999,
    ),
  );
}

/**
 * ============================================================================
 * TIMEZONE VALIDATION
 * ============================================================================
 */

function assertTimeZone(
  timeZone =
    DEFAULT_TIME_ZONE,
) {
  const normalized =
    normalizeString(
      timeZone,
      DEFAULT_TIME_ZONE,
    );

  try {
    new Intl.DateTimeFormat(
      DEFAULT_LOCALE,
      {
        timeZone:
          normalized,
      },
    ).format();

    return normalized;
  } catch (error) {
    throw new AdminDatesError(
      `Unsupported IANA time zone: ${normalized}.`,
      {
        code:
          'INVALID_TIME_ZONE',

        details: {
          timeZone:
            normalized,
        },

        cause:
          error,
      },
    );
  }
}

/**
 * ============================================================================
 * TIMEZONE PARTS
 * ============================================================================
 */

function getTimeZoneParts(
  value =
    new Date(),
  timeZone =
    DEFAULT_TIME_ZONE,
) {
  const date =
    toDate(
      value,
    );

  const zone =
    assertTimeZone(
      timeZone,
    );

  const formatter =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone:
          zone,

        calendar:
          'iso8601',

        numberingSystem:
          'latn',

        year:
          'numeric',

        month:
          '2-digit',

        day:
          '2-digit',

        hour:
          '2-digit',

        minute:
          '2-digit',

        second:
          '2-digit',

        hourCycle:
          'h23',
      },
    );

  const values =
    formatter.formatToParts(
      date,
    );

  const map =
    {};

  for (
    const part of
    values
  ) {
    if (
      part.type !==
      'literal'
    ) {
      map[part.type] =
        part.value;
    }
  }

  return {
    year:
      Number(
        map.year,
      ),

    month:
      Number(
        map.month,
      ),

    day:
      Number(
        map.day,
      ),

    hour:
      Number(
        map.hour,
      ),

    minute:
      Number(
        map.minute,
      ),

    second:
      Number(
        map.second,
      ),

    timeZone:
      zone,
  };
}

/**
 * ============================================================================
 * TIMEZONE OFFSET
 * ============================================================================
 */

function getTimeZoneOffsetMinutes(
  value =
    new Date(),
  timeZone =
    DEFAULT_TIME_ZONE,
) {
  const date =
    toDate(
      value,
    );

  const zone =
    assertTimeZone(
      timeZone,
    );

  const parts =
    getTimeZoneParts(
      date,
      zone,
    );

  const asUtc =
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );

  return (
    asUtc -
    date.getTime()
  ) /
    60000;
}

/**
 * ============================================================================
 * TIMEZONE LOCAL -> UTC
 * ============================================================================
 *
 * Converts a local calendar representation to the corresponding UTC instant.
 *
 * This helper is intended primarily for calendar-boundary calculations and
 * reporting windows.
 * ============================================================================
 */

function zonedLocalToUtc(
  {
    year,
    month,
    day,
    hour =
      0,
    minute =
      0,
    second =
      0,
    millisecond =
      0,
  },
  timeZone =
    DEFAULT_TIME_ZONE,
) {
  const zone =
    assertTimeZone(
      timeZone,
    );

  if (
    !Number.isInteger(
      year,
    ) ||
    !Number.isInteger(
      month,
    ) ||
    !Number.isInteger(
      day,
    )
  ) {
    throw new AdminDatesError(
      'Invalid local calendar components.',
      {
        code:
          'INVALID_LOCAL_DATE_COMPONENTS',
      },
    );
  }

  /**
   * Initial UTC guess.
   *
   * The offset is resolved iteratively because the local timestamp may cross
   * a daylight-saving transition in zones that observe DST.
   */
  let utcGuess =
    Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute,
      second,
      millisecond,
    );

  for (
    let iteration = 0;
    iteration < 3;
    iteration += 1
  ) {
    const offset =
      getTimeZoneOffsetMinutes(
        new Date(
          utcGuess,
        ),
        zone,
      );

    const nextGuess =
      Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute,
        second,
        millisecond,
      ) -
      offset *
        60000;

    if (
      nextGuess ===
      utcGuess
    ) {
      break;
    }

    utcGuess =
      nextGuess;
  }

  return new Date(
    utcGuess,
  );
}

/**
 * ============================================================================
 * TIMEZONE-AWARE DAY BOUNDARIES
 * ============================================================================
 */

function startOfDayInTimeZone(
  value =
    new Date(),
  timeZone =
    DEFAULT_TIME_ZONE,
) {
  const parts =
    getTimeZoneParts(
      value,
      timeZone,
    );

  return zonedLocalToUtc(
    {
      year:
        parts.year,

      month:
        parts.month,

      day:
        parts.day,

      hour:
        0,

      minute:
        0,

      second:
        0,

      millisecond:
        0,
    },
    parts.timeZone,
  );
}

function endOfDayInTimeZone(
  value =
    new Date(),
  timeZone =
    DEFAULT_TIME_ZONE,
) {
  return new Date(
    startOfDayInTimeZone(
      value,
      timeZone,
    ).getTime() +
      DAY_MS -
      1,
  );
}

function startOfMonthInTimeZone(
  value =
    new Date(),
  timeZone =
    DEFAULT_TIME_ZONE,
) {
  const parts =
    getTimeZoneParts(
      value,
      timeZone,
    );

  return zonedLocalToUtc(
    {
      year:
        parts.year,

      month:
        parts.month,

      day:
        1,
    },
    parts.timeZone,
  );
}

function endOfMonthInTimeZone(
  value =
    new Date(),
  timeZone =
    DEFAULT_TIME_ZONE,
) {
  const start =
    startOfMonthInTimeZone(
      value,
      timeZone,
    );

  const next =
    addMonths(
      start,
      1,
    );

  return new Date(
    next.getTime() -
      1,
  );
}

function startOfQuarterInTimeZone(
  value =
    new Date(),
  timeZone =
    DEFAULT_TIME_ZONE,
) {
  const parts =
    getTimeZoneParts(
      value,
      timeZone,
    );

  const quarterStartMonth =
    Math.floor(
      (
        parts.month -
        1
      ) /
        3,
    ) *
      3 +
    1;

  return zonedLocalToUtc(
    {
      year:
        parts.year,

      month:
        quarterStartMonth,

      day:
        1,
    },
    parts.timeZone,
  );
}

function endOfQuarterInTimeZone(
  value =
    new Date(),
  timeZone =
    DEFAULT_TIME_ZONE,
) {
  const next =
    addMonths(
      startOfQuarterInTimeZone(
        value,
        timeZone,
      ),
      3,
    );

  return new Date(
    next.getTime() -
      1,
  );
}

function startOfYearInTimeZone(
  value =
    new Date(),
  timeZone =
    DEFAULT_TIME_ZONE,
) {
  const parts =
    getTimeZoneParts(
      value,
      timeZone,
    );

  return zonedLocalToUtc(
    {
      year:
        parts.year,

      month:
        1,

      day:
        1,
    },
    parts.timeZone,
  );
}

function endOfYearInTimeZone(
  value =
    new Date(),
  timeZone =
    DEFAULT_TIME_ZONE,
) {
  const next =
    addYears(
      startOfYearInTimeZone(
        value,
        timeZone,
      ),
      1,
    );

  return new Date(
    next.getTime() -
      1,
  );
}

/**
 * ============================================================================
 * REPORTING PERIODS
 * ============================================================================
 */

function getReportingPeriod(
  {
    period =
      'day',

    date =
      new Date(),

    timeZone =
      DEFAULT_TIME_ZONE,
  } = {},
) {
  const normalizedPeriod =
    normalizeString(
      period,
    )?.toLowerCase();

  const zone =
    assertTimeZone(
      timeZone,
    );

  let start;
  let end;

  switch (
    normalizedPeriod
  ) {
    case 'day':
      start =
        startOfDayInTimeZone(
          date,
          zone,
        );

      end =
        endOfDayInTimeZone(
          date,
          zone,
        );
      break;

    case 'week':
      start =
        startOfWeekInTimeZone(
          date,
          zone,
        );

      end =
        endOfWeekInTimeZone(
          date,
          zone,
        );
      break;

    case 'month':
      start =
        startOfMonthInTimeZone(
          date,
          zone,
        );

      end =
        endOfMonthInTimeZone(
          date,
          zone,
        );
      break;

    case 'quarter':
      start =
        startOfQuarterInTimeZone(
          date,
          zone,
        );

      end =
        endOfQuarterInTimeZone(
          date,
          zone,
        );
      break;

    case 'year':
      start =
        startOfYearInTimeZone(
          date,
          zone,
        );

      end =
        endOfYearInTimeZone(
          date,
          zone,
        );
      break;

    default:
      throw new AdminDatesError(
        `Unsupported reporting period: ${period}.`,
        {
          code:
            'INVALID_REPORTING_PERIOD',

          details: {
            allowed: [
              'day',
              'week',
              'month',
              'quarter',
              'year',
            ],
          },
        },
      );
  }

  return {
    period:
      normalizedPeriod,

    timeZone:
      zone,

    start,

    end,

    startIso:
      start.toISOString(),

    endIso:
      end.toISOString(),

    durationMs:
      end.getTime() -
      start.getTime() +
      1,

    durationDays:
      (
        end.getTime() -
        start.getTime() +
        1
      ) /
      DAY_MS,
  };
}

/**
 * ============================================================================
 * REPORTING PERIOD HELPERS
 * ============================================================================
 */

function getCurrentDayPeriod(
  timeZone =
    DEFAULT_TIME_ZONE,
  now =
    new Date(),
) {
  return getReportingPeriod({
    period:
      'day',

    date:
      now,

    timeZone,
  });
}

function getCurrentWeekPeriod(
  timeZone =
    DEFAULT_TIME_ZONE,
  now =
    new Date(),
) {
  return getReportingPeriod({
    period:
      'week',

    date:
      now,

    timeZone,
  });
}

function getCurrentMonthPeriod(
  timeZone =
    DEFAULT_TIME_ZONE,
  now =
    new Date(),
) {
  return getReportingPeriod({
    period:
      'month',

    date:
      now,

    timeZone,
  });
}

function getCurrentQuarterPeriod(
  timeZone =
    DEFAULT_TIME_ZONE,
  now =
    new Date(),
) {
  return getReportingPeriod({
    period:
      'quarter',

    date:
      now,

    timeZone,
  });
}

function getCurrentYearPeriod(
  timeZone =
    DEFAULT_TIME_ZONE,
  now =
    new Date(),
) {
  return getReportingPeriod({
    period:
      'year',

    date:
      now,

    timeZone,
  });
}

/**
 * ============================================================================
 * TIMEZONE-AWARE WEEK
 * ============================================================================
 */

function startOfWeekInTimeZone(
  value =
    new Date(),
  timeZone =
    DEFAULT_TIME_ZONE,
  {
    weekStartsOn =
      1,
  } = {},
) {
  const parts =
    getTimeZoneParts(
      value,
      timeZone,
    );

  const localStart =
    zonedLocalToUtc(
      {
        year:
          parts.year,

        month:
          parts.month,

        day:
          parts.day,
      },
      parts.timeZone,
    );

  const localDay =
    new Date(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
      ),
    ).getUTCDay();

  const offset =
    (
      localDay -
      weekStartsOn +
      7
    ) % 7;

  const target =
    addDays(
      localStart,
      -offset,
    );

  return startOfDayInTimeZone(
    target,
    timeZone,
  );
}

function endOfWeekInTimeZone(
  value =
    new Date(),
  timeZone =
    DEFAULT_TIME_ZONE,
  options = {},
) {
  return endOfDayInTimeZone(
    addDays(
      startOfWeekInTimeZone(
        value,
        timeZone,
        options,
      ),
      6,
    ),
    timeZone,
  );
}

/**
 * ============================================================================
 * ROLLING PERIODS
 * ============================================================================
 */

function getRollingPeriod(
  {
    end =
      new Date(),

    days =
      30,

    includeCurrentDay =
      true,
  } = {},
) {
  const normalizedDays =
    Number(
      days,
    );

  if (
    !Number.isInteger(
      normalizedDays,
    ) ||
    normalizedDays <
      1 ||
    normalizedDays >
      MAX_RANGE_DAYS
  ) {
    throw new AdminDatesError(
      `days must be between 1 and ${MAX_RANGE_DAYS}.`,
      {
        code:
          'INVALID_ROLLING_PERIOD',
      },
    );
  }

  const resolvedEnd =
    toDate(
      end,
    );

  const resolvedStart =
    includeCurrentDay
      ? startOfDay(
          addDays(
            resolvedEnd,
            -(
              normalizedDays -
              1
            ),
          ),
        )
      : addDays(
          resolvedEnd,
          -normalizedDays,
        );

  return {
    start:
      resolvedStart,

    end:
      resolvedEnd,

    startIso:
      resolvedStart.toISOString(),

    endIso:
      resolvedEnd.toISOString(),

    days:
      normalizedDays,
  };
}

/**
 * ============================================================================
 * DATE RANGE VALIDATION
 * ============================================================================
 */

function validateRange(
  {
    from,
    to,
  },
  {
    fieldFrom =
      'from',

    fieldTo =
      'to',

    maxDays =
      MAX_RANGE_DAYS,

    allowFuture =
      true,

    allowEqual =
      true,
  } = {},
) {
  const start =
    toDate(
      from,
      {
        field:
          fieldFrom,

        required:
          true,
      },
    );

  const end =
    toDate(
      to,
      {
        field:
          fieldTo,

        required:
          true,
      },
    );

  if (
    start.getTime() >
    end.getTime()
  ) {
    throw new AdminDatesError(
      `${fieldFrom} cannot be later than ${fieldTo}.`,
      {
        code:
          'INVALID_DATE_RANGE',

        details: {
          from:
            start.toISOString(),

          to:
            end.toISOString(),
        },
      },
    );
  }

  if (
    !allowEqual &&
    start.getTime() ===
      end.getTime()
  ) {
    throw new AdminDatesError(
      `${fieldFrom} and ${fieldTo} must be different.`,
      {
        code:
          'EQUAL_DATE_RANGE_NOT_ALLOWED',
      },
    );
  }

  const rangeDays =
    (
      end.getTime() -
      start.getTime()
    ) /
    DAY_MS;

  if (
    rangeDays >
    maxDays
  ) {
    throw new AdminDatesError(
      `Date range exceeds the maximum allowed period of ${maxDays} days.`,
      {
        code:
          'DATE_RANGE_TOO_LARGE',

        details: {
          maxDays,
          rangeDays,
        },
      },
    );
  }

  if (
    !allowFuture
  ) {
    const now =
      new Date();

    if (
      start >
      now
    ) {
      throw new AdminDatesError(
        `${fieldFrom} cannot be in the future.`,
        {
          code:
            'FUTURE_DATE_NOT_ALLOWED',

          field:
            fieldFrom,
        },
      );
    }

    if (
      end >
      now
    ) {
      throw new AdminDatesError(
        `${fieldTo} cannot be in the future.`,
        {
          code:
            'FUTURE_DATE_NOT_ALLOWED',

          field:
            fieldTo,
        },
      );
    }
  }

  return {
    from:
      start,

    to:
      end,

    fromIso:
      start.toISOString(),

    toIso:
      end.toISOString(),

    rangeDays,
  };
}

function rangeFromDays(
  {
    days =
      30,

    end =
      new Date(),

    includeCurrentDay =
      true,

    maxDays =
      MAX_RANGE_DAYS,
  } = {},
) {
  const period =
    getRollingPeriod({
      end,

      days,

      includeCurrentDay,
    });

  if (
    period.days >
    maxDays
  ) {
    throw new AdminDatesError(
      'Requested date range exceeds the supported maximum.',
      {
        code:
          'DATE_RANGE_TOO_LARGE',
      },
    );
  }

  return {
    from:
      period.start,

    to:
      period.end,

    fromIso:
      period.startIso,

    toIso:
      period.endIso,

    rangeDays:
      period.days,
  };
}

/**
 * ============================================================================
 * PERIOD PRESETS
 * ============================================================================
 */

function previousPeriod(
  {
    period =
      'month',

    date =
      new Date(),

    timeZone =
      DEFAULT_TIME_ZONE,
  } = {},
) {
  const current =
    getReportingPeriod({
      period,

      date,

      timeZone,
    });

  let reference;

  switch (
    period
  ) {
    case 'day':
      reference =
        addDays(
          current.start,
          -1,
        );
      break;

    case 'week':
      reference =
        addDays(
          current.start,
          -7,
        );
      break;

    case 'month':
      reference =
        addMonths(
          current.start,
          -1,
        );
      break;

    case 'quarter':
      reference =
        addMonths(
          current.start,
          -3,
        );
      break;

    case 'year':
      reference =
        addYears(
          current.start,
          -1,
        );
      break;

    default:
      throw new AdminDatesError(
        `Unsupported reporting period: ${period}.`,
        {
          code:
            'INVALID_REPORTING_PERIOD',
        },
      );
  }

  return getReportingPeriod({
    period,

    date:
      reference,

    timeZone,
  });
}

function nextPeriod(
  {
    period =
      'month',

    date =
      new Date(),

    timeZone =
      DEFAULT_TIME_ZONE,
  } = {},
) {
  const current =
    getReportingPeriod({
      period,

      date,

      timeZone,
    });

  let reference;

  switch (
    period
  ) {
    case 'day':
      reference =
        addDays(
          current.end,
          1,
        );
      break;

    case 'week':
      reference =
        addDays(
          current.end,
          1,
        );
      break;

    case 'month':
      reference =
        addDays(
          current.end,
          1,
        );
      break;

    case 'quarter':
      reference =
        addDays(
          current.end,
          1,
        );
      break;

    case 'year':
      reference =
        addDays(
          current.end,
          1,
        );
      break;

    default:
      throw new AdminDatesError(
        `Unsupported reporting period: ${period}.`,
        {
          code:
            'INVALID_REPORTING_PERIOD',
        },
      );
  }

  return getReportingPeriod({
    period,

    date:
      reference,

    timeZone,
  });
}

/**
 * ============================================================================
 * AGEING HELPERS
 * ============================================================================
 *
 * Useful for:
 *
 * - loan arrears
 * - audit age
 * - pending review age
 * - support SLA age
 * - dormant-user analysis
 * ============================================================================
 */

function ageInDays(
  from,
  {
    asOf =
      new Date(),
  } = {},
) {
  const start =
    toDate(
      from,
    );

  const end =
    toDate(
      asOf,
    );

  if (
    end <
    start
  ) {
    return 0;
  }

  return Math.floor(
    (
      end.getTime() -
      start.getTime()
    ) /
      DAY_MS,
  );
}

function ageBucket(
  from,
  {
    asOf =
      new Date(),
  } = {},
) {
  const days =
    ageInDays(
      from,
      {
        asOf,
      },
    );

  if (
    days <=
    0
  ) {
    return 'CURRENT';
  }

  if (
    days <=
    30
  ) {
    return '1_30_DAYS';
  }

  if (
    days <=
    60
  ) {
    return '31_60_DAYS';
  }

  if (
    days <=
    90
  ) {
    return '61_90_DAYS';
  }

  if (
    days <=
    180
  ) {
    return '91_180_DAYS';
  }

  if (
    days <=
    365
  ) {
    return '181_365_DAYS';
  }

  return '365_PLUS_DAYS';
}

/**
 * ============================================================================
 * BUSINESS-DAY HELPERS
 * ============================================================================
 */

function isWeekend(
  value,
) {
  const date =
    toDate(
      value,
    );

  const day =
    date.getUTCDay();

  return (
    day ===
      0 ||
    day ===
      6
  );
}

function isWeekday(
  value,
) {
  return !isWeekend(
    value,
  );
}

function addBusinessDays(
  value,
  amount,
) {
  let date =
    toDate(
      value,
    );

  let remaining =
    Number(
      amount,
    );

  if (
    !Number.isInteger(
      remaining,
    )
  ) {
    throw new AdminDatesError(
      'Business-day amount must be an integer.',
      {
        code:
          'INVALID_BUSINESS_DAY_OFFSET',
      },
    );
  }

  const direction =
    remaining >=
    0
      ? 1
      : -1;

  remaining =
    Math.abs(
      remaining,
    );

  while (
    remaining >
    0
  ) {
    date =
      addDays(
        date,
        direction,
      );

    if (
      isWeekday(
        date,
      )
    ) {
      remaining -= 1;
    }
  }

  return date;
}

/**
 * ============================================================================
 * CALENDAR HELPERS
 * ============================================================================
 */

function daysInMonth(
  year,
  month,
) {
  const normalizedYear =
    Number(year);

  const normalizedMonth =
    Number(month);

  if (
    !Number.isInteger(
      normalizedYear,
    ) ||
    !Number.isInteger(
      normalizedMonth,
    ) ||
    normalizedMonth <
      1 ||
    normalizedMonth >
      12
  ) {
    throw new AdminDatesError(
      'Invalid year/month.',
      {
        code:
          'INVALID_CALENDAR_MONTH',
      },
    );
  }

  return new Date(
    Date.UTC(
      normalizedYear,
      normalizedMonth,
      0,
    ),
  ).getUTCDate();
}

function daysInYear(
  year,
) {
  const normalizedYear =
    Number(year);

  if (
    !Number.isInteger(
      normalizedYear,
    )
  ) {
    throw new AdminDatesError(
      'Invalid year.',
      {
        code:
          'INVALID_CALENDAR_YEAR',
      },
    );
  }

  return isLeapYear(
    normalizedYear,
  )
    ? 366
    : 365;
}

function isLeapYear(
  year,
) {
  const normalizedYear =
    Number(year);

  if (
    !Number.isInteger(
      normalizedYear,
    )
  ) {
    throw new AdminDatesError(
      'Invalid year.',
      {
        code:
          'INVALID_CALENDAR_YEAR',
      },
    );
  }

  return (
    normalizedYear %
      4 ===
      0 &&
    (
      normalizedYear %
        100 !==
        0 ||
      normalizedYear %
        400 ===
        0
    )
  );
}

/**
 * ============================================================================
 * RANGE OVERLAP
 * ============================================================================
 */

function rangesOverlap(
  firstRange,
  secondRange,
  {
    inclusive =
      true,
  } = {},
) {
  const first =
    validateRange(
      firstRange,
    );

  const second =
    validateRange(
      secondRange,
    );

  if (
    inclusive
  ) {
    return !(
      first.to <
        second.from ||
      second.to <
        first.from
    );
  }

  return !(
    first.to <=
      second.from ||
    second.to <=
      first.from
  );
}

/**
 * ============================================================================
 * RANGE CONTAINS
 * ============================================================================
 */

function rangeContains(
  range,
  value,
  {
    inclusive =
      true,
  } = {},
) {
  const normalized =
    validateRange(
      range,
    );

  const date =
    toDate(
      value,
    );

  if (
    inclusive
  ) {
    return (
      date >=
        normalized.from &&
      date <=
        normalized.to
    );
  }

  return (
    date >
      normalized.from &&
    date <
      normalized.to
  );
}

/**
 * ============================================================================
 * ADMIN REPORT QUERY RANGE
 * ============================================================================
 */

function buildAdminReportRange(
  {
    from =
      null,

    to =
      null,

    days =
      null,

    period =
      null,

    date =
      new Date(),

    timeZone =
      DEFAULT_TIME_ZONE,

    allowFuture =
      false,

    maxDays =
      MAX_RANGE_DAYS,
  } = {},
) {
  if (
    period
  ) {
    const reportingPeriod =
      getReportingPeriod({
        period,

        date,

        timeZone,
      });

    if (
      !allowFuture &&
      reportingPeriod.end >
        new Date()
    ) {
      throw new AdminDatesError(
        'The requested reporting period extends into the future.',
        {
          code:
            'FUTURE_PERIOD_NOT_ALLOWED',
        },
      );
    }

    return {
      from:
        reportingPeriod.start,

      to:
        reportingPeriod.end,

      fromIso:
        reportingPeriod.startIso,

      toIso:
        reportingPeriod.endIso,

      period:
        reportingPeriod.period,

      timeZone:
        reportingPeriod.timeZone,
    };
  }

  if (
    from !==
      null ||
    to !==
      null
  ) {
    return validateRange(
      {
        from,
        to,
      },
      {
        maxDays,

        allowFuture,
      },
    );
  }

  if (
    days !==
      null &&
    days !==
      undefined
  ) {
    return rangeFromDays({
      days,

      end:
        new Date(),

      includeCurrentDay:
        true,

      maxDays,
    });
  }

  /**
   * Default: current reporting day in the specified timezone.
   */
  const current =
    getCurrentDayPeriod(
      timeZone,
    );

  if (
    !allowFuture &&
    current.end >
      new Date()
  ) {
    return {
      ...current,

      to:
        new Date(),

      toIso:
        new Date().toISOString(),
    };
  }

  return current;
}

/**
 * ============================================================================
 * JSON / DATABASE SERIALIZATION
 * ============================================================================
 */

function serializeForDatabase(
  value,
  {
    nullable =
      false,
  } = {},
) {
  if (
    value ===
      null ||
    value ===
      undefined
  ) {
    return nullable
      ? null
      : undefined;
  }

  return toISOString(
    value,
  );
}

function serializeRange(
  range,
) {
  const normalized =
    validateRange(
      range,
    );

  return {
    from:
      normalized.fromIso,

    to:
      normalized.toIso,
  };
}

/**
 * ============================================================================
 * NOW
 * ============================================================================
 */

function now() {
  return new Date();
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * ============================================================================
 * CAPABILITIES
 * ============================================================================
 */

function getCapabilities() {
  return {
    utility:
      UTILITY_NAME,

    version:
      UTILITY_VERSION,

    application:
      APPLICATION_NAME,

    features: {
      strictIsoParsing:
        true,

      utcNormalization:
        true,

      utcBoundaries:
        true,

      timezoneBoundaries:
        true,

      reportingPeriods:
        true,

      rollingPeriods:
        true,

      dateArithmetic:
        true,

      dateComparison:
        true,

      ageing:
        true,

      businessDays:
        true,

      rangeValidation:
        true,

      rangeOverlap:
        true,

      databaseSerialization:
        true,
    },

    defaults: {
      timeZone:
        DEFAULT_TIME_ZONE,

      maxRangeDays:
        MAX_RANGE_DAYS,
    },

    timestamp:
      new Date(),
  };
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

const AdminDates =
  Object.freeze({
    name:
      UTILITY_NAME,

    version:
      UTILITY_VERSION,

    application:
      APPLICATION_NAME,

    constants: {
      DAY_MS,

      WEEK_MS,

      DEFAULT_TIME_ZONE,

      MAX_RANGE_DAYS,
    },

    /**
     * Parsing / serialization
     */
    toDate,

    toISOString,

    toTimestamp,

    cloneDate,

    isIsoDateString,

    serializeForDatabase,

    serializeRange,

    /**
     * Comparison
     */
    compare,

    isBefore,

    isAfter,

    isEqual,

    minDate,

    maxDate,

    /**
     * Difference
     */
    differenceMs,

    differenceSeconds,

    differenceMinutes,

    differenceHours,

    differenceDays,

    elapsedDays,

    /**
     * Arithmetic
     */
    addMilliseconds,

    addSeconds,

    addMinutes,

    addHours,

    addDays,

    addWeeks,

    addMonths,

    addYears,

    /**
     * UTC boundaries
     */
    startOfDay,

    endOfDay,

    startOfWeek,

    endOfWeek,

    startOfMonth,

    endOfMonth,

    startOfQuarter,

    endOfQuarter,

    startOfYear,

    endOfYear,

    /**
     * Time zones
     */
    assertTimeZone,

    getTimeZoneParts,

    getTimeZoneOffsetMinutes,

    zonedLocalToUtc,

    startOfDayInTimeZone,

    endOfDayInTimeZone,

    startOfWeekInTimeZone,

    endOfWeekInTimeZone,

    startOfMonthInTimeZone,

    endOfMonthInTimeZone,

    startOfQuarterInTimeZone,

    endOfQuarterInTimeZone,

    startOfYearInTimeZone,

    endOfYearInTimeZone,

    /**
     * Reporting
     */
    getReportingPeriod,

    getCurrentDayPeriod,

    getCurrentWeekPeriod,

    getCurrentMonthPeriod,

    getCurrentQuarterPeriod,

    getCurrentYearPeriod,

    previousPeriod,

    nextPeriod,

    getRollingPeriod,

    buildAdminReportRange,

    /**
     * Ranges
     */
    validateRange,

    rangeFromDays,

    rangesOverlap,

    rangeContains,

    /**
     * Ageing
     */
    ageInDays,

    ageBucket,

    /**
     * Business days
     */
    isWeekend,

    isWeekday,

    addBusinessDays,

    /**
     * Calendar
     */
    daysInMonth,

    daysInYear,

    isLeapYear,

    /**
     * Current time
     */
    now,

    nowIso,

    /**
     * Diagnostics
     */
    getCapabilities,
  });

module.exports =
  AdminDates;

module.exports.AdminDates =
  AdminDates;

module.exports.AdminDatesError =
  AdminDatesError;

Object.assign(
  module.exports,
  AdminDates,
);