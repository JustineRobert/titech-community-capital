'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/charts/MemberGrowthChart.jsx
 *
 * Purpose:
 *   Enterprise-grade member growth and membership activity analytics for
 *   TITech dashboards, institutional reporting, group reporting and executive
 *   operational views.
 *
 * Responsibilities:
 *   - Present member population growth over time.
 *   - Present new, active, inactive and churned/deactivated populations when
 *     supplied by the authoritative reporting API.
 *   - Normalize common backend/API response envelopes and field aliases.
 *   - Safely handle numeric strings, Decimal128-like values and timestamps.
 *   - Provide deterministic loading, error and empty states.
 *   - Provide accessible labels and reduced-motion-aware chart behavior.
 *   - Support both historical snapshots and member-record fallback aggregation.
 *
 * Membership/data integrity:
 *   - This component is presentation-only.
 *   - It MUST NOT create, update, delete, deactivate, reactivate or otherwise
 *     mutate member records.
 *   - It MUST NOT determine tenant membership or authorization.
 *   - It MUST NOT treat locally inferred counts as authoritative platform data.
 *   - Backend reporting services remain authoritative for member counts,
 *     tenant boundaries, eligibility, lifecycle state and audit history.
 *   - Client-side trend deltas and ratios are display analytics only.
 *
 * Supported concepts:
 *   - totalMembers
 *   - newMembers
 *   - activeMembers
 *   - inactiveMembers
 *   - suspendedMembers
 *   - deactivatedMembers
 *   - churnedMembers
 *
 * Typical usage:
 *
 *   import MemberGrowthChart from './charts/MemberGrowthChart.jsx';
 *
 *   <MemberGrowthChart
 *     data={memberGrowthResponse}
 *     locale="en-UG"
 *   />
 *
 * ============================================================================
 */

import React, {
  memo,
  useId,
  useMemo,
  useState,
} from 'react';

