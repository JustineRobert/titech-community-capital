/**
 * TITech Community Capital
 * File: backend/modules/payment/airtel/intelligence/governance/governanceDashboard.js
 *
 * Architectural role
 * ------------------
 * Read-only operational dashboard and governance observability boundary for
 * Airtel payment intelligence decisions.
 *
 * This module composes bounded, tenant-scoped governance evidence into a
 * stable dashboard read model for operators, compliance teams, reviewers,
 * engineering teams, and internal APIs. It deliberately consumes existing
 * governance components instead of re-evaluating policy, risk, prediction,
 * recommendation, approval, or payment decisions.
 *
 * Important boundaries / non-responsibilities
 * --------------------------------------------
 * - NOT the financial source of truth.
 * - NOT the canonical double-entry accounting ledger.
 * - NOT a payment execution or settlement service.
 * - NOT an authorization, RBAC, IAM, or maker-checker state machine.
 * - NOT a policy engine and never creates policy decisions.
 * - NOT a risk, prediction, recommendation, regulatory, or learning engine.
 * - NOT an approval workflow engine.
 * - NOT an audit ledger and never rewrites audit history.
 * - NOT a raw analytics warehouse or feature store.
 * - NOT a source for unrestricted PII, provider secrets, tokens, OTP/PINs,
 *   credentials, raw provider payloads, or sensitive payment values.
 * - NOT a replacement for an immutable audit trail or independent compliance
 *   reporting system.
 * - NOT an authorization decision: dashboard state must never be interpreted
 *   as execution approval.
 *
 * Production principles
 * ---------------------
 * - Tenant context is mandatory and remains part of every read boundary.
 * - Airtel scope is explicit; cross-provider reads fail closed.
 * - Dashboard calculations are deterministic for identical source records.
 * - Aggregations are bounded to protect API and database resources.
 * - Raw identifiers are not emitted by aggregation paths; identifiers are
 *   represented as deterministic digests where correlation is useful.
 * - Monetary values are never reconstructed from display strings; this module
 *   reports counts, ratios, and already-authorized summaries only.
 * - Source integrity failures are surfaced as operational health degradation,
 *   never silently treated as healthy data.
 * - Missing evidence is distinct from zero, and unavailable source data is
 *   distinct from an empty data set.
 * - Dashboard write paths do not exist. A dashboard cannot mutate decisions,
 *   financial records, approvals, policies, or audit history.
 * - Optional repository-backed aggregate queries are preferred for production
 *   scale. Bounded source pagination exists as a compatibility fallback.
 * - Audit/explainability verification is explicit and bounded; the dashboard
 *   never claims a record is trustworthy merely because it was readable.
 * - Observability failures must not alter governance semantics.
 *
 * Module format
 * -------------
 * - Native ECMAScript module (ESM).
 * - Node.js built-ins only.
 */

import {
  createHash,
  timingSafeEqual,
} from 'node:crypto';

export const ENGINE_NAME = 'airtel-governance-dashboard';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = 'sha256';

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

export const DASHBOARD_HEALTH_STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const GOVERNANCE_DASHBOARD_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'GOVERNANCE_DASHBOARD_INVALID_INPUT',
  TENANT_REQUIRED: 'GOVERNANCE_DASHBOARD_TENANT_REQUIRED',
  PROVIDER_SCOPE_VIOLATION:
    'GOVERNANCE_DASHBOARD_PROVIDER_SCOPE_VIOLATION',
  SOURCE_REQUIRED: 'GOVERNANCE_DASHBOARD_SOURCE_REQUIRED',
  SOURCE_UNAVAILABLE: 'GOVERNANCE_DASHBOARD_SOURCE_UNAVAILABLE',
  SOURCE_PROTOCOL_ERROR: 'GOVERNANCE_DASHBOARD_SOURCE_PROTOCOL_ERROR',
  RANGE_INVALID: 'GOVERNANCE_DASHBOARD_RANGE_INVALID',
  RANGE_TOO_LARGE: 'GOVERNANCE_DASHBOARD_RANGE_TOO_LARGE',
  PAYLOAD_TOO_LARGE: 'GOVERNANCE_DASHBOARD_PAYLOAD_TOO_LARGE',
  INTEGRITY_FAILURE: 'GOVERNANCE_DASHBOARD_INTEGRITY_FAILURE',
  EXPORT_TOO_LARGE: 'GOVERNANCE_DASHBOARD_EXPORT_TOO_LARGE',
  NOT_FOUND: 'GOVERNANCE_DASHBOARD_NOT_FOUND',
});

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER,
  tenantRequired: true,
  maxTenantIdLength: 160,
  maxDecisionIdLength: 180,
  maxExplanationIdLength: 180,
  maxEventTypeLength: 120,
  maxOutcomeLength: 80,
  maxReasonCodeLength: 160,
  maxRuleCodeLength: 160,
  maxLabelLength: 200,
  defaultLimit: 50,
  maxLimit: 250,
  maxSourcePageSize: 250,
  maxSourceRecords: 10000,
  maxTrendBuckets: 366,
  maxTopItems: 50,
  maxExportBytes: 2 * 1024 * 1024,
  defaultRangeDays: 30,
  maxRangeDays: 366,
  maxVerificationRecords: 500,
  verifyExplainabilityIntegrity: true,
  verifyAuditIntegrity: true,
  failClosedOnIntegrityFailure: false,
  failClosedOnSourceUnavailable: false,
});

const OUTCOME_ORDER = Object.freeze([
  DASHBOARD_OUTCOMES.ALLOW,
  DASHBOARD_OUTCOMES.ALLOW_WITH_CONTROLS,
  DASHBOARD_OUTCOMES.REQUIRE_REVIEW,
  DASHBOARD_OUTCOMES.REQUIRE_APPROVAL,
  DASHBOARD_OUTCOMES.BLOCK,
  DASHBOARD_OUTCOMES.CONFLICT,
  DASHBOARD_OUTCOMES.STALE,
  DASHBOARD_OUTCOMES.INVALID,
  DASHBOARD_OUTCOMES.INDETERMINATE,
]);

const APPROVAL_ORDER = Object.freeze([
  DASHBOARD_APPROVAL_STATES.NONE,
  DASHBOARD_APPROVAL_STATES.REQUIRE_APPROVAL,
  DASHBOARD_APPROVAL_STATES.PENDING,
  DASHBOARD_APPROVAL_STATES.APPROVED,
  DASHBOARD_APPROVAL_STATES.AUTHORIZED,
  DASHBOARD_APPROVAL_STATES.REJECTED,
  DASHBOARD_APPROVAL_STATES.CANCELLED,
  DASHBOARD_APPROVAL_STATES.EXPIRED,
  DASHBOARD_APPROVAL_STATES.UNKNOWN,
]);

const INTEGRITY_ORDER = Object.freeze([
  DASHBOARD_INTEGRITY_STATES.VERIFIED,
  DASHBOARD_INTEGRITY_STATES.UNVERIFIED,
  DASHBOARD_INTEGRITY_STATES.FAILED,
  DASHBOARD_INTEGRITY_STATES.UNAVAILABLE,
]);

const IMPACT_ORDER = Object.freeze([
  'NON_FINANCIAL',
  'REVERSAL',
  'REFUND',
  'DISBURSEMENT',
  'COLLECTION',
  'SETTLEMENT',
]);

const RISK_ORDER = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
  'UNKNOWN',
]);

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
  /provider.?payload/i,
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
  return proto === Object.prototype || proto === null;
}

function normalizeString(value, maxLength = 200) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function upper(value, maxLength = 80) {
  return normalizeString(value, maxLength)?.toUpperCase();
}

