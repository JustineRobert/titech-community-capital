/**
 * TITech Community Capital
 * File: backend/modules/payment/airtel/intelligence/command-center/dashboardAggregator.js
 *
 * Architectural role
 * ------------------
 * Enterprise read-only dashboard aggregation boundary for Airtel payment
 * intelligence. Composes bounded tenant-scoped governance, compliance,
 * alerting, agent, model-risk, explainability and audit signals into a stable
 * command-center read model.
 *
 * Important boundaries / non-responsibilities
 * --------------------------------------------
 * - NOT the financial source of truth, ledger, balance service, or settlement service.
 * - NOT an Airtel provider adapter and never owns provider credentials.
 * - NOT a policy, governance, KYC, AML, sanctions, risk, prediction or learning engine.
 * - NOT an approval/maker-checker state machine.
 * - NOT an audit ledger; it never rewrites historical audit records.
 * - NOT a notification transport.
 * - NOT a raw analytics warehouse or feature store.
 * - NOT allowed to execute payments, call providers, mutate money, grant approval,
 *   mutate policy/compliance/alert/model state, or infer execution authorization.
 *
 * Production principles
 * ---------------------
 * - Tenant and Airtel provider scopes are fail-closed.
 * - Source failures remain visible as data-quality/health degradation.
 * - Missing/unavailable data is never represented as a successful zero.
 * - Aggregation is deterministic for identical normalized source data.
 * - Sensitive identifiers are digested; secrets, OTP/PINs and raw provider payloads
 *   are never emitted by aggregation paths.
 * - Monetary values are not reconstructed or recalculated here.
 * - Reads, ranges, records, trends and exports are bounded.
 * - Source methods are explicitly allow-listed; no arbitrary method execution exists.
 * - Dashboard fingerprints exclude generated timestamps.
 * - Returned records are deeply frozen.
 * - Persistence is injected; no database dependency is hard-coded here.
 * - No internal scheduler is created. Scheduler/worker invocation belongs elsewhere.
 *
 * Module format
 * -------------
 * - Native ECMAScript module (ESM).
 * - Node.js built-ins only.
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME = 'airtel-command-center-dashboard-aggregator';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = 'sha256';

export const DASHBOARD_HEALTH_STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const DASHBOARD_DATA_STATES = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  EMPTY: 'EMPTY',
  PARTIAL: 'PARTIAL',
  TRUNCATED: 'TRUNCATED',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const DASHBOARD_OUTCOMES = Object.freeze({
  ALLOW: 'ALLOW',
  ALLOW_WITH_CONTROLS: 'ALLOW_WITH_CONTROLS',
  REQUIRE_REVIEW: 'REQUIRE_REVIEW',
  REQUIRE_APPROVAL: 'REQUIRE_APPROVAL',
  BLOCK: 'BLOCK',
  CONFLICT: 'CONFLICT',
  STALE: 'STALE',
  INVALID: 'INVALID',
  INDETERMINATE: 'INDETERMINATE',
});

export const DASHBOARD_RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
  UNKNOWN: 'UNKNOWN',
});

export const DASHBOARD_APPROVAL_STATES = Object.freeze({
  NONE: 'NONE',
  REQUIRE_APPROVAL: 'REQUIRE_APPROVAL',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  AUTHORIZED: 'AUTHORIZED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  UNKNOWN: 'UNKNOWN',
});

export const DASHBOARD_INTEGRITY_STATES = Object.freeze({
  VERIFIED: 'VERIFIED',
  UNVERIFIED: 'UNVERIFIED',
  FAILED: 'FAILED',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const DASHBOARD_SOURCE_TYPES = Object.freeze({
  GOVERNANCE: 'GOVERNANCE',
  COMPLIANCE: 'COMPLIANCE',
  ALERTS: 'ALERTS',
  AGENTS: 'AGENTS',
  MODEL_DRIFT: 'MODEL_DRIFT',
  EXPLAINABILITY: 'EXPLAINABILITY',
  AUDIT: 'AUDIT',
  REPOSITORY: 'REPOSITORY',
});

export const DASHBOARD_AGGREGATOR_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'DASHBOARD_AGGREGATOR_INVALID_INPUT',
  TENANT_REQUIRED: 'DASHBOARD_AGGREGATOR_TENANT_REQUIRED',
  PROVIDER_SCOPE_VIOLATION: 'DASHBOARD_AGGREGATOR_PROVIDER_SCOPE_VIOLATION',
  RANGE_INVALID: 'DASHBOARD_AGGREGATOR_RANGE_INVALID',
  RANGE_TOO_LARGE: 'DASHBOARD_AGGREGATOR_RANGE_TOO_LARGE',
  SOURCE_REQUIRED: 'DASHBOARD_AGGREGATOR_SOURCE_REQUIRED',
  SOURCE_UNAVAILABLE: 'DASHBOARD_AGGREGATOR_SOURCE_UNAVAILABLE',
  SOURCE_PROTOCOL_ERROR: 'DASHBOARD_AGGREGATOR_SOURCE_PROTOCOL_ERROR',
  PAYLOAD_TOO_LARGE: 'DASHBOARD_AGGREGATOR_PAYLOAD_TOO_LARGE',
  EXPORT_TOO_LARGE: 'DASHBOARD_AGGREGATOR_EXPORT_TOO_LARGE',
  QUERY_TOO_LARGE: 'DASHBOARD_AGGREGATOR_QUERY_TOO_LARGE',
});

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER,
  tenantRequired: true,
  maxTenantIdLength: 160,
  defaultRangeDays: 30,
  maxRangeDays: 366,
  defaultLimit: 50,
  maxLimit: 250,
  maxSourceRecords: 10_000,
  maxSourcePageSize: 250,
  maxTrendBuckets: 366,
  maxTopItems: 50,
  maxPayloadBytes: 1024 * 1024,
  maxExportBytes: 4 * 1024 * 1024,
  maxSourceFailures: 100,
  failClosedOnAllSourcesUnavailable: true,
});

const OUTCOME_ORDER = Object.freeze(Object.values(DASHBOARD_OUTCOMES));
const RISK_ORDER = Object.freeze(Object.values(DASHBOARD_RISK_LEVELS));
const APPROVAL_ORDER = Object.freeze(Object.values(DASHBOARD_APPROVAL_STATES));
const INTEGRITY_ORDER = Object.freeze(Object.values(DASHBOARD_INTEGRITY_STATES));

const INTELLIGENCE_KEYS = Object.freeze([
  'regulatory',
  'policy',
  'prediction',
  'recommendation',
  'learning',
  'risk',
]);

const SENSITIVE_KEY_PATTERNS = Object.freeze([
  /password/i,
  /passphrase/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /session/i,
  /otp/i,
  /pin/i,
  /cvv/i,
  /cvc/i,
  /pan/i,
  /private.?key/i,
  /api.?key/i,
  /access.?key/i,
  /credential/i,
  /signature/i,
  /raw.?payload/i,
  /raw.?request/i,
  /raw.?response/i,
]);

const IDENTIFIER_KEY_PATTERNS = Object.freeze([
  /^phone$/i,
  /phone(number)?/i,
  /msisdn/i,
  /email/i,
  /national.?id/i,
  /^nin$/i,
  /account(number)?/i,
  /bank.?account/i,
  /wallet(number|id)?/i,
  /customer(number|id)?/i,
  /device.?id/i,
  /ip(address)?/i,
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;

  const proto = Object.getPrototypeOf(value);

  return (
    proto === Object.prototype
    || proto === null
  );
}

function normalizeString(
  value,
  maxLength = 200,
) {
  if (
    value === undefined
    || value === null
  ) {
    return undefined;
  }

  const valueString =
    String(value).trim();

  if (!valueString) {
    return undefined;
  }

  return valueString.length > maxLength
    ? valueString.slice(
        0,
        maxLength,
      )
    : valueString;
}

function upper(
  value,
  maxLength = 80,
) {
  return normalizeString(
    value,
    maxLength,
  )?.toUpperCase();
}

function finiteNumber(
  value,
  fallback = null,
) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function integer(
  value,
  fallback,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(
      min,
      Math.trunc(number),
    ),
  );
}

function iso(
  value,
  fallback = undefined,
) {
  if (
    value === undefined
    || value === null
    || value === ''
  ) {
    return fallback;
  }

  const date =
    value instanceof Date
      ? new Date(
          value.getTime(),
        )
      : new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? fallback
    : date.toISOString();
}

function addDays(
  value,
  days,
) {
  const date =
    new Date(value);

  date.setUTCDate(
    date.getUTCDate()
      + days,
  );

  return date.toISOString();
}

function startOfDay(
  value,
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  date.setUTCHours(
    0,
    0,
    0,
    0,
  );

  return date.toISOString();
}

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(
        JSON.stringify(value),
      );
}

function stableNormalize(
  value,
  seen = new WeakSet(),
) {
  if (
    value === null
    || value === undefined
  ) {
    return value;
  }

  if (
    typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    typeof value === 'number'
  ) {
    if (
      Number.isFinite(value)
    ) {
      return value;
    }

    if (
      Number.isNaN(value)
    ) {
      return 'NaN';
    }

    return value > 0
      ? 'Infinity'
      : '-Infinity';
  }

  if (
    typeof value === 'bigint'
  ) {
    return `${value.toString()}n`;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    Buffer.isBuffer(value)
  ) {
    return `base64:${value.toString('base64')}`;
  }

  if (
    value instanceof Uint8Array
  ) {
    return `base64:${Buffer.from(value).toString('base64')}`;
  }

  if (
    typeof value === 'function'
    || typeof value === 'symbol'
  ) {
    return String(value);
  }

  if (
    seen.has(value)
  ) {
    return '[Circular]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const result =
      value.map(
        (item) =>
          stableNormalize(
            item,
            seen,
          ),
      );

    seen.delete(value);

    return result;
  }

  if (
    typeof value.toJSON
      === 'function'
    && !isPlainObject(value)
  ) {
    const result =
      stableNormalize(
        value.toJSON(),
        seen,
      );

    seen.delete(value);

    return result;
  }

  const result =
    Object.create(null);

  for (
    const key
    of Object.keys(value).sort()
  ) {
    result[key] =
      stableNormalize(
        value[key],
        seen,
      );
  }

  seen.delete(value);

  return result;
}

function sha256(
  value,
) {
  const input =
    typeof value === 'string'
    || Buffer.isBuffer(value)
      ? value
      : JSON.stringify(
          stableNormalize(
            value,
          ),
        );

  return createHash(
    HASH_ALGORITHM,
  )
    .update(input)
    .digest('hex');
}

function digest(
  value,
) {
  return `sha256:${sha256(
    String(value),
  ).slice(0, 40)}`;
}

function safeBytes(
  value,
) {
  return Buffer.byteLength(
    JSON.stringify(
      value ?? null,
    ),
    'utf8',
  );
}

function deepFreeze(
  value,
  seen = new WeakSet(),
) {
  if (
    !value
    || typeof value !== 'object'
    || seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (
    const child
    of Object.values(value)
  ) {
    deepFreeze(
      child,
      seen,
    );
  }

  return Object.freeze(
    value,
  );
}

function redact(
  value,
  key = '',
  depth = 0,
) {
  if (
    depth > 8
  ) {
    return '[TRUNCATED]';
  }

  if (
    value === null
    || value === undefined
  ) {
    return value;
  }

  if (
    SENSITIVE_KEY_PATTERNS.some(
      (pattern) =>
        pattern.test(key),
    )
  ) {
    return '[REDACTED]';
  }

  if (
    IDENTIFIER_KEY_PATTERNS.some(
      (pattern) =>
        pattern.test(key),
    )
  ) {
    return digest(value);
  }

  if (
    typeof value !== 'object'
  ) {
    return (
      typeof value === 'string'
      && value.length > 500
    )
      ? `${value.slice(0, 497)}...`
      : value;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    Buffer.isBuffer(value)
    || value instanceof Uint8Array
  ) {
    return '[BINARY_REDACTED]';
  }

  if (
    Array.isArray(value)
  ) {
    return value
      .slice(0, 250)
      .map(
        (item) =>
          redact(
            item,
            '',
            depth + 1,
          ),
      );
  }

  const result =
    Object.create(null);

  for (
    const childKey
    of Object.keys(value)
      .slice(0, 250)
  ) {
    result[childKey] =
      redact(
        value[childKey],
        childKey,
        depth + 1,
      );
  }

  return result;
}

function safePercent(
  numerator,
  denominator,
  precision = 2,
) {
  const n =
    finiteNumber(
      numerator,
      0,
    ) ?? 0;

  const d =
    finiteNumber(
      denominator,
      0,
    ) ?? 0;

  if (
    d <= 0
  ) {
    return 0;
  }

  const factor =
    10 ** precision;

  return (
    Math.round(
      (n / d) * factor,
    ) / factor
  ) * 100;
}

function normalizeOutcome(
  value,
) {
  const candidate =
    upper(
      value,
      80,
    );

  if (!candidate) {
    return DASHBOARD_OUTCOMES
      .INDETERMINATE;
  }

  if (
    OUTCOME_ORDER.includes(
      candidate,
    )
  ) {
    return candidate;
  }

  if (
    candidate === 'REVIEW'
  ) {
    return DASHBOARD_OUTCOMES
      .REQUIRE_REVIEW;
  }

  if (
    candidate
      === 'REVIEW_REQUIRED'
  ) {
    return DASHBOARD_OUTCOMES
      .REQUIRE_REVIEW;
  }

  if (
    candidate
      === 'APPROVAL_REQUIRED'
  ) {
    return DASHBOARD_OUTCOMES
      .REQUIRE_APPROVAL;
  }

  return DASHBOARD_OUTCOMES
    .INDETERMINATE;
}

function normalizeRisk(
  value,
) {
  const candidate =
    upper(
      value,
      40,
    );

  return RISK_ORDER.includes(
    candidate,
  )
    ? candidate
    : DASHBOARD_RISK_LEVELS.UNKNOWN;
}

function normalizeApproval(
  value,
  required = false,
) {
  const candidate =
    upper(
      value,
      60,
    );

  if (!candidate) {
    return required
      ? DASHBOARD_APPROVAL_STATES
          .REQUIRE_APPROVAL
      : DASHBOARD_APPROVAL_STATES
          .NONE;
  }

  if (
    APPROVAL_ORDER.includes(
      candidate,
    )
  ) {
    return candidate;
  }

  if (
    candidate === 'REQUIRED'
  ) {
    return DASHBOARD_APPROVAL_STATES
      .REQUIRE_APPROVAL;
  }

  return DASHBOARD_APPROVAL_STATES
    .UNKNOWN;
}

function normalizeIntegrity(
  value,
) {
  const candidate =
    upper(
      value,
      50,
    );

  return INTEGRITY_ORDER.includes(
    candidate,
  )
    ? candidate
    : DASHBOARD_INTEGRITY_STATES
        .UNAVAILABLE;
}

function page(
  raw,
) {
  if (
    Array.isArray(raw)
  ) {
    return {
      entries:
        raw,

      total:
        raw.length,

      limit:
        raw.length,

      offset:
        0,

      hasMore:
        false,
    };
  }

  const entries =
    Array.isArray(
      raw?.entries,
    )
      ? raw.entries
      : Array.isArray(
          raw?.items,
        )
        ? raw.items
        : [];

  const total =
    Number.isFinite(
      Number(raw?.total),
    )
      ? Number(raw.total)
      : entries.length;

  const limit =
    Number.isFinite(
      Number(raw?.limit),
    )
      ? Number(raw.limit)
      : entries.length;

  const offset =
    Number.isFinite(
      Number(raw?.offset),
    )
      ? Number(raw.offset)
      : 0;

  return {
    entries,
    total,
    limit,
    offset,

    hasMore:
      raw?.hasMore === true
      || offset + entries.length
        < total,
  };
}

function histogram(
  rows,
  keyFn,
  order,
) {
  const counts =
    new Map();

  for (
    const row
    of rows
  ) {
    const key =
      keyFn(row)
      ?? 'UNKNOWN';

    counts.set(
      key,
      (
        counts.get(key)
        ?? 0
      ) + 1,
    );
  }

  const keys = [
    ...order,
    ...[
      ...counts.keys(),
    ]
      .filter(
        (key) =>
          !order.includes(
            key,
          ),
      )
      .sort(),
  ];

  return keys
    .filter(
      (key) =>
        counts.has(key),
    )
    .map(
      (key) => ({
        key,

        count:
          counts.get(key),

        percentage:
          safePercent(
            counts.get(key),
            rows.length,
          ),
      }),
    );
}

function topCodes(
  rows,
  field,
  limit,
) {
  const counts =
    new Map();

  for (
    const row
    of rows
  ) {
    for (
      const code
      of row[field] ?? []
    ) {
      counts.set(
        code,
        (
          counts.get(code)
          ?? 0
        ) + 1,
      );
    }
  }

  return [
    ...counts.entries(),
  ]
    .map(
      ([
        key,
        count,
      ]) => ({
        key,
        count,

        percentageOfDecisions:
          safePercent(
            count,
            rows.length,
          ),
      }),
    )
    .sort(
      (a, b) =>
        b.count
          - a.count
        || a.key.localeCompare(
          b.key,
        ),
    )
    .slice(
      0,
      limit,
    );
}

function aggregateTrend(
  rows,
  bucket,
  maxBuckets,
) {
  const buckets =
    new Map();

  const bucketKey =
    (value) => {
      if (!value) {
        return null;
      }

      const date =
        new Date(value);

      if (
        Number.isNaN(
          date.getTime(),
        )
      ) {
        return null;
      }

      if (
        bucket === 'hour'
      ) {
        return `${date
          .toISOString()
          .slice(
            0,
            13,
          )}:00:00.000Z`;
      }

      if (
        bucket === 'week'
      ) {
        const week =
          new Date(
            date,
          );

        const day =
          week.getUTCDay();

        week.setUTCDate(
          week.getUTCDate()
            - (
              day === 0
                ? 6
                : day - 1
            ),
        );

        week.setUTCHours(
          0,
          0,
          0,
          0,
        );

        return week.toISOString();
      }

      return startOfDay(
        value,
      );
    };

  for (
    const row
    of rows
  ) {
    const key =
      bucketKey(
        row.occurredAt,
      );

    if (!key) {
      continue;
    }

    if (
      !buckets.has(key)
    ) {
      buckets.set(
        key,
        {
          bucket:
            key,

          total:
            0,

          allow:
            0,

          allowWithControls:
            0,

          review:
            0,

          approvalRequired:
            0,

          block:
            0,

          conflict:
            0,

          stale:
            0,

          indeterminate:
            0,

          highRisk:
            0,

          criticalRisk:
            0,

          integrityFailures:
            0,

          authorized:
            0,
        },
      );
    }

    const item =
      buckets.get(
        key,
      );

    item.total += 1;

    if (
      row.outcome
        === DASHBOARD_OUTCOMES
          .ALLOW
    ) {
      item.allow += 1;
    }

    if (
      row.outcome
        === DASHBOARD_OUTCOMES
          .ALLOW_WITH_CONTROLS
    ) {
      item.allowWithControls += 1;
    }

    if (
      row.outcome
        === DASHBOARD_OUTCOMES
          .REQUIRE_REVIEW
    ) {
      item.review += 1;
    }

    if (
      row.outcome
        === DASHBOARD_OUTCOMES
          .REQUIRE_APPROVAL
    ) {
      item.approvalRequired += 1;
    }

    if (
      row.outcome
        === DASHBOARD_OUTCOMES
          .BLOCK
    ) {
      item.block += 1;
    }

    if (
      row.outcome
        === DASHBOARD_OUTCOMES
          .CONFLICT
    ) {
      item.conflict += 1;
    }

    if (
      row.outcome
        === DASHBOARD_OUTCOMES
          .STALE
    ) {
      item.stale += 1;
    }

    if (
      row.outcome
        === DASHBOARD_OUTCOMES
          .INDETERMINATE
    ) {
      item.indeterminate += 1;
    }

    if (
      row.riskLevel
        === DASHBOARD_RISK_LEVELS
          .HIGH
    ) {
      item.highRisk += 1;
    }

    if (
      row.riskLevel
        === DASHBOARD_RISK_LEVELS
          .CRITICAL
    ) {
      item.criticalRisk += 1;
    }

    if (
      row.integrityState
        === DASHBOARD_INTEGRITY_STATES
          .FAILED
    ) {
      item.integrityFailures += 1;
    }

    if (
      row.approvalState
        === DASHBOARD_APPROVAL_STATES
          .AUTHORIZED
    ) {
      item.authorized += 1;
    }
  }

  return [
    ...buckets.values(),
  ]
    .sort(
      (a, b) =>
        a.bucket.localeCompare(
          b.bucket,
        ),
    )
    .slice(
      -maxBuckets,
    )
    .map(
      (item) => ({
        ...item,

        blockRate:
          safePercent(
            item.block,
            item.total,
          ),

        reviewRate:
          safePercent(
            item.review,
            item.total,
          ),

        authorizationRate:
          safePercent(
            item.authorized,
            item.approvalRequired,
          ),

        integrityFailureRate:
          safePercent(
            item.integrityFailures,
            item.total,
          ),
      }),
    );
}

function resolveRange(
  input,
  config,
  clock,
) {
  const now =
    iso(
      clock(),
      new Date().toISOString(),
    );

  const to =
    iso(
      input.to,
      now,
    );

  const from =
    iso(
      input.from,
      addDays(
        to,
        -config.defaultRangeDays,
      ),
    );

  if (
    !from
    || !to
  ) {
    throw new DashboardAggregatorError(
      DASHBOARD_AGGREGATOR_ERROR_CODES
        .RANGE_INVALID,

      'Dashboard range is invalid.',

      {
        from,
        to,
      },
    );
  }

  const fromMs =
    new Date(
      from,
    ).getTime();

  const toMs =
    new Date(
      to,
    ).getTime();

  if (
    fromMs > toMs
  ) {
    throw new DashboardAggregatorError(
      DASHBOARD_AGGREGATOR_ERROR_CODES
        .RANGE_INVALID,

      'Dashboard range start must not exceed its end.',

      {
        from,
        to,
      },
    );
  }

  const rangeDays =
    Math.ceil(
      (
        toMs
        - fromMs
      ) / 86_400_000,
    );

  if (
    rangeDays
      > config.maxRangeDays
  ) {
    throw new DashboardAggregatorError(
      DASHBOARD_AGGREGATOR_ERROR_CODES
        .RANGE_TOO_LARGE,

      `Dashboard range exceeds ${config.maxRangeDays} days.`,

      {
        rangeDays,

        maxRangeDays:
          config.maxRangeDays,
      },
    );
  }

  return Object.freeze({
    from,
    to,
    rangeDays,
  });
}

function assertPlainObject(
  value,
  name,
) {
  if (
    !isPlainObject(value)
  ) {
    throw new DashboardAggregatorError(
      DASHBOARD_AGGREGATOR_ERROR_CODES
        .INVALID_INPUT,

      `${name} must be an object.`,
    );
  }
}

export class DashboardAggregatorError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message);

    this.name =
      'DashboardAggregatorError';

    this.code =
      code;

    this.details =
      redact(
        details,
      );

    this.retryable =
      Boolean(
        options.retryable,
      );

    this.httpStatus =
      Number.isFinite(
        options.httpStatus,
      )
        ? options.httpStatus
        : 400;

    this.cause =
      options.cause;
  }
}

export class InMemoryDashboardAggregatorRepository {
  constructor(
    seed = {},
  ) {
    this.snapshots =
      Array.isArray(
        seed.snapshots,
      )
        ? clone(
            seed.snapshots,
          )
        : [];
  }

  async saveSnapshot(
    record,
  ) {
    const existing =
      this.snapshots.find(
        (item) =>
          item.tenantId
            === record.tenantId
          && item.snapshotId
            === record.snapshotId,
      );

    if (existing) {
      return clone(
        existing,
      );
    }

    this.snapshots.push(
      clone(record),
    );

    return clone(
      record,
    );
  }

  async getSnapshot({
    tenantId,
    snapshotId,
  }) {
    return clone(
      this.snapshots.find(
        (item) =>
          item.tenantId
            === tenantId
          && item.snapshotId
            === snapshotId,
      )
      ?? null,
    );
  }

  async listSnapshots({
    tenantId,
    from,
    to,
    limit = 50,
    offset = 0,
  }) {
    const fromMs =
      from
        ? new Date(
            from,
          ).getTime()
        : -Infinity;

    const toMs =
      to
        ? new Date(
            to,
          ).getTime()
        : Infinity;

    const rows =
      this.snapshots
        .filter(
          (item) =>
            item.tenantId
              === tenantId,
        )
        .filter(
          (item) => {
            const at =
              new Date(
                item.generatedAt
                  ?? 0,
              ).getTime();

            return (
              at >= fromMs
              && at <= toMs
            );
          },
        )
        .sort(
          (a, b) =>
            new Date(
              b.generatedAt
                ?? 0,
            )
            - new Date(
              a.generatedAt
                ?? 0,
            ),
        );

    return {
      entries:
        rows.slice(
          offset,
          offset + limit,
        ),

      total:
        rows.length,

      limit,
      offset,

      hasMore:
        offset + limit
          < rows.length,
    };
  }

  async healthCheck() {
    return {
      ok: true,

      component:
        'in-memory-dashboard-aggregator-repository',
    };
  }

  async close() {}
}

export class DashboardAggregator {
  constructor(
    options = {},
  ) {
    assertPlainObject(
      options,
      'options',
    );

    this.config =
      Object.freeze({
        ...DEFAULT_CONFIG,

        ...(
          isPlainObject(
            options.config,
          )
            ? options.config
            : {}
        ),
      });

    const provider =
      upper(
        this.config.provider
          ?? PROVIDER,
        30,
      );

    if (
      provider
        !== PROVIDER
    ) {
      throw new DashboardAggregatorError(
        DASHBOARD_AGGREGATOR_ERROR_CODES
          .PROVIDER_SCOPE_VIOLATION,

        `Dashboard aggregator scope is ${PROVIDER}.`,
      );
    }

    this.repository =
      options.repository
      ?? options.dashboardRepository
      ?? null;

    this.governanceDashboard =
      options.governanceDashboard
      ?? null;

    this.complianceCenter =
      options.complianceCenter
      ?? null;

    this.alertManager =
      options.alertManager
      ?? null;

    this.agentOrchestrator =
      options.agentOrchestrator
      ?? null;

    this.modelDriftMonitor =
      options.modelDriftMonitor
      ?? null;

    this.explainabilityStore =
      options.explainabilityStore
      ?? null;

    this.auditLedger =
      options.auditLedger
      ?? options.decisionAuditLedger
      ?? null;

    this.governanceService =
      options.governanceService
      ?? options.decisionGovernanceService
      ?? null;

    this.policyEngine =
      options.policyEngine
      ?? options.decisionPolicyEngine
      ?? null;

    this.approvalWorkflow =
      options.approvalWorkflow
      ?? null;

    this.logger =
      options.logger
      ?? null;

    this.metrics =
      options.metrics
      ?? null;

    this.clock =
      typeof options.clock
        === 'function'
        ? options.clock
        : () => new Date();

    if (
      !this.repository
      && !this.governanceDashboard
      && !this.complianceCenter
      && !this.alertManager
      && !this.agentOrchestrator
      && !this.modelDriftMonitor
      && !this.explainabilityStore
      && !this.auditLedger
    ) {
      throw new DashboardAggregatorError(
        DASHBOARD_AGGREGATOR_ERROR_CODES
          .SOURCE_REQUIRED,

        'At least one dashboard source is required.',
      );
    }
  }

  _tenantId(
    tenantId,
  ) {
    const normalized =
      normalizeString(
        tenantId,
        this.config
          .maxTenantIdLength,
      );

    if (
      this.config
        .tenantRequired
      && !normalized
    ) {
      throw new DashboardAggregatorError(
        DASHBOARD_AGGREGATOR_ERROR_CODES
          .TENANT_REQUIRED,

        'tenantId is required.',
      );
    }

    return normalized;
  }

  _provider(
    provider,
  ) {
    const normalized =
      upper(
        provider
          ?? PROVIDER,
        30,
      );

    if (
      normalized
        !== PROVIDER
    ) {
      throw new DashboardAggregatorError(
        DASHBOARD_AGGREGATOR_ERROR_CODES
          .PROVIDER_SCOPE_VIOLATION,

        `Dashboard provider scope is ${PROVIDER}.`,

        {
          provider:
            normalized,
        },
      );
    }

    return PROVIDER;
  }

  _log(
    level,
    message,
    error,
    context = {},
  ) {
    try {
      const method =
        this.logger?.[
          level
        ]
        ?? this.logger?.info;

      if (
        typeof method
          === 'function'
      ) {
        method.call(
          this.logger,

          {
            component:
              COMPONENT,

            ...redact(
              context,
            ),

            ...(error
              ? {
                  error: {
                    name:
                      error.name,

                    code:
                      error.code,

                    message:
                      error.message,

                    retryable:
                      Boolean(
                        error.retryable,
                      ),
                  },
                }
              : {}),
          },

          message,
        );
      }
    } catch {
      // Logging is non-authoritative.
    }
  }

  _metric(
    name,
    labels = {},
    value = 1,
  ) {
    try {
      if (
        typeof this.metrics
          ?.increment
          === 'function'
      ) {
        this.metrics.increment(
          name,
          labels,
          value,
        );
      } else if (
        typeof this.metrics
          ?.inc
          === 'function'
      ) {
        this.metrics.inc(
          name,
          value,
          labels,
        );
      }
    } catch {
      // Metrics are non-authoritative.
    }
  }

  async _source(
    name,
    source,
    methods,
    payload,
    failures,
  ) {
    if (!source) {
      return {
        configured: false,
        available: false,
        source: name,
        value: null,
        method: null,
      };
    }

    for (
      const method
      of methods
    ) {
      if (
        typeof source[method]
          !== 'function'
      ) {
        continue;
      }

      try {
        return {
          configured:
            true,

          available:
            true,

          source:
            name,

          value:
            await source[
              method
            ](
              payload,
            ),

          method,
        };
      } catch (
        error
      ) {
        failures.push({
          source:
            name,

          method,

          error: {
            name:
              error.name,

            code:
              error.code,

            message:
              error.message,

            retryable:
              Boolean(
                error.retryable,
              ),
          },
        });

        this._log(
          'warn',

          `Dashboard source ${name} failed.`,

          error,

          {
            source:
              name,

            method,
          },
        );

        return {
          configured:
            true,

          available:
            false,

          source:
            name,

          value:
            null,

          method,

          error,
        };
      }
    }

    const error =
      new DashboardAggregatorError(
        DASHBOARD_AGGREGATOR_ERROR_CODES
          .SOURCE_PROTOCOL_ERROR,

        `Dashboard source ${name} does not expose a supported read method.`,

        {
          methods,
        },

        {
          httpStatus:
            503,
        },
      );

    failures.push({
      source:
        name,

      method:
        null,

      error: {
        code:
          error.code,

        message:
          error.message,
      },
    });

    return {
      configured:
        true,

      available:
        false,

      source:
        name,

      value:
        null,

      method:
        null,

      error,
    };
  }

  async _loadAll(
    tenantId,
    range,
    filters,
    failures,
  ) {
    const results =
      {};

    results.governance =
      await this._source(
        'governance',

        this.governanceDashboard,

        [
          'getOverview',
          'getSnapshot',
          'getDashboardSummary',
        ],

        {
          tenantId,

          provider:
            PROVIDER,

          from:
            range.from,

          to:
            range.to,

          filters:
            redact(
              filters,
            ),

          maxRecords:
            this.config
              .maxSourceRecords,
        },

        failures,
      );

    results.compliance =
      await this._source(
        'compliance',

        this.complianceCenter,

        [
          'summary',
          'listCases',
        ],

        {
          tenantId,

          provider:
            PROVIDER,

          from:
            range.from,

          to:
            range.to,

          limit:
            this.config
              .maxSourceRecords,

          offset:
            0,

          filters:
            redact(
              filters,
            ),
        },

        failures,
      );

    results.alerts =
      await this._source(
        'alerts',

        this.alertManager,

        [
          'summary',
          'listAlerts',
          'list',
        ],

        {
          tenantId,

          provider:
            PROVIDER,

          from:
            range.from,

          to:
            range.to,

          limit:
            this.config
              .maxSourceRecords,

          offset:
            0,

          filters:
            redact(
              filters,
            ),
        },

        failures,
      );

    results.agents =
      await this._source(
        'agents',

        this.agentOrchestrator,

        [
          'listRuns',
        ],

        {
          tenantId,

          provider:
            PROVIDER,

          from:
            range.from,

          to:
            range.to,

          limit:
            this.config
              .maxSourceRecords,

          offset:
            0,
        },

        failures,
      );

    results.modelDrift =
      await this._source(
        'modelDrift',

        this.modelDriftMonitor,

        [
          'summary',
          'getDashboardSummary',
          'listReports',
        ],

        {
          tenantId,

          provider:
            PROVIDER,

          from:
            range.from,

          to:
            range.to,

          limit:
            this.config
              .maxSourceRecords,

          offset:
            0,
        },

        failures,
      );

    results.explainability =
      await this._source(
        'explainability',

        this.explainabilityStore,

        [
          'listTenant',
        ],

        {
          tenantId,

          provider:
            PROVIDER,

          from:
            range.from,

          to:
            range.to,

          limit:
            this.config
              .maxSourceRecords,

          offset:
            0,
        },

        failures,
      );

    results.audit =
      await this._source(
        'audit',

        this.auditLedger,

        [
          'listTenantAudit',
          'listTenant',
          'getDashboardSummary',
        ],

        {
          tenantId,

          provider:
            PROVIDER,

          from:
            range.from,

          to:
            range.to,

          limit:
            this.config
              .maxSourceRecords,

          offset:
            0,
        },

        failures,
      );

    return results;
  }

  _normalizeRecord(
    record,
    source,
  ) {
    if (
      !isPlainObject(record)
    ) {
      return null;
    }

    const provider =
      upper(
        record.provider
          ?? record.providerCode,
        30,
      );

    if (
      provider
      && provider
        !== PROVIDER
    ) {
      return null;
    }

    const decisionId =
      normalizeString(
        record.decisionId
          ?? record.decision
            ?.decisionId
          ?? record.subject
            ?.decisionId,

        180,
      );

    const approvalRequired =
      Boolean(
        record.approvalRequired
          ?? record.approval
            ?.required
          ?? record.governance
            ?.approvalRequired,
      );

    return {
      source,

      tenantIdDigest:
        record.tenantId
          ? digest(
              record.tenantId,
            )
          : null,

      decisionIdDigest:
        decisionId
          ? digest(
              decisionId,
            )
          : null,

      occurredAt:
        iso(
          record.occurredAt
            ?? record.evaluatedAt
            ?? record.createdAt
            ?? record.recordedAt,

          null,
        ),

      outcome:
        normalizeOutcome(
          record.outcome
            ?? record.decision
              ?.outcome
            ?? record.decision
              ?.decision
            ?? record.governance
              ?.outcome,
        ),

      approvalRequired,

      approvalState:
        normalizeApproval(
          record.approvalState
            ?? record.approval
              ?.state
            ?? record.approval
              ?.status
            ?? record.governance
              ?.executionState,

          approvalRequired,
        ),

      riskLevel:
        normalizeRisk(
          record.riskLevel
            ?? record.risk
              ?.level
            ?? record.governance
              ?.riskLevel,
        ),

      integrityState:
        normalizeIntegrity(
          record.integrityState
            ?? record.integrity
              ?.status
            ?? record.verification
              ?.state,
        ),

      confidence:
        finiteNumber(
          record.confidence
            ?? record.decision
              ?.confidence
            ?? record.governance
              ?.confidence,
        ),

      reasons:
        this._codes(
          record.reasonCodes
            ?? record.reasons
            ?? record.decision
              ?.reasonCodes,
        ),

      controls:
        this._codes(
          record.controls
            ?? record.governance
              ?.controls,
        ),

      sourceFingerprint:
        normalizeString(
          record.fingerprint
            ?? record.decisionFingerprint
            ?? record.governanceFingerprint,

          180,
        )
        ?? null,
    };
  }

  _codes(
    value,
  ) {
    if (
      typeof value
        === 'string'
    ) {
      return [
        normalizeString(
          value,
          180,
        ),
      ].filter(Boolean);
    }

    if (
      !Array.isArray(
        value,
      )
    ) {
      return [];
    }

    return [
      ...new Set(
        value
          .map(
            (item) =>
              isPlainObject(item)
                ? item.code
                  ?? item.reasonCode
                  ?? item.id
                : item,
          )
          .map(
            (item) =>
              normalizeString(
                item,
                180,
              ),
          )
          .filter(Boolean),
      ),
    ].slice(
      0,
      this.config
        .maxTopItems,
    );
  }

  _extractEntries(
    value,
    source,
  ) {
    if (!value) {
      return [];
    }

    const candidates = [
      value.entries,
      value.records,
      value.decisions,
      value.snapshot?.entries,
    ];

    const candidate =
      candidates.find(
        Array.isArray,
      );

    return (
      candidate
      ?? []
    )
      .map(
        (item) =>
          this._normalizeRecord(
            item,
            source,
          ),
      )
      .filter(Boolean);
  }

  _dedupe(
    records,
  ) {
    const seen =
      new Set();

    const result =
      [];

    for (
      const record
      of records.sort(
        (a, b) =>
          new Date(
            b.occurredAt
              ?? 0,
          )
          - new Date(
            a.occurredAt
              ?? 0,
          ),
      )
    ) {
      const key = [
        record.decisionIdDigest
          ?? record.sourceFingerprint
          ?? 'NONE',

        record.occurredAt
          ?? 'NONE',
      ].join('|');

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);

      result.push(
        record,
      );

      if (
        result.length
          >= this.config
            .maxSourceRecords
      ) {
        break;
      }
    }

    return result;
  }

  _summary(
    rows,
  ) {
    const total =
      rows.length;

    const approvalRequired =
      rows.filter(
        (r) =>
          r.approvalRequired,
      ).length;

    const approved =
      rows.filter(
        (r) =>
          r.approvalState
            === DASHBOARD_APPROVAL_STATES
              .APPROVED,
      ).length;

    const authorized =
      rows.filter(
        (r) =>
          r.approvalState
            === DASHBOARD_APPROVAL_STATES
              .AUTHORIZED,
      ).length;

    const block =
      rows.filter(
        (r) =>
          r.outcome
            === DASHBOARD_OUTCOMES
              .BLOCK,
      ).length;

    const review =
      rows.filter(
        (r) =>
          r.outcome
            === DASHBOARD_OUTCOMES
              .REQUIRE_REVIEW,
      ).length;

    const requireApproval =
      rows.filter(
        (r) =>
          r.outcome
            === DASHBOARD_OUTCOMES
              .REQUIRE_APPROVAL,
      ).length;

    const conflict =
      rows.filter(
        (r) =>
          r.outcome
            === DASHBOARD_OUTCOMES
              .CONFLICT,
      ).length;

    const stale =
      rows.filter(
        (r) =>
          r.outcome
            === DASHBOARD_OUTCOMES
              .STALE,
      ).length;

    const indeterminate =
      rows.filter(
        (r) =>
          r.outcome
            === DASHBOARD_OUTCOMES
              .INDETERMINATE,
      ).length;

    const highRisk =
      rows.filter(
        (r) =>
          r.riskLevel
            === DASHBOARD_RISK_LEVELS
              .HIGH,
      ).length;

    const criticalRisk =
      rows.filter(
        (r) =>
          r.riskLevel
            === DASHBOARD_RISK_LEVELS
              .CRITICAL,
      ).length;

    const integrityFailures =
      rows.filter(
        (r) =>
          r.integrityState
            === DASHBOARD_INTEGRITY_STATES
              .FAILED,
      ).length;

    const integrityUnavailable =
      rows.filter(
        (r) =>
          r.integrityState
            === DASHBOARD_INTEGRITY_STATES
              .UNAVAILABLE,
      ).length;

    const confidence =
      rows.filter(
        (r) =>
          Number.isFinite(
            r.confidence,
          ),
      );

    return {
      totalDecisions:
        total,

      approvalsRequired:
        approvalRequired,

      approvalsApproved:
        approved,

      approvalsAuthorized:
        authorized,

      blockedDecisions:
        block,

      reviewRequired:
        review,

      approvalRequiredOutcomes:
        requireApproval,

      conflicts:
        conflict,

      staleDecisions:
        stale,

      indeterminateDecisions:
        indeterminate,

      highRiskDecisions:
        highRisk,

      criticalRiskDecisions:
        criticalRisk,

      integrityFailures:
        integrityFailures,

      integrityUnavailable:
        integrityUnavailable,

      approvalRate:
        safePercent(
          approved,
          approvalRequired,
        ),

      authorizationRate:
        safePercent(
          authorized,
          approvalRequired,
        ),

      blockRate:
        safePercent(
          block,
          total,
        ),

      reviewRate:
        safePercent(
          review,
          total,
        ),

      integrityFailureRate:
        safePercent(
          integrityFailures,
          total,
        ),

      meanConfidence:
        confidence.length
          ? Number(
              (
                confidence.reduce(
                  (
                    sum,
                    item,
                  ) =>
                    sum
                    + item.confidence,

                  0,
                )
                / confidence.length
              ).toFixed(6),
            )
          : null,
    };
  }

  _compliance(
    value,
  ) {
    if (!value) {
      return {
        dataState:
          DASHBOARD_DATA_STATES
            .UNAVAILABLE,

        unavailable:
          true,

        activeCases:
          null,

        openCases:
          null,

        reviewRequired:
          null,

        blockedCases:
          null,

        escalatedCases:
          null,

        clearedCases:
          null,

        closedCases:
          null,
      };
    }

    const counts =
      value.counts
        ?? value.summary?.counts;

    if (counts) {
      return {
        dataState:
          DASHBOARD_DATA_STATES
            .AVAILABLE,

        unavailable:
          false,

        activeCases:
          Number(
            value.activeCount
              ?? 0,
          ),

        openCases:
          Number(
            counts.OPEN
              ?? 0,
          ),

        reviewRequired:
          Number(
            counts.REVIEW_REQUIRED
              ?? 0,
          ),

        blockedCases:
          Number(
            counts.BLOCKED
              ?? 0,
          ),

        escalatedCases:
          Number(
            counts.ESCALATED
              ?? 0,
          ),

        clearedCases:
          Number(
            counts.CLEARED
              ?? 0,
          ),

        closedCases:
          Number(
            counts.CLOSED
              ?? 0,
          ),
      };
    }

    const result =
      page(value);

    const rows =
      result.entries;

    const statuses =
      rows.map(
        (item) =>
          upper(
            item.status,
            60,
          ),
      );

    return {
      dataState:
        result.hasMore
          ? DASHBOARD_DATA_STATES
              .TRUNCATED
          : rows.length
            ? DASHBOARD_DATA_STATES
                .AVAILABLE
            : DASHBOARD_DATA_STATES
                .EMPTY,

      unavailable:
        false,

      activeCases:
        statuses.filter(
          (status) =>
            [
              'OPEN',
              'REVIEW_REQUIRED',
              'ESCALATED',
              'BLOCKED',
            ].includes(
              status,
            ),
        ).length,

      openCases:
        statuses.filter(
          (status) =>
            status
              === 'OPEN',
        ).length,

      reviewRequired:
        statuses.filter(
          (status) =>
            status
              === 'REVIEW_REQUIRED',
        ).length,

      blockedCases:
        statuses.filter(
          (status) =>
            status
              === 'BLOCKED',
        ).length,

      escalatedCases:
        statuses.filter(
          (status) =>
            status
              === 'ESCALATED',
        ).length,

      clearedCases:
        statuses.filter(
          (status) =>
            status
              === 'CLEARED',
        ).length,

      closedCases:
        statuses.filter(
          (status) =>
            status
              === 'CLOSED',
        ).length,
    };
  }

  _alerts(
    value,
  ) {
    if (!value) {
      return {
        dataState:
          DASHBOARD_DATA_STATES
            .UNAVAILABLE,

        unavailable:
          true,

        activeAlerts:
          null,

        criticalAlerts:
          null,

        highAlerts:
          null,

        escalatedAlerts:
          null,

        acknowledgedAlerts:
          null,

        resolvedAlerts:
          null,
      };
    }

    const counts =
      value.counts
        ?? value.summary?.counts;

    if (counts) {
      return {
        dataState:
          DASHBOARD_DATA_STATES
            .AVAILABLE,

        unavailable:
          false,

        activeAlerts:
          Number(
            value.activeCount
              ?? 0,
          ),

        criticalAlerts:
          Number(
            value.criticalCount
              ?? 0,
          ),

        highAlerts:
          Number(
            value.highCount
              ?? 0,
          ),

        escalatedAlerts:
          Number(
            counts.ESCALATED
              ?? 0,
          ),

        acknowledgedAlerts:
          Number(
            counts.ACKNOWLEDGED
              ?? 0,
          ),

        resolvedAlerts:
          Number(
            counts.RESOLVED
              ?? 0,
          ),
      };
    }

    const result =
      page(value);

    const rows =
      result.entries;

    const active =
      new Set([
        'OPEN',
        'ACKNOWLEDGED',
        'ESCALATED',
        'SUPPRESSED',
      ]);

    return {
      dataState:
        result.hasMore
          ? DASHBOARD_DATA_STATES
              .TRUNCATED
          : rows.length
            ? DASHBOARD_DATA_STATES
                .AVAILABLE
            : DASHBOARD_DATA_STATES
                .EMPTY,

      unavailable:
        false,

      activeAlerts:
        rows.filter(
          (item) =>
            active.has(
              upper(
                item.status,
                50,
              ),
            ),
        ).length,

      criticalAlerts:
        rows.filter(
          (item) =>
            upper(
              item.severity,
              30,
            ) === 'CRITICAL',
        ).length,

      highAlerts:
        rows.filter(
          (item) =>
            upper(
              item.severity,
              30,
            ) === 'HIGH',
        ).length,

      escalatedAlerts:
        rows.filter(
          (item) =>
            upper(
              item.status,
              50,
            ) === 'ESCALATED',
        ).length,

      acknowledgedAlerts:
        rows.filter(
          (item) =>
            upper(
              item.status,
              50,
            ) === 'ACKNOWLEDGED',
        ).length,

      resolvedAlerts:
        rows.filter(
          (item) =>
            upper(
              item.status,
              50,
            ) === 'RESOLVED',
        ).length,
    };
  }

  _agents(
    value,
  ) {
    if (!value) {
      return {
        dataState:
          DASHBOARD_DATA_STATES
            .UNAVAILABLE,

        unavailable:
          true,

        totalRuns:
          null,

        completedRuns:
          null,

        partialRuns:
          null,

        failedRuns:
          null,

        blockedRuns:
          null,

        timedOutRuns:
          null,
      };
    }

    const result =
      page(value);

    const rows =
      result.entries;

    return {
      dataState:
        result.hasMore
          ? DASHBOARD_DATA_STATES
              .TRUNCATED
          : rows.length
            ? DASHBOARD_DATA_STATES
                .AVAILABLE
            : DASHBOARD_DATA_STATES
                .EMPTY,

      unavailable:
        false,

      totalRuns:
        result.total,

      completedRuns:
        rows.filter(
          (item) =>
            upper(
              item.status,
              40,
            ) === 'COMPLETED',
        ).length,

      partialRuns:
        rows.filter(
          (item) =>
            upper(
              item.status,
              40,
            ) === 'PARTIAL',
        ).length,

      failedRuns:
        rows.filter(
          (item) =>
            upper(
              item.status,
              40,
            ) === 'FAILED',
        ).length,

      blockedRuns:
        rows.filter(
          (item) =>
            upper(
              item.status,
              40,
            ) === 'BLOCKED',
        ).length,

      timedOutRuns:
        rows.filter(
          (item) =>
            upper(
              item.status,
              40,
            ) === 'TIMED_OUT',
        ).length,
    };
  }

  _modelDrift(
    value,
  ) {
    if (!value) {
      return {
        dataState:
          DASHBOARD_DATA_STATES
            .UNAVAILABLE,

        unavailable:
          true,

        reports:
          null,

        critical:
          null,

        significant:
          null,

        elevated:
          null,

        indeterminate:
          null,
      };
    }

    const result =
      page(value);

    const rows =
      Array.isArray(
        value.reports,
      )
        ? value.reports
        : result.entries;

    const total =
      Number(
        value.total
          ?? rows.length,
      );

    return {
      dataState:
        result.hasMore
          ? DASHBOARD_DATA_STATES
              .TRUNCATED
          : rows.length
            ? DASHBOARD_DATA_STATES
                .AVAILABLE
            : DASHBOARD_DATA_STATES
                .EMPTY,

      unavailable:
        false,

      reports:
        total,

      critical:
        rows.filter(
          (item) =>
            upper(
              item.overallStatus
                ?? item.status,
              40,
            ) === 'CRITICAL',
        ).length,

      significant:
        rows.filter(
          (item) =>
            upper(
              item.overallStatus
                ?? item.status,
              40,
            ) === 'SIGNIFICANT',
        ).length,

      elevated:
        rows.filter(
          (item) =>
            upper(
              item.overallStatus
                ?? item.status,
              40,
            ) === 'ELEVATED',
        ).length,

      indeterminate:
        rows.filter(
          (item) =>
            upper(
              item.overallStatus
                ?? item.status,
              40,
            ) === 'INDETERMINATE',
        ).length,
    };
  }

  _sourceStatus(
    results,
  ) {
    return Object.fromEntries(
      Object.entries(
        results,
      ).map(
        ([
          name,
          value,
        ]) => [
          name,
          {
            configured:
              Boolean(
                value?.configured,
              ),

            available:
              Boolean(
                value?.available,
              ),

            method:
              value?.method
              ?? null,
          },
        ],
      ),
    );
  }

  _health(
    results,
    failures,
    rows,
    aggregate,
  ) {
    const configured =
      Object.values(
        results,
      ).filter(
        (item) =>
          item.configured,
      );

    const available =
      configured.filter(
        (item) =>
          item.available,
      );

    let state =
      DASHBOARD_HEALTH_STATES
        .HEALTHY;

    if (
      !configured.length
      || !available.length
    ) {
      state =
        DASHBOARD_HEALTH_STATES
          .UNAVAILABLE;
    } else if (
      failures.length
      || aggregate.integrityFailures
    ) {
      state =
        DASHBOARD_HEALTH_STATES
          .DEGRADED;
    }

    return {
      state,

      healthy:
        state
          === DASHBOARD_HEALTH_STATES
            .HEALTHY,

      degraded:
        state
          === DASHBOARD_HEALTH_STATES
            .DEGRADED,

      unavailable:
        state
          === DASHBOARD_HEALTH_STATES
            .UNAVAILABLE,

      configuredSources:
        configured.length,

      availableSources:
        available.length,

      unavailableSources:
        configured.length
        - available.length,

      recordsObserved:
        rows.length,

      sourceFailures:
        failures.slice(
          0,
          this.config
            .maxSourceFailures,
        ),

      sourceStatus:
        this._sourceStatus(
          results,
        ),
    };
  }

  async aggregate(
    input = {},
  ) {
    assertPlainObject(
      input,
      'input',
    );

    const tenantId =
      this._tenantId(
        input.tenantId,
      );

    this._provider(
      input.provider,
    );

    const range =
      resolveRange(
        input,
        this.config,
        this.clock,
      );

    const filters =
      isPlainObject(
        input.filters,
      )
        ? input.filters
        : {};

    const bucket =
      [
        'hour',
        'day',
        'week',
      ].includes(
        input.bucket,
      )
        ? input.bucket
        : 'day';

    const failures =
      [];

    const sources =
      await this._loadAll(
        tenantId,
        range,
        filters,
        failures,
      );

    const rawRows = [
      ...this._extractEntries(
        sources.governance
          ?.value,

        DASHBOARD_SOURCE_TYPES
          .GOVERNANCE,
      ),

      ...this._extractEntries(
        sources.explainability
          ?.value,

        DASHBOARD_SOURCE_TYPES
          .EXPLAINABILITY,
      ),
    ];

    const rows =
      this._dedupe(
        rawRows,
      );

    const summary =
      this._summary(
        rows,
      );

    const compliance =
      this._compliance(
        sources.compliance
          ?.value,
      );

    const alerts =
      this._alerts(
        sources.alerts
          ?.value,
      );

    const agents =
      this._agents(
        sources.agents
          ?.value,
      );

    const modelDrift =
      this._modelDrift(
        sources.modelDrift
          ?.value,
      );

    const health =
      this._health(
        sources,
        failures,
        rows,
        summary,
      );

    const governanceCoverage =
      Array.isArray(
        sources.governance
          ?.value
          ?.intelligenceCoverage,
      )
        ? sources.governance.value
            .intelligenceCoverage
        : [];

    const intelligenceCoverage =
      INTELLIGENCE_KEYS.map(
        (key) => {
          const item =
            governanceCoverage.find(
              (candidate) =>
                String(
                  candidate
                    ?.component
                  ?? '',
                ).toLowerCase()
                  === key,
            );

          return item
            ? {
                component:
                  key,

                observations:
                  Number(
                    item.observations
                      ?? 0,
                  ),

                available:
                  Number(
                    item.available
                      ?? 0,
                  ),

                unavailable:
                  Number(
                    item.unavailable
                      ?? 0,
                  ),

                fingerprinted:
                  Number(
                    item.fingerprinted
                      ?? 0,
                  ),

                coveragePercentage:
                  Number(
                    item.coveragePercentage
                      ?? 0,
                  ),

                fingerprintCoveragePercentage:
                  Number(
                    item
                      .fingerprintCoveragePercentage
                      ?? 0,
                  ),

                source:
                  'GOVERNANCE_DASHBOARD',
              }
            : {
                component:
                  key,

                observations:
                  0,

                available:
                  0,

                unavailable:
                  null,

                fingerprinted:
                  0,

                coveragePercentage:
                  null,

                fingerprintCoveragePercentage:
                  null,

                source:
                  'NO_DIRECT_MEASUREMENT',
              };
        },
      );

    const dashboard = {
      schemaVersion:
        SCHEMA_VERSION,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      provider:
        PROVIDER,

      tenant: {
        tenantDigest:
          digest(
            tenantId,
          ),
      },

      generatedAt:
        iso(
          this.clock(),
          new Date().toISOString(),
        ),

      range,

      bucket,

      filters:
        redact(
          filters,
        ),

      summary,

      compliance,

      alerts,

      agents,

      modelDrift,

      distributions: {
        outcomes:
          histogram(
            rows,

            (row) =>
              row.outcome,

            OUTCOME_ORDER,
          ),

        risks:
          histogram(
            rows,

            (row) =>
              row.riskLevel,

            RISK_ORDER,
          ),

        approvals:
          histogram(
            rows,

            (row) =>
              row.approvalState,

            APPROVAL_ORDER,
          ),

        integrity:
          histogram(
            rows,

            (row) =>
              row.integrityState,

            INTEGRITY_ORDER,
          ),
      },

      intelligenceCoverage,

      topReasons:
        topCodes(
          rows,
          'reasons',
          this.config
            .maxTopItems,
        ),

      topControls:
        topCodes(
          rows,
          'controls',
          this.config
            .maxTopItems,
        ),

      trends:
        aggregateTrend(
          rows,
          bucket,
          this.config
            .maxTrendBuckets,
        ),

      dataQuality: {
        dataState:
          !Object.values(
            sources,
          ).some(
            (item) =>
              item.available,
          )
            ? DASHBOARD_DATA_STATES
                .UNAVAILABLE
            : failures.length
              ? DASHBOARD_DATA_STATES
                  .PARTIAL
              : rows.length
                ? DASHBOARD_DATA_STATES
                    .AVAILABLE
                : DASHBOARD_DATA_STATES
                    .EMPTY,

        sourceRecordsTruncated:
          rawRows.length
            > rows.length
          || rows.length
              >= this.config
                .maxSourceRecords,

        recordsAggregated:
          rows.length,

        sourceFailures:
          failures.length,

        unknownOutcomes:
          rows.filter(
            (row) =>
              row.outcome
                === DASHBOARD_OUTCOMES
                  .INDETERMINATE,
          ).length,

        unknownRisk:
          rows.filter(
            (row) =>
              row.riskLevel
                === DASHBOARD_RISK_LEVELS
                  .UNKNOWN,
          ).length,

        integrityUnavailable:
          rows.filter(
            (row) =>
              row.integrityState
                === DASHBOARD_INTEGRITY_STATES
                  .UNAVAILABLE,
          ).length,
      },

      health,

      safety: {
        readOnly:
          true,

        financialMutationPerformed:
          false,

        paymentExecutionPerformed:
          false,

        settlementPerformed:
          false,

        ledgerMutationPerformed:
          false,

        balanceMutationPerformed:
          false,

        providerCallPerformed:
          false,

        approvalGranted:
          false,

        policyMutationPerformed:
          false,

        complianceCaseMutationPerformed:
          false,

        alertMutationPerformed:
          false,

        modelMutationPerformed:
          false,

        executionAuthorized:
          false,
      },
    };

    const semantic =
      clone(
        dashboard,
      );

    delete semantic.generatedAt;

    dashboard.dashboardFingerprint =
      `sha256:${sha256(
        semantic,
      )}`;

    if (
      safeBytes(
        dashboard,
      )
        > this.config
          .maxPayloadBytes
    ) {
      throw new DashboardAggregatorError(
        DASHBOARD_AGGREGATOR_ERROR_CODES
          .PAYLOAD_TOO_LARGE,

        `Dashboard aggregate exceeds ${this.config.maxPayloadBytes} bytes.`,

        {
          maxPayloadBytes:
            this.config
              .maxPayloadBytes,
        },

        {
          httpStatus:
            413,
        },
      );
    }

    if (
      this.repository
      && typeof this.repository
        .saveSnapshot
          === 'function'
    ) {
      try {
        await this.repository
          .saveSnapshot({
            snapshotId:
              `dashboard-${sha256(
                `${tenantId}:${dashboard.dashboardFingerprint}:${dashboard.generatedAt}`,
              ).slice(
                0,
                24,
              )}`,

            tenantId,

            provider:
              PROVIDER,

            generatedAt:
              dashboard.generatedAt,

            range:
              dashboard.range,

            dashboardFingerprint:
              dashboard.dashboardFingerprint,

            summary:
              clone(
                dashboard.summary,
              ),

            compliance:
              clone(
                dashboard.compliance,
              ),

            alerts:
              clone(
                dashboard.alerts,
              ),

            agents:
              clone(
                dashboard.agents,
              ),

            modelDrift:
              clone(
                dashboard.modelDrift,
              ),

            distributions:
              clone(
                dashboard.distributions,
              ),

            intelligenceCoverage:
              clone(
                dashboard
                  .intelligenceCoverage,
              ),

            trends:
              clone(
                dashboard.trends,
              ),

            dataQuality:
              clone(
                dashboard.dataQuality,
              ),

            health:
              clone(
                dashboard.health,
              ),

            safety:
              clone(
                dashboard.safety,
              ),
          });
      } catch (
        error
      ) {
        this._log(
          'warn',

          'Dashboard snapshot persistence failed.',

          error,

          {
            tenantId:
              digest(
                tenantId,
              ),
          },
        );
      }
    }

    this._metric(
      'dashboard_aggregator_overviews_total',
      {
        health:
          health.state,
      },
    );

    return deepFreeze(
      redact(
        dashboard,
      ),
    );
  }

  async getOverview(
    input = {},
  ) {
    return this.aggregate(
      input,
    );
  }

  async getSnapshot(
    input = {},
  ) {
    return this.aggregate(
      input,
    );
  }

  async getSummary(
    input = {},
  ) {
    const result =
      await this.aggregate(
        input,
      );

    return deepFreeze({
      component:
        result.component,

      provider:
        result.provider,

      tenant:
        result.tenant,

      generatedAt:
        result.generatedAt,

      range:
        result.range,

      summary:
        result.summary,

      compliance:
        result.compliance,

      alerts:
        result.alerts,

      agents:
        result.agents,

      modelDrift:
        result.modelDrift,

      dataQuality:
        result.dataQuality,

      health:
        result.health,

      dashboardFingerprint:
        result.dashboardFingerprint,
    });
  }

  async getTrends(
    input = {},
  ) {
    const result =
      await this.aggregate(
        input,
      );

    return deepFreeze({
      component:
        result.component,

      provider:
        result.provider,

      tenant:
        result.tenant,

      generatedAt:
        result.generatedAt,

      range:
        result.range,

      bucket:
        result.bucket,

      trends:
        result.trends,

      health:
        result.health,

      dashboardFingerprint:
        result.dashboardFingerprint,
    });
  }

  async getRisk(
    input = {},
  ) {
    const result =
      await this.aggregate(
        input,
      );

    return deepFreeze({
      component:
        result.component,

      provider:
        result.provider,

      tenant:
        result.tenant,

      generatedAt:
        result.generatedAt,

      range:
        result.range,

      outcomes:
        result.distributions
          .outcomes,

      risks:
        result.distributions
          .risks,

      integrity:
        result.distributions
          .integrity,

      topReasons:
        result.topReasons,

      topControls:
        result.topControls,

      compliance:
        result.compliance,

      alerts:
        result.alerts,

      modelDrift:
        result.modelDrift,

      health:
        result.health,

      dashboardFingerprint:
        result.dashboardFingerprint,
    });
  }

  async getOperations(
    input = {},
  ) {
    const result =
      await this.aggregate(
        input,
      );

    return deepFreeze({
      component:
        result.component,

      provider:
        result.provider,

      tenant:
        result.tenant,

      generatedAt:
        result.generatedAt,

      range:
        result.range,

      alerts:
        result.alerts,

      agents:
        result.agents,

      trends:
        result.trends,

      dataQuality:
        result.dataQuality,

      health:
        result.health,

      dashboardFingerprint:
        result.dashboardFingerprint,
    });
  }

  async getCompliance(
    input = {},
  ) {
    const result =
      await this.aggregate(
        input,
      );

    return deepFreeze({
      component:
        result.component,

      provider:
        result.provider,

      tenant:
        result.tenant,

      generatedAt:
        result.generatedAt,

      range:
        result.range,

      compliance:
        result.compliance,

      alerts:
        result.alerts,

      health:
        result.health,

      dashboardFingerprint:
        result.dashboardFingerprint,
    });
  }

  async getIntelligenceCoverage(
    input = {},
  ) {
    const result =
      await this.aggregate(
        input,
      );

    return deepFreeze({
      component:
        result.component,

      provider:
        result.provider,

      tenant:
        result.tenant,

      generatedAt:
        result.generatedAt,

      range:
        result.range,

      intelligenceCoverage:
        result.intelligenceCoverage,

      health:
        result.health,

      dashboardFingerprint:
        result.dashboardFingerprint,
    });
  }

  async listSnapshots({
    tenantId,
    from,
    to,
    limit =
      this.config.defaultLimit,
    offset = 0,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    const range =
      resolveRange(
        {
          from,
          to,
        },

        this.config,

        this.clock,
      );

    if (
      !this.repository
      || typeof this.repository
        .listSnapshots
          !== 'function'
    ) {
      throw new DashboardAggregatorError(
        DASHBOARD_AGGREGATOR_ERROR_CODES
          .SOURCE_UNAVAILABLE,

        'Dashboard snapshot repository is not configured.',

        {},

        {
          httpStatus:
            503,
        },
      );
    }

    const boundedLimit =
      integer(
        limit,
        this.config
          .defaultLimit,

        1,

        this.config
          .maxLimit,
      );

    const boundedOffset =
      integer(
        offset,
        0,
        0,
        Number.MAX_SAFE_INTEGER,
      );

    return deepFreeze(
      redact(
        await this.repository
          .listSnapshots({
            tenantId:
              scopedTenant,

            provider:
              PROVIDER,

            from:
              range.from,

            to:
              range.to,

            limit:
              boundedLimit,

            offset:
              boundedOffset,
          }),
      ),
    );
  }

  async getStoredSnapshot({
    tenantId,
    snapshotId,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    const id =
      normalizeString(
        snapshotId,
        180,
      );

    if (!id) {
      throw new DashboardAggregatorError(
        DASHBOARD_AGGREGATOR_ERROR_CODES
          .INVALID_INPUT,

        'snapshotId is required.',
      );
    }

    if (
      !this.repository
      || typeof this.repository
        .getSnapshot
          !== 'function'
    ) {
      throw new DashboardAggregatorError(
        DASHBOARD_AGGREGATOR_ERROR_CODES
          .SOURCE_UNAVAILABLE,

        'Dashboard snapshot repository is not configured.',

        {},

        {
          httpStatus:
            503,
        },
      );
    }

    const snapshot =
      await this.repository
        .getSnapshot({
          tenantId:
            scopedTenant,

          provider:
            PROVIDER,

          snapshotId:
            id,
        });

    return snapshot
      ? deepFreeze(
          redact(
            snapshot,
          ),
        )
      : null;
  }

  async exportOverview(
    input = {},
  ) {
    const overview =
      await this.aggregate(
        input,
      );

    const content =
      JSON.stringify(
        overview,
        null,
        2,
      );

    const bytes =
      Buffer.byteLength(
        content,
        'utf8',
      );

    if (
      bytes
        > this.config
          .maxExportBytes
    ) {
      throw new DashboardAggregatorError(
        DASHBOARD_AGGREGATOR_ERROR_CODES
          .EXPORT_TOO_LARGE,

        `Dashboard export exceeds ${this.config.maxExportBytes} bytes.`,

        {
          bytes,

          maxExportBytes:
            this.config
              .maxExportBytes,
        },

        {
          httpStatus:
            413,
        },
      );
    }

    return Object.freeze({
      contentType:
        'application/json',

      filename:
        `airtel-command-center-dashboard-${overview.range.from.slice(0, 10)}-${overview.range.to.slice(0, 10)}.json`,

      bytes,

      fingerprint:
        `sha256:${sha256(
          content,
        )}`,

      content,
    });
  }

  async health() {
    const sources = {
      repository:
        this.repository,

      governanceDashboard:
        this.governanceDashboard,

      complianceCenter:
        this.complianceCenter,

      alertManager:
        this.alertManager,

      agentOrchestrator:
        this.agentOrchestrator,

      modelDriftMonitor:
        this.modelDriftMonitor,

      explainabilityStore:
        this.explainabilityStore,

      auditLedger:
        this.auditLedger,
    };

    const status =
      {};

    for (
      const [
        name,
        source,
      ]
      of Object.entries(
        sources,
      )
    ) {
      if (!source) {
        status[name] = {
          configured:
            false,

          available:
            false,

          health:
            null,
        };

        continue;
      }

      let health =
        null;

      try {
        if (
          typeof source
            .readiness
            === 'function'
        ) {
          health =
            await source
              .readiness();
        } else if (
          typeof source
            .health
            === 'function'
        ) {
          health =
            await source
              .health();
        } else if (
          typeof source
            .healthCheck
            === 'function'
        ) {
          health =
            await source
              .healthCheck();
        } else {
          health = {
            ok:
              true,

            reason:
              'configured; health contract not implemented',
          };
        }
      } catch (
        error
      ) {
        health = {
          ok:
            false,

          error: {
            name:
              error.name,

            code:
              error.code,

            message:
              error.message,
          },
        };
      }

      status[name] = {
        configured:
          true,

        available:
          health?.ok
            !== false,

        health:
          redact(
            health,
          ),
      };
    }

    const configured =
      Object.values(
        status,
      ).filter(
        (item) =>
          item.configured,
      );

    const available =
      configured.filter(
        (item) =>
          item.available,
      );

    const unhealthySources =
      Object.entries(
        status,
      )
        .filter(
          ([
            ,
            item,
          ]) =>
            item.configured
            && !item.available,
        )
        .map(
          ([
            name,
          ]) =>
            name,
        );

    const state =
      !configured.length
        ? DASHBOARD_HEALTH_STATES
            .UNAVAILABLE
        : !available.length
          ? DASHBOARD_HEALTH_STATES
              .UNAVAILABLE
          : unhealthySources.length
            ? DASHBOARD_HEALTH_STATES
                .DEGRADED
            : DASHBOARD_HEALTH_STATES
                .HEALTHY;

    return deepFreeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      state,

      healthy:
        state
          === DASHBOARD_HEALTH_STATES
            .HEALTHY,

      degraded:
        state
          === DASHBOARD_HEALTH_STATES
            .DEGRADED,

      unavailable:
        state
          === DASHBOARD_HEALTH_STATES
            .UNAVAILABLE,

      sourceAvailabilityRate:
        safePercent(
          available.length,
          configured.length,
        ),

      sources:
        status,

      unhealthySources,

      safety: {
        readOnly:
          true,

        financialMutationPerformed:
          false,

        paymentExecutionPerformed:
          false,

        settlementPerformed:
          false,

        ledgerMutationPerformed:
          false,

        balanceMutationPerformed:
          false,

        providerCallPerformed:
          false,

        approvalGranted:
          false,

        executionAuthorized:
          false,
      },
    });
  }

  async readiness() {
    return this.health();
  }

  getComponentInfo() {
    return Object.freeze({
      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      provider:
        PROVIDER,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      readOnly:
        true,

      tenantIsolation:
        true,

      providerScope:
        PROVIDER,

      deterministicAggregation:
        true,

      deterministicFingerprint:
        true,

      boundedReads:
        true,

      boundedTrends:
        true,

      integrityAware:
        true,

      complianceAware:
        true,

      modelRiskAware:
        true,

      alertAware:
        true,

      agentAware:
        true,

      storesFinancialState:
        false,

      executesPayments:
        false,

      callsProvider:
        false,

      settlesPayments:
        false,

      mutatesLedger:
        false,

      mutatesBalances:
        false,

      grantsApproval:
        false,

      mutatesPolicies:
        false,

      mutatesComplianceCases:
        false,

      mutatesAlerts:
        false,

      mutatesModels:
        false,

      arbitraryCodeExecution:
        false,

      internalScheduler:
        false,
    });
  }
}

export function createDashboardAggregator(
  options = {},
) {
  return new DashboardAggregator(
    options,
  );
}

export const createAirtelDashboardAggregator =
  createDashboardAggregator;

export const AirtelDashboardAggregator =
  DashboardAggregator;

export const constants =
  Object.freeze({
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    PROVIDER,
    SCHEMA_VERSION,
    HASH_ALGORITHM,
    DASHBOARD_HEALTH_STATES,
    DASHBOARD_DATA_STATES,
    DASHBOARD_OUTCOMES,
    DASHBOARD_RISK_LEVELS,
    DASHBOARD_APPROVAL_STATES,
    DASHBOARD_INTEGRITY_STATES,
    DASHBOARD_SOURCE_TYPES,
    DASHBOARD_AGGREGATOR_ERROR_CODES,
  });

export function buildDashboardFingerprint(
  value,
) {
  return `sha256:${sha256(
    value,
  )}`;
}

export default DashboardAggregator;