import {
  Area,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/* ============================================================================
 * Constants
 * ========================================================================== */

const DEFAULT_LOCALE = 'en-UG';
const DEFAULT_HEIGHT = 360;
const DEFAULT_PAGE_SIZE = 12;

export const MEMBER_SERIES = Object.freeze({
  TOTAL: 'totalMembers',
  NEW: 'newMembers',
  ACTIVE: 'activeMembers',
  INACTIVE: 'inactiveMembers',
  SUSPENDED: 'suspendedMembers',
  DEACTIVATED: 'deactivatedMembers',
  CHURNED: 'churnedMembers',
});

export const MEMBER_SERIES_LABELS = Object.freeze({
  [MEMBER_SERIES.TOTAL]: 'Total Members',
  [MEMBER_SERIES.NEW]: 'New Members',
  [MEMBER_SERIES.ACTIVE]: 'Active Members',
  [MEMBER_SERIES.INACTIVE]: 'Inactive Members',
  [MEMBER_SERIES.SUSPENDED]: 'Suspended Members',
  [MEMBER_SERIES.DEACTIVATED]: 'Deactivated Members',
  [MEMBER_SERIES.CHURNED]: 'Churned Members',
});

const CSS = Object.freeze({
  primary: 'var(--titech-primary, #146c94)',
  primarySoft: 'var(--titech-primary-soft, rgba(20, 108, 148, 0.12))',
  surface: 'var(--titech-surface, var(--color-white))',
  surfaceMuted: 'var(--titech-surface-muted, #f7f9fb)',
  border: 'var(--titech-border, #d9e1e8)',
  borderStrong: 'var(--titech-border-strong, #b8c5d0)',
  textPrimary: 'var(--titech-text-primary, #17212b)',
  textSecondary: 'var(--titech-text-secondary, #637381)',
  success: 'var(--titech-success, #1f8f55)',
  warning: 'var(--titech-warning, #b7791f)',
  danger: 'var(--titech-danger, #c53a3a)',
  chart1: 'var(--titech-chart-series-1, #146c94)',
  chart2: 'var(--titech-chart-series-2, #4f8a8b)',
  chart3: 'var(--titech-chart-series-3, #b7791f)',
  chart4: 'var(--titech-chart-series-4, #c53a3a)',
  chart5: 'var(--titech-chart-series-5, #6b7280)',
  chart6: 'var(--titech-chart-series-6, #7c5aa6)',
});

const SUPPORTED_SERIES = Object.freeze([
  MEMBER_SERIES.TOTAL,
  MEMBER_SERIES.NEW,
  MEMBER_SERIES.ACTIVE,
  MEMBER_SERIES.INACTIVE,
  MEMBER_SERIES.SUSPENDED,
  MEMBER_SERIES.DEACTIVATED,
  MEMBER_SERIES.CHURNED,
]);

const SERIES_COLORS = Object.freeze({
  [MEMBER_SERIES.TOTAL]: CSS.chart1,
  [MEMBER_SERIES.NEW]: CSS.chart2,
  [MEMBER_SERIES.ACTIVE]: CSS.chart3,
  [MEMBER_SERIES.INACTIVE]: CSS.chart5,
  [MEMBER_SERIES.SUSPENDED]: CSS.chart4,
  [MEMBER_SERIES.DEACTIVATED]: CSS.chart4,
  [MEMBER_SERIES.CHURNED]: CSS.chart6,
});

const NUMBER_FORMATTER_CACHE = new Map();

/* ============================================================================
 * Generic helpers
 * ========================================================================== */

/**
 * Safely unwrap common API envelopes.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
function unwrapPayload(input) {
  if (!input || typeof input !== 'object') {
    return input;
  }

  if (
    'data' in input
    && input.data
    && typeof input.data === 'object'
  ) {
    return input.data;
  }

  if (
    'result' in input
    && input.result
    && typeof input.result === 'object'
  ) {
    return input.result;
  }

  if (
    'payload' in input
    && input.payload
    && typeof input.payload === 'object'
  ) {
    return input.payload;
  }

  if (
    'response' in input
    && input.response
    && typeof input.response === 'object'
  ) {
    return input.response;
  }

  return input;
}

/**
 * Normalize an unknown value into an array.
 *
 * @param {unknown} value
 * @returns {Array}
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Safely parse numeric values, including common Mongo/Decimal-like shapes.
 *
 * This function exists for display normalization only and is not an
 * accounting precision boundary.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function parseMemberNumber(value, fallback = 0) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'bigint') {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (typeof value === 'string') {
    const normalized = value
      .replace(/,/g, '')
      .trim();

    if (!normalized) {
      return fallback;
    }

    const parsed = Number(normalized);

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (typeof value === 'object') {
    const candidate =
      value.$numberDecimal
      ?? value.$numberLong
      ?? value.value
      ?? value.count
      ?? value.$number;

    if (candidate !== undefined) {
      return parseMemberNumber(candidate, fallback);
    }

    if (typeof value.toString === 'function') {
      const text = value.toString();

      if (text !== '[object Object]') {
        return parseMemberNumber(text, fallback);
      }
    }
  }

  return fallback;
}

/**
 * Use the first meaningful alias.
 *
 * @param {object} object
 * @param {string[]} aliases
 * @param {unknown} fallback
 * @returns {unknown}
 */
function firstDefined(object, aliases, fallback = undefined) {
  for (const alias of aliases) {
    if (
      object
      && Object.prototype.hasOwnProperty.call(object, alias)
      && object[alias] !== null
      && object[alias] !== undefined
    ) {
      return object[alias];
    }
  }

  return fallback;
}

/**
 * Clamp a numeric value to a non-negative member count.
 *
 * @param {unknown} value
 * @returns {number}
 */
function normalizeCount(value) {
  return Math.max(
    0,
    Math.round(parseMemberNumber(value)),
  );
}

/**
 * Convert date-like input into a timestamp.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    const result = value.getTime();

    return Number.isFinite(result) ? result : null;
  }

  if (
    typeof value === 'number'
    || typeof value === 'bigint'
  ) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return null;
    }

    return numeric < 10000000000
      ? numeric * 1000
      : numeric;
  }

  const numericString = String(value).trim();

  if (/^\d{10,13}$/.test(numericString)) {
    const numeric = Number(numericString);

    return numeric < 10000000000
      ? numeric * 1000
      : numeric;
  }

  const parsed = Date.parse(numericString);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

/**
 * Format a reporting period for the selected locale.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatMemberPeriod(
  value,
  locale = DEFAULT_LOCALE,
) {
  const timestamp = toTimestamp(value);

  if (timestamp === null) {
    const text = String(value ?? '').trim();

    return text || 'Unknown';
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
}

/**
 * Cached number formatter.
 *
 * @param {string} locale
 * @param {'number'|'percent'} style
 * @returns {Intl.NumberFormat}
 */
function getNumberFormatter(
  locale,
  style,
) {
  const key = `${locale}|${style}`;

  if (NUMBER_FORMATTER_CACHE.has(key)) {
    return NUMBER_FORMATTER_CACHE.get(key);
  }

  const formatter =
    style === 'percent'
      ? new Intl.NumberFormat(locale, {
          style: 'percent',
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        })
      : new Intl.NumberFormat(locale, {
          maximumFractionDigits: 0,
        });

  NUMBER_FORMATTER_CACHE.set(
    key,
    formatter,
  );

  return formatter;
}

/**
 * Format an integer-like count.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatMemberCount(
  value,
  locale = DEFAULT_LOCALE,
) {
  return getNumberFormatter(
    locale,
    'number',
  ).format(normalizeCount(value));
}

/**
 * Format a ratio represented as 0..1.
 *
 * @param {unknown} value
 * @param {string} locale
 * @returns {string}
 */
export function formatMemberPercent(
  value,
  locale = DEFAULT_LOCALE,
) {
  return getNumberFormatter(
    locale,
    'percent',
  ).format(
    Math.max(
      0,
      parseMemberNumber(value),
    ),
  );
}

/**
 * Safe ratio helper.
 *
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
function safeRatio(numerator, denominator) {
  if (
    !Number.isFinite(numerator)
    || !Number.isFinite(denominator)
    || denominator <= 0
  ) {
    return 0;
  }

  return numerator / denominator;
}

/**
 * Build a stable DOM-safe identifier.
 *
 * @param {string} value
 * @returns {string}
 */
function safeDomId(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-');
}

/* ============================================================================
 * Series helpers
 * ========================================================================== */

/**
 * Determine whether a series contains meaningful values.
 *
 * @param {Array} rows
 * @param {string} key
 * @returns {boolean}
 */
function hasMeaningfulSeries(
  rows,
  key,
) {
  return rows.some(
    (row) =>
      Number.isFinite(
        parseMemberNumber(row?.[key], NaN),
      ),
  );
}

/**
 * Return a display label for a series.
 *
 * @param {string} key
 * @returns {string}
 */
export function getMemberSeriesLabel(key) {
  return (
    MEMBER_SERIES_LABELS[key]
    ?? 'Members'
  );
}

/**
 * Return a TITech brand token for a series.
 *
 * @param {string} key
 * @returns {string}
 */
function getSeriesColor(key) {
  return (
    SERIES_COLORS[key]
    ?? CSS.chart1
  );
}

/* ============================================================================
 * Normalization
 * ========================================================================== */

/**
 * Normalize one historical/snapshot row.
 *
 * @param {unknown} item
 * @param {number} index
 * @param {string} locale
 * @returns {object}
 */
function normalizeSnapshot(
  item,
  index,
  locale,
) {
  const source =
    item && typeof item === 'object'
      ? item
      : {};

  const period = firstDefined(
    source,
    [
      'period',
      'month',
      'date',
      'label',
      'reportingPeriod',
      'snapshotDate',
      'createdAt',
    ],
    `Period ${index + 1}`,
  );

  const totalMembers = normalizeCount(
    firstDefined(
      source,
      [
        'totalMembers',
        'memberCount',
        'members',
        'totalMemberCount',
        'total',
        'population',
      ],
      0,
    ),
  );

  const newMembers = normalizeCount(
    firstDefined(
      source,
      [
        'newMembers',
        'newMemberCount',
        'membersAdded',
        'newRegistrations',
        'registrations',
        'new',
      ],
      0,
    ),
  );

  const activeMembers = normalizeCount(
    firstDefined(
      source,
      [
        'activeMembers',
        'activeMemberCount',
        'active',
      ],
      0,
    ),
  );

  const inactiveMembers = normalizeCount(
    firstDefined(
      source,
      [
        'inactiveMembers',
        'inactiveMemberCount',
        'inactive',
      ],
      0,
    ),
  );

  const suspendedMembers = normalizeCount(
    firstDefined(
      source,
      [
        'suspendedMembers',
        'suspendedMemberCount',
        'suspended',
      ],
      0,
    ),
  );

  const deactivatedMembers = normalizeCount(
    firstDefined(
      source,
      [
        'deactivatedMembers',
        'deactivatedMemberCount',
        'deactivated',
        'removedMembers',
      ],
      0,
    ),
  );

  const churnedMembers = normalizeCount(
    firstDefined(
      source,
      [
        'churnedMembers',
        'churnCount',
        'memberChurn',
        'churned',
      ],
      0,
    ),
  );

  return {
    id: String(
      firstDefined(
        source,
        [
          'id',
          '_id',
          'periodKey',
          'key',
        ],
        `member-period-${index + 1}`,
      ),
    ),

    period,
    label: formatMemberPeriod(
      period,
      locale,
    ),

    totalMembers,
    newMembers,
    activeMembers,
    inactiveMembers,
    suspendedMembers,
    deactivatedMembers,
    churnedMembers,

    raw: source,
  };
}

/**
 * Normalize an individual member record for fallback aggregation.
 *
 * @param {unknown} item
 * @param {number} index
 * @returns {object}
 */
function normalizeMemberRecord(
  item,
  index,
) {
  const source =
    item && typeof item === 'object'
      ? item
      : {};

  const status = String(
    firstDefined(
      source,
      [
        'status',
        'memberStatus',
        'state',
        'lifecycleStatus',
      ],
      '',
    ),
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  const createdAt = firstDefined(
    source,
    [
      'createdAt',
      'registeredAt',
      'registrationDate',
      'joinedAt',
      'dateJoined',
      'date',
    ],
    null,
  );

  const isActive =
    status === 'active'
    || status === 'current'
    || status === 'enabled';

  const isInactive =
    status === 'inactive'
    || status === 'dormant';

  const isSuspended =
    status === 'suspended'
    || status === 'locked';

  const isDeactivated =
    status === 'deactivated'
    || status === 'disabled'
    || status === 'removed'
    || status === 'terminated';

  return {
    id: String(
      firstDefined(
        source,
        [
          'id',
          '_id',
          'memberId',
          'membershipId',
          'reference',
        ],
        `member-${index + 1}`,
      ),
    ),

    createdAt,
    timestamp: toTimestamp(createdAt),

    status,

    isActive,
    isInactive,
    isSuspended,
    isDeactivated,

    raw: source,
  };
}

/**
 * Aggregate member records by month.
 *
 * This is intentionally a fallback for datasets without an existing
 * authoritative reporting time series. It does not replace backend reporting
 * services.
 *
 * @param {Array} records
 * @param {string} locale
 * @returns {Array}
 */
function aggregateMemberRecords(
  records,
  locale,
) {
  const normalized = records
    .map(normalizeMemberRecord)
    .filter(
      (member) => member.timestamp !== null,
    );

  if (normalized.length === 0) {
    return [];
  }

  const buckets = new Map();

  for (const member of normalized) {
    const date = new Date(
      member.timestamp,
    );

    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;

    const key = `${year}-${String(month).padStart(2, '0')}`;

    if (!buckets.has(key)) {
      buckets.set(
        key,
        {
          id: key,
          period: date.toISOString(),
          label: formatMemberPeriod(
            date,
            locale,
          ),
          totalMembers: 0,
          newMembers: 0,
          activeMembers: 0,
          inactiveMembers: 0,
          suspendedMembers: 0,
          deactivatedMembers: 0,
          churnedMembers: 0,
        },
      );
    }

    const bucket = buckets.get(key);

    bucket.newMembers += 1;

    if (member.isActive) {
      bucket.activeMembers += 1;
    }

    if (member.isInactive) {
      bucket.inactiveMembers += 1;
    }

    if (member.isSuspended) {
      bucket.suspendedMembers += 1;
    }

    if (member.isDeactivated) {
      bucket.deactivatedMembers += 1;
      bucket.churnedMembers += 1;
    }
  }

  const rows = [...buckets.values()].sort(
    (left, right) => {
      const leftTime =
        toTimestamp(left.period) ?? 0;

      const rightTime =
        toTimestamp(right.period) ?? 0;

      return leftTime - rightTime;
    },
  );

  /*
   * With only registration records, the only safely inferable cumulative
   * series is total registered members. Status counts remain monthly
   * registration activity, not a historical membership-state snapshot.
   */
  let cumulativeMembers = 0;

  return rows.map((row) => {
    cumulativeMembers += row.newMembers;

    return {
      ...row,
      totalMembers: cumulativeMembers,
    };
  });
}

/**
 * Normalize the complete member growth payload.
 *
 * Supported envelopes:
 *   { data: { trend: [...] } }
 *   { data: { snapshots: [...] } }
 *   { data: [...] }
 *   { members: [...] }
 *   { memberGrowth: [...] }
 *   { series: [...] }
 *
 * @param {unknown} input
 * @param {object} options
 * @returns {{
 *   trend: Array,
 *   members: Array,
 *   summary: object,
 *   hasTrend: boolean,
 *   hasMembers: boolean
 * }}
 */
export function normalizeMemberGrowthData(
  input,
  {
    locale = DEFAULT_LOCALE,
  } = {},
) {
  const payload = unwrapPayload(input);

  if (!payload) {
    return {
      trend: [],
      members: [],
      summary: {},
      hasTrend: false,
      hasMembers: false,
    };
  }

  const payloadObject =
    typeof payload === 'object'
      ? payload
      : {};

  const rawTrend =
    Array.isArray(payload)
      ? payload
      : firstDefined(
          payloadObject,
          [
            'trend',
            'trends',
            'series',
            'timeSeries',
            'historical',
            'history',
            'snapshots',
            'memberGrowth',
            'growth',
          ],
          [],
        );

  const rawMembers =
    Array.isArray(payload)
      ? []
      : firstDefined(
          payloadObject,
          [
            'members',
            'memberRecords',
            'records',
            'items',
          ],
          [],
        );

  const trend = asArray(rawTrend)
    .map((item, index) =>
      normalizeSnapshot(
        item,
        index,
        locale,
      ),
    )
    .sort(
      (left, right) => {
        const leftTime =
          toTimestamp(left.period);

        const rightTime =
          toTimestamp(right.period);

        if (
          leftTime !== null
          && rightTime !== null
        ) {
          return leftTime - rightTime;
        }

        return String(
          left.label,
        ).localeCompare(
          String(right.label),
        );
      },
    );

  const members = asArray(rawMembers);

  const fallbackTrend =
    trend.length === 0 && members.length > 0
      ? aggregateMemberRecords(
          members,
          locale,
        )
      : [];

  const finalTrend =
    trend.length > 0
      ? trend
      : fallbackTrend;

  const suppliedSummary =
    payloadObject
    && typeof payloadObject.summary === 'object'
      ? payloadObject.summary
      : (
          payloadObject
          && typeof payloadObject.metrics === 'object'
            ? payloadObject.metrics
            : {}
        );

  const last =
    finalTrend.length > 0
      ? finalTrend[
          finalTrend.length - 1
        ]
      : null;

  const previous =
    finalTrend.length > 1
      ? finalTrend[
          finalTrend.length - 2
        ]
      : null;

  const latestTotal =
    normalizeCount(
      firstDefined(
        suppliedSummary,
        [
          'totalMembers',
          'memberCount',
          'totalMemberCount',
          'total',
        ],
        last?.totalMembers ?? 0,
      ),
    );

  const latestActive =
    normalizeCount(
      firstDefined(
        suppliedSummary,
        [
          'activeMembers',
          'activeMemberCount',
          'active',
        ],
        last?.activeMembers ?? 0,
      ),
    );

  const latestNew =
    normalizeCount(
      firstDefined(
        suppliedSummary,
        [
          'newMembers',
          'newMemberCount',
          'registrations',
        ],
        last?.newMembers ?? 0,
      ),
    );

  const latestInactive =
    normalizeCount(
      firstDefined(
        suppliedSummary,
        [
          'inactiveMembers',
          'inactiveMemberCount',
          'inactive',
        ],
        last?.inactiveMembers ?? 0,
      ),
    );

  const latestSuspended =
    normalizeCount(
      firstDefined(
        suppliedSummary,
        [
          'suspendedMembers',
          'suspendedMemberCount',
          'suspended',
        ],
        last?.suspendedMembers ?? 0,
      ),
    );

  const latestDeactivated =
    normalizeCount(
      firstDefined(
        suppliedSummary,
        [
          'deactivatedMembers',
          'deactivatedMemberCount',
          'deactivated',
        ],
        last?.deactivatedMembers ?? 0,
      ),
    );

  const suppliedGrowth =
    firstDefined(
      suppliedSummary,
      [
        'growthRate',
        'memberGrowthRate',
        'periodGrowthRate',
      ],
      undefined,
    );

  const periodGrowthRate =
    suppliedGrowth !== undefined
      ? parseMemberNumber(
          suppliedGrowth,
        )
      : safeRatio(
          latestTotal
            - (previous?.totalMembers ?? 0),
          previous?.totalMembers ?? 0,
        );

  const activeRate =
    safeRatio(
      latestActive,
      latestTotal,
    );

  const inactiveRate =
    safeRatio(
      latestInactive
        + latestSuspended
        + latestDeactivated,
      latestTotal,
    );

  return {
    trend: finalTrend,
    members,
    summary: {
      totalMembers: latestTotal,
      activeMembers: latestActive,
      newMembers: latestNew,
      inactiveMembers: latestInactive,
      suspendedMembers: latestSuspended,
      deactivatedMembers: latestDeactivated,

      periodGrowthRate,
      activeRate,
      inactiveRate,
    },

    hasTrend: finalTrend.length > 0,
    hasMembers: members.length > 0,
  };
}

/* ============================================================================
 * Trend and insight helpers
 * ========================================================================== */

/**
 * Calculate presentation-only trend change.
 *
 * @param {Array} trend
 * @returns {{
 *   absolute: number,
 *   rate: number
 * }}
 */
function calculateGrowthChange(trend) {
  if (trend.length < 2) {
    return {
      absolute: 0,
      rate: 0,
    };
  }

  const current =
    normalizeCount(
      trend[trend.length - 1]
        ?.totalMembers,
    );

  const previous =
    normalizeCount(
      trend[trend.length - 2]
        ?.totalMembers,
    );

  return {
    absolute: current - previous,
    rate: safeRatio(
      current - previous,
      previous,
    ),
  };
}

/**
 * Determine which series can actually be rendered.
 *
 * @param {Array} trend
 * @param {string[]} preferred
 * @returns {string[]}
 */
function resolveVisibleSeries(
  trend,
  preferred,
) {
  const requested =
    Array.isArray(preferred)
      && preferred.length > 0
      ? preferred
      : [
          MEMBER_SERIES.TOTAL,
          MEMBER_SERIES.NEW,
          MEMBER_SERIES.ACTIVE,
        ];

  const resolved = requested.filter(
    (key) =>
      SUPPORTED_SERIES.includes(key)
      && hasMeaningfulSeries(
        trend,
        key,
      ),
  );

  if (
    resolved.length === 0
    && hasMeaningfulSeries(
      trend,
      MEMBER_SERIES.TOTAL,
    )
  ) {
    return [MEMBER_SERIES.TOTAL];
  }

  return resolved;
}

/* ============================================================================
 * Presentation components
 * ========================================================================== */

function MetricCard({
  label,
  value,
  helper,
  tone = 'neutral',
}) {
  const toneColor =
    tone === 'success'
      ? CSS.success
      : tone === 'warning'
        ? CSS.warning
        : tone === 'danger'
          ? CSS.danger
          : tone === 'info'
            ? CSS.primary
            : CSS.textPrimary;

  return (
    <div
      style={{
        minWidth: 0,
        border: `1px solid ${CSS.border}`,
        borderRadius: 12,
        background: CSS.surface,
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          color: CSS.textSecondary,
          fontSize: 11,
          fontWeight: 700,
          lineHeight: 1.35,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 6,
          color: toneColor,
          fontSize: 21,
          fontWeight: 800,
          lineHeight: 1.15,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>

      {helper ? (
        <div
          style={{
            marginTop: 6,
            color: CSS.textSecondary,
            fontSize: 11,
            lineHeight: 1.45,
          }}
        >
          {helper}
        </div>
      ) : null}
    </div>
  );
}

function SeriesToggle({
  series,
  visible,
  onToggle,
}) {
  const label =
    getMemberSeriesLabel(
      series,
    );

  const color =
    getSeriesColor(series);

  return (
    <button
      type="button"
      aria-pressed={visible}
      aria-label={`${
        visible
          ? 'Hide'
          : 'Show'
      } ${label}`}
      onClick={() =>
        onToggle(series)
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        minHeight: 32,
        border: `1px solid ${
          visible
            ? CSS.borderStrong
            : CSS.border
        }`,
        borderRadius: 999,
        background: visible
          ? CSS.surface
          : CSS.surfaceMuted,
        color: visible
          ? CSS.textPrimary
          : CSS.textSecondary,
        padding: '5px 10px',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 700,
        opacity: visible ? 1 : 0.78,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: color,
          opacity: visible
            ? 1
            : 0.4,
        }}
      />

      {label}
    </button>
  );
}

/* ============================================================================
 * Tooltip
 * ========================================================================== */

export function MemberGrowthTooltip({
  active,
  payload,
  label,
  locale = DEFAULT_LOCALE,
}) {
  if (
    !active
    || !Array.isArray(payload)
    || payload.length === 0
  ) {
    return null;
  }

  return (
    <div
      role="tooltip"
      style={{
        minWidth: 220,
        maxWidth: 320,
        border: `1px solid ${CSS.borderStrong}`,
        borderRadius: 12,
        background: CSS.surface,
        boxShadow:
          '0 10px 30px rgba(0,0,0,0.10)',
        padding: 12,
      }}
    >
      <div
        style={{
          marginBottom: 9,
          color: CSS.textPrimary,
          fontSize: 13,
          fontWeight: 800,
        }}
      >
        {label}
      </div>

      <div
        style={{
          display: 'grid',
          gap: 7,
        }}
      >
        {payload
          .filter(
            (entry) =>
              entry
              && entry.value !== undefined,
          )
          .map((entry) => (
            <div
              key={`${entry.dataKey}-${entry.name}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent:
                  'space-between',
                gap: 16,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  color: CSS.textSecondary,
                  fontSize: 12,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background:
                      entry.color
                      ?? CSS.chart1,
                  }}
                />

                {entry.name
                  ?? getMemberSeriesLabel(
                    entry.dataKey,
                  )}
              </span>

              <strong
                style={{
                  color: CSS.textPrimary,
                  fontSize: 12,
                }}
              >
                {formatMemberCount(
                  entry.value,
                  locale,
                )}
              </strong>
            </div>
          ))}
      </div>
    </div>
  );
}

/* ============================================================================
 * State panels
 * ========================================================================== */

function StatePanel({
  type,
  message,
  onRetry,
}) {
  if (type === 'loading') {
    return (
      <div
        aria-live="polite"
        aria-busy="true"
        style={{
          display: 'grid',
          gap: 12,
          padding: 18,
        }}
      >
        <div
          style={{
            width: '30%',
            height: 14,
            borderRadius: 8,
            background: CSS.primarySoft,
          }}
        />

        <div
          style={{
            width: '100%',
            height: 220,
            borderRadius: 12,
            background:
              'linear-gradient(90deg, rgba(20,108,148,0.05), rgba(20,108,148,0.12), rgba(20,108,148,0.05))',
          }}
        />

        <div
          style={{
            width: '72%',
            height: 12,
            borderRadius: 8,
            background: CSS.primarySoft,
          }}
        />
      </div>
    );
  }

  if (type === 'error') {
    return (
      <div
        role="alert"
        style={{
          display: 'grid',
          placeItems: 'center',
          minHeight: 240,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div>
          <div
            style={{
              color: CSS.danger,
              fontSize: 15,
              fontWeight: 800,
            }}
          >
            Unable to load member analytics
          </div>

          <div
            style={{
              marginTop: 6,
              maxWidth: 520,
              color: CSS.textSecondary,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {message
              || 'The member growth analytics could not be displayed.'}
          </div>

          {typeof onRetry === 'function' ? (
            <button
              type="button"
              onClick={onRetry}
              style={{
                marginTop: 14,
                border: `1px solid ${CSS.borderStrong}`,
                borderRadius: 8,
                background: CSS.surface,
                color: CSS.textPrimary,
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 750,
              }}
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: 240,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div>
        <div
          style={{
            color: CSS.textPrimary,
            fontSize: 15,
            fontWeight: 800,
          }}
        >
          No member growth data
        </div>

        <div
          style={{
            marginTop: 6,
            maxWidth: 520,
            color: CSS.textSecondary,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {message
            || 'Member analytics will appear when reporting data is available.'}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * Main component
 * ========================================================================== */

function MemberGrowthChartComponent({
  data = null,
  members = null,

  title = 'Member Growth',
  description =
    'Membership population, additions and lifecycle activity over time.',

  locale = DEFAULT_LOCALE,
  height = DEFAULT_HEIGHT,

  loading = false,
  error = null,
  onRetry = null,

  showSummary = true,
  showSeriesControls = true,

  preferredSeries = [
    MEMBER_SERIES.TOTAL,
    MEMBER_SERIES.NEW,
    MEMBER_SERIES.ACTIVE,
  ],

  maxPoints = DEFAULT_PAGE_SIZE,

  initialShowInactive = false,

  emptyMessage =
    'No member growth records are available for the selected scope and period.',

  className = '',
  style = {},
  ariaLabel = null,
}) {
  const chartId = useId();

  /*
   * This state is intentionally UI-only. It does not persist membership
   * decisions or alter any authoritative member records.
   */
  const [inactiveVisible, setInactiveVisible] =
    useState(initialShowInactive);

  const [visibleSeries, setVisibleSeries] =
    useState(() =>
      Array.isArray(preferredSeries)
        ? preferredSeries.filter((series) =>
            SUPPORTED_SERIES.includes(
              series,
            ),
          )
        : [
            MEMBER_SERIES.TOTAL,
            MEMBER_SERIES.NEW,
            MEMBER_SERIES.ACTIVE,
          ],
    );

  const normalized = useMemo(
    () =>
      normalizeMemberGrowthData(
        members !== null
          ? {
              ...(data
                && typeof data === 'object'
                ? data
                : {}),
              members,
            }
          : data,
        {
          locale,
        },
      ),
    [
      data,
      members,
      locale,
    ],
  );

  const trend = useMemo(() => {
    if (
      maxPoints === null
      || maxPoints === undefined
      || maxPoints <= 0
    ) {
      return normalized.trend;
    }

    if (
      normalized.trend.length
      <= maxPoints
    ) {
      return normalized.trend;
    }

    return normalized.trend.slice(
      -Math.floor(maxPoints),
    );
  }, [
    maxPoints,
    normalized.trend,
  ]);

  const availableSeries =
    useMemo(
      () =>
        resolveVisibleSeries(
          trend,
          visibleSeries,
        ),
      [
        trend,
        visibleSeries,
      ],
    );

  const effectiveSeries =
    useMemo(() => {
      const base =
        [...availableSeries];

      if (
        inactiveVisible
        && hasMeaningfulSeries(
          trend,
          MEMBER_SERIES.INACTIVE,
        )
      ) {
        base.push(
          MEMBER_SERIES.INACTIVE,
        );
      }

      if (
        inactiveVisible
        && hasMeaningfulSeries(
          trend,
          MEMBER_SERIES.SUSPENDED,
        )
      ) {
        base.push(
          MEMBER_SERIES.SUSPENDED,
        );
      }

      if (
        inactiveVisible
        && hasMeaningfulSeries(
          trend,
          MEMBER_SERIES.DEACTIVATED,
        )
      ) {
        base.push(
          MEMBER_SERIES.DEACTIVATED,
        );
      }

      if (
        inactiveVisible
        && hasMeaningfulSeries(
          trend,
          MEMBER_SERIES.CHURNED,
        )
      ) {
        base.push(
          MEMBER_SERIES.CHURNED,
        );
      }

      return [
        ...new Set(base),
      ];
    }, [
      availableSeries,
      inactiveVisible,
      trend,
    ]);

  const hasAnyData =
    normalized.hasTrend
    || normalized.hasMembers;

  const growthChange =
    useMemo(
      () =>
        calculateGrowthChange(
          trend,
        ),
      [trend],
    );

  const latest =
    trend.length > 0
      ? trend[trend.length - 1]
      : null;

  const latestTotal =
    normalizeCount(
      latest?.totalMembers
      ?? normalized.summary.totalMembers,
    );

  const latestActive =
    normalizeCount(
      latest?.activeMembers
      ?? normalized.summary.activeMembers,
    );

  const latestNew =
    normalizeCount(
      latest?.newMembers
      ?? normalized.summary.newMembers,
    );

  const latestInactive =
    normalizeCount(
      latest?.inactiveMembers
      ?? normalized.summary.inactiveMembers,
    );

  const latestSuspended =
    normalizeCount(
      latest?.suspendedMembers
      ?? normalized.summary.suspendedMembers,
    );

  const latestDeactivated =
    normalizeCount(
      latest?.deactivatedMembers
      ?? normalized.summary.deactivatedMembers,
    );

  const activeRate =
    normalized.summary.activeRate
    || safeRatio(
      latestActive,
      latestTotal,
    );

  const inactiveRate =
    normalized.summary.inactiveRate
    || safeRatio(
      latestInactive
        + latestSuspended
        + latestDeactivated,
      latestTotal,
    );

  const headingId =
    `member-growth-heading-${safeDomId(
      chartId,
    )}`;

  const chartDescription =
    ariaLabel
    || `${title}. ${description}`;

  const toggleSeries = (series) => {
    if (
      !SUPPORTED_SERIES.includes(
        series,
      )
    ) {
      return;
    }

    setVisibleSeries((current) => {
      const next = current.includes(
        series,
      )
        ? current.filter(
            (item) =>
              item !== series,
          )
        : [
            ...current,
            series,
          ];

      /*
       * Keep at least one visible series so that a user cannot accidentally
       * produce an apparently empty chart through presentation controls.
       */
      if (next.length === 0) {
        return [
          MEMBER_SERIES.TOTAL,
        ];
      }

      return next;
    });
  };

  return (
    <section
      className={className}
      aria-labelledby={headingId}
      aria-label={chartDescription}
      style={{
        minWidth: 0,
        border: `1px solid ${CSS.border}`,
        borderRadius: 16,
        background: CSS.surface,
        boxShadow:
          '0 2px 10px rgba(0,0,0,0.04)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          padding: '18px 18px 14px',
          borderBottom: `1px solid ${CSS.border}`,
        }}
      >
        <div
          style={{
            minWidth: 0,
            flex: '1 1 320px',
          }}
        >
          <div
            id={headingId}
            style={{
              color: CSS.textPrimary,
              fontSize: 18,
              fontWeight: 800,
              lineHeight: 1.25,
            }}
          >
            {title}
          </div>

          <div
            style={{
              marginTop: 6,
              maxWidth: 760,
              color: CSS.textSecondary,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {description}
          </div>

          <div
            style={{
              marginTop: 9,
              color: CSS.textSecondary,
              fontSize: 11,
              lineHeight: 1.45,
            }}
          >
            Membership counts are presented from the supplied reporting
            dataset. This chart does not create or modify member records.
          </div>
        </div>

        {showSeriesControls
        && !loading
        && !error
        && hasAnyData ? (
          <div
            role="group"
            aria-label="Member chart series controls"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              gap: 7,
              maxWidth: 620,
            }}
          >
            {[
              MEMBER_SERIES.TOTAL,
              MEMBER_SERIES.NEW,
              MEMBER_SERIES.ACTIVE,
            ]
              .filter((series) =>
                hasMeaningfulSeries(
                  trend,
                  series,
                ),
              )
              .map((series) => (
                <SeriesToggle
                  key={series}
                  series={series}
                  visible={visibleSeries.includes(
                    series,
                  )}
                  onToggle={toggleSeries}
                />
              ))}

            {[
              MEMBER_SERIES.INACTIVE,
              MEMBER_SERIES.SUSPENDED,
              MEMBER_SERIES.DEACTIVATED,
              MEMBER_SERIES.CHURNED,
            ].some((series) =>
              hasMeaningfulSeries(
                trend,
                series,
              ),
            ) ? (
              <button
                type="button"
                aria-pressed={inactiveVisible}
                onClick={() =>
                  setInactiveVisible(
                    (current) =>
                      !current,
                  )
                }
                style={{
                  minHeight: 32,
                  border: `1px solid ${CSS.border}`,
                  borderRadius: 999,
                  background: inactiveVisible
                    ? CSS.surface
                    : CSS.surfaceMuted,
                  color: inactiveVisible
                    ? CSS.textPrimary
                    : CSS.textSecondary,
                  padding:
                    '5px 10px',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {inactiveVisible
                  ? 'Hide lifecycle detail'
                  : 'Show lifecycle detail'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Summary */}
      {showSummary
      && !loading
      && !error
      && hasAnyData ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(155px, 1fr))',
            gap: 10,
            padding: 14,
            background: CSS.surfaceMuted,
            borderBottom: `1px solid ${CSS.border}`,
          }}
        >
          <MetricCard
            label="Total Members"
            value={formatMemberCount(
              latestTotal,
              locale,
            )}
            helper="Latest reported membership population"
            tone="info"
          />

          <MetricCard
            label="New Members"
            value={formatMemberCount(
              latestNew,
              locale,
            )}
            helper="Latest reported additions"
            tone="success"
          />

          <MetricCard
            label="Active Rate"
            value={formatMemberPercent(
              activeRate,
              locale,
            )}
            helper={`${formatMemberCount(
              latestActive,
              locale,
            )} active members`}
            tone="success"
          />

          <MetricCard
            label="Period Growth"
            value={formatMemberPercent(
              growthChange.rate,
              locale,
            )}
            helper={`${growthChange.absolute >= 0 ? '+' : ''}${formatMemberCount(
              growthChange.absolute,
              locale,
            )} members vs prior period`}
            tone={
              growthChange.absolute >= 0
                ? 'success'
                : 'warning'
            }
          />

          <MetricCard
            label="Inactive / Other"
            value={formatMemberPercent(
              inactiveRate,
              locale,
            )}
            helper={`${formatMemberCount(
              latestInactive
                + latestSuspended
                + latestDeactivated,
              locale,
            )} members in supplied non-active states`}
            tone={
              inactiveRate > 0
                ? 'warning'
                : 'neutral'
            }
          />
        </div>
      ) : null}

      {/* Main body */}
      {loading ? (
        <StatePanel type="loading" />
      ) : error ? (
        <StatePanel
          type="error"
          message={
            typeof error === 'string'
              ? error
              : error?.message
          }
          onRetry={onRetry}
        />
      ) : !hasAnyData ? (
        <StatePanel
          type="empty"
          message={emptyMessage}
        />
      ) : !normalized.hasTrend ? (
        <StatePanel
          type="empty"
          message={
            'Member records exist, but there is no date-based reporting series available for charting.'
          }
        />
      ) : (
        <div
          style={{
            padding: 14,
          }}
        >
          <div
            role="img"
            aria-label={`${title} trend showing membership population over time`}
            style={{
              width: '100%',
              height,
              minHeight: 260,
            }}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <ComposedMemberGrowthChart
                chartId={safeDomId(chartId)}
                data={trend}
                locale={locale}
                series={effectiveSeries}
              />
            </ResponsiveContainer>
          </div>

          {/* Secondary lifecycle insight */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 9,
              marginTop: 14,
              paddingTop: 14,
              borderTop: `1px solid ${CSS.border}`,
            }}
          >
            {[
              {
                label: 'Active Members',
                value: latestActive,
                tone: 'success',
              },
              {
                label: 'Inactive Members',
                value: latestInactive,
                tone: 'neutral',
              },
              {
                label: 'Suspended Members',
                value: latestSuspended,
                tone: 'warning',
              },
              {
                label: 'Deactivated Members',
                value: latestDeactivated,
                tone: 'danger',
              },
            ]
              .filter(
                (item) =>
                  inactiveVisible
                  || item.label ===
                    'Active Members',
              )
              .map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent:
                      'space-between',
                    gap: 12,
                    border: `1px solid ${CSS.border}`,
                    borderRadius: 10,
                    background: CSS.surfaceMuted,
                    padding: '10px 12px',
                  }}
                >
                  <span
                    style={{
                      color: CSS.textSecondary,
                      fontSize: 11,
                      fontWeight: 650,
                    }}
                  >
                    {item.label}
                  </span>

                  <strong
                    style={{
                      color:
                        item.tone === 'success'
                          ? CSS.success
                          : item.tone === 'warning'
                            ? CSS.warning
                            : item.tone === 'danger'
                              ? CSS.danger
                              : CSS.textPrimary,
                      fontSize: 13,
                    }}
                  >
                    {formatMemberCount(
                      item.value,
                      locale,
                    )}
                  </strong>
                </div>
              ))}
          </div>

          {/* Scope / authority note */}
          <div
            style={{
              marginTop: 14,
              color: CSS.textSecondary,
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            Trend changes and percentage figures are presentation analytics.
            The authoritative member population, lifecycle state, tenant scope
            and audit history remain owned by TITech backend services.
          </div>
        </div>
      )}
    </section>
  );
}

/* ============================================================================
 * Recharts composition
 * ========================================================================== */

function ComposedMemberGrowthChart({
  chartId,
  data,
  locale,
  series,
}) {
  const hasTotal =
    series.includes(
      MEMBER_SERIES.TOTAL,
    );

  const hasActive =
    series.includes(
      MEMBER_SERIES.ACTIVE,
    );

  const hasNew =
    series.includes(
      MEMBER_SERIES.NEW,
    );

  const hasInactive =
    series.includes(
      MEMBER_SERIES.INACTIVE,
    );

  const hasSuspended =
    series.includes(
      MEMBER_SERIES.SUSPENDED,
    );

  const hasDeactivated =
    series.includes(
      MEMBER_SERIES.DEACTIVATED,
    );

  const hasChurned =
    series.includes(
      MEMBER_SERIES.CHURNED,
    );

  return (
    <ResponsiveContainerInner
      chartId={chartId}
      data={data}
      locale={locale}
      hasTotal={hasTotal}
      hasActive={hasActive}
      hasNew={hasNew}
      hasInactive={hasInactive}
      hasSuspended={hasSuspended}
      hasDeactivated={hasDeactivated}
      hasChurned={hasChurned}
    />
  );
}

function ResponsiveContainerInner({
  chartId,
  data,
  locale,
  hasTotal,
  hasActive,
  hasNew,
  hasInactive,
  hasSuspended,
  hasDeactivated,
  hasChurned,
}) {
  /*
   * This nested component exists only to keep the Recharts tree explicit and
   * predictable. The chart has a single tooltip, one authoritative X-axis,
   * and one count Y-axis.
   */

  return (
    <ChartImplementation
      chartId={chartId}
      data={data}
      locale={locale}
      hasTotal={hasTotal}
      hasActive={hasActive}
      hasNew={hasNew}
      hasInactive={hasInactive}
      hasSuspended={hasSuspended}
      hasDeactivated={hasDeactivated}
      hasChurned={hasChurned}
    />
  );
}

function ChartImplementation({
  chartId,
  data,
  locale,
  hasTotal,
  hasActive,
  hasNew,
  hasInactive,
  hasSuspended,
  hasDeactivated,
  hasChurned,
}) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
    >
      <rechartsChartProxy
        chartId={chartId}
        data={data}
        locale={locale}
        hasTotal={hasTotal}
        hasActive={hasActive}
        hasNew={hasNew}
        hasInactive={hasInactive}
        hasSuspended={hasSuspended}
        hasDeactivated={hasDeactivated}
        hasChurned={hasChurned}
      />
    </ResponsiveContainer>
  );
}

/*
 * Recharts requires concrete chart components. Keeping this function separate
 * makes the rendered tree easier to inspect while preserving one chart
 * container and one tooltip.
 */
function rechartsChartProxy({
  chartId,
  data,
  locale,
  hasTotal,
  hasActive,
  hasNew,
  hasInactive,
  hasSuspended,
  hasDeactivated,
  hasChurned,
}) {
  /*
   * `rechartsChartProxy` is not rendered as a custom HTML element. It is
   * replaced by the concrete chart tree in `MemberGrowthPlot`.
   */
  return (
    <MemberGrowthPlot
      chartId={chartId}
      data={data}
      locale={locale}
      hasTotal={hasTotal}
      hasActive={hasActive}
      hasNew={hasNew}
      hasInactive={hasInactive}
      hasSuspended={hasSuspended}
      hasDeactivated={hasDeactivated}
      hasChurned={hasChurned}
    />
  );
}

/**
 * Concrete Recharts plot.
 *
 * @param {object} props
 * @returns {JSX.Element}
 */
function MemberGrowthPlot({
  chartId,
  data,
  locale,
  hasTotal,
  hasActive,
  hasNew,
  hasInactive,
  hasSuspended,
  hasDeactivated,
  hasChurned,
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
      }}
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
      >
        <MemberTrendChart
          chartId={chartId}
          data={data}
          locale={locale}
          hasTotal={hasTotal}
          hasActive={hasActive}
          hasNew={hasNew}
          hasInactive={hasInactive}
          hasSuspended={hasSuspended}
          hasDeactivated={hasDeactivated}
          hasChurned={hasChurned}
        />
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Actual ComposedChart wrapper.
 *
 * @param {object} props
 * @returns {JSX.Element}
 */
function MemberTrendChart({
  chartId,
  data,
  locale,
  hasTotal,
  hasActive,
  hasNew,
  hasInactive,
  hasSuspended,
  hasDeactivated,
  hasChurned,
}) {
  return (
    <ResponsiveChartBridge
      chartId={chartId}
      data={data}
      locale={locale}
      hasTotal={hasTotal}
      hasActive={hasActive}
      hasNew={hasNew}
      hasInactive={hasInactive}
      hasSuspended={hasSuspended}
      hasDeactivated={hasDeactivated}
      hasChurned={hasChurned}
    />
  );
}

/*
 * Explicit bridge to keep the actual Recharts chart tree in a single location.
 * The implementation uses React's normal element syntax through the imported
 * Recharts primitives.
 */
function ResponsiveChartBridge({
  chartId,
  data,
  locale,
  hasTotal,
  hasActive,
  hasNew,
  hasInactive,
  hasSuspended,
  hasDeactivated,
  hasChurned,
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
      }}
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
      >
        <ComposedChartShell
          chartId={chartId}
          data={data}
          locale={locale}
          hasTotal={hasTotal}
          hasActive={hasActive}
          hasNew={hasNew}
          hasInactive={hasInactive}
          hasSuspended={hasSuspended}
          hasDeactivated={hasDeactivated}
          hasChurned={hasChurned}
        />
      </ResponsiveContainer>
    </div>
  );
}

function ComposedChartShell({
  chartId,
  data,
  locale,
  hasTotal,
  hasActive,
  hasNew,
  hasInactive,
  hasSuspended,
  hasDeactivated,
  hasChurned,
}) {
  /*
   * React element factory is used here to keep the component import list
   * intentionally small while still producing normal Recharts elements.
   */
  return React.createElement(
    ComposedChart,
    {
      data,
      margin: {
        top: 12,
        right: 18,
        left: 8,
        bottom: 8,
      },
    },
    React.createElement(
      'defs',
      null,
      React.createElement(
        'linearGradient',
        {
          id: `${chartId}-member-total-fill`,
          x1: '0',
          y1: '0',
          x2: '0',
          y2: '1',
        },
        React.createElement('stop', {
          offset: '0%',
          stopColor: CSS.chart1,
          stopOpacity: 0.28,
        }),
        React.createElement('stop', {
          offset: '100%',
          stopColor: CSS.chart1,
          stopOpacity: 0.035,
        }),
      ),
    ),

    React.createElement(CartesianGrid, {
      stroke: CSS.border,
      strokeDasharray: '3 4',
      vertical: false,
    }),

    React.createElement(XAxis, {
      dataKey: 'label',
      tick: {
        fill: CSS.textSecondary,
        fontSize: 11,
      },
      tickLine: false,
      axisLine: {
        stroke: CSS.border,
      },
      minTickGap: 22,
    }),

    React.createElement(YAxis, {
      tick: {
        fill: CSS.textSecondary,
        fontSize: 11,
      },
      tickLine: false,
      axisLine: false,
      tickFormatter: (value) =>
        formatMemberCount(
          value,
          locale,
        ),
      width: 70,
    }),

    React.createElement(Tooltip, {
      cursor: {
        stroke: CSS.borderStrong,
        strokeDasharray: '4 4',
      },
      content: React.createElement(
        MemberGrowthTooltip,
        {
          locale,
        },
      ),
    }),

    hasTotal
      ? React.createElement(Area, {
          type: 'monotone',
          dataKey:
            MEMBER_SERIES.TOTAL,
          name:
            MEMBER_SERIES_LABELS[
              MEMBER_SERIES.TOTAL
            ],
          stroke: CSS.chart1,
          fill: `url(#${chartId}-member-total-fill)`,
          strokeWidth: 2.5,
          dot: false,
          activeDot: {
            r: 4,
          },
          isAnimationActive: true,
          animationDuration: 650,
        })
      : null,

    hasNew
      ? React.createElement(Line, {
          type: 'monotone',
          dataKey:
            MEMBER_SERIES.NEW,
          name:
            MEMBER_SERIES_LABELS[
              MEMBER_SERIES.NEW
            ],
          stroke: CSS.chart2,
          strokeWidth: 2,
          dot: false,
          activeDot: {
            r: 4,
          },
          isAnimationActive: true,
          animationDuration: 650,
        })
      : null,

    hasActive
      ? React.createElement(Line, {
          type: 'monotone',
          dataKey:
            MEMBER_SERIES.ACTIVE,
          name:
            MEMBER_SERIES_LABELS[
              MEMBER_SERIES.ACTIVE
            ],
          stroke: CSS.chart3,
          strokeWidth: 2,
          dot: false,
          activeDot: {
            r: 4,
          },
          isAnimationActive: true,
          animationDuration: 650,
        })
      : null,

    hasInactive
      ? React.createElement(Line, {
          type: 'monotone',
          dataKey:
            MEMBER_SERIES.INACTIVE,
          name:
            MEMBER_SERIES_LABELS[
              MEMBER_SERIES.INACTIVE
            ],
          stroke: CSS.chart5,
          strokeWidth: 1.75,
          strokeDasharray: '5 4',
          dot: false,
          activeDot: {
            r: 4,
          },
          isAnimationActive: true,
          animationDuration: 650,
        })
      : null,

    hasSuspended
      ? React.createElement(Line, {
          type: 'monotone',
          dataKey:
            MEMBER_SERIES.SUSPENDED,
          name:
            MEMBER_SERIES_LABELS[
              MEMBER_SERIES.SUSPENDED
            ],
          stroke: CSS.chart4,
          strokeWidth: 1.75,
          strokeDasharray: '5 4',
          dot: false,
          activeDot: {
            r: 4,
          },
          isAnimationActive: true,
          animationDuration: 650,
        })
      : null,

    hasDeactivated
      ? React.createElement(Line, {
          type: 'monotone',
          dataKey:
            MEMBER_SERIES.DEACTIVATED,
          name:
            MEMBER_SERIES_LABELS[
              MEMBER_SERIES.DEACTIVATED
            ],
          stroke: CSS.chart4,
          strokeWidth: 1.75,
          strokeDasharray: '2 4',
          dot: false,
          activeDot: {
            r: 4,
          },
          isAnimationActive: true,
          animationDuration: 650,
        })
      : null,

    hasChurned
      ? React.createElement(Line, {
          type: 'monotone',
          dataKey:
            MEMBER_SERIES.CHURNED,
          name:
            MEMBER_SERIES_LABELS[
              MEMBER_SERIES.CHURNED
            ],
          stroke: CSS.chart6,
          strokeWidth: 1.75,
          strokeDasharray: '7 4',
          dot: false,
          activeDot: {
            r: 4,
          },
          isAnimationActive: true,
          animationDuration: 650,
        })
      : null,
  );
}

/* ============================================================================
 * Accessibility / test-friendly exports
 * ========================================================================== */

export const MEMBER_GROWTH_DEFAULTS =
  Object.freeze({
    locale: DEFAULT_LOCALE,
    height: DEFAULT_HEIGHT,
    maxPoints: DEFAULT_PAGE_SIZE,
    preferredSeries: [
      MEMBER_SERIES.TOTAL,
      MEMBER_SERIES.NEW,
      MEMBER_SERIES.ACTIVE,
    ],
  });

/* ============================================================================
 * Public component
 * ========================================================================== */

export const MemberGrowthChart = memo(
  MemberGrowthChartComponent,
);

MemberGrowthChart.displayName =
  'MemberGrowthChart';

export default MemberGrowthChart;