function toInteger(
  value,
  fallback,
  {
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
  } = {},
) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function toFiniteNumber(value, fallback = undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toIso(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function addDays(dateIso, days) {
  const date = new Date(dateIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function startOfUtcDay(dateIso) {
  const date = new Date(dateIso);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function canonicalize(value) {
  return JSON.stringify(stableNormalize(value));
}

function stableNormalize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  if (
    typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    if (Number.isNaN(value)) return 'NaN';
    return value > 0 ? 'Infinity' : '-Infinity';
  }

  if (typeof value === 'bigint') {
    return `${value.toString()}n`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `base64:${value.toString('base64')}`;
  }

  if (value instanceof Uint8Array) {
    return `base64:${Buffer.from(value).toString('base64')}`;
  }

  if (
    typeof value === 'function'
    || typeof value === 'symbol'
  ) {
    return String(value);
  }

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const output = value.map((item) =>
      stableNormalize(item, seen),
    );
    seen.delete(value);
    return output;
  }

  if (
    typeof value.toJSON === 'function'
    && !isPlainObject(value)
  ) {
    const output =
      stableNormalize(
        value.toJSON(),
        seen,
      );
    seen.delete(value);
    return output;
  }

  const output = Object.create(null);

  for (const key of Object.keys(value).sort()) {
    output[key] =
      stableNormalize(
        value[key],
        seen,
      );
  }

  seen.delete(value);

  return output;
}

function sha256(value) {
  const input =
    typeof value === 'string' || Buffer.isBuffer(value)
      ? value
      : canonicalize(value);

  return createHash(HASH_ALGORITHM)
    .update(input)
    .digest('hex');
}

function safeDigest(value) {
  return `sha256:${sha256(String(value)).slice(0, 40)}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return value;
  }

  seen.add(value);

  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function safeRatio(
  numerator,
  denominator,
  precision = 4,
) {
  const n = toFiniteNumber(numerator, 0);
  const d = toFiniteNumber(denominator, 0);

  if (d <= 0) return 0;

  const factor = 10 ** precision;

  return (
    Math.round((n / d) * factor)
    / factor
  );
}

function safePercent(
  numerator,
  denominator,
  precision = 2,
) {
  return (
    safeRatio(
      numerator,
      denominator,
      precision,
    ) * 100
  );
}

function redact(
  value,
  key = '',
  depth = 0,
  maxDepth = 8,
) {
  if (depth > maxDepth) return '[TRUNCATED]';

  if (value === undefined || value === null) {
    return value;
  }

  if (
    SENSITIVE_KEY_PATTERNS.some((pattern) =>
      pattern.test(key),
    )
  ) {
    return '[REDACTED]';
  }

  if (
    IDENTIFIER_KEY_PATTERNS.some((pattern) =>
      pattern.test(key),
    )
  ) {
    return safeDigest(value);
  }

  if (typeof value === 'string') {
    return value.length > 400
      ? `${value.slice(0, 397)}...`
      : value;
  }

  if (typeof value !== 'object') return value;

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    Buffer.isBuffer(value)
    || value instanceof Uint8Array
  ) {
    return '[BINARY_REDACTED]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) =>
        redact(
          item,
          '',
          depth + 1,
          maxDepth,
        ),
      );
  }

  const output = Object.create(null);

  for (
    const keyName
    of Object.keys(value).slice(0, 100)
  ) {
    output[keyName] =
      redact(
        value[keyName],
        keyName,
        depth + 1,
        maxDepth,
      );
  }

  return output;
}

function getNested(source, paths) {
  for (const path of paths) {
    const segments = path.split('.');
    let current = source;
    let found = true;

    for (const segment of segments) {
      if (
        current === null
        || current === undefined
        || !Object.prototype.hasOwnProperty.call(
          current,
          segment,
        )
      ) {
        found = false;
        break;
      }

      current = current[segment];
    }

    if (
      found
      && current !== undefined
      && current !== null
    ) {
      return current;
    }
  }

  return undefined;
}

function pickString(
  source,
  paths,
  maxLength = 160,
) {
  return normalizeString(
    getNested(source, paths),
    maxLength,
  );
}

function pickUpper(
  source,
  paths,
  maxLength = 80,
) {
  return upper(
    getNested(source, paths),
    maxLength,
  );
}

function normalizeOutcome(value) {
  const candidate = upper(value, 80);

  if (!candidate) {
    return DASHBOARD_OUTCOMES.INDETERMINATE;
  }

  if (OUTCOME_ORDER.includes(candidate)) {
    return candidate;
  }

  if (candidate === 'REVIEW_REQUIRED') {
    return DASHBOARD_OUTCOMES.REQUIRE_REVIEW;
  }

  if (candidate === 'APPROVAL_REQUIRED') {
    return DASHBOARD_OUTCOMES.REQUIRE_APPROVAL;
  }

  return DASHBOARD_OUTCOMES.INDETERMINATE;
}

function normalizeApprovalState(
  value,
  approvalRequired = false,
) {
  const candidate = upper(value, 80);

  if (!candidate) {
    return approvalRequired
      ? DASHBOARD_APPROVAL_STATES.REQUIRE_APPROVAL
      : DASHBOARD_APPROVAL_STATES.NONE;
  }

  if (APPROVAL_ORDER.includes(candidate)) {
    return candidate;
  }

  if (candidate === 'REQUIRE_CHECKER') {
    return DASHBOARD_APPROVAL_STATES.REQUIRE_APPROVAL;
  }

  return DASHBOARD_APPROVAL_STATES.UNKNOWN;
}

function normalizeRisk(value) {
  const candidate = upper(value, 40);

  return (
    candidate
    && RISK_ORDER.includes(candidate)
  )
    ? candidate
    : 'UNKNOWN';
}

function normalizeImpact(value) {
  const candidate = upper(value, 80);

  return (
    candidate
    && IMPACT_ORDER.includes(candidate)
  )
    ? candidate
    : 'NON_FINANCIAL';
}

function normalizeIntegrityState(value) {
  const candidate = upper(value, 40);

  return INTEGRITY_ORDER.includes(candidate)
    ? candidate
    : DASHBOARD_INTEGRITY_STATES.UNAVAILABLE;
}

function errorToSafe(error) {
  if (!error) return null;

  return {
    name:
      normalizeString(
        error.name,
        100,
      ) ?? 'Error',

    code:
      normalizeString(
        error.code,
        160,
      ) ?? null,

    message:
      normalizeString(
        error.message,
        400,
      ) ?? 'Unknown error',

    retryable:
      Boolean(error.retryable),
  };
}

function makeHistogram(
  items,
  keyFn,
  order = [],
) {
  const counts = new Map();

  for (const item of items) {
    const key =
      keyFn(item) ?? 'UNKNOWN';

    counts.set(
      key,
      (counts.get(key) ?? 0) + 1,
    );
  }

  const orderedKeys = [
    ...order,
    ...[...counts.keys()]
      .filter(
        (key) => !order.includes(key),
      )
      .sort(),
  ];

  const total = items.length;

  return orderedKeys
    .filter(
      (key) => counts.has(key),
    )
    .map((key) => ({
      key,
      count: counts.get(key),
      percentage:
        safePercent(
          counts.get(key),
          total,
        ),
    }));
}

function sortByCountDescending(items) {
  return [...items].sort((a, b) => {
    if (
      (b.count ?? 0)
      !== (a.count ?? 0)
    ) {
      return (
        (b.count ?? 0)
        - (a.count ?? 0)
      );
    }

    return String(
      a.key ?? '',
    ).localeCompare(
      String(
        b.key ?? '',
      ),
    );
  });
}

function boundedItems(
  items,
  maxItems,
) {
  return Array.isArray(items)
    ? items.slice(0, maxItems)
    : [];
}

function sourceName(
  source,
  fallback,
) {
  return (
    normalizeString(
      source?.component
        ?? source?.name
        ?? source?.constructor?.name,
      120,
    ) ?? fallback
  );
}

function assertPlainObject(
  value,
  name,
) {
  if (!isPlainObject(value)) {
    throw new GovernanceDashboardError(
      GOVERNANCE_DASHBOARD_ERROR_CODES.INVALID_INPUT,
      `${name} must be an object.`,
    );
  }
}

function assertProvider(provider) {
  const normalized =
    upper(provider, 30);

  if (
    normalized
    && normalized !== PROVIDER
  ) {
    throw new GovernanceDashboardError(
      GOVERNANCE_DASHBOARD_ERROR_CODES
        .PROVIDER_SCOPE_VIOLATION,
      `Dashboard provider scope is ${PROVIDER}.`,
      {
        provider: normalized,
      },
    );
  }

  return PROVIDER;
}

function assertTenant(
  tenantId,
  config,
) {
  const normalized =
    normalizeString(
      tenantId,
      config.maxTenantIdLength,
    );

  if (
    config.tenantRequired
    && !normalized
  ) {
    throw new GovernanceDashboardError(
      GOVERNANCE_DASHBOARD_ERROR_CODES.TENANT_REQUIRED,
      'tenantId is required.',
    );
  }

  return normalized;
}

function resolveDateRange(
  input = {},
  config = DEFAULT_CONFIG,
  clock = () => new Date(),
) {
  const now =
    toIso(
      clock(),
      new Date().toISOString(),
    );

  let to =
    toIso(
      input.to,
      now,
    );

  let from =
    toIso(
      input.from,
      undefined,
    );

  if (!from) {
    from =
      addDays(
        to,
        -config.defaultRangeDays,
      );
  }

  const fromDate =
    new Date(from);

  const toDate =
    new Date(to);

  if (
    Number.isNaN(fromDate.getTime())
    || Number.isNaN(toDate.getTime())
    || fromDate > toDate
  ) {
    throw new GovernanceDashboardError(
      GOVERNANCE_DASHBOARD_ERROR_CODES.RANGE_INVALID,
      'Dashboard date range is invalid.',
      {
        from,
        to,
      },
    );
  }

  const rangeDays =
    Math.ceil(
      (
        toDate.getTime()
        - fromDate.getTime()
      ) / 86_400_000,
    );

  if (
    rangeDays
    > config.maxRangeDays
  ) {
    throw new GovernanceDashboardError(
      GOVERNANCE_DASHBOARD_ERROR_CODES.RANGE_TOO_LARGE,
      `Dashboard date range exceeds ${config.maxRangeDays} days.`,
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

function normalizeLimitOffset(
  limit,
  offset,
  config,
) {
  return {
    limit:
      toInteger(
        limit,
        config.defaultLimit,
        {
          min: 1,
          max: config.maxLimit,
        },
      ),

    offset:
      toInteger(
        offset,
        0,
        {
          min: 0,
          max: Number.MAX_SAFE_INTEGER,
        },
      ),
  };
}

function pageResult(
  raw,
  fallbackEntries = [],
) {
  if (Array.isArray(raw)) {
    return {
      entries: raw,
      total: raw.length,
      hasMore: false,
      nextOffset: null,
    };
  }

  const entries =
    Array.isArray(raw?.entries)
      ? raw.entries
      : Array.isArray(raw?.items)
        ? raw.items
        : fallbackEntries;

  const total =
    Number.isFinite(
      Number(raw?.total),
    )
      ? Number(raw.total)
      : entries.length;

  const offset =
    Number.isFinite(
      Number(raw?.offset),
    )
      ? Number(raw.offset)
      : 0;

  const limit =
    Number.isFinite(
      Number(raw?.limit),
    )
      ? Number(raw.limit)
      : entries.length;

  const hasMore =
    raw?.hasMore === true
    || offset + entries.length < total;

  return {
    entries,
    total,
    hasMore,
    nextOffset:
      hasMore
        ? offset + entries.length
        : null,
    limit,
    offset,
  };
}

export class GovernanceDashboardError
  extends Error
{
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message);

    this.name =
      'GovernanceDashboardError';

    this.code = code;

    this.details =
      redact(details);

    this.retryable =
      Boolean(options.retryable);

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

/**
 * Minimal repository contract for optimized production dashboards.
 *
 * A repository may implement any of these methods. Missing methods are
 * transparently backed by bounded explainability/audit reads when possible.
 */
export class InMemoryGovernanceDashboardRepository {
  constructor(seed = {}) {
    this.records =
      Array.isArray(seed.records)
        ? clone(seed.records)
        : [];

    this.events =
      Array.isArray(seed.events)
        ? clone(seed.events)
        : [];
  }

  async getDecisionSnapshot({
    tenantId,
    from,
    to,
  } = {}) {
    const records =
      this.records.filter(
        (record) =>
          record?.tenantId === tenantId
          && (
            !from
            || new Date(
              record.occurredAt
                ?? record.recordedAt
                ?? 0,
            ) >= new Date(from)
          )
          && (
            !to
            || new Date(
              record.occurredAt
                ?? record.recordedAt
                ?? 0,
            ) <= new Date(to)
          )
          && upper(
            record.provider,
            30,
          ) === PROVIDER,
      );

    return {
      entries: records,
      total: records.length,
      hasMore: false,
    };
  }

  async getDashboardSummary(
    params,
  ) {
    return this.getDecisionSnapshot(
      params,
    );
  }

  async healthCheck() {
    return {
      ok: true,
      component:
        'in-memory-governance-dashboard-repository',
    };
  }

  async close() {}
}

export class GovernanceDashboard {
  constructor(options = {}) {
    assertPlainObject(
      options,
      'options',
    );

    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...(isPlainObject(options.config)
        ? options.config
        : {}),
    });

    assertProvider(
      this.config.provider,
    );

    this.repository =
      options.repository
      ?? options.dashboardRepository
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
      typeof options.clock === 'function'
        ? options.clock
        : () => new Date();

    if (
      !this.repository
      && !this.explainabilityStore
      && !this.auditLedger
    ) {
      throw new GovernanceDashboardError(
        GOVERNANCE_DASHBOARD_ERROR_CODES.SOURCE_REQUIRED,
        'At least one read source is required: repository, explainabilityStore, or auditLedger.',
      );
    }
  }

  _tenantId(tenantId) {
    return assertTenant(
      tenantId,
      this.config,
    );
  }

  _provider(provider) {
    return assertProvider(
      provider ?? PROVIDER,
    );
  }

  _metric(
    name,
    labels = {},
    value = 1,
  ) {
    try {
      if (!this.metrics) return;

      if (
        typeof this.metrics.increment
        === 'function'
      ) {
        this.metrics.increment(
          name,
          labels,
          value,
        );
      } else if (
        typeof this.metrics.inc
        === 'function'
      ) {
        this.metrics.inc(
          name,
          value,
          labels,
        );
      }
    } catch (error) {
      this._log(
        'warn',
        'Dashboard metric emission failed.',
        error,
        {
          metric: name,
        },
      );
    }
  }

  _log(
    level,
    message,
    error = null,
    context = {},
  ) {
    try {
      const payload = {
        component: COMPONENT,
        ...redact(context),
      };

      if (error) {
        payload.error =
          errorToSafe(error);
      }

      const loggerMethod =
        this.logger?.[level]
        ?? this.logger?.info;

      if (
        typeof loggerMethod ===
        'function'
      ) {
        loggerMethod.call(
          this.logger,
          payload,
          message,
        );
      }
    } catch {
      // Logging is non-authoritative and must never affect dashboard semantics.
    }
  }

  _normalizeSourceError(
    error,
    source,
  ) {
    if (
      error instanceof
      GovernanceDashboardError
    ) {
      return error;
    }

    return new GovernanceDashboardError(
      GOVERNANCE_DASHBOARD_ERROR_CODES.SOURCE_UNAVAILABLE,
      `${sourceName(source, 'Dashboard source')} is unavailable.`,
      {
        source:
          sourceName(
            source,
            'unknown',
          ),
        error:
          errorToSafe(error),
      },
      {
        retryable:
          Boolean(error?.retryable),
        httpStatus: 503,
        cause: error,
      },
    );
  }

  async _callSource(
    source,
    methodNames,
    payload,
    { required = false } = {},
  ) {
    if (!source) {
      if (required) {
        throw new GovernanceDashboardError(
          GOVERNANCE_DASHBOARD_ERROR_CODES.SOURCE_REQUIRED,
          'Required dashboard source is not configured.',
        );
      }

      return {
        available: false,
        value: null,
        method: null,
        error: null,
      };
    }

    for (
      const methodName of methodNames
    ) {
      if (
        typeof source[methodName]
        === 'function'
      ) {
        try {
          const value =
            await source[methodName](
              payload,
            );

          return {
            available: true,
            value,
            method: methodName,
            error: null,
          };
        } catch (error) {
          const normalized =
            this._normalizeSourceError(
              error,
              source,
            );

          this._log(
            'warn',
            'Governance dashboard source call failed.',
            normalized,
            {
              source:
                sourceName(
                  source,
                  'unknown',
                ),
              method: methodName,
            },
          );

          if (
            this.config
              .failClosedOnSourceUnavailable
            || required
          ) {
            throw normalized;
          }

          return {
            available: false,
            value: null,
            method: methodName,
            error: normalized,
          };
        }
      }
    }

    if (required) {
      throw new GovernanceDashboardError(
        GOVERNANCE_DASHBOARD_ERROR_CODES
          .SOURCE_PROTOCOL_ERROR,
        `Source does not implement any required method: ${methodNames.join(', ')}.`,
        {
          source:
            sourceName(
              source,
              'unknown',
            ),
          methods: methodNames,
        },
      );
    }

    return {
      available: false,
      value: null,
      method: null,
      error: null,
    };
  }

  async _queryOptimizedSnapshot({
    tenantId,
    range,
    filters = {},
  } = {}) {
    if (!this.repository) return null;

    const result =
      await this._callSource(
        this.repository,
        [
          'getDashboardSummary',
          'getDecisionSnapshot',
          'summarizeGovernance',
          'aggregateGovernance',
        ],
        {
          tenantId,
          provider: PROVIDER,
          from: range.from,
          to: range.to,
          filters: redact(filters),
        },
      );

    if (!result.available) return null;

    return result.value;
  }

  async _loadExplainabilityPage({
    tenantId,
    range,
    limit,
    offset,
    filters = {},
  } = {}) {
    if (!this.explainabilityStore) {
      return null;
    }

    const result =
      await this._callSource(
        this.explainabilityStore,
        ['listTenant'],
        {
          tenantId,
          from: range.from,
          to: range.to,
          explanationType:
            filters.explanationType,
          decisionOutcome:
            filters.decisionOutcome,
          limit,
          offset,
        },
      );

    if (!result.available) return null;

    return pageResult(
      result.value,
    );
  }

  async _loadAuditPage({
    tenantId,
    range,
    limit,
    offset,
    filters = {},
  } = {}) {
    if (!this.auditLedger) {
      return null;
    }

    const result =
      await this._callSource(
        this.auditLedger,
        ['listTenantAudit'],
        {
          tenantId,
          from: range.from,
          to: range.to,
          eventType:
            filters.eventType,
          limit,
          offset,
        },
      );

    if (!result.available) return null;

    return pageResult(
      result.value,
    );
  }

  _normalizeRecord(
    record,
    sourceType = 'EXPLAINABILITY',
  ) {
    if (!isPlainObject(record)) {
      return null;
    }

    const decisionId =
      pickString(
        record,
        [
          'decisionId',
          'decision.id',
          'subject.decisionId',
        ],
        this.config.maxDecisionIdLength,
      );

    const tenantId =
      pickString(
        record,
        [
          'tenantId',
          'tenant.id',
        ],
        this.config.maxTenantIdLength,
      );

    const provider =
      upper(
        getNested(
          record,
          [
            'provider',
            'provider.code',
            'scope.provider',
          ],
        ),
        30,
      );

    if (
      provider
      && provider !== PROVIDER
    ) {
      return null;
    }

    const outcome =
      normalizeOutcome(
        getNested(
          record,
          [
            'outcome',
            'decision.outcome',
            'decision.decision',
            'governance.outcome',
          ],
        ),
      );

    const approvalRequired =
      Boolean(
        getNested(
          record,
          [
            'approvalRequired',
            'governance.approvalRequired',
            'approval.required',
          ],
        ),
      );

    const approvalState =
      normalizeApprovalState(
        getNested(
          record,
          [
            'approvalState',
            'approval.state',
            'governance.approval.state',
            'approval.status',
            'governance.executionState',
          ],
        ),
        approvalRequired,
      );

    const riskLevel =
      normalizeRisk(
        getNested(
          record,
          [
            'riskLevel',
            'risk.level',
            'decision.riskLevel',
            'governance.riskLevel',
            'intelligence.risk.level',
          ],
        ),
      );

    const impactLevel =
      normalizeImpact(
        getNested(
          record,
          [
            'impactLevel',
            'subject.impactLevel',
            'scope.impactLevel',
            'decision.impactLevel',
          ],
        ),
      );

    const integrityState =
      normalizeIntegrityState(
        getNested(
          record,
          [
            'integrityState',
            'integrity.status',
            'integrity.result',
            'verification.state',
          ],
        ),
      );

    const occurredAt =
      toIso(
        getNested(
          record,
          [
            'occurredAt',
            'evaluatedAt',
            'eventAt',
            'createdAt',
            'recordedAt',
          ],
        ),
        null,
      );

    const explanationId =
      pickString(
        record,
        [
          'explanationId',
          'id',
          'entryId',
        ],
        this.config.maxExplanationIdLength,
      );

    const source =
      upper(
        sourceType,
        40,
      ) ?? 'UNKNOWN';

    const intelligence =
      Object.create(null);

    const rawIntelligence =
      isPlainObject(
        record.intelligence,
      )
        ? record.intelligence
        : {};

    for (
      const key of INTELLIGENCE_KEYS
    ) {
      const item =
        isPlainObject(
          rawIntelligence[key],
        )
          ? rawIntelligence[key]
          : null;

      intelligence[key] = {
        available:
          item
            ? item.available !== false
            : null,

        decision:
          item
            ? normalizeOutcome(
                item.decision
                  ?? item.outcome,
              )
            : null,

        fingerprint:
          item?.fingerprint
            ? safeDigest(
                item.fingerprint,
              )
            : null,

        confidence:
          toFiniteNumber(
            item?.confidence,
            null,
          ),

        riskLevel:
          key === 'risk'
            ? normalizeRisk(
                item?.level
                  ?? item?.riskLevel,
              )
            : null,
      };
    }

    return {
      source,

      tenantId:
        tenantId
          ? safeDigest(
              tenantId,
            )
          : null,

      provider:
        provider
        ?? PROVIDER,

      decisionId:
        decisionId
          ? safeDigest(
              decisionId,
            )
          : null,

      explanationId:
        explanationId
          ? safeDigest(
              explanationId,
            )
          : null,

      occurredAt,

      outcome,

      approvalRequired,

      approvalState,

      riskLevel,

      impactLevel,

      integrityState,

      confidence:
        toFiniteNumber(
          getNested(
            record,
            [
              'confidence',
              'decision.confidence',
              'governance.confidence',
            ],
          ),
          null,
        ),

      executionState:
        upper(
          getNested(
            record,
            [
              'executionState',
              'governance.executionState',
              'execution.state',
            ],
          ),
          80,
        ) ?? null,

      originalIdempotencyKeyPresent:
        Boolean(
          getNested(
            record,
            [
              'originalIdempotencyKey',
              'subject.originalIdempotencyKey',
              'request.idempotencyKey',
            ],
          ),
        ),

      reasons:
        this._normalizeCodes(
          getNested(
            record,
            [
              'reasonCodes',
              'reasons',
              'decision.reasonCodes',
            ],
          ),
          this.config.maxReasonCodeLength,
        ),

      controls:
        this._normalizeCodes(
          getNested(
            record,
            [
              'controls',
              'decision.controls',
              'governance.controls',
            ],
          ),
          this.config.maxRuleCodeLength,
        ),

      ruleCodes:
        this._normalizeRuleCodes(
          record,
        ),

      intelligence,

      metadata:
        redact(
          {
            operation:
              getNested(
                record,
                [
                  'operation',
                  'subject.operation',
                  'scope.operation',
                ],
              ),

            operationType:
              getNested(
                record,
                [
                  'operationType',
                  'scope.operationType',
                ],
              ),

            command:
              getNested(
                record,
                [
                  'command',
                  'scope.command',
                ],
              ),

            action:
              getNested(
                record,
                [
                  'action',
                  'scope.action',
                  'decision.action',
                ],
              ),
          },
        ),
    };
  }

  _normalizeCodes(
    value,
    maxLength,
  ) {
    if (
      typeof value === 'string'
    ) {
      return [
        normalizeString(
          value,
          maxLength,
        ),
      ].filter(Boolean);
    }

    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) =>
        isPlainObject(item)
          ? item.code
            ?? item.id
            ?? item.reasonCode
          : item,
      )
      .map((item) =>
        normalizeString(
          item,
          maxLength,
        ),
      )
      .filter(Boolean)
      .slice(
        0,
        this.config.maxTopItems,
      );
  }

  _normalizeRuleCodes(
    record,
  ) {
    const candidates = [
      getNested(
        record,
        ['appliedRules'],
      ),

      getNested(
        record,
        ['findings'],
      ),

      getNested(
        record,
        ['policy.appliedRules'],
      ),

      getNested(
        record,
        ['governance.reasons'],
      ),
    ];

    const output = [];

    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }

      for (const item of candidate) {
        const code =
          normalizeString(
            isPlainObject(item)
              ? item.code
                ?? item.ruleCode
                ?? item.id
                ?? item.findingCode
              : item,
            this.config.maxRuleCodeLength,
          );

        if (
          code
          && !output.includes(code)
        ) {
          output.push(code);
        }

        if (
          output.length
          >= this.config.maxTopItems
        ) {
          return output;
        }
      }
    }

    return output;
  }

  _deduplicateRecords(records) {
    const seen = new Set();
    const output = [];

    for (const record of records) {
      if (!record) continue;

      const key = [
        record.decisionId,
        record.occurredAt,
        record.source,
      ].join('|');

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      output.push(record);
    }

    return output;
  }

  async _collectRecords({
    tenantId,
    range,
    filters = {},
    maxRecords =
      this.config.maxSourceRecords,
  } = {}) {
    const all = [];
    let sourceUnavailable = 0;

    const optimized =
      await this._queryOptimizedSnapshot(
        {
          tenantId,
          range,
          filters,
        },
      );

    if (optimized) {
      const page =
        pageResult(
          optimized,
        );

      for (
        const item
        of page.entries.slice(
          0,
          maxRecords,
        )
      ) {
        const normalized =
          this._normalizeRecord(
            item,
            item?.source
              ?? 'AGGREGATE',
          );

        if (normalized) {
          all.push(normalized);
        }
      }
    }

    if (
      !all.length
      && this.explainabilityStore
    ) {
      let offset = 0;

      const pageSize =
        Math.min(
          this.config
            .maxSourcePageSize,
          maxRecords,
        );

      while (
        all.length < maxRecords
      ) {
        const page =
          await this._loadExplainabilityPage(
            {
              tenantId,
              range,
              limit: pageSize,
              offset,
              filters,
            },
          );

        if (!page) {
          sourceUnavailable += 1;
          break;
        }

        for (
          const item
          of page.entries
        ) {
          const normalized =
            this._normalizeRecord(
              item,
              'EXPLAINABILITY',
            );

          if (normalized) {
            all.push(normalized);
          }

          if (
            all.length >= maxRecords
          ) {
            break;
          }
        }

        if (
          !page.hasMore
          || !page.nextOffset
        ) {
          break;
        }

        offset =
          page.nextOffset;
      }
    }

    if (
      !all.length
      && this.auditLedger
    ) {
      let offset = 0;

      const pageSize =
        Math.min(
          this.config
            .maxSourcePageSize,
          maxRecords,
        );

      while (
        all.length < maxRecords
      ) {
        const page =
          await this._loadAuditPage(
            {
              tenantId,
              range,
              limit: pageSize,
              offset,
              filters,
            },
          );

        if (!page) {
          sourceUnavailable += 1;
          break;
        }

        for (
          const item
          of page.entries
        ) {
          const normalized =
            this._normalizeRecord(
              item,
              'AUDIT',
            );

          if (normalized) {
            all.push(normalized);
          }

          if (
            all.length >= maxRecords
          ) {
            break;
          }
        }

        if (
          !page.hasMore
          || !page.nextOffset
        ) {
          break;
        }

        offset =
          page.nextOffset;
      }
    }

    const deduped =
      this._deduplicateRecords(
        all,
      );

    deduped.sort(
      (a, b) =>
        String(
          b.occurredAt ?? '',
        ).localeCompare(
          String(
            a.occurredAt ?? '',
          ),
        ),
    );

    return {
      records:
        deduped.slice(
          0,
          maxRecords,
        ),

      truncated:
        deduped.length
        > maxRecords,

      sourceUnavailable,
    };
  }

  _applyFilters(
    records,
    filters = {},
  ) {
    const outcome =
      filters.outcome
        ? normalizeOutcome(
            filters.outcome,
          )
        : null;

    const approvalState =
      filters.approvalState
        ? normalizeApprovalState(
            filters.approvalState,
          )
        : null;

    const riskLevel =
      filters.riskLevel
        ? normalizeRisk(
            filters.riskLevel,
          )
        : null;

    const impactLevel =
      filters.impactLevel
        ? normalizeImpact(
            filters.impactLevel,
          )
        : null;

    return records.filter(
      (record) => {
        if (
          outcome
          && record.outcome
            !== outcome
        ) {
          return false;
        }

        if (
          approvalState
          && record.approvalState
            !== approvalState
        ) {
          return false;
        }

        if (
          riskLevel
          && record.riskLevel
            !== riskLevel
        ) {
          return false;
        }

        if (
          impactLevel
          && record.impactLevel
            !== impactLevel
        ) {
          return false;
        }

        return true;
      },
    );
  }

  _summarizeRecords(records) {
    const total =
      records.length;

    const approved =
      records.filter(
        (record) =>
          record.approvalState
          === DASHBOARD_APPROVAL_STATES.APPROVED,
      ).length;

    const authorized =
      records.filter(
        (record) =>
          record.approvalState
          === DASHBOARD_APPROVAL_STATES.AUTHORIZED,
      ).length;

    const approvalRequired =
      records.filter(
        (record) =>
          record.approvalRequired,
      ).length;

    const blocked =
      records.filter(
        (record) =>
          record.outcome
          === DASHBOARD_OUTCOMES.BLOCK,
      ).length;

    const review =
      records.filter(
        (record) =>
          record.outcome
          === DASHBOARD_OUTCOMES.REQUIRE_REVIEW,
      ).length;

    const conflict =
      records.filter(
        (record) =>
          record.outcome
          === DASHBOARD_OUTCOMES.CONFLICT,
      ).length;

    const stale =
      records.filter(
        (record) =>
          record.outcome
          === DASHBOARD_OUTCOMES.STALE,
      ).length;

    const invalid =
      records.filter(
        (record) =>
          record.outcome
          === DASHBOARD_OUTCOMES.INVALID,
      ).length;

    const criticalRisk =
      records.filter(
        (record) =>
          record.riskLevel === 'CRITICAL',
      ).length;

    const highRisk =
      records.filter(
        (record) =>
          record.riskLevel === 'HIGH',
      ).length;

    const integrityFailed =
      records.filter(
        (record) =>
          record.integrityState
          === DASHBOARD_INTEGRITY_STATES.FAILED,
      ).length;

    const integrityUnavailable =
      records.filter(
        (record) =>
          record.integrityState
          === DASHBOARD_INTEGRITY_STATES.UNAVAILABLE,
      ).length;

    const confidenceRecords =
      records.filter(
        (record) =>
          Number.isFinite(
            record.confidence,
          ),
      );

    return {
      totalDecisions: total,
      approvalsRequired:
        approvalRequired,
      approvalsApproved:
        approved,
      approvalsAuthorized:
        authorized,
      blockedDecisions:
        blocked,
      reviewRequired:
        review,
      conflicts:
        conflict,
      staleDecisions:
        stale,
      invalidDecisions:
        invalid,
      highRiskDecisions:
        highRisk,
      criticalRiskDecisions:
        criticalRisk,
      integrityFailures:
        integrityFailed,
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
          blocked,
          total,
        ),
      reviewRate:
        safePercent(
          review,
          total,
        ),
      integrityFailureRate:
        safePercent(
          integrityFailed,
          total,
        ),
      meanConfidence:
        confidenceRecords.length
          ? Number(
              (
                confidenceRecords.reduce(
                  (sum, record) =>
                    sum
                    + record.confidence,
                  0,
                )
                / confidenceRecords.length
              ).toFixed(6),
            )
          : null,
    };
  }

  _buildTopCodes(
    records,
    property,
    limit = this.config.maxTopItems,
  ) {
    const counts = new Map();

    for (const record of records) {
      for (
        const code
        of record[property] ?? []
      ) {
        counts.set(
          code,
          (counts.get(code) ?? 0)
          + 1,
        );
      }
    }

    return sortByCountDescending(
      [
        ...counts.entries(),
      ].map(
        ([key, count]) => ({
          key,
          count,
          percentageOfDecisions:
            safePercent(
              count,
              records.length,
            ),
        }),
      ),
    ).slice(
      0,
      limit,
    );
  }

  _buildIntelligenceCoverage(
    records,
  ) {
    return INTELLIGENCE_KEYS.map(
      (key) => {
        const known =
          records.filter(
            (record) =>
              record.intelligence?.[key]
                ?.available
              !== null,
          );

        const available =
          known.filter(
            (record) =>
              record.intelligence?.[key]
                ?.available
              === true,
          ).length;

        const unavailable =
          known.filter(
            (record) =>
              record.intelligence?.[key]
                ?.available
              === false,
          ).length;

        const withFingerprint =
          records.filter(
            (record) =>
              Boolean(
                record.intelligence?.[key]
                  ?.fingerprint,
              ),
          ).length;

        return {
          component: key,
          observations:
            known.length,
          available,
          unavailable,
          coveragePercentage:
            safePercent(
              available,
              known.length,
            ),
          fingerprinted:
            withFingerprint,
          fingerprintCoveragePercentage:
            safePercent(
              withFingerprint,
              records.length,
            ),
        };
      },
    );
  }

  _buildTrend(
    records,
    range,
    bucket = 'day',
  ) {
    const buckets =
      new Map();

    const keyFor = (iso) => {
      if (!iso) return 'UNKNOWN';

      const date =
        new Date(iso);

      if (
        Number.isNaN(
          date.getTime(),
        )
      ) {
        return 'UNKNOWN';
      }

      if (bucket === 'hour') {
        return `${date.toISOString().slice(0, 13)}:00:00.000Z`;
      }

      if (bucket === 'week') {
        const start =
          new Date(date);

        const day =
          start.getUTCDay();

        const delta =
          day === 0
            ? 6
            : day - 1;

        start.setUTCDate(
          start.getUTCDate()
          - delta,
        );

        start.setUTCHours(
          0,
          0,
          0,
          0,
        );

        return start.toISOString();
      }

      return startOfUtcDay(iso);
    };

    for (const record of records) {
      const key =
        keyFor(
          record.occurredAt,
        );

      if (!buckets.has(key)) {
        buckets.set(
          key,
          {
            bucket: key,
            total: 0,
            allow: 0,
            allowWithControls: 0,
            requireReview: 0,
            requireApproval: 0,
            block: 0,
            conflict: 0,
            stale: 0,
            invalid: 0,
            indeterminate: 0,
            criticalRisk: 0,
            highRisk: 0,
            approvalRequired: 0,
            authorizationCount: 0,
            integrityFailures: 0,
          },
        );
      }

      const item =
        buckets.get(key);

      item.total += 1;

      if (
        record.outcome
        === DASHBOARD_OUTCOMES.ALLOW
      ) {
        item.allow += 1;
      }

      if (
        record.outcome
        ===
        DASHBOARD_OUTCOMES.ALLOW_WITH_CONTROLS
      ) {
        item.allowWithControls += 1;
      }

      if (
        record.outcome
        ===
        DASHBOARD_OUTCOMES.REQUIRE_REVIEW
      ) {
        item.requireReview += 1;
      }

      if (
        record.outcome
        ===
        DASHBOARD_OUTCOMES.REQUIRE_APPROVAL
      ) {
        item.requireApproval += 1;
      }

      if (
        record.outcome
        === DASHBOARD_OUTCOMES.BLOCK
      ) {
        item.block += 1;
      }

      if (
        record.outcome
        === DASHBOARD_OUTCOMES.CONFLICT
      ) {
        item.conflict += 1;
      }

      if (
        record.outcome
        === DASHBOARD_OUTCOMES.STALE
      ) {
        item.stale += 1;
      }

      if (
        record.outcome
        === DASHBOARD_OUTCOMES.INVALID
      ) {
        item.invalid += 1;
      }

      if (
        record.outcome
        === DASHBOARD_OUTCOMES.INDETERMINATE
      ) {
        item.indeterminate += 1;
      }

      if (
        record.riskLevel === 'CRITICAL'
      ) {
        item.criticalRisk += 1;
      }

      if (
        record.riskLevel === 'HIGH'
      ) {
        item.highRisk += 1;
      }

      if (
        record.approvalRequired
      ) {
        item.approvalRequired += 1;
      }

      if (
        record.approvalState
        ===
        DASHBOARD_APPROVAL_STATES.AUTHORIZED
      ) {
        item.authorizationCount += 1;
      }

      if (
        record.integrityState
        ===
        DASHBOARD_INTEGRITY_STATES.FAILED
      ) {
        item.integrityFailures += 1;
      }
    }

    return [...buckets.values()]
      .filter(
        (item) =>
          item.bucket
          !== 'UNKNOWN',
      )
      .sort(
        (a, b) =>
          a.bucket.localeCompare(
            b.bucket,
          ),
      )
      .slice(
        -this.config.maxTrendBuckets,
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
              item.requireReview,
              item.total,
            ),

          authorizationRate:
            safePercent(
              item.authorizationCount,
              item.approvalRequired,
            ),

          integrityFailureRate:
            safePercent(
              item.integrityFailures,
              item.total,
            ),

          from:
            item.bucket,

          to:
            bucket === 'hour'
              ? new Date(
                  new Date(
                    item.bucket,
                  ).getTime()
                  + 3_600_000,
                ).toISOString()
              : bucket === 'week'
                ? new Date(
                    new Date(
                      item.bucket,
                    ).getTime()
                    + 7 * 86_400_000,
                  ).toISOString()
                : new Date(
                    new Date(
                      item.bucket,
                    ).getTime()
                    + 86_400_000,
                  ).toISOString(),
        }),
      );
  }

  async _verifyExplainabilityRecords(
    tenantId,
    records,
  ) {
    if (
      !this.config
        .verifyExplainabilityIntegrity
      || !this.explainabilityStore
    ) {
      return {
        attempted: 0,
        verified: 0,
        failed: 0,
        unavailable: 0,
        details: [],
      };
    }

    const candidates =
      records
        .filter(
          (record) =>
            record.source
            === 'EXPLAINABILITY',
        )
        .slice(
          0,
          this.config
            .maxVerificationRecords,
        );

    const details = [];

    let verified = 0;
    let failed = 0;
    let unavailable = 0;

    for (
      const candidate
      of candidates
    ) {
      let explanation = null;

      try {
        if (!candidate.explanationId) {
          unavailable += 1;
          continue;
        }

        const rawId =
          candidate.explanationId
            .startsWith('sha256:')
            ? null
            : candidate.explanationId;

        if (!rawId) {
          /*
           * Dashboard records intentionally store only a digest, so verification
           * requires the optimized repository to expose a verification summary.
           */
          unavailable += 1;
          continue;
        }

        explanation =
          await this.explainabilityStore
            .getExplanation({
              tenantId,
              explanationId: rawId,
            });

        const report =
          await this.explainabilityStore
            .verifyExplanation(
              explanation,
            );

        const state =
          report?.ok
            ? DASHBOARD_INTEGRITY_STATES.VERIFIED
            : DASHBOARD_INTEGRITY_STATES.FAILED;

        if (
          state
          === DASHBOARD_INTEGRITY_STATES.VERIFIED
        ) {
          verified += 1;
        } else {
          failed += 1;
        }

        details.push({
          explanationId:
            safeDigest(
              rawId,
            ),

          decisionId:
            explanation?.decisionId
              ? safeDigest(
                  explanation.decisionId,
                )
              : null,

          state,
        });
      } catch (error) {
        unavailable += 1;

        details.push({
          explanationId:
            candidate.explanationId,

          state:
            DASHBOARD_INTEGRITY_STATES
              .UNAVAILABLE,

          error:
            errorToSafe(error),
        });
      }
    }

    return {
      attempted:
        candidates.length,

      verified,

      failed,

      unavailable,

      details,
    };
  }

  async _verifyAuditRecords(
    tenantId,
    records,
  ) {
    if (
      !this.config
        .verifyAuditIntegrity
      || !this.auditLedger
    ) {
      return {
        attempted: 0,
        verified: 0,
        failed: 0,
        unavailable: 0,
        details: [],
      };
    }

    const auditCandidates =
      records
        .filter(
          (record) =>
            record.source === 'AUDIT',
        )
        .slice(
          0,
          this.config
            .maxVerificationRecords,
        );

    let verified = 0;
    let failed = 0;
    let unavailable = 0;

    const details = [];

    for (
      const candidate
      of auditCandidates
    ) {
      /*
       * Deliberately do not infer the raw entry identifier from a digest.
       * Verification is delegated to repository-backed aggregate methods.
       */
      try {
        if (
          typeof this.auditLedger
            .verifyDecision
          !== 'function'
          || !candidate.decisionId
        ) {
          unavailable += 1;
          continue;
        }

        unavailable += 1;

        details.push({
          decisionId:
            candidate.decisionId,

          state:
            DASHBOARD_INTEGRITY_STATES
              .UNAVAILABLE,

          reason:
            'decision identifier is redacted at the dashboard aggregation boundary',
        });
      } catch (error) {
        failed += 1;

        details.push({
          decisionId:
            candidate.decisionId,

          state:
            DASHBOARD_INTEGRITY_STATES
              .FAILED,

          error:
            errorToSafe(error),
        });
      }
    }

    return {
      attempted:
        auditCandidates.length,

      verified,

      failed,

      unavailable,

      details,

      tenantScoped:
        Boolean(tenantId),
    };
  }

  _buildHealth({
    records,
    sourceUnavailable = 0,
    explainabilityVerification,
    auditVerification,
    sourceStatus,
  }) {
    const integrityFailureCount =
      (
        explainabilityVerification
          ?.failed
        ?? 0
      )
      + (
        auditVerification
          ?.failed
        ?? 0
      );

    let state =
      DASHBOARD_HEALTH_STATES
        .HEALTHY;

    if (integrityFailureCount > 0) {
      state =
        DASHBOARD_HEALTH_STATES
          .DEGRADED;
    }

    if (sourceUnavailable > 0) {
      state =
        DASHBOARD_HEALTH_STATES
          .DEGRADED;
    }

    if (
      !records.length
      && sourceUnavailable > 0
    ) {
      state =
        DASHBOARD_HEALTH_STATES
          .UNAVAILABLE;
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

      recordsObserved:
        records.length,

      sourceUnavailable,

      integrityFailures:
        integrityFailureCount,

      sources:
        sourceStatus,

      safety: {
        financialMutationPerformed:
          false,

        ledgerMutationPerformed:
          false,

        providerCallPerformed:
          false,

        approvalGranted:
          false,

        executionAuthorized:
          false,
      },
    };
  }

  async _sourceStatus() {
    const sources = {
      dashboardRepository:
        null,

      explainabilityStore:
        null,

      auditLedger:
        null,

      governanceService:
        null,

      policyEngine:
        null,

      approvalWorkflow:
        null,
    };

    const checks = [
      [
        'dashboardRepository',
        this.repository,
      ],

      [
        'explainabilityStore',
        this.explainabilityStore,
      ],

      [
        'auditLedger',
        this.auditLedger,
      ],

      [
        'governanceService',
        this.governanceService,
      ],

      [
        'policyEngine',
        this.policyEngine,
      ],

      [
        'approvalWorkflow',
        this.approvalWorkflow,
      ],
    ];

    for (
      const [key, source]
      of checks
    ) {
      if (!source) {
        sources[key] = {
          configured: false,
          available: false,
          health: null,
        };

        continue;
      }

      let health = null;

      try {
        if (
          typeof source.readiness
          === 'function'
        ) {
          health =
            await source.readiness();
        } else if (
          typeof source.health
          === 'function'
        ) {
          health =
            await source.health();
        } else if (
          typeof source.healthCheck
          === 'function'
        ) {
          health =
            await source.healthCheck();
        }
      } catch (error) {
        health = {
          ok: false,
          error:
            errorToSafe(error),
        };
      }

      sources[key] = {
        configured: true,

        available:
          health?.ok !== false,

        health:
          redact(health),
      };
    }

    return sources;
  }

  async getOverview(
    input = {},
  ) {
    const tenantId =
      this._tenantId(
        input.tenantId,
      );

    this._provider(
      input.provider,
    );

    const range =
      resolveDateRange(
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

    const maxRecords =
      Math.min(
        toInteger(
          input.maxRecords,
          this.config.maxSourceRecords,
          {
            min: 1,
            max:
              this.config
                .maxSourceRecords,
          },
        ),
        this.config.maxSourceRecords,
      );

    const collected =
      await this._collectRecords({
        tenantId,
        range,
        filters,
        maxRecords,
      });

    const records =
      this._applyFilters(
        collected.records,
        filters,
      );

    const summary =
      this._summarizeRecords(
        records,
      );

    const outcomeDistribution =
      makeHistogram(
        records,
        (record) =>
          record.outcome,
        OUTCOME_ORDER,
      );

    const approvalDistribution =
      makeHistogram(
        records,
        (record) =>
          record.approvalState,
        APPROVAL_ORDER,
      );

    const riskDistribution =
      makeHistogram(
        records,
        (record) =>
          record.riskLevel,
        RISK_ORDER,
      );

    const impactDistribution =
      makeHistogram(
        records,
        (record) =>
          record.impactLevel,
        IMPACT_ORDER,
      );

    const integrityDistribution =
      makeHistogram(
        records,
        (record) =>
          record.integrityState,
        INTEGRITY_ORDER,
      );

    const explainabilityVerification =
      await this
        ._verifyExplainabilityRecords(
          tenantId,
          records,
        );

    const auditVerification =
      await this
        ._verifyAuditRecords(
          tenantId,
          records,
        );

    const sourceStatus =
      await this._sourceStatus();

    const dashboard = {
      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      tenant: {
        tenantDigest:
          safeDigest(
            tenantId,
          ),
      },

      generatedAt:
        toIso(
          this.clock(),
          new Date().toISOString(),
        ),

      range,

      filters:
        redact(filters),

      summary,

      distributions: {
        outcomes:
          outcomeDistribution,

        approvals:
          approvalDistribution,

        risks:
          riskDistribution,

        impacts:
          impactDistribution,

        integrity:
          integrityDistribution,
      },

      intelligenceCoverage:
        this._buildIntelligenceCoverage(
          records,
        ),

      topReasons:
        this._buildTopCodes(
          records,
          'reasons',
        ),

      topControls:
        this._buildTopCodes(
          records,
          'controls',
        ),

      topRules:
        this._buildTopCodes(
          records,
          'ruleCodes',
        ),

      trends:
        this._buildTrend(
          records,
          range,
          input.bucket ?? 'day',
        ),

      integrity: {
        explainability:
          explainabilityVerification,

        audit:
          auditVerification,
      },

      health:
        this._buildHealth({
          records,
          sourceUnavailable:
            collected.sourceUnavailable,
          explainabilityVerification,
          auditVerification,
          sourceStatus,
        }),

      dataQuality: {
        sourceRecordsObserved:
          records.length,

        sourceRecordsTruncated:
          collected.truncated,

        missingOccurredAt:
          records.filter(
            (record) =>
              !record.occurredAt,
          ).length,

        unknownOutcomes:
          records.filter(
            (record) =>
              record.outcome
              ===
              DASHBOARD_OUTCOMES
                .INDETERMINATE,
          ).length,

        unknownRisk:
          records.filter(
            (record) =>
              record.riskLevel
              === 'UNKNOWN',
          ).length,

        unknownApprovalState:
          records.filter(
            (record) =>
              record.approvalState
              ===
              DASHBOARD_APPROVAL_STATES
                .UNKNOWN,
          ).length,

        integrityUnavailable:
          records.filter(
            (record) =>
              record.integrityState
              ===
              DASHBOARD_INTEGRITY_STATES
                .UNAVAILABLE,
          ).length,
      },

      safety: {
        readOnly:
          true,

        financialMutationPerformed:
          false,

        ledgerMutationPerformed:
          false,

        providerCallPerformed:
          false,

        approvalGranted:
          false,

        executionAuthorized:
          false,

        authoritativeFinancialBoundary:
          'TITECH_FINANCIAL_CORE',
      },
    };

    const fingerprint =
      sha256({
        component:
          dashboard.component,

        schemaVersion:
          dashboard.schemaVersion,

        tenantDigest:
          dashboard.tenant.tenantDigest,

        range:
          dashboard.range,

        summary:
          dashboard.summary,

        distributions:
          dashboard.distributions,

        intelligenceCoverage:
          dashboard.intelligenceCoverage,

        topReasons:
          dashboard.topReasons,

        topControls:
          dashboard.topControls,

        topRules:
          dashboard.topRules,

        trends:
          dashboard.trends,

        integrity:
          dashboard.integrity,

        dataQuality:
          dashboard.dataQuality,
      });

    dashboard.dashboardFingerprint =
      `sha256:${fingerprint}`;

    this._metric(
      'governance_dashboard_overview_total',
      {
        outcome:
          filters.outcome
            ? normalizeOutcome(
                filters.outcome,
              )
            : 'ALL',

        riskLevel:
          filters.riskLevel
            ? normalizeRisk(
                filters.riskLevel,
              )
            : 'ALL',
      },
    );

    return deepFreeze(
      dashboard,
    );
  }

  async getSnapshot(
    input = {},
  ) {
    return this.getOverview(
      input,
    );
  }

  async getTrends(
    input = {},
  ) {
    const overview =
      await this.getOverview(
        input,
      );

    return deepFreeze({
      component:
        overview.component,

      provider:
        overview.provider,

      tenant:
        overview.tenant,

      generatedAt:
        overview.generatedAt,

      range:
        overview.range,

      bucket:
        input.bucket ?? 'day',

      trends:
        overview.trends,

      health:
        overview.health,

      dashboardFingerprint:
        overview.dashboardFingerprint,
    });
  }

  async getDistribution(
    input = {},
  ) {
    const overview =
      await this.getOverview(
        input,
      );

    return deepFreeze({
      component:
        overview.component,

      provider:
        overview.provider,

      tenant:
        overview.tenant,

      generatedAt:
        overview.generatedAt,

      range:
        overview.range,

      distributions:
        overview.distributions,

      dashboardFingerprint:
        overview.dashboardFingerprint,
    });
  }

  async getIntelligenceCoverage(
    input = {},
  ) {
    const overview =
      await this.getOverview(
        input,
      );

    return deepFreeze({
      component:
        overview.component,

      provider:
        overview.provider,

      tenant:
        overview.tenant,

      generatedAt:
        overview.generatedAt,

      range:
        overview.range,

      intelligenceCoverage:
        overview.intelligenceCoverage,

      dashboardFingerprint:
        overview.dashboardFingerprint,
    });
  }

  async getIntegrityStatus(
    input = {},
  ) {
    const overview =
      await this.getOverview(
        input,
      );

    return deepFreeze({
      component:
        overview.component,

      provider:
        overview.provider,

      tenant:
        overview.tenant,

      generatedAt:
        overview.generatedAt,

      range:
        overview.range,

      integrity:
        overview.integrity,

      dataQuality:
        overview.dataQuality,

      health:
        overview.health,

      dashboardFingerprint:
        overview.dashboardFingerprint,
    });
  }

  async getDecision({
    tenantId,
    decisionId,
    includeHistory = true,
  } = {}) {
    const normalizedTenantId =
      this._tenantId(
        tenantId,
      );

    this._provider(
      PROVIDER,
    );

    const normalizedDecisionId =
      normalizeString(
        decisionId,
        this.config.maxDecisionIdLength,
      );

    if (!normalizedDecisionId) {
      throw new GovernanceDashboardError(
        GOVERNANCE_DASHBOARD_ERROR_CODES.INVALID_INPUT,
        'decisionId is required.',
      );
    }

    let explanationBundle =
      null;

    if (
      this.explainabilityStore
      && typeof this
        .explainabilityStore
        .buildEvidenceBundle
      === 'function'
    ) {
      try {
        explanationBundle =
          await this
            .explainabilityStore
            .buildEvidenceBundle({
              tenantId:
                normalizedTenantId,

              decisionId:
                normalizedDecisionId,
            });
      } catch (error) {
        if (
          error?.code
          && error.code
            !==
            'EXPLAINABILITY_STORE_NOT_FOUND'
        ) {
          this._log(
            'warn',
            'Decision explainability bundle unavailable.',
            error,
            {
              tenantId:
                safeDigest(
                  normalizedTenantId,
                ),

              decisionId:
                safeDigest(
                  normalizedDecisionId,
                ),
            },
          );
        }
      }
    }

    let auditHistory =
      null;

    let auditVerification =
      null;

    if (
      includeHistory
      && this.auditLedger
    ) {
      const historyResult =
        await this._callSource(
          this.auditLedger,
          ['getDecisionHistory'],
          {
            tenantId:
              normalizedTenantId,

            decisionId:
              normalizedDecisionId,

            limit:
              this.config.maxLimit,

            offset: 0,
          },
        );

      if (
        historyResult.available
      ) {
        auditHistory =
          pageResult(
            historyResult.value,
          );

        if (
          typeof this
            .auditLedger
            .verifyDecision
          === 'function'
        ) {
          try {
            auditVerification =
              await this
                .auditLedger
                .verifyDecision({
                  tenantId:
                    normalizedTenantId,

                  decisionId:
                    normalizedDecisionId,
                });
          } catch (error) {
            auditVerification = {
              ok: false,

              state:
                DASHBOARD_INTEGRITY_STATES
                  .FAILED,

              error:
                errorToSafe(error),
            };
          }
        }
      }
    }

    let approval =
      null;

    if (
      this.approvalWorkflow
    ) {
      const approvalMethods = [
        'getApprovalStatus',
        'getRequest',
        'getByDecisionId',
        'findByDecisionId',
      ];

      const approvalResult =
        await this._callSource(
          this.approvalWorkflow,
          approvalMethods,
          {
            tenantId:
              normalizedTenantId,

            decisionId:
              normalizedDecisionId,
          },
        );

      approval =
        approvalResult.available
          ? redact(
              approvalResult.value,
            )
          : null;
    }

    let explanationEntries =
      [];

    if (
      this.explainabilityStore
      && typeof this
        .explainabilityStore
        .getByDecisionId
      === 'function'
    ) {
      const result =
        await this._callSource(
          this.explainabilityStore,
          ['getByDecisionId'],
          {
            tenantId:
              normalizedTenantId,

            decisionId:
              normalizedDecisionId,

            limit:
              this.config.maxLimit,

            offset: 0,
          },
        );

      if (
        result.available
      ) {
        explanationEntries =
          pageResult(
            result.value,
          ).entries.map(
            (entry) =>
              redact(entry),
          );
      }
    }

    const response = {
      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      tenant: {
        tenantDigest:
          safeDigest(
            normalizedTenantId,
          ),
      },

      decision: {
        decisionDigest:
          safeDigest(
            normalizedDecisionId,
          ),
      },

      generatedAt:
        toIso(
          this.clock(),
          new Date().toISOString(),
        ),

      explainability:
        explanationBundle
          ? redact(
              explanationBundle,
            )
          : null,

      explanationEntries,

      audit: {
        history:
          auditHistory
            ? redact(
                auditHistory,
              )
            : null,

        verification:
          redact(
            auditVerification,
          ),
      },

      approval,

      safety: {
        readOnly:
          true,

        financialMutationPerformed:
          false,

        ledgerMutationPerformed:
          false,

        providerCallPerformed:
          false,

        approvalGranted:
          false,

        executionAuthorized:
          false,
      },
    };

    response.decisionFingerprint =
      `sha256:${
        sha256({
          tenantDigest:
            response.tenant.tenantDigest,

          decisionDigest:
            response.decision.decisionDigest,

          explainability:
            response.explainability,

          explanationEntries:
            response.explanationEntries,

          audit:
            response.audit,

          approval:
            response.approval,
        })
      }`;

    return deepFreeze(
      response,
    );
  }

  async listRecent(
    input = {},
  ) {
    const tenantId =
      this._tenantId(
        input.tenantId,
      );

    this._provider(
      input.provider,
    );

    const range =
      resolveDateRange(
        input,
        this.config,
        this.clock,
      );

    const pagination =
      normalizeLimitOffset(
        input.limit,
        input.offset,
        this.config,
      );

    const filters =
      isPlainObject(
        input.filters,
      )
        ? input.filters
        : {};

    const collected =
      await this._collectRecords({
        tenantId,
        range,
        filters,
        maxRecords:
          this.config
            .maxSourceRecords,
      });

    const filtered =
      this._applyFilters(
        collected.records,
        filters,
      );

    const entries =
      filtered
        .slice(
          pagination.offset,
          pagination.offset
            + pagination.limit,
        )
        .map(
          (record) =>
            redact(record),
        );

    return deepFreeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      tenant: {
        tenantDigest:
          safeDigest(
            tenantId,
          ),
      },

      generatedAt:
        toIso(
          this.clock(),
          new Date().toISOString(),
        ),

      range,

      entries,

      total:
        filtered.length,

      limit:
        pagination.limit,

      offset:
        pagination.offset,

      hasMore:
        pagination.offset
          + entries.length
        < filtered.length,

      dataQuality: {
        truncated:
          collected.truncated,

        sourceUnavailable:
          collected.sourceUnavailable,
      },
    });
  }

  async exportOverview(
    input = {},
  ) {
    const overview =
      await this.getOverview(
        input,
      );

    const exportable =
      clone(overview);

    const json =
      JSON.stringify(
        exportable,
        null,
        2,
      );

    const bytes =
      Buffer.byteLength(
        json,
        'utf8',
      );

    if (
      bytes
      > this.config.maxExportBytes
    ) {
      throw new GovernanceDashboardError(
        GOVERNANCE_DASHBOARD_ERROR_CODES.EXPORT_TOO_LARGE,
        `Dashboard export exceeds ${this.config.maxExportBytes} bytes.`,
        {
          bytes,
          maxExportBytes:
            this.config
              .maxExportBytes,
        },
        {
          httpStatus: 413,
        },
      );
    }

    return Object.freeze({
      contentType:
        'application/json',

      filename:
        `airtel-governance-dashboard-${overview.range.from.slice(0, 10)}-${overview.range.to.slice(0, 10)}.json`,

      bytes,

      fingerprint:
        `sha256:${sha256(
          json,
        )}`,

      content:
        json,
    });
  }

  async health() {
    const sourceStatus =
      await this._sourceStatus();

    const sourceConfigured =
      Object.values(
        sourceStatus,
      ).some(
        (item) =>
          item.configured,
      );

    const sourceAvailable =
      Object.values(
        sourceStatus,
      ).some(
        (item) =>
          item.available,
      );

    const unhealthySources =
      Object.entries(
        sourceStatus,
      )
        .filter(
          ([, item]) =>
            item.configured
            && !item.available,
        )
        .map(
          ([name]) => name,
        );

    const state =
      !sourceConfigured
        ? DASHBOARD_HEALTH_STATES
            .UNAVAILABLE
        : unhealthySources.length > 0
          && !sourceAvailable
            ? DASHBOARD_HEALTH_STATES
                .UNAVAILABLE
            : unhealthySources.length > 0
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

      sources:
        sourceStatus,

      unhealthySources,

      safety: {
        readOnly:
          true,

        financialMutationPerformed:
          false,

        ledgerMutationPerformed:
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

      storesFinancialState:
        false,

      mutatesGovernanceState:
        false,

      executesProviderOperations:
        false,

      storesRawProviderPayloads:
        false,

      supportsTenantIsolation:
        true,

      supportsIntegrityReporting:
        true,

      supportsOptimizedRepository:
        Boolean(
          this.repository,
        ),
    });
  }
}

export function createGovernanceDashboard(
  options = {},
) {
  return new GovernanceDashboard(
    options,
  );
}

export const createAirtelGovernanceDashboard =
  createGovernanceDashboard;

export const AirtelPaymentGovernanceDashboard =
  GovernanceDashboard;

export default GovernanceDashboard;

export const constants =
  Object.freeze({
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    PROVIDER,
    SCHEMA_VERSION,
    HASH_ALGORITHM,
    DASHBOARD_OUTCOMES,
    DASHBOARD_APPROVAL_STATES,
    DASHBOARD_INTEGRITY_STATES,
    DASHBOARD_HEALTH_STATES,
    GOVERNANCE_DASHBOARD_ERROR_CODES,
  });

export function buildDashboardFingerprint(
  value,
) {
  return `sha256:${sha256(value)}`;
}

export function constantTimeEqual(
  left,
  right,
) {
  if (
    left === undefined
    || left === null
    || right === undefined
    || right === null
  ) {
    return false;
  }

  const a =
    Buffer.from(
      String(left),
      'utf8',
    );

  const b =
    Buffer.from(
      String(right),
      'utf8',
    );

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(
    a,
    b,
  );
}