/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Payment SLA Manager
 * ============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/intelligence/command-center/slaManager.js
 *
 * Architectural role
 * ------------------
 * Tenant-scoped Service Level Agreement / SLO intelligence boundary for the
 * Airtel payment command center. The component evaluates observed provider and
 * platform telemetry against explicitly configured operational objectives,
 * derives breach/exposure states, measures error-budget consumption, preserves
 * evidence/provenance, and exposes bounded SLA views to operations, executives,
 * incident intelligence, governance and reporting consumers.
 *
 * Responsibilities
 * ----------------
 * - Evaluate configurable availability, latency, success-rate and outcome SLOs.
 * - Calculate rolling-window SLA posture and error-budget consumption.
 * - Detect current breaches, near-breaches and worsening operational exposure.
 * - Preserve observed-versus-target measurements and evidence provenance.
 * - Correlate provider telemetry with incident, cockpit and command-center data.
 * - Support tenant-scoped snapshots/history through an injected repository.
 * - Provide deterministic semantic fingerprints and idempotent snapshot writes.
 * - Expose health/readiness/summary/overview APIs for command-center consumers.
 * - Provide bounded advisory recommendations for operational review.
 *
 * Non-responsibilities / important boundaries
 * --------------------------------------------
 * - NOT a payment execution or provider adapter.
 * - NOT an Airtel API client.
 * - NOT a financial source of truth, ledger or settlement service.
 * - NOT authorized to retry, reverse, refund, capture, settle, debit or credit.
 * - NOT a circuit breaker or routing engine.
 * - NOT an incident lifecycle/state-machine owner.
 * - NOT a workflow scheduler or worker.
 * - NOT an approval/maker-checker authority.
 * - NOT an AML/KYC/sanctions/fraud decision engine.
 * - NOT a credit score or adverse-action engine.
 * - NOT a guarantee of contractual SLA compliance; contract-specific legal
 *   interpretation remains outside this module and must use approved policy.
 *
 * Production principles
 * ---------------------
 * - Provider scope is fail-closed to AIRTEL.
 * - Tenant scope is mandatory by default.
 * - SLO definitions are explicit, bounded and versioned.
 * - Observed metrics are distinguished from inferred/derived values.
 * - Missing evidence produces INDETERMINATE/PARTIAL states rather than a false
 *   healthy posture.
 * - A local/offline queued payment is never treated as a settled outcome.
 * - Sensitive identifiers are redacted or represented by SHA-256 digests.
 * - Downstream methods are allow-listed and calls are timeout-bounded.
 * - Inputs/outputs are size-bounded and defensively cloned/frozen.
 * - Persistence is injected; in-memory storage is development/test support only.
 * - Advisory recommendations contain no executable financial action.
 * - Timestamps are excluded from semantic fingerprints so identical evidence
 *   produces stable hashes.
 *
 * Module format
 * -------------
 * Native ECMAScript Module (ESM), Node.js 24+ compatible, Node built-ins only.
 * ============================================================================
 */

import crypto from 'node:crypto';

// =============================================================================
// Engine identity
// =============================================================================

export const ENGINE_NAME = 'airtel-command-center-sla-manager';
export const ENGINE_VERSION = '2.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = 'sha256';

// =============================================================================
// Public enumerations
// =============================================================================

export const SLA_STATUS = Object.freeze({
  COMPLIANT: 'COMPLIANT',
  AT_RISK: 'AT_RISK',
  BREACHED: 'BREACHED',
  DEGRADED: 'DEGRADED',
  INDETERMINATE: 'INDETERMINATE',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const SLA_DATA_STATE = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  PARTIAL: 'PARTIAL',
  EMPTY: 'EMPTY',
  UNAVAILABLE: 'UNAVAILABLE',
  TRUNCATED: 'TRUNCATED',
});

export const SLA_SEVERITY = Object.freeze({
  INFO: 'INFO',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const SLA_TREND = Object.freeze({
  IMPROVING: 'IMPROVING',
  STABLE: 'STABLE',
  WORSENING: 'WORSENING',
  INDETERMINATE: 'INDETERMINATE',
});

export const SLA_METRIC = Object.freeze({
  AVAILABILITY: 'AVAILABILITY',
  SUCCESS_RATE: 'SUCCESS_RATE',
  FAILURE_RATE: 'FAILURE_RATE',
  LATENCY: 'LATENCY',
  P95_LATENCY: 'P95_LATENCY',
  ERROR_RATE: 'ERROR_RATE',
  AMBIGUITY_RATE: 'AMBIGUITY_RATE',
  RECONCILIATION_BACKLOG: 'RECONCILIATION_BACKLOG',
});

export const SLA_MODE = Object.freeze({
  OVERVIEW: 'OVERVIEW',
  SUMMARY: 'SUMMARY',
  ANALYZE: 'ANALYZE',
  HEALTH: 'HEALTH',
  READINESS: 'READINESS',
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'AIRTEL_SLA_INVALID_INPUT',
  TENANT_REQUIRED: 'AIRTEL_SLA_TENANT_REQUIRED',
  TENANT_INVALID: 'AIRTEL_SLA_TENANT_INVALID',
  PROVIDER_SCOPE_VIOLATION: 'AIRTEL_SLA_PROVIDER_SCOPE_VIOLATION',
  SYSTEM_SCOPE_FORBIDDEN: 'AIRTEL_SLA_SYSTEM_SCOPE_FORBIDDEN',
  RANGE_INVALID: 'AIRTEL_SLA_RANGE_INVALID',
  RANGE_TOO_LARGE: 'AIRTEL_SLA_RANGE_TOO_LARGE',
  TIMEOUT: 'AIRTEL_SLA_TIMEOUT',
  SOURCE_UNAVAILABLE: 'AIRTEL_SLA_SOURCE_UNAVAILABLE',
  SOURCE_PROTOCOL_ERROR: 'AIRTEL_SLA_SOURCE_PROTOCOL_ERROR',
  SOURCE_UNSAFE: 'AIRTEL_SLA_SOURCE_UNSAFE',
  PAYLOAD_TOO_LARGE: 'AIRTEL_SLA_PAYLOAD_TOO_LARGE',
  REPOSITORY_REQUIRED: 'AIRTEL_SLA_REPOSITORY_REQUIRED',
  PERSISTENCE_FAILED: 'AIRTEL_SLA_PERSISTENCE_FAILED',
  IDEMPOTENCY_CONFLICT: 'AIRTEL_SLA_IDEMPOTENCY_CONFLICT',
  SNAPSHOT_NOT_FOUND: 'AIRTEL_SLA_SNAPSHOT_NOT_FOUND',
  EXPORT_TOO_LARGE: 'AIRTEL_SLA_EXPORT_TOO_LARGE',
});

// =============================================================================
// Default SLO policy
// =============================================================================

const DEFAULT_OBJECTIVES = Object.freeze({
  availabilityPercent: Object.freeze({
    target: 99.9,
    nearBreachMargin: 0.10,
    hardFloor: 95,
  }),

  successRatePercent: Object.freeze({
    target: 98,
    nearBreachMargin: 1,
    hardFloor: 80,
  }),

  failureRatePercent: Object.freeze({
    target: 2,
    nearBreachMargin: 0.5,
    hardCeiling: 20,
  }),

  latencyMs: Object.freeze({
    target: 3_000,
    nearBreachMargin: 500,
    hardCeiling: 30_000,
  }),

  p95LatencyMs: Object.freeze({
    target: 5_000,
    nearBreachMargin: 750,
    hardCeiling: 60_000,
  }),

  ambiguityRatePercent: Object.freeze({
    target: 1,
    nearBreachMargin: 0.5,
    hardCeiling: 25,
  }),

  reconciliationBacklog: Object.freeze({
    target: 25,
    nearBreachMargin: 25,
    hardCeiling: 1_000,
  }),

  errorBudgetPercent: Object.freeze({
    targetRemaining: 100,
    nearExhaustionRemaining: 20,
    exhaustedRemaining: 0,
  }),
});

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER,
  tenantRequired: true,
  systemScopeAllowed: false,

  defaultWindowMinutes: 60,
  maxWindowMinutes: 7 * 24 * 60,

  defaultTimeoutMs: 5_000,
  maxTimeoutMs: 30_000,

  maxConcurrency: 8,
  maxSourceRecords: 5_000,
  maxSignals: 40,
  maxEvidence: 100,
  maxRecommendations: 20,
  maxHistory: 100,
  defaultHistoryLimit: 20,

  maxPayloadBytes: 768 * 1024,
  maxExportBytes: 4 * 1024 * 1024,

  persistSnapshots: true,
  requireRepository: false,

  failClosedOnRequiredSourceFailure: false,
  failClosedOnUnsafeSource: true,

  objectives: DEFAULT_OBJECTIVES,

  requiredSources: Object.freeze([
    'providerTelemetry',
  ]),
});

// =============================================================================
// Source contracts
// =============================================================================

const SOURCE_DEFINITIONS = Object.freeze({
  providerTelemetry: Object.freeze({
    required: true,
    methods: Object.freeze([
      'getOverview',
      'getSummary',
      'getHealth',
      'health',
      'status',
    ]),
  }),

  operationsCockpit: Object.freeze({
    required: false,
    methods: Object.freeze([
      'getOperations',
      'getOverview',
      'getRisk',
    ]),
  }),

  providerIntelligence: Object.freeze({
    required: false,
    methods: Object.freeze([
      'getOverview',
      'getSummary',
      'getIntelligence',
      'analyze',
    ]),
  }),

  incidentPredictor: Object.freeze({
    required: false,
    methods: Object.freeze([
      'getOverview',
      'getSignals',
      'predict',
      'predictIncident',
    ]),
  }),

  executiveRiskCenter: Object.freeze({
    required: false,
    methods: Object.freeze([
      'getRisk',
      'getOverview',
      'getSnapshot',
    ]),
  }),

  dashboardAggregator: Object.freeze({
    required: false,
    methods: Object.freeze([
      'getOverview',
      'getSummary',
      'getOperations',
      'getRisk',
    ]),
  }),

  reconciliationIntelligence: Object.freeze({
    required: false,
    methods: Object.freeze([
      'getOverview',
      'getSummary',
      'analyze',
    ]),
  }),

  retryIntelligence: Object.freeze({
    required: false,
    methods: Object.freeze([
      'getOverview',
      'getSummary',
      'analyze',
      'classify',
    ]),
  }),
});

const SOURCE_METHOD_PREFERENCE = Object.freeze({
  providerTelemetry: [
    'getOverview',
    'getSummary',
    'getHealth',
    'health',
    'status',
  ],

  operationsCockpit: [
    'getOperations',
    'getOverview',
    'getRisk',
  ],

  providerIntelligence: [
    'getOverview',
    'getSummary',
    'getIntelligence',
    'analyze',
  ],

  incidentPredictor: [
    'getOverview',
    'getSignals',
    'predict',
    'predictIncident',
  ],

  executiveRiskCenter: [
    'getRisk',
    'getOverview',
    'getSnapshot',
  ],

  dashboardAggregator: [
    'getOverview',
    'getSummary',
    'getOperations',
    'getRisk',
  ],

  reconciliationIntelligence: [
    'getOverview',
    'getSummary',
    'analyze',
  ],

  retryIntelligence: [
    'getOverview',
    'getSummary',
    'analyze',
    'classify',
  ],
});

// =============================================================================
// Security helpers
// =============================================================================

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'set-cookie',
  'apiKey',
  'clientSecret',
  'privateKey',
  'otp',
  'pin',
  'cvv',
  'cardNumber',
  'accountNumber',
  'phoneNumber',
  'mobileNumber',
  'email',
  'nationalId',
  'nin',
]);

const FINANCIAL_MUTATION_KEYS = [
  'ledgerPosting',
  'financialPosting',
  'settlementMutation',
  'balanceMutation',
  'paymentExecution',
  'paymentPosting',
  'capture',
  'debit',
  'credit',
  'refund',
  'reverse',
  'disburse',
];

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && !(value instanceof Date)
    && !Buffer.isBuffer(value);
}

function normalizeString(
  value,
  {
    max = 200,
    fallback = '',
  } = {},
) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const result = value.trim();

  return result
    ? result.slice(0, max)
    : fallback;
}

function normalizeTenantId(value) {
  return normalizeString(
    value,
    {
      max: 160,
    },
  );
}

function normalizeProvider(value) {
  return normalizeString(
    value,
    {
      max: 32,
    },
  ).toUpperCase();
}

function normalizeNumber(
  value,
  fallback = null,
) {
  if (
    value === null
    || value === undefined
    || value === ''
  ) {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function normalizeInteger(
  value,
  fallback,
  {
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
  } = {},
) {
  const number = Number(value);

  if (!Number.isInteger(number)) {
    return fallback;
  }

  return Math.min(
    Math.max(number, min),
    max,
  );
}

function normalizePercent(value) {
  const number =
    normalizeNumber(value);

  if (number === null) {
    return null;
  }

  return clamp(
    number,
    0,
    100,
  );
}

function normalizePositive(
  value,
  fallback = null,
) {
  const number =
    normalizeNumber(
      value,
      fallback,
    );

  return number !== null
    && number > 0
    ? number
    : fallback;
}

function clamp(
  value,
  min,
  max,
) {
  return Math.min(
    Math.max(value, min),
    max,
  );
}

function percentage(
  numerator,
  denominator,
) {
  const n =
    normalizeNumber(
      numerator,
      null,
    );

  const d =
    normalizeNumber(
      denominator,
      null,
    );

  if (
    n === null
    || d === null
    || d <= 0
  ) {
    return null;
  }

  return Number(
    (
      (n / d)
      * 100
    ).toFixed(4),
  );
}

function firstNumber(...values) {
  for (const value of values) {
    const number =
      normalizeNumber(
        value,
        null,
      );

    if (number !== null) {
      return number;
    }
  }

  return null;
}

function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return null;
}

function nested(
  source,
  paths = [],
) {
  for (const path of paths) {
    const parts = path.split('.');
    let current = source;
    let found = true;

    for (const part of parts) {
      if (
        current === null
        || current === undefined
        || !(part in Object(current))
      ) {
        found = false;
        break;
      }

      current = current[part];
    }

    if (
      found
      && current !== null
      && current !== undefined
    ) {
      return current;
    }
  }

  return null;
}

function stableNormalize(
  value,
  depth = 0,
) {
  if (depth > 12) {
    return '[MAX_DEPTH]';
  }

  if (
    value === null
    || value === undefined
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[BUFFER:${value.length}]`;
  }

  if (typeof value === 'bigint') {
    return `${value}n`;
  }

  if (typeof value !== 'object') {
    if (
      typeof value === 'number'
      && !Number.isFinite(value)
    ) {
      return String(value);
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      (item) =>
        stableNormalize(
          item,
          depth + 1,
        ),
    );
  }

  const output = {};

  for (
    const key of Object.keys(value).sort()
  ) {
    output[key] =
      stableNormalize(
        value[key],
        depth + 1,
      );
  }

  return output;
}

function stableStringify(value) {
  return JSON.stringify(
    stableNormalize(value),
  );
}

function sha256(value) {
  return crypto
    .createHash(
      HASH_ALGORITHM,
    )
    .update(
      typeof value === 'string'
        ? value
        : stableStringify(value),
      'utf8',
    )
    .digest('hex');
}

function redact(
  value,
  depth = 0,
  seen = new WeakSet(),
) {
  if (depth > 10) {
    return '[MAX_DEPTH]';
  }

  if (
    value === null
    || value === undefined
  ) {
    return value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[BUFFER:${value.length}]`;
  }

  if (seen.has(value)) {
    return '[CIRCULAR]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, 200)
      .map(
        (item) =>
          redact(
            item,
            depth + 1,
            seen,
          ),
      );
  }

  const output = {};

  for (
    const [key, item]
    of Object.entries(value).slice(0, 300)
  ) {
    if (
      SENSITIVE_KEYS.has(key)
      || SENSITIVE_KEYS.has(
        key.toLowerCase(),
      )
      || /password|secret|token|authorization|cookie|private.?key|otp|pin|cvv/i.test(
        key,
      )
    ) {
      output[key] =
        item == null
          ? null
          : '[REDACTED]';

      continue;
    }

    output[key] =
      redact(
        item,
        depth + 1,
        seen,
      );
  }

  return output;
}

function safeBytes(value) {
  try {
    return Buffer.byteLength(
      stableStringify(
        redact(value),
      ),
      'utf8',
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
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
    const key of Reflect.ownKeys(value)
  ) {
    try {
      deepFreeze(
        value[key],
        seen,
      );
    } catch {
      // Defensive best effort.
    }
  }

  try {
    Object.freeze(value);
  } catch {
    // Defensive best effort.
  }

  return value;
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? new Date(value)
      : new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? null
    : date;
}

function normalizeIsoDate(
  value,
  fallback = null,
) {
  const date =
    parseDate(value);

  return date
    ? date.toISOString()
    : fallback;
}

function now(clock) {
  const value =
    typeof clock === 'function'
      ? clock()
      : new Date();

  return value instanceof Date
    ? value
    : new Date(value);
}

function nowIso(clock) {
  return now(clock)
    .toISOString();
}

function pickMethod(
  adapter,
  methods,
) {
  if (
    !adapter
    || typeof adapter !== 'object'
  ) {
    return null;
  }

  return (
    methods.find(
      (method) =>
        typeof adapter[method]
          === 'function',
    )
    || null
  );
}

function sourceProvider(result) {
  return normalizeProvider(
    nested(
      result,
      [
        'provider',
        'context.provider',
        'meta.provider',
        'data.provider',
      ],
    ) || PROVIDER,
  );
}

function sourceTenant(result) {
  return normalizeTenantId(
    nested(
      result,
      [
        'tenantId',
        'context.tenantId',
        'meta.tenantId',
        'data.tenantId',
      ],
    ) || '',
  );
}

function sourceStatus(result) {
  return normalizeString(
    nested(
      result,
      [
        'status',
        'state',
        'health.status',
        'readiness.status',
        'data.status',
      ],
    ) || 'UNKNOWN',
    {
      max: 80,
    },
  ).toUpperCase();
}

function isUnsafeFinancialPayload(
  value,
  depth = 0,
) {
  if (
    depth > 8
    || value === null
    || value === undefined
  ) {
    return false;
  }

  if (typeof value === 'string') {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(
      (item) =>
        isUnsafeFinancialPayload(
          item,
          depth + 1,
        ),
    );
  }

  if (typeof value !== 'object') {
    return false;
  }

  return Object.entries(value).some(
    ([key, child]) => {
      if (
        FINANCIAL_MUTATION_KEYS.some(
          (pattern) =>
            key
              .toLowerCase()
              .includes(
                pattern.toLowerCase(),
              ),
        )
      ) {
        return true;
      }

      return isUnsafeFinancialPayload(
        child,
        depth + 1,
      );
    },
  );
}

function severityWeight(
  severity,
) {
  switch (severity) {
    case SLA_SEVERITY.CRITICAL:
      return 5;

    case SLA_SEVERITY.HIGH:
      return 4;

    case SLA_SEVERITY.MEDIUM:
      return 3;

    case SLA_SEVERITY.LOW:
      return 2;

    default:
      return 1;
  }
}

function severityForBreachDepth(
  depth,
) {
  if (depth >= 100) {
    return SLA_SEVERITY.CRITICAL;
  }

  if (depth >= 50) {
    return SLA_SEVERITY.HIGH;
  }

  if (depth >= 20) {
    return SLA_SEVERITY.MEDIUM;
  }

  if (depth > 0) {
    return SLA_SEVERITY.LOW;
  }

  return SLA_SEVERITY.INFO;
}

function statusForMetric({
  breached,
  atRisk,
  unavailable,
}) {
  if (unavailable) {
    return SLA_STATUS.INDETERMINATE;
  }

  if (breached) {
    return SLA_STATUS.BREACHED;
  }

  if (atRisk) {
    return SLA_STATUS.AT_RISK;
  }

  return SLA_STATUS.COMPLIANT;
}

function trendFromValues(
  current,
  baseline,
  {
    higherIsBetter = true,
  } = {},
) {
  if (
    !Number.isFinite(current)
    || !Number.isFinite(baseline)
  ) {
    return SLA_TREND.INDETERMINATE;
  }

  const denominator =
    Math.max(
      Math.abs(baseline),
      0.000001,
    );

  const relativeChange =
    Math.abs(
      (
        (current - baseline)
        / denominator
      ),
    ) * 100;

  if (relativeChange < 5) {
    return SLA_TREND.STABLE;
  }

  if (higherIsBetter) {
    return current > baseline
      ? SLA_TREND.IMPROVING
      : SLA_TREND.WORSENING;
  }

  return current < baseline
    ? SLA_TREND.IMPROVING
    : SLA_TREND.WORSENING;
}

// =============================================================================
// Error type
// =============================================================================

export class SlaManagerError extends Error {
  constructor(
    code,
    message,
    status = 500,
    details = undefined,
    cause = undefined,
  ) {
    super(
      message,
      { cause },
    );

    this.name =
      'SlaManagerError';

    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// =============================================================================
// Development/test repository
// =============================================================================

export class InMemorySlaRepository {
  constructor({
    maxHistory =
      DEFAULT_CONFIG.maxHistory,
  } = {}) {
    this.maxHistory =
      normalizeInteger(
        maxHistory,
        DEFAULT_CONFIG.maxHistory,
        {
          min: 1,
          max: DEFAULT_CONFIG.maxHistory,
        },
      );

    this.snapshots = new Map();
    this.idempotency = new Map();
  }

  _tenantKey(tenantId) {
    return (
      normalizeTenantId(
        tenantId,
      )
      || '__SYSTEM__'
    );
  }

  async saveSnapshot(
    snapshot,
  ) {
    const tenantKey =
      this._tenantKey(
        snapshot.tenantId,
      );

    const rows =
      this.snapshots.get(
        tenantKey,
      ) || [];

    rows.unshift(
      redact(snapshot),
    );

    this.snapshots.set(
      tenantKey,
      rows.slice(
        0,
        this.maxHistory,
      ),
    );

    if (
      snapshot.idempotencyKeyDigest
    ) {
      this.idempotency.set(
        `${tenantKey}:${snapshot.idempotencyKeyDigest}`,
        redact(snapshot),
      );
    }

    return snapshot;
  }

  async getByIdempotency({
    tenantId,
    idempotencyKeyDigest,
  }) {
    return (
      this.idempotency.get(
        `${this._tenantKey(
          tenantId,
        )}:${idempotencyKeyDigest}`,
      )
      || null
    );
  }

  async getSnapshot({
    tenantId,
    snapshotId,
  }) {
    const rows =
      this.snapshots.get(
        this._tenantKey(
          tenantId,
        ),
      ) || [];

    return (
      rows.find(
        (row) =>
          row.snapshotId
          === snapshotId,
      )
      || null
    );
  }

  async listSnapshots({
    tenantId,
    limit = 20,
  }) {
    const rows =
      this.snapshots.get(
        this._tenantKey(
          tenantId,
        ),
      ) || [];

    return rows.slice(
      0,
      Math.min(
        limit,
        this.maxHistory,
      ),
    );
  }

  async healthCheck() {
    return {
      status: 'UP',
      tenants:
        this.snapshots.size,
    };
  }

  async close() {
    this.snapshots.clear();
    this.idempotency.clear();
  }
}

// =============================================================================
// SLA manager
// =============================================================================

export class AirtelSlaManager {
  constructor({
    providerTelemetry,
    operationsCockpit,
    providerIntelligence,
    incidentPredictor,
    executiveRiskCenter,
    dashboardAggregator,
    reconciliationIntelligence,
    retryIntelligence,
    repository,
    logger,
    metrics,
    tracer,
    clock = () => new Date(),
    snapshotIdFactory,
    config = {},
  } = {}) {
    this.providerTelemetry =
      providerTelemetry;

    this.operationsCockpit =
      operationsCockpit;

    this.providerIntelligence =
      providerIntelligence;

    this.incidentPredictor =
      incidentPredictor;

    this.executiveRiskCenter =
      executiveRiskCenter;

    this.dashboardAggregator =
      dashboardAggregator;

    this.reconciliationIntelligence =
      reconciliationIntelligence;

    this.retryIntelligence =
      retryIntelligence;

    this.repository =
      repository
      || new InMemorySlaRepository();

    this.logger = logger;
    this.metrics = metrics;
    this.tracer = tracer;
    this.clock = clock;
    this.snapshotIdFactory =
      snapshotIdFactory;

    const objectiveOverrides =
      isPlainObject(
        config?.objectives,
      )
        ? config.objectives
        : {};

    const objectives = {
      ...DEFAULT_OBJECTIVES,
      ...objectiveOverrides,
    };

    for (
      const [
        key,
        defaults,
      ]
      of Object.entries(
        DEFAULT_OBJECTIVES,
      )
    ) {
      if (
        isPlainObject(defaults)
        && isPlainObject(
          objectiveOverrides[key],
        )
      ) {
        objectives[key] = {
          ...defaults,
          ...objectiveOverrides[key],
        };
      }
    }

    this.config =
      deepFreeze({
        ...DEFAULT_CONFIG,
        ...(isPlainObject(config)
          ? config
          : {}),
        provider:
          PROVIDER,
        objectives,
        requiredSources:
          Array.isArray(
            config?.requiredSources,
          )
            ? [
                ...config.requiredSources,
              ]
            : [
                ...DEFAULT_CONFIG
                  .requiredSources,
              ],
      });

    this.statistics = {
      evaluations: 0,
      successfulEvaluations: 0,
      failedEvaluations: 0,
      replayedEvaluations: 0,
      sourceFailures: 0,
      sourceTimeouts: 0,
      snapshotsPersisted: 0,
    };

    this._closed = false;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async getOverview(
    input = {},
  ) {
    return this.analyze({
      ...input,
      mode:
        SLA_MODE.OVERVIEW,
    });
  }

  async getStatus(
    input = {},
  ) {
    return this.getOverview(
      input,
    );
  }

  async getSummary(
    input = {},
  ) {
    return this.analyze({
      ...input,
      mode:
        SLA_MODE.SUMMARY,
    });
  }

  async summary(
    input = {},
  ) {
    return this.getSummary(
      input,
    );
  }

  async analyze(
    input = {},
  ) {
    this.statistics.evaluations += 1;

    if (this._closed) {
      throw new SlaManagerError(
        ERROR_CODES.SOURCE_UNAVAILABLE,
        'Airtel SLA manager is closed.',
        503,
      );
    }

    const context =
      this._normalizeContext(
        input,
      );

    const startedAt =
      Date.now();

    try {
      const replay =
        await this._findReplay(
          context,
        );

      if (replay) {
        this.statistics
          .replayedEvaluations += 1;

        return this._freeze({
          ...replay,

          replayed: true,

          generatedAt:
            nowIso(this.clock),
        });
      }

      const sources =
        await this._collectSources(
          context,
        );

      const metrics =
        this._extractMetrics(
          sources,
        );

      const objectives =
        this._buildObjectives();

      const metricEvaluations =
        this._evaluateObjectives(
          metrics,
          objectives,
        );

      const overall =
        this._deriveOverallStatus(
          metricEvaluations,
          sources,
        );

      const errorBudget =
        this._calculateErrorBudget(
          metrics,
          objectives,
        );

      const trend =
        this._deriveTrend(
          metrics,
        );

      const signals =
        this._buildSignals(
          metrics,
          metricEvaluations,
          sources,
          errorBudget,
        );

      const recommendations =
        this._buildRecommendations(
          signals,
          metricEvaluations,
          errorBudget,
        );

      const evidence =
        context.includeEvidence
          ? this._buildEvidence(
              sources,
              metrics,
              metricEvaluations,
            )
          : [];

      const sourceAvailabilityPercent =
        this._sourceAvailability(
          sources,
        );

      const dataState =
        this._deriveDataState(
          sources,
          sourceAvailabilityPercent,
        );

      const result = {
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

        tenantId:
          context.tenantId,

        tenantDigest:
          context.tenantDigest,

        scope:
          context.scope,

        mode:
          context.mode,

        status:
          overall.status,

        severity:
          overall.severity,

        operationalBand:
          overall.operationalBand,

        dataState,

        range: {
          startAt:
            context.startAt,

          endAt:
            context.endAt,

          windowMinutes:
            context.windowMinutes,
        },

        objectives,

        metrics,

        metricEvaluations,

        errorBudget,

        trend,

        signals,

        recommendations,

        evidence,

        sources:
          this._buildSourceSummary(
            sources,
          ),

        limitations:
          this._buildLimitations({
            sources,
            dataState,
            sourceAvailabilityPercent,
          }),

        financialSafety: {
          authoritativeFinancialState:
            false,

          paymentExecutionAllowed:
            false,

          settlementMutationAllowed:
            false,

          ledgerMutationAllowed:
            false,

          retryAuthorization:
            false,

          offlineLocalStateIsFinalSettlement:
            false,
        },

        generatedAt:
          nowIso(this.clock),

        durationMs:
          Date.now()
          - startedAt,
      };

      result.requestFingerprint =
        this._requestFingerprint(
          context,
        );

      result.fingerprint =
        this._fingerprint(
          result,
        );

      if (context.persist) {
        await this._persist(
          result,
          context,
        );
      }

      this.statistics
        .successfulEvaluations += 1;

      this._metric(
        'airtel_sla_manager_evaluations_total',
        1,
        {
          status:
            overall.status,

          mode:
            context.mode,
        },
      );

      return this._freeze(
        result,
      );
    } catch (error) {
      this.statistics
        .failedEvaluations += 1;

      const normalized =
        this._normalizeError(
          error,
        );

      this._metric(
        'airtel_sla_manager_evaluations_failed_total',
        1,
        {
          code:
            normalized.code,
        },
      );

      this._log(
        'warn',
        'Airtel SLA evaluation failed.',
        {
          code:
            normalized.code,

          tenantDigest:
            context.tenantDigest,

          mode:
            context.mode,
        },
      );

      throw error;
    }
  }

  async getSnapshot({
    tenantId,
    snapshotId,
  } = {}) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    this._assertTenant(
      normalizedTenantId,
      'TENANT',
    );

    const normalizedSnapshotId =
      normalizeString(
        snapshotId,
        {
          max: 160,
        },
      );

    if (!normalizedSnapshotId) {
      throw new SlaManagerError(
        ERROR_CODES.INVALID_INPUT,
        'snapshotId is required.',
        400,
      );
    }

    if (
      !this.repository
      || typeof this.repository
        .getSnapshot
        !== 'function'
    ) {
      throw new SlaManagerError(
        ERROR_CODES.REPOSITORY_REQUIRED,
        'SLA snapshot repository is unavailable.',
        503,
      );
    }

    const snapshot =
      await this.repository.getSnapshot({
        tenantId:
          normalizedTenantId,

        snapshotId:
          normalizedSnapshotId,
      });

    if (!snapshot) {
      throw new SlaManagerError(
        ERROR_CODES.SNAPSHOT_NOT_FOUND,
        'SLA snapshot was not found.',
        404,
      );
    }

    return this._freeze(
      snapshot,
    );
  }

  async listSnapshots({
    tenantId,
    limit =
      this.config.defaultHistoryLimit,
  } = {}) {
    const normalizedTenantId =
      normalizeTenantId(
        tenantId,
      );

    this._assertTenant(
      normalizedTenantId,
      'TENANT',
    );

    const boundedLimit =
      normalizeInteger(
        limit,
        this.config.defaultHistoryLimit,
        {
          min: 1,
          max: this.config.maxHistory,
        },
      );

    if (
      !this.repository
      || typeof this.repository
        .listSnapshots
        !== 'function'
    ) {
      throw new SlaManagerError(
        ERROR_CODES.REPOSITORY_REQUIRED,
        'SLA snapshot repository is unavailable.',
        503,
      );
    }

    const records =
      await this.repository.listSnapshots({
        tenantId:
          normalizedTenantId,

        limit:
          boundedLimit,
      });

    return this._freeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      tenantId:
        normalizedTenantId,

      tenantDigest:
        sha256(
          normalizedTenantId,
        ),

      count:
        records.length,

      records,

      generatedAt:
        nowIso(this.clock),
    });
  }

  async exportOverview(
    input = {},
  ) {
    const result =
      await this.getOverview({
        ...input,
        persist: false,
      });

    const payload =
      JSON.stringify(
        result,
        null,
        2,
      );

    const bytes =
      Buffer.byteLength(
        payload,
        'utf8',
      );

    if (
      bytes
      > this.config.maxExportBytes
    ) {
      throw new SlaManagerError(
        ERROR_CODES.EXPORT_TOO_LARGE,
        'SLA export exceeds the configured size limit.',
        413,
      );
    }

    return this._freeze({
      contentType:
        'application/json',

      filename:
        'airtel-sla-overview.json',

      bytes,

      fingerprint:
        sha256(result),

      payload,
    });
  }

  async health({
    tenantId,
  } = {}) {
    const repository =
      await this._safeHealthCheck(
        this.repository,
        'repository',
      );

    const provider =
      await this._safeHealthCheck(
        this.providerTelemetry,
        'providerTelemetry',
      );

    let status =
      SLA_STATUS.COMPLIANT;

    if (!provider.ok) {
      status =
        SLA_STATUS.UNAVAILABLE;
    } else if (!repository.ok) {
      status =
        SLA_STATUS.DEGRADED;
    }

    return this._freeze({
      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      provider:
        PROVIDER,

      status,

      tenantDigest:
        sha256(
          normalizeTenantId(
            tenantId,
          ) || 'system',
        ),

      checkedAt:
        nowIso(this.clock),

      checks: [
        repository,
        provider,
      ],

      statistics: {
        ...this.statistics,
      },
    });
  }

  async readiness({
    tenantId,
  } = {}) {
    const result =
      await this.health({
        tenantId,
      });

    return this._freeze({
      ...result,

      ready:
        result.status
          !== SLA_STATUS.UNAVAILABLE
        && result.checks.every(
          (check) => check.ok,
        ),
    });
  }

  async close() {
    this._closed = true;

    if (
      this.repository
      && typeof this.repository.close
        === 'function'
    ) {
      await this.repository.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Context normalization
  // ---------------------------------------------------------------------------

  _normalizeContext(
    input,
  ) {
    if (!isPlainObject(input)) {
      throw new SlaManagerError(
        ERROR_CODES.INVALID_INPUT,
        'SLA manager input must be a plain object.',
        400,
      );
    }

    const provider =
      normalizeProvider(
        input.provider
          || PROVIDER,
      );

    if (
      provider !== PROVIDER
    ) {
      throw new SlaManagerError(
        ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        'This SLA manager is restricted to Airtel.',
        403,
        {
          provider,
        },
      );
    }

    const tenantId =
      normalizeTenantId(
        input.tenantId,
      );

    const scope =
      normalizeString(
        input.scope,
        {
          max: 20,
        },
      ).toUpperCase()
      || 'TENANT';

    if (
      scope === 'SYSTEM'
      && !this.config
        .systemScopeAllowed
    ) {
      throw new SlaManagerError(
        ERROR_CODES.SYSTEM_SCOPE_FORBIDDEN,
        'System scope is disabled for the Airtel SLA manager.',
        403,
      );
    }

    this._assertTenant(
      tenantId,
      scope,
    );

    const endAt =
      parseDate(
        input.endAt,
      )
      || now(this.clock);

    const requestedWindow =
      normalizePositive(
        input.windowMinutes,
        this.config
          .defaultWindowMinutes,
      );

    const explicitStartAt =
      parseDate(
        input.startAt,
      );

    const startAt =
      explicitStartAt
      || new Date(
        endAt.getTime()
        - (
          requestedWindow
          * 60_000
        ),
      );

    if (
      startAt.getTime()
      >= endAt.getTime()
    ) {
      throw new SlaManagerError(
        ERROR_CODES.RANGE_INVALID,
        'startAt must be earlier than endAt.',
        400,
      );
    }

    const actualWindowMinutes =
      (
        endAt.getTime()
        - startAt.getTime()
      )
      / 60_000;

    if (
      actualWindowMinutes
      > this.config
        .maxWindowMinutes
    ) {
      throw new SlaManagerError(
        ERROR_CODES.RANGE_TOO_LARGE,
        'Requested SLA window exceeds the configured limit.',
        400,
        {
          maxWindowMinutes:
            this.config
              .maxWindowMinutes,
        },
      );
    }

    const mode =
      normalizeString(
        input.mode,
        {
          max: 30,
        },
      ).toUpperCase()
      || SLA_MODE.ANALYZE;

    if (
      !Object.values(
        SLA_MODE,
      ).includes(mode)
    ) {
      throw new SlaManagerError(
        ERROR_CODES.INVALID_INPUT,
        'Unsupported SLA mode.',
        400,
      );
    }

    if (
      safeBytes(input)
      > this.config
        .maxPayloadBytes
    ) {
      throw new SlaManagerError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        'SLA request exceeds the configured payload limit.',
        413,
      );
    }

    const timeoutMs =
      normalizeInteger(
        input.timeoutMs,
        this.config
          .defaultTimeoutMs,
        {
          min: 100,
          max: this.config
            .maxTimeoutMs,
        },
      );

    const maxSourceRecords =
      normalizeInteger(
        input.maxSourceRecords,
        this.config
          .maxSourceRecords,
        {
          min: 1,
          max: this.config
            .maxSourceRecords,
        },
      );

    return {
      provider:
        PROVIDER,

      tenantId,

      tenantDigest:
        sha256(
          tenantId
            || 'system',
        ),

      scope,

      startAt:
        startAt.toISOString(),

      endAt:
        endAt.toISOString(),

      windowMinutes:
        Number(
          actualWindowMinutes
            .toFixed(4),
        ),

      timeoutMs,

      maxSourceRecords,

      mode,

      includeEvidence:
        input.includeEvidence
        !== false,

      persist:
        input.persist
        !== false
        && this.config
          .persistSnapshots,

      dryRun:
        input.dryRun === true,

      correlationId:
        normalizeString(
          input.correlationId,
          {
            max: 160,
          },
        )
        || crypto.randomUUID(),

      idempotencyKey:
        normalizeString(
          input.idempotencyKey,
          {
            max: 200,
          },
        ),

      idempotencyKeyDigest:
        input.idempotencyKey
          ? sha256(
              normalizeString(
                input.idempotencyKey,
                {
                  max: 200,
                },
              ),
            )
          : null,
    };
  }

  _assertTenant(
    tenantId,
    scope = 'TENANT',
  ) {
    if (
      this.config.tenantRequired
      && scope !== 'SYSTEM'
      && !tenantId
    ) {
      throw new SlaManagerError(
        ERROR_CODES.TENANT_REQUIRED,
        'tenantId is required for tenant-scoped SLA operations.',
        400,
      );
    }

    if (
      tenantId
      && tenantId.length < 2
    ) {
      throw new SlaManagerError(
        ERROR_CODES.TENANT_INVALID,
        'tenantId is invalid.',
        400,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Source collection
  // ---------------------------------------------------------------------------

  async _collectSources(
    context,
  ) {
    const entries =
      Object.entries(
        SOURCE_DEFINITIONS,
      )
        .map(
          ([
            name,
            definition,
          ]) => ({
            name,
            definition,
            adapter:
              this[name],
          }),
        )
        .filter(
          ({ adapter }) =>
            Boolean(adapter),
        );

    const requiredNames =
      new Set(
        Array.isArray(
          this.config.requiredSources,
        )
          ? this.config
              .requiredSources
          : [],
      );

    const results = {};

    let cursor = 0;

    const workerCount =
      Math.min(
        this.config
          .maxConcurrency,
        entries.length || 1,
      );

    const workers =
      Array.from(
        {
          length:
            workerCount,
        },
        async () => {
          while (true) {
            const entry =
              entries[cursor++];

            if (!entry) {
              return;
            }

            const {
              name,
              definition,
              adapter,
            } = entry;

            const method =
              pickMethod(
                adapter,
                SOURCE_METHOD_PREFERENCE[
                  name
                ]
                  || definition.methods,
              );

            const required =
              requiredNames.has(
                name,
              )
              || definition.required;

            if (!method) {
              results[name] = {
                source:
                  name,

                method:
                  null,

                required,

                available:
                  false,

                status:
                  'UNSUPPORTED',

                intelligenceStatus:
                  SLA_STATUS
                    .INDETERMINATE,

                provider:
                  PROVIDER,

                tenantDigest:
                  context
                    .tenantDigest,

                latencyMs:
                  0,

                data:
                  null,

                errorCode:
                  ERROR_CODES
                    .SOURCE_UNAVAILABLE,
              };

              continue;
            }

            const startedAt =
              Date.now();

            try {
              const result =
                await this._invokeSource({
                  adapter,
                  method,
                  context,
                });

              if (
                !isPlainObject(
                  result,
                )
                && !Array.isArray(
                  result,
                )
              ) {
                throw new SlaManagerError(
                  ERROR_CODES
                    .SOURCE_PROTOCOL_ERROR,
                  'SLA source returned an unsupported payload.',
                  502,
                  {
                    source:
                      name,
                  },
                );
              }

              const returnedProvider =
                sourceProvider(
                  result,
                );

              const returnedTenant =
                sourceTenant(
                  result,
                );

              if (
                returnedProvider
                !== PROVIDER
              ) {
                throw new SlaManagerError(
                  ERROR_CODES
                    .SOURCE_UNSAFE,
                  'SLA source returned a different provider.',
                  502,
                  {
                    source:
                      name,

                    returnedProvider,
                  },
                );
              }

              if (
                context.tenantId
                && returnedTenant
                && returnedTenant
                  !== context.tenantId
              ) {
                throw new SlaManagerError(
                  ERROR_CODES
                    .SOURCE_UNSAFE,
                  'SLA source returned a different tenant.',
                  502,
                  {
                    source:
                      name,
                  },
                );
              }

              if (
                this.config
                  .failClosedOnUnsafeSource
                && isUnsafeFinancialPayload(
                  result,
                )
              ) {
                throw new SlaManagerError(
                  ERROR_CODES
                    .SOURCE_UNSAFE,
                  'SLA source payload crosses a protected financial mutation boundary.',
                  502,
                  {
                    source:
                      name,
                  },
                );
              }

              const status =
                sourceStatus(
                  result,
                );

              results[name] = {
                source:
                  name,

                method,

                required,

                available:
                  true,

                status,

                intelligenceStatus:
                  this
                    ._classifySourceStatus(
                      status,
                    ),

                provider:
                  PROVIDER,

                tenantDigest:
                  context
                    .tenantDigest,

                latencyMs:
                  Date.now()
                  - startedAt,

                data:
                  redact(result),
              };
            } catch (error) {
              const normalized =
                this._normalizeError(
                  error,
                );

              this.statistics
                .sourceFailures += 1;

              if (
                normalized.code
                  === ERROR_CODES.TIMEOUT
              ) {
                this.statistics
                  .sourceTimeouts += 1;
              }

              results[name] = {
                source:
                  name,

                method,

                required,

                available:
                  false,

                status:
                  'FAILED',

                intelligenceStatus:
                  SLA_STATUS
                    .UNAVAILABLE,

                provider:
                  PROVIDER,

                tenantDigest:
                  context
                    .tenantDigest,

                latencyMs:
                  Date.now()
                  - startedAt,

                data:
                  null,

                errorCode:
                  normalized.code,
              };

              if (
                required
                && this.config
                  .failClosedOnRequiredSourceFailure
              ) {
                throw error;
              }

              if (
                normalized.code
                  === ERROR_CODES
                    .SOURCE_UNSAFE
                && this.config
                  .failClosedOnUnsafeSource
              ) {
                throw error;
              }
            }
          }
        },
      );

    await Promise.all(
      workers,
    );

    return results;
  }

  async _invokeSource({
    adapter,
    method,
    context,
  }) {
    const payload = {
      provider:
        PROVIDER,

      tenantId:
        context.tenantId,

      tenantDigest:
        context.tenantDigest,

      scope:
        context.scope,

      startAt:
        context.startAt,

      endAt:
        context.endAt,

      windowMinutes:
        context.windowMinutes,

      maxSourceRecords:
        context.maxSourceRecords,

      limit:
        context.maxSourceRecords,

      correlationId:
        context.correlationId,

      mode:
        'ADVISORY',

      dryRun:
        true,
    };

    return this._withTimeout(
      this._withSpan(
        `${COMPONENT}.${method}`,
        () =>
          adapter[method](
            payload,
          ),
      ),
      context.timeoutMs,
      method,
    );
  }

  async _withTimeout(
    promise,
    timeoutMs,
    operation,
  ) {
    let timer = null;

    const timeout =
      new Promise(
        (_, reject) => {
          timer =
            setTimeout(
              () => {
                reject(
                  new SlaManagerError(
                    ERROR_CODES.TIMEOUT,
                    'SLA source operation timed out.',
                    504,
                    {
                      operation,
                      timeoutMs,
                    },
                  ),
                );
              },
              timeoutMs,
            );

          timer.unref?.();
        },
      );

    try {
      return await Promise.race([
        Promise.resolve(
          promise,
        ),
        timeout,
      ]);
    } finally {
      if (timer) {
        clearTimeout(
          timer,
        );
      }
    }
  }

  async _withSpan(
    name,
    fn,
  ) {
    if (!this.tracer) {
      return fn();
    }

    if (
      typeof this.tracer
        .startActiveSpan
        === 'function'
    ) {
      return new Promise(
        (
          resolve,
          reject,
        ) => {
          this.tracer.startActiveSpan(
            name,
            async (span) => {
              try {
                const result =
                  await fn();

                span?.setAttribute?.(
                  'provider',
                  PROVIDER,
                );

                span?.end?.();

                resolve(
                  result,
                );
              } catch (error) {
                span?.recordException?.(
                  error,
                );

                span?.end?.();

                reject(
                  error,
                );
              }
            },
          );
        },
      );
    }

    if (
      typeof this.tracer
        .startSpan
        === 'function'
    ) {
      const span =
        this.tracer.startSpan(
          name,
        );

      try {
        const result =
          await fn();

        span?.end?.();

        return result;
      } catch (error) {
        span?.recordException?.(
          error,
        );

        span?.end?.();

        throw error;
      }
    }

    return fn();
  }

  _classifySourceStatus(
    status,
  ) {
    const value =
      String(
        status || 'UNKNOWN',
      ).toUpperCase();

    if (
      [
        'DOWN',
        'FAILED',
        'UNAVAILABLE',
        'ERROR',
        'NOT_READY',
      ].includes(value)
    ) {
      return SLA_STATUS.UNAVAILABLE;
    }

    if (
      value.includes(
        'DEGRAD',
      )
    ) {
      return SLA_STATUS.DEGRADED;
    }

    if (
      value === 'CRITICAL'
    ) {
      return SLA_STATUS.BREACHED;
    }

    if (
      [
        'HEALTHY',
        'UP',
        'READY',
        'OK',
        'OPERATIONAL',
      ].includes(value)
    ) {
      return SLA_STATUS.COMPLIANT;
    }

    return SLA_STATUS.INDETERMINATE;
  }

  // ---------------------------------------------------------------------------
  // Metric extraction
  // ---------------------------------------------------------------------------

  _extractMetrics(
    sources,
  ) {
    const provider =
      sources.providerTelemetry
        ?.data
      || {};

    const cockpit =
      sources.operationsCockpit
        ?.data
      || {};

    const providerIntel =
      sources.providerIntelligence
        ?.data
      || {};

    const dashboard =
      sources.dashboardAggregator
        ?.data
      || {};

    const incidents =
      sources.incidentPredictor
        ?.data
      || {};

    const risk =
      sources.executiveRiskCenter
        ?.data
      || {};

    const reconciliation =
      sources.reconciliationIntelligence
        ?.data
      || {};

    const retry =
      sources.retryIntelligence
        ?.data
      || {};

    const totalTransactions =
      firstNumber(
        nested(
          provider,
          [
            'metrics.totalTransactions',
            'totalTransactions',
            'transactions.total',
          ],
        ),

        nested(
          providerIntel,
          [
            'metrics.totalTransactions',
            'totalTransactions',
          ],
        ),

        nested(
          cockpit,
          [
            'metrics.totalTransactions',
            'totalTransactions',
          ],
        ),

        nested(
          dashboard,
          [
            'metrics.totalTransactions',
            'totalTransactions',
          ],
        ),
      );

    const successfulTransactions =
      firstNumber(
        nested(
          provider,
          [
            'metrics.successfulTransactions',
            'successfulTransactions',
            'transactions.successful',
          ],
        ),

        nested(
          providerIntel,
          [
            'metrics.successfulTransactions',
            'successfulTransactions',
          ],
        ),

        nested(
          cockpit,
          [
            'metrics.successfulTransactions',
            'successfulTransactions',
          ],
        ),
      );

    const failedTransactions =
      firstNumber(
        nested(
          provider,
          [
            'metrics.failedTransactions',
            'failedTransactions',
            'transactions.failed',
          ],
        ),

        nested(
          providerIntel,
          [
            'metrics.failedTransactions',
            'failedTransactions',
          ],
        ),

        nested(
          cockpit,
          [
            'metrics.failedTransactions',
            'failedTransactions',
          ],
        ),

        nested(
          dashboard,
          [
            'metrics.failedTransactions',
            'failedTransactions',
          ],
        ),
      );

    const ambiguousTransactions =
      firstNumber(
        nested(
          provider,
          [
            'metrics.ambiguousTransactions',
            'ambiguousTransactions',
            'transactions.ambiguous',
          ],
        ),

        nested(
          providerIntel,
          [
            'metrics.ambiguousTransactions',
            'ambiguousTransactions',
          ],
        ),

        nested(
          retry,
          [
            'metrics.ambiguousTransactions',
            'ambiguousTransactions',
          ],
        ),
      );

    const availabilityPercent =
      normalizePercent(
        firstNumber(
          nested(
            provider,
            [
              'metrics.availabilityPercent',
              'availabilityPercent',
              'availability.percent',
            ],
          ),

          nested(
            providerIntel,
            [
              'metrics.availabilityPercent',
              'availabilityPercent',
            ],
          ),

          nested(
            cockpit,
            [
              'metrics.providerAvailabilityPercent',
              'providerAvailabilityPercent',
            ],
          ),
        ),
      );

    const successRatePercent =
      normalizePercent(
        firstNumber(
          nested(
            provider,
            [
              'metrics.successRate',
              'successRate',
              'rates.successRate',
            ],
          ),

          nested(
            providerIntel,
            [
              'metrics.successRate',
              'successRate',
            ],
          ),

          percentage(
            successfulTransactions,
            totalTransactions,
          ),
        ),
      );

    const failureRatePercent =
      normalizePercent(
        firstNumber(
          nested(
            provider,
            [
              'metrics.failureRate',
              'failureRate',
              'rates.failureRate',
            ],
          ),

          nested(
            providerIntel,
            [
              'metrics.failureRate',
              'failureRate',
            ],
          ),

          nested(
            cockpit,
            [
              'metrics.failureRate',
              'failureRate',
            ],
          ),

          percentage(
            failedTransactions,
            totalTransactions,
          ),
        ),
      );

    const averageLatencyMs =
      firstNumber(
        nested(
          provider,
          [
            'metrics.averageLatencyMs',
            'averageLatencyMs',
            'latency.averageMs',
          ],
        ),

        nested(
          providerIntel,
          [
            'metrics.averageLatencyMs',
            'averageLatencyMs',
          ],
        ),

        nested(
          cockpit,
          [
            'metrics.averageLatencyMs',
            'averageLatencyMs',
          ],
        ),
      );

    const p95LatencyMs =
      firstNumber(
        nested(
          provider,
          [
            'metrics.p95LatencyMs',
            'p95LatencyMs',
            'latency.p95Ms',
          ],
        ),

        nested(
          providerIntel,
          [
            'metrics.p95LatencyMs',
            'p95LatencyMs',
          ],
        ),

        nested(
          cockpit,
          [
            'metrics.p95LatencyMs',
            'p95LatencyMs',
          ],
        ),
      );

    const baselineLatencyMs =
      firstNumber(
        nested(
          provider,
          [
            'metrics.baselineLatencyMs',
            'baselineLatencyMs',
            'latency.baselineMs',
          ],
        ),

        nested(
          providerIntel,
          [
            'metrics.baselineLatencyMs',
            'baselineLatencyMs',
          ],
        ),
      );

    const latencyDeltaPercent =
      firstNumber(
        nested(
          provider,
          [
            'metrics.latencyDeltaPercent',
            'latencyDeltaPercent',
            'latency.deltaPercent',
          ],
        ),

        nested(
          providerIntel,
          [
            'metrics.latencyDeltaPercent',
            'latencyDeltaPercent',
          ],
        ),

        baselineLatencyMs !== null
          && averageLatencyMs !== null
          && baselineLatencyMs > 0
          ? (
              (
                averageLatencyMs
                - baselineLatencyMs
              )
              / baselineLatencyMs
            )
            * 100
          : null,
      );

    const ambiguityRatePercent =
      normalizePercent(
        firstNumber(
          nested(
            provider,
            [
              'metrics.ambiguityRate',
              'ambiguityRate',
              'metrics.ambiguousRate',
            ],
          ),

          nested(
            retry,
            [
              'metrics.ambiguityRate',
              'ambiguityRate',
              'metrics.ambiguousRate',
            ],
          ),

          percentage(
            ambiguousTransactions,
            totalTransactions,
          ),
        ),
      );

    const activeIncidentCount =
      firstNumber(
        nested(
          incidents,
          [
            'metrics.activeIncidentCount',
            'activeIncidentCount',
            'incidents.active',
          ],
        ),

        nested(
          cockpit,
          [
            'metrics.activeIncidentCount',
            'activeIncidentCount',
          ],
        ),

        nested(
          risk,
          [
            'metrics.activeIncidentCount',
            'activeIncidentCount',
          ],
        ),
      );

    const predictedIncidentRiskScore =
      normalizePercent(
        firstNumber(
          nested(
            incidents,
            [
              'risk.score',
              'riskScore',
              'metrics.predictedIncidentRiskScore',
            ],
          ),

          nested(
            risk,
            [
              'incidentRiskScore',
              'risk.score',
            ],
          ),
        ),
      );

    const criticalAlerts =
      firstNumber(
        nested(
          cockpit,
          [
            'metrics.criticalAlerts',
            'criticalAlerts',
          ],
        ),

        nested(
          dashboard,
          [
            'metrics.criticalAlerts',
            'criticalAlerts',
          ],
        ),
      );

    const complianceBacklog =
      firstNumber(
        nested(
          cockpit,
          [
            'metrics.complianceBacklog',
            'complianceBacklog',
          ],
        ),

        nested(
          dashboard,
          [
            'metrics.complianceBacklog',
            'complianceBacklog',
          ],
        ),
      );

    const reconciliationBacklog =
      firstNumber(
        nested(
          reconciliation,
          [
            'metrics.backlog',
            'backlog',
            'metrics.reconciliationBacklog',
            'reconciliationBacklog',
          ],
        ),

        nested(
          cockpit,
          [
            'metrics.reconciliationBacklog',
            'reconciliationBacklog',
          ],
        ),
      );

    const governanceBlockRatePercent =
      normalizePercent(
        firstNumber(
          nested(
            cockpit,
            [
              'metrics.governanceBlockRate',
              'governanceBlockRate',
            ],
          ),

          nested(
            dashboard,
            [
              'metrics.governanceBlockRate',
              'governanceBlockRate',
            ],
          ),
        ),
      );

    const observedAt =
      normalizeIsoDate(
        nested(
          provider,
          [
            'observedAt',
            'generatedAt',
            'timestamp',
          ],
        ),
        null,
      );

    return {
      totalTransactions,
      successfulTransactions,
      failedTransactions,
      ambiguousTransactions,

      availabilityPercent,
      successRatePercent,
      failureRatePercent,

      averageLatencyMs,
      p95LatencyMs,
      baselineLatencyMs,
      latencyDeltaPercent,
      ambiguityRatePercent,

      activeIncidentCount,
      predictedIncidentRiskScore,

      criticalAlerts,
      complianceBacklog,
      reconciliationBacklog,

      governanceBlockRatePercent,

      providerStatus:
        sourceStatus(
          provider,
        ),

      providerObservedAt:
        observedAt,

      sourceLatencyMs:
        Object.fromEntries(
          Object.entries(
            sources,
          ).map(
            ([
              name,
              source,
            ]) => [
              name,
              source.latencyMs
                ?? null,
            ],
          ),
        ),
    };
  }

  // ---------------------------------------------------------------------------
  // Objective evaluation
  // ---------------------------------------------------------------------------

  _buildObjectives() {
    const o =
      this.config.objectives;

    return {
      availabilityPercent: {
        metric:
          SLA_METRIC
            .AVAILABILITY,

        target:
          normalizePercent(
            o.availabilityPercent
              .target,
          ),

        nearBreachMargin:
          normalizePositive(
            o.availabilityPercent
              .nearBreachMargin,
            0.1,
          ),

        hardFloor:
          normalizePercent(
            o.availabilityPercent
              .hardFloor,
          ),

        direction:
          'HIGHER_BETTER',

        unit:
          'percent',
      },

      successRatePercent: {
        metric:
          SLA_METRIC
            .SUCCESS_RATE,

        target:
          normalizePercent(
            o.successRatePercent
              .target,
          ),

        nearBreachMargin:
          normalizePositive(
            o.successRatePercent
              .nearBreachMargin,
            1,
          ),

        hardFloor:
          normalizePercent(
            o.successRatePercent
              .hardFloor,
          ),

        direction:
          'HIGHER_BETTER',

        unit:
          'percent',
      },

      failureRatePercent: {
        metric:
          SLA_METRIC
            .FAILURE_RATE,

        target:
          normalizePercent(
            o.failureRatePercent
              .target,
          ),

        nearBreachMargin:
          normalizePositive(
            o.failureRatePercent
              .nearBreachMargin,
            0.5,
          ),

        hardCeiling:
          normalizePercent(
            o.failureRatePercent
              .hardCeiling,
          ),

        direction:
          'LOWER_BETTER',

        unit:
          'percent',
      },

      latencyMs: {
        metric:
          SLA_METRIC
            .LATENCY,

        target:
          normalizePositive(
            o.latencyMs.target,
            3_000,
          ),

        nearBreachMargin:
          normalizePositive(
            o.latencyMs
              .nearBreachMargin,
            500,
          ),

        hardCeiling:
          normalizePositive(
            o.latencyMs
              .hardCeiling,
            30_000,
          ),

        direction:
          'LOWER_BETTER',

        unit:
          'milliseconds',
      },

      p95LatencyMs: {
        metric:
          SLA_METRIC
            .P95_LATENCY,

        target:
          normalizePositive(
            o.p95LatencyMs
              .target,
            5_000,
          ),

        nearBreachMargin:
          normalizePositive(
            o.p95LatencyMs
              .nearBreachMargin,
            750,
          ),

        hardCeiling:
          normalizePositive(
            o.p95LatencyMs
              .hardCeiling,
            60_000,
          ),

        direction:
          'LOWER_BETTER',

        unit:
          'milliseconds',
      },

      ambiguityRatePercent: {
        metric:
          SLA_METRIC
            .AMBIGUITY_RATE,

        target:
          normalizePercent(
            o.ambiguityRatePercent
              .target,
          ),

        nearBreachMargin:
          normalizePositive(
            o.ambiguityRatePercent
              .nearBreachMargin,
            0.5,
          ),

        hardCeiling:
          normalizePercent(
            o.ambiguityRatePercent
              .hardCeiling,
          ),

        direction:
          'LOWER_BETTER',

        unit:
          'percent',
      },

      reconciliationBacklog: {
        metric:
          SLA_METRIC
            .RECONCILIATION_BACKLOG,

        target:
          normalizeNumber(
            o.reconciliationBacklog
              .target,
            25,
          ),

        nearBreachMargin:
          normalizePositive(
            o.reconciliationBacklog
              .nearBreachMargin,
            25,
          ),

        hardCeiling:
          normalizeNumber(
            o.reconciliationBacklog
              .hardCeiling,
            1_000,
          ),

        direction:
          'LOWER_BETTER',

        unit:
          'items',
      },
    };
  }

  _evaluateObjectives(
    metrics,
    objectives,
  ) {
    const evaluateHigher =
      (
        name,
        value,
        objective,
      ) => {
        const unavailable =
          value === null;

        if (unavailable) {
          return {
            metric:
              objective.metric,

            observed:
              null,

            target:
              objective.target,

            unit:
              objective.unit,

            direction:
              objective.direction,

            status:
              SLA_STATUS
                .INDETERMINATE,

            severity:
              SLA_SEVERITY
                .MEDIUM,

            breached:
              false,

            atRisk:
              false,

            marginToTarget:
              null,

            breachDepthPercent:
              null,

            errorBudgetUsedPercent:
              null,

            evidence:
              'MISSING_OBSERVATION',

            name,
          };
        }

        const difference =
          value
          - objective.target;

        const breached =
          value < objective.target;

        const atRisk =
          !breached
          && difference
            <= objective
              .nearBreachMargin;

        const severity =
          breached
            ? severityForBreachDepth(
                objective.target > 0
                  ? (
                      (
                        objective.target
                        - value
                      )
                      / objective.target
                    ) * 100
                  : 100,
              )
            : atRisk
              ? SLA_SEVERITY.MEDIUM
              : SLA_SEVERITY.INFO;

        const errorBudgetUsed =
          objective.target >= 100
            ? value >= objective.target
              ? 0
              : clamp(
                  (
                    (
                      objective.target
                      - value
                    )
                    / (
                      100
                      - objective.target
                    )
                  ) * 100,
                  0,
                  100,
                )
            : clamp(
                (
                  (
                    objective.target
                    - value
                  )
                  / Math.max(
                    objective.target,
                    0.000001,
                  )
                ) * 100,
                0,
                100,
              );

        return {
          metric:
            objective.metric,

          observed:
            value,

          target:
            objective.target,

          unit:
            objective.unit,

          direction:
            objective.direction,

          status:
            statusForMetric({
              breached,
              atRisk,
              unavailable:
                false,
            }),

          severity,

          breached,

          atRisk,

          marginToTarget:
            Number(
              Math.abs(
                difference,
              ).toFixed(4),
            ),

          breachDepthPercent:
            breached
              && objective.target > 0
              ? Number(
                  (
                    (
                      (
                        objective.target
                        - value
                      )
                      / objective.target
                    ) * 100
                  ).toFixed(4),
                )
              : 0,

          errorBudgetUsedPercent:
            Number(
              errorBudgetUsed
                .toFixed(4),
            ),

          evidence:
            'OBSERVED',

          name,
        };
      };

    const evaluateLower =
      (
        name,
        value,
        objective,
      ) => {
        const unavailable =
          value === null;

        if (unavailable) {
          return {
            metric:
              objective.metric,

            observed:
              null,

            target:
              objective.target,

            unit:
              objective.unit,

            direction:
              objective.direction,

            status:
              SLA_STATUS
                .INDETERMINATE,

            severity:
              SLA_SEVERITY
                .MEDIUM,

            breached:
              false,

            atRisk:
              false,

            marginToTarget:
              null,

            breachDepthPercent:
              null,

            errorBudgetUsedPercent:
              null,

            evidence:
              'MISSING_OBSERVATION',

            name,
          };
        }

        const difference =
          value
          - objective.target;

        const breached =
          value > objective.target;

        const atRisk =
          !breached
          && difference
            >= -objective
              .nearBreachMargin;

        const denominator =
          Math.max(
            objective.target,
            0.000001,
          );

        const breachDepth =
          breached
            ? (
                (
                  value
                  - objective.target
                )
                / denominator
              ) * 100
            : 0;

        return {
          metric:
            objective.metric,

          observed:
            value,

          target:
            objective.target,

          unit:
            objective.unit,

          direction:
            objective.direction,

          status:
            statusForMetric({
              breached,
              atRisk,
              unavailable:
                false,
            }),

          severity:
            breached
              ? severityForBreachDepth(
                  breachDepth,
                )
              : atRisk
                ? SLA_SEVERITY
                    .MEDIUM
                : SLA_SEVERITY
                    .INFO,

          breached,

          atRisk,

          marginToTarget:
            Number(
              Math.abs(
                difference,
              ).toFixed(4),
            ),

          breachDepthPercent:
            Number(
              Math.max(
                breachDepth,
                0,
              ).toFixed(4),
            ),

          errorBudgetUsedPercent:
            Number(
              clamp(
                (
                  Math.max(
                    value
                    - objective.target,
                    0,
                  )
                  / denominator
                ) * 100,
                0,
                100,
              ).toFixed(4),
            ),

          evidence:
            'OBSERVED',

          name,
        };
      };

    return {
      availabilityPercent:
        evaluateHigher(
          'availabilityPercent',
          metrics
            .availabilityPercent,
          objectives
            .availabilityPercent,
        ),

      successRatePercent:
        evaluateHigher(
          'successRatePercent',
          metrics
            .successRatePercent,
          objectives
            .successRatePercent,
        ),

      failureRatePercent:
        evaluateLower(
          'failureRatePercent',
          metrics
            .failureRatePercent,
          objectives
            .failureRatePercent,
        ),

      latencyMs:
        evaluateLower(
          'latencyMs',
          metrics
            .averageLatencyMs,
          objectives
            .latencyMs,
        ),

      p95LatencyMs:
        evaluateLower(
          'p95LatencyMs',
          metrics
            .p95LatencyMs,
          objectives
            .p95LatencyMs,
        ),

      ambiguityRatePercent:
        evaluateLower(
          'ambiguityRatePercent',
          metrics
            .ambiguityRatePercent,
          objectives
            .ambiguityRatePercent,
        ),

      reconciliationBacklog:
        evaluateLower(
          'reconciliationBacklog',
          metrics
            .reconciliationBacklog,
          objectives
            .reconciliationBacklog,
        ),
    };
  }

  _deriveOverallStatus(
    evaluations,
    sources,
  ) {
    const entries =
      Object.values(
        evaluations,
      );

    const available =
      entries.filter(
        (item) =>
          item.observed
          !== null,
      );

    if (
      !sources
        .providerTelemetry
        ?.available
    ) {
      return {
        status:
          SLA_STATUS.UNAVAILABLE,

        severity:
          SLA_SEVERITY.CRITICAL,

        operationalBand:
          'UNKNOWN',
      };
    }

    if (
      available.length === 0
    ) {
      return {
        status:
          SLA_STATUS.INDETERMINATE,

        severity:
          SLA_SEVERITY.MEDIUM,

        operationalBand:
          'UNKNOWN',
      };
    }

    const breaches =
      entries.filter(
        (item) =>
          item.breached,
      );

    const atRisk =
      entries.filter(
        (item) =>
          item.atRisk,
      );

    const degradedSources =
      Object.values(
        sources,
      ).filter(
        (source) =>
          source.available
          && [
            SLA_STATUS.DEGRADED,
            SLA_STATUS.BREACHED,
          ].includes(
            source.intelligenceStatus,
          ),
      );

    if (
      breaches.some(
        (item) =>
          item.severity
            === SLA_SEVERITY
              .CRITICAL,
      )
    ) {
      return {
        status:
          SLA_STATUS.BREACHED,

        severity:
          SLA_SEVERITY.CRITICAL,

        operationalBand:
          'CRITICAL',
      };
    }

    if (
      breaches.some(
        (item) =>
          severityWeight(
            item.severity,
          ) >= 4,
      )
    ) {
      return {
        status:
          SLA_STATUS.BREACHED,

        severity:
          SLA_SEVERITY.HIGH,

        operationalBand:
          'HIGH',
      };
    }

    if (
      breaches.length > 0
    ) {
      return {
        status:
          SLA_STATUS.BREACHED,

        severity:
          SLA_SEVERITY.MEDIUM,

        operationalBand:
          'ELEVATED',
      };
    }

    if (
      atRisk.length > 0
      || degradedSources.length > 0
    ) {
      return {
        status:
          SLA_STATUS.AT_RISK,

        severity:
          atRisk.some(
            (item) =>
              item.severity
                === SLA_SEVERITY
                  .MEDIUM,
          )
            ? SLA_SEVERITY.MEDIUM
            : SLA_SEVERITY.LOW,

        operationalBand:
          'WATCH',
      };
    }

    const partial =
      entries.some(
        (item) =>
          item.observed
          === null,
      );

    if (partial) {
      return {
        status:
          SLA_STATUS.DEGRADED,

        severity:
          SLA_SEVERITY.MEDIUM,

        operationalBand:
          'UNKNOWN',
      };
    }

    return {
      status:
        SLA_STATUS.COMPLIANT,

      severity:
        SLA_SEVERITY.INFO,

      operationalBand:
        'NORMAL',
    };
  }

  _calculateErrorBudget(
    metrics,
    objectives,
  ) {
    const failureObjective =
      objectives
        .failureRatePercent;

    const failureRate =
      metrics
        .failureRatePercent;

    let remainingPercent =
      null;

    let usedPercent =
      null;

    let status =
      SLA_STATUS.INDETERMINATE;

    if (
      failureRate !== null
    ) {
      const target =
        failureObjective
          .target;

      const allowedFailure =
        Math.max(
          target,
          0.000001,
        );

      usedPercent =
        Number(
          clamp(
            (
              failureRate
              / allowedFailure
            ) * 100,
            0,
            200,
          ).toFixed(4),
        );

      remainingPercent =
        Number(
          clamp(
            100
            - usedPercent,
            -100,
            100,
          ).toFixed(4),
        );

      status =
        remainingPercent
          <= this.config
            .objectives
            .errorBudgetPercent
            .exhaustedRemaining
          ? SLA_STATUS.BREACHED
          : remainingPercent
              <= this.config
                .objectives
                .errorBudgetPercent
                .nearExhaustionRemaining
            ? SLA_STATUS.AT_RISK
            : SLA_STATUS.COMPLIANT;
    }

    return {
      basisMetric:
        SLA_METRIC.FAILURE_RATE,

      targetFailureRatePercent:
        failureObjective
          .target,

      observedFailureRatePercent:
        failureRate,

      usedPercent,

      remainingPercent,

      status,

      exhausted:
        remainingPercent
          !== null
        && remainingPercent <= 0,

      source:
        failureRate !== null
          ? 'OBSERVED'
          : 'MISSING_OBSERVATION',
    };
  }

  _deriveTrend(
    metrics,
  ) {
    return {
      availability: {
        direction:
          SLA_TREND
            .INDETERMINATE,
      },

      successRate: {
        direction:
          SLA_TREND
            .INDETERMINATE,
      },

      failureRate: {
        direction:
          SLA_TREND
            .INDETERMINATE,
      },

      latency: {
        direction:
          trendFromValues(
            metrics
              .latencyDeltaPercent
              ?? NaN,

            0,

            {
              higherIsBetter:
                false,
            },
          ),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Signals / recommendations
  // ---------------------------------------------------------------------------

  _buildSignals(
    metrics,
    evaluations,
    sources,
    errorBudget,
  ) {
    const signals = [];

    const add = ({
      code,
      metric,
      severity,
      score,
      title,
      description,
      evidence = {},
    }) => {
      if (
        signals.length
        >= this.config
          .maxSignals
      ) {
        return;
      }

      signals.push({
        code,

        metric:
          metric || null,

        severity,

        score:
          Number(
            clamp(
              score,
              0,
              100,
            ).toFixed(4),
          ),

        title,

        description,

        evidence:
          redact(
            evidence,
          ),
      });
    };

    for (
      const item
      of Object.values(
        evaluations,
      )
    ) {
      if (
        !item.breached
        && !item.atRisk
      ) {
        continue;
      }

      const severity =
        item.severity;

      const score =
        item.breached
          ? Math.max(
              50,
              item
                .breachDepthPercent
                ?? 50,
            )
          : 25;

      add({
        code:
          `${item.metric}_SLO_${
            item.breached
              ? 'BREACH'
              : 'AT_RISK'
          }`,

        metric:
          item.metric,

        severity,

        score,

        title:
          `${item.metric} SLA objective is ${
            item.breached
              ? 'breached'
              : 'at risk'
          }.`,

        description:
          item.breached
            ? `Observed ${item.name} is outside the configured SLA objective.`
            : `Observed ${item.name} is approaching the configured SLA objective boundary.`,

        evidence: {
          observed:
            item.observed,

          target:
            item.target,

          unit:
            item.unit,

          marginToTarget:
            item.marginToTarget,

          breachDepthPercent:
            item.breachDepthPercent,
        },
      });
    }

    if (
      errorBudget.status
        === SLA_STATUS.BREACHED
    ) {
      add({
        code:
          'ERROR_BUDGET_EXHAUSTED',

        metric:
          SLA_METRIC.ERROR_RATE,

        severity:
          SLA_SEVERITY.CRITICAL,

        score:
          100,

        title:
          'Airtel payment error budget is exhausted.',

        description:
          'The observed failure rate has consumed or exceeded the configured SLA error budget.',

        evidence: {
          usedPercent:
            errorBudget
              .usedPercent,

          remainingPercent:
            errorBudget
              .remainingPercent,
        },
      });
    } else if (
      errorBudget.status
        === SLA_STATUS.AT_RISK
    ) {
      add({
        code:
          'ERROR_BUDGET_NEAR_EXHAUSTION',

        metric:
          SLA_METRIC.ERROR_RATE,

        severity:
          SLA_SEVERITY.HIGH,

        score:
          clamp(
            100
            - (
              errorBudget
                .remainingPercent
              ?? 0
            ),
            50,
            99,
          ),

        title:
          'Airtel payment error budget is nearing exhaustion.',

        description:
          'Observed payment failures are consuming a material portion of the available error budget.',

        evidence: {
          usedPercent:
            errorBudget
              .usedPercent,

          remainingPercent:
            errorBudget
              .remainingPercent,
        },
      });
    }

    if (
      metrics.activeIncidentCount
        !== null
      && metrics.activeIncidentCount
        > 0
    ) {
      add({
        code:
          'ACTIVE_INCIDENT_SLA_EXPOSURE',

        metric:
          null,

        severity:
          metrics.activeIncidentCount
            >= 5
            ? SLA_SEVERITY
                .CRITICAL
            : metrics
                .activeIncidentCount
                >= 3
              ? SLA_SEVERITY
                  .HIGH
              : SLA_SEVERITY
                  .MEDIUM,

        score:
          clamp(
            metrics
              .activeIncidentCount
            * 20,
            0,
            100,
          ),

        title:
          'Active incidents may increase SLA exposure.',

        description:
          'Incident intelligence reports active operational issues that may affect service-level attainment.',

        evidence: {
          activeIncidentCount:
            metrics
              .activeIncidentCount,

          predictedIncidentRiskScore:
            metrics
              .predictedIncidentRiskScore,
        },
      });
    }

    if (
      metrics.criticalAlerts
        !== null
      && metrics.criticalAlerts
        > 0
    ) {
      add({
        code:
          'CRITICAL_ALERT_SLA_EXPOSURE',

        metric:
          null,

        severity:
          metrics.criticalAlerts
            >= 5
            ? SLA_SEVERITY
                .CRITICAL
            : metrics.criticalAlerts
                >= 3
              ? SLA_SEVERITY
                  .HIGH
              : SLA_SEVERITY
                  .MEDIUM,

        score:
          clamp(
            metrics.criticalAlerts
              * 20,
            0,
            100,
          ),

        title:
          'Critical alerts indicate potential SLA exposure.',

        description:
          'Critical command-center alerts are present within the evaluated SLA window.',

        evidence: {
          criticalAlerts:
            metrics
              .criticalAlerts,
        },
      });
    }

    const unavailableSources =
      Object.values(
        sources,
      ).filter(
        (source) =>
          !source.available,
      ).length;

    if (
      unavailableSources > 0
    ) {
      add({
        code:
          'SLA_EVIDENCE_PARTIAL',

        metric:
          null,

        severity:
          unavailableSources
            >= 3
            ? SLA_SEVERITY.HIGH
            : SLA_SEVERITY.MEDIUM,

        score:
          clamp(
            unavailableSources
              * 25,
            0,
            100,
          ),

        title:
          'SLA evidence coverage is partial.',

        description:
          'One or more contributing intelligence sources are unavailable, reducing measurement confidence.',

        evidence: {
          unavailableSources,
        },
      });
    }

    if (
      signals.length
      === 0
    ) {
      add({
        code:
          'SLA_WITHIN_OBJECTIVES',

        metric:
          null,

        severity:
          SLA_SEVERITY.INFO,

        score:
          0,

        title:
          'Observed Airtel SLA indicators are within configured objectives.',

        description:
          'No material SLA breach or near-breach was identified from the available evidence.',

        evidence: {
          providerStatus:
            metrics
              .providerStatus,

          failureRatePercent:
            metrics
              .failureRatePercent,

          successRatePercent:
            metrics
              .successRatePercent,

          averageLatencyMs:
            metrics
              .averageLatencyMs,
        },
      });
    }

    signals.sort(
      (a, b) =>
        severityWeight(
          b.severity,
        )
        - severityWeight(
          a.severity,
        )
        || b.score - a.score,
    );

    return signals.slice(
      0,
      this.config.maxSignals,
    );
  }

  _buildRecommendations(
    signals,
    evaluations,
    errorBudget,
  ) {
    const recommendations = [];

    const add = ({
      code,
      intent,
      priority,
      title,
      description,
      evidence,
    }) => {
      if (
        recommendations.length
        >= this.config
          .maxRecommendations
      ) {
        return;
      }

      recommendations.push({
        code,
        intent,
        priority,
        title,
        description,
        executable:
          false,
        evidence:
          redact(
            evidence,
          ),
      });
    };

    for (
      const signal
      of signals
    ) {
      if (
        signal.code
          .includes(
            'FAILURE_RATE',
          )
      ) {
        add({
          code:
            'REVIEW_FAILURE_SLA_EXPOSURE',

          intent:
            'INVESTIGATE',

          priority:
            signal.severity,

          title:
            'Review Airtel payment failure concentration.',

          description:
            'Correlate failure classes, provider telemetry, retry outcomes and reconciliation evidence before any operational change.',

          evidence:
            signal.evidence,
        });
      } else if (
        signal.code
          .includes(
            'LATENCY',
          )
      ) {
        add({
          code:
            'REVIEW_LATENCY_SLA_EXPOSURE',

          intent:
            'INVESTIGATE',

          priority:
            signal.severity,

          title:
            'Investigate Airtel latency degradation.',

          description:
            'Correlate average and percentile latency with provider endpoints, traffic patterns and active incidents.',

          evidence:
            signal.evidence,
        });
      } else if (
        signal.code
          .includes(
            'AVAILABILITY',
          )
      ) {
        add({
          code:
            'ESCALATE_AVAILABILITY_SLA_EXPOSURE',

          intent:
            'ESCALATE',

          priority:
            signal.severity,

          title:
            'Escalate provider availability exposure through the established incident process.',

          description:
            'Use the incident-management and provider-escalation process; SLA intelligence does not execute failover or routing changes.',

          evidence:
            signal.evidence,
        });
      } else if (
        signal.code
          .includes(
            'AMBIGUITY',
          )
      ) {
        add({
          code:
            'REVIEW_AMBIGUOUS_OUTCOME_SLA_EXPOSURE',

          intent:
            'REVIEW',

          priority:
            signal.severity,

          title:
            'Review ambiguous payment outcomes affecting SLA measurement.',

          description:
            'Use provider status lookup and reconciliation evidence rather than treating uncertain outcomes as failures or successes without evidence.',

          evidence:
            signal.evidence,
        });
      } else if (
        signal.code
          .includes(
            'RECONCILIATION',
          )
      ) {
        add({
          code:
            'REVIEW_RECONCILIATION_SLA_EXPOSURE',

          intent:
            'REVIEW',

          priority:
            signal.severity,

          title:
            'Review reconciliation backlog affecting operational service levels.',

          description:
            'Investigate unresolved provider/internal outcome discrepancies while retaining the financial ledger as the accounting authority.',

          evidence:
            signal.evidence,
        });
      } else if (
        signal.code
          === 'ERROR_BUDGET_EXHAUSTED'
      ) {
        add({
          code:
            'ESCALATE_ERROR_BUDGET_EXHAUSTION',

          intent:
            'ESCALATE',

          priority:
            SLA_SEVERITY.CRITICAL,

          title:
            'Escalate exhausted Airtel SLA error budget.',

          description:
            'Use approved operational escalation and incident governance. This component does not change payment routing or authorization.',

          evidence:
            signal.evidence,
        });
      } else if (
        signal.code
          === 'ERROR_BUDGET_NEAR_EXHAUSTION'
      ) {
        add({
          code:
            'REVIEW_ERROR_BUDGET_CONSUMPTION',

          intent:
            'REVIEW',

          priority:
            SLA_SEVERITY.HIGH,

          title:
            'Review accelerating Airtel SLA error-budget consumption.',

          description:
            'Inspect error-rate trend and incident context before additional operational actions are considered.',

          evidence:
            signal.evidence,
        });
      } else if (
        signal.code
          .includes(
            'INCIDENT',
          )
      ) {
        add({
          code:
            'REVIEW_INCIDENT_SLA_EXPOSURE',

          intent:
            'REVIEW',

          priority:
            signal.severity,

          title:
            'Review incident impact on Airtel service-level objectives.',

          description:
            'Compare active incident timelines with observed SLA metrics and preserve evidence for post-incident reporting.',

          evidence:
            signal.evidence,
        });
      } else if (
        signal.code
          .includes(
            'EVIDENCE_PARTIAL',
          )
      ) {
        add({
          code:
            'RESTORE_SLA_EVIDENCE_COVERAGE',

          intent:
            'INVESTIGATE',

          priority:
            signal.severity,

          title:
            'Restore missing SLA evidence sources.',

          description:
            'Resolve source availability issues before treating an indeterminate SLA posture as confirmed compliance.',

          evidence:
            signal.evidence,
        });
      }
    }

    if (
      recommendations.length
      === 0
      && errorBudget.status
        === SLA_STATUS.COMPLIANT
      && Object.values(
        evaluations,
      ).every(
        (item) =>
          !item.breached
          && !item.atRisk,
      )
    ) {
      add({
        code:
          'CONTINUE_SLA_OBSERVATION',

        intent:
          'OBSERVE',

        priority:
          SLA_SEVERITY.INFO,

        title:
          'Continue routine Airtel SLA observation.',

        description:
          'Current evidence does not identify a material SLA breach or near-breach.',

        evidence: {
          errorBudgetRemainingPercent:
            errorBudget
              .remainingPercent,
        },
      });
    }

    return recommendations.slice(
      0,
      this.config
        .maxRecommendations,
    );
  }

  // ---------------------------------------------------------------------------
  // Evidence / limitations / summaries
  // ---------------------------------------------------------------------------

  _buildEvidence(
    sources,
    metrics,
    evaluations,
  ) {
    const evidence = [];

    for (
      const [name, source]
      of Object.entries(
        sources,
      )
    ) {
      if (
        !source.available
        || !source.data
      ) {
        continue;
      }

      evidence.push({
        source:
          name,

        method:
          source.method,

        status:
          source.status,

        intelligenceStatus:
          source.intelligenceStatus,

        latencyMs:
          source.latencyMs,

        fingerprint:
          sha256(
            source.data,
          ),

        observedAt:
          normalizeIsoDate(
            nested(
              source.data,
              [
                'observedAt',
                'generatedAt',
                'timestamp',
              ],
            ),
            null,
          ),
      });
    }

    evidence.push({
      source:
        'slaObjectives',

      status:
        'CONFIGURED',

      fingerprint:
        sha256(
          this._buildObjectives(),
        ),
    });

    for (
      const item
      of Object.values(
        evaluations,
      )
    ) {
      if (
        evidence.length
        >= this.config
          .maxEvidence
      ) {
        break;
      }

      evidence.push({
        source:
          `evaluation.${item.metric}`,

        status:
          item.status,

        metric:
          item.metric,

        observed:
          item.observed,

        target:
          item.target,

        unit:
          item.unit,

        fingerprint:
          sha256({
            metric:
              item.metric,

            observed:
              item.observed,

            target:
              item.target,

            status:
              item.status,
          }),
      });
    }

    if (
      evidence.length
        < this.config.maxEvidence
      && metrics
        .providerObservedAt
    ) {
      evidence.push({
        source:
          'providerTelemetry.observedAt',

        status:
          'AVAILABLE',

        observedAt:
          metrics
            .providerObservedAt,

        fingerprint:
          sha256(
            metrics
              .providerObservedAt,
          ),
      });
    }

    return evidence.slice(
      0,
      this.config.maxEvidence,
    );
  }

  _buildSourceSummary(
    sources,
  ) {
    return Object.values(
      sources,
    ).map(
      (source) => ({
        source:
          source.source,

        method:
          source.method
          || null,

        required:
          source.required,

        available:
          source.available,

        status:
          source.status,

        intelligenceStatus:
          source.intelligenceStatus,

        latencyMs:
          source.latencyMs,

        errorCode:
          source.errorCode
          || null,
      }),
    );
  }

  _sourceAvailability(
    sources,
  ) {
    const entries =
      Object.values(
        sources,
      );

    if (!entries.length) {
      return null;
    }

    const available =
      entries.filter(
        (source) =>
          source.available,
      ).length;

    return Number(
      (
        (
          available
          / entries.length
        )
        * 100
      ).toFixed(2),
    );
  }

  _deriveDataState(
    sources,
    availability,
  ) {
    const entries =
      Object.values(
        sources,
      );

    if (!entries.length) {
      return SLA_DATA_STATE
        .UNAVAILABLE;
    }

    const available =
      entries.filter(
        (source) =>
          source.available,
      ).length;

    if (available === 0) {
      return SLA_DATA_STATE
        .UNAVAILABLE;
    }

    if (
      availability !== null
      && availability < 100
    ) {
      return SLA_DATA_STATE.PARTIAL;
    }

    const truncated =
      entries.some(
        (source) => {
          const rows =
            firstArray(
              nested(
                source.data,
                [
                  'records',
                ],
              ),

              nested(
                source.data,
                [
                  'items',
                ],
              ),

              nested(
                source.data,
                [
                  'data.records',
                ],
              ),

              nested(
                source.data,
                [
                  'data.items',
                ],
              ),
            );

          return (
            Array.isArray(rows)
            && rows.length
              >= this.config
                .maxSourceRecords
          );
        },
      );

    return truncated
      ? SLA_DATA_STATE
          .TRUNCATED
      : SLA_DATA_STATE
          .AVAILABLE;
  }

  _buildLimitations({
    sources,
    dataState,
    sourceAvailabilityPercent,
  }) {
    const limitations = [];

    if (
      dataState
        !== SLA_DATA_STATE
          .AVAILABLE
    ) {
      limitations.push(
        'SLA evidence coverage is incomplete; unavailable sources reduce confidence.',
      );
    }

    if (
      sourceAvailabilityPercent
        !== null
      && sourceAvailabilityPercent
        < 100
    ) {
      limitations.push(
        `Only ${sourceAvailabilityPercent}% of configured SLA intelligence sources are currently available.`,
      );
    }

    if (
      !sources.providerIntelligence
        ?.available
    ) {
      limitations.push(
        'Provider intelligence evidence is unavailable or not configured.',
      );
    }

    if (
      !sources.incidentPredictor
        ?.available
    ) {
      limitations.push(
        'Incident intelligence evidence is unavailable or not configured.',
      );
    }

    limitations.push(
      'SLA objectives are operational configuration and must not be interpreted as independent legal or contractual determinations.',
    );

    limitations.push(
      'The SLA manager is advisory and does not authorize payment execution, settlement, retry, failover or ledger mutation.',
    );

    return limitations;
  }

  // ---------------------------------------------------------------------------
  // Persistence / idempotency
  // ---------------------------------------------------------------------------

  _requestFingerprint(
    context,
  ) {
    return sha256({
      component:
        COMPONENT,

      engineVersion:
        ENGINE_VERSION,

      provider:
        PROVIDER,

      tenantDigest:
        context.tenantDigest,

      scope:
        context.scope,

      startAt:
        context.startAt,

      endAt:
        context.endAt,

      windowMinutes:
        context.windowMinutes,

      mode:
        context.mode,

      includeEvidence:
        context.includeEvidence,

      dryRun:
        context.dryRun,
    });
  }

  _fingerprint(
    result,
  ) {
    return sha256({
      component:
        result.component,

      engineVersion:
        result.engineVersion,

      schemaVersion:
        result.schemaVersion,

      provider:
        result.provider,

      tenantDigest:
        result.tenantDigest,

      scope:
        result.scope,

      mode:
        result.mode,

      status:
        result.status,

      severity:
        result.severity,

      dataState:
        result.dataState,

      objectives:
        result.objectives,

      metrics:
        result.metrics,

      metricEvaluations:
        result.metricEvaluations,

      errorBudget:
        result.errorBudget,

      trend:
        result.trend,

      signals:
        result.signals,

      recommendations:
        result.recommendations,

      sources:
        result.sources,

      evidence:
        result.evidence,
    });
  }

  async _findReplay(
    context,
  ) {
    if (
      !context
        .idempotencyKeyDigest
      || !this.repository
      || typeof this.repository
        .getByIdempotency
        !== 'function'
    ) {
      return null;
    }

    const prior =
      await this.repository
        .getByIdempotency({
          tenantId:
            context.tenantId,

          idempotencyKeyDigest:
            context
              .idempotencyKeyDigest,
        });

    if (!prior) {
      return null;
    }

    const expected =
      this._requestFingerprint(
        context,
      );

    if (
      prior.requestFingerprint
      && prior.requestFingerprint
        !== expected
    ) {
      throw new SlaManagerError(
        ERROR_CODES
          .IDEMPOTENCY_CONFLICT,

        'The idempotency key was previously used with a different SLA request.',

        409,

        {
          idempotencyKeyDigest:
            context
              .idempotencyKeyDigest,
        },
      );
    }

    return prior;
  }

  async _persist(
    result,
    context,
  ) {
    if (
      !this.config
        .persistSnapshots
    ) {
      return;
    }

    if (
      !this.repository
      || typeof this.repository
        .saveSnapshot
        !== 'function'
    ) {
      if (
        this.config
          .requireRepository
      ) {
        throw new SlaManagerError(
          ERROR_CODES
            .REPOSITORY_REQUIRED,

          'SLA snapshot repository is unavailable.',

          503,
        );
      }

      return;
    }

    const snapshot = {
      ...result,

      snapshotId:
        typeof this
          .snapshotIdFactory
          === 'function'
          ? (
              normalizeString(
                this.snapshotIdFactory(),
                {
                  max: 160,
                },
              )
              || crypto.randomUUID()
            )
          : crypto.randomUUID(),

      requestFingerprint:
        this._requestFingerprint(
          context,
        ),

      idempotencyKeyDigest:
        context.idempotencyKeyDigest,

      persistedAt:
        nowIso(this.clock),
    };

    try {
      await this.repository.saveSnapshot(
        redact(snapshot),
      );

      this.statistics
        .snapshotsPersisted += 1;
    } catch (error) {
      const normalized =
        this._normalizeError(
          error,
        );

      this._log(
        'error',
        'Airtel SLA snapshot persistence failed.',
        {
          code:
            normalized.code,

          tenantDigest:
            context
              .tenantDigest,
        },
      );

      if (
        this.config
          .requireRepository
      ) {
        throw new SlaManagerError(
          ERROR_CODES
            .PERSISTENCE_FAILED,

          'SLA snapshot persistence failed.',

          503,

          undefined,

          error,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Health / observability
  // ---------------------------------------------------------------------------

  async _safeHealthCheck(
    adapter,
    name,
  ) {
    if (!adapter) {
      return {
        name,

        ok:
          false,

        status:
          'MISSING',
      };
    }

    const method =
      pickMethod(
        adapter,
        [
          'health',
          'readiness',
          'healthCheck',
          'getHealth',
        ],
      );

    if (!method) {
      return {
        name,

        ok:
          false,

        status:
          'UNSUPPORTED',
      };
    }

    try {
      const result =
        await this._withTimeout(
          Promise.resolve(
            adapter[method]({
              provider:
                PROVIDER,
            }),
          ),
          Math.min(
            this.config
              .defaultTimeoutMs,
            5_000,
          ),
          `${name}.${method}`,
        );

      const status =
        sourceStatus(
          result,
        );

      const unavailable =
        [
          'DOWN',
          'FAILED',
          'UNAVAILABLE',
          'ERROR',
          'NOT_READY',
        ].includes(
          status,
        );

      return {
        name,

        ok:
          !unavailable,

        status,

        details:
          redact(result),
      };
    } catch (error) {
      const normalized =
        this._normalizeError(
          error,
        );

      return {
        name,

        ok:
          false,

        status:
          normalized.code,
      };
    }
  }

  _normalizeError(
    error,
  ) {
    if (
      error
        instanceof SlaManagerError
    ) {
      return {
        code:
          error.code,

        status:
          error.status,

        public: {
          code:
            error.code,

          status:
            error.status,

          message:
            error.message,

          details:
            redact(
              error.details,
            ),
        },
      };
    }

    return {
      code:
        ERROR_CODES
          .SOURCE_PROTOCOL_ERROR,

      status:
        502,

      public: {
        code:
          ERROR_CODES
            .SOURCE_PROTOCOL_ERROR,

        status:
          502,

        message:
          'SLA source operation failed.',
      },
    };
  }

  _metric(
    name,
    value = 1,
    labels = {},
  ) {
    try {
      if (
        typeof this.metrics
          ?.increment
          === 'function'
      ) {
        this.metrics.increment(
          name,
          value,
          {
            provider:
              PROVIDER,

            ...labels,
          },
        );

        return;
      }

      if (
        typeof this.metrics?.inc
          === 'function'
      ) {
        this.metrics.inc(
          name,
          value,
          {
            provider:
              PROVIDER,

            ...labels,
          },
        );
      }
    } catch {
      // Observability must not alter SLA semantics.
    }
  }

  _log(
    level,
    message,
    context = {},
  ) {
    try {
      const method =
        this.logger?.[level]
        || this.logger?.info;

      if (
        typeof method
          !== 'function'
      ) {
        return;
      }

      method.call(
        this.logger,

        {
          component:
            COMPONENT,

          provider:
            PROVIDER,

          ...redact(
            context,
          ),
        },

        message,
      );
    } catch {
      // Logging must never break SLA evaluation.
    }
  }

  _freeze(
    value,
  ) {
    return deepFreeze(
      redact(value),
    );
  }
}

// =============================================================================
// Factories / compatibility aliases
// =============================================================================

export function createSlaManager(
  options = {},
) {
  return new AirtelSlaManager(
    options,
  );
}

export function createAirtelSlaManager(
  options = {},
) {
  return new AirtelSlaManager({
    ...options,

    config: {
      ...(options.config || {}),
      provider:
        PROVIDER,
    },
  });
}

export const SlaManager =
  AirtelSlaManager;

export const AirtelPaymentSlaManager =
  AirtelSlaManager;

export const SLA_MGR =
  AirtelSlaManager;

export const constants =
  Object.freeze({
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    PROVIDER,
    SCHEMA_VERSION,
    HASH_ALGORITHM,

    SLA_STATUS,
    SLA_DATA_STATE,
    SLA_SEVERITY,
    SLA_TREND,
    SLA_METRIC,
    SLA_MODE,

    ERROR_CODES,

    SOURCE_DEFINITIONS,

    DEFAULT_OBJECTIVES,
  });

export function buildSlaFingerprint(
  input = {},
) {
  return sha256({
    component:
      COMPONENT,

    provider:
      PROVIDER,

    tenantDigest:
      sha256(
        normalizeTenantId(
          input.tenantId,
        )
        || 'system',
      ),

    scope:
      normalizeString(
        input.scope,
        {
          max: 20,
        },
      ).toUpperCase()
      || 'TENANT',

    mode:
      normalizeString(
        input.mode,
        {
          max: 30,
        },
      ).toUpperCase()
      || SLA_MODE.ANALYZE,

    startAt:
      normalizeIsoDate(
        input.startAt,
        null,
      ),

    endAt:
      normalizeIsoDate(
        input.endAt,
        null,
      ),

    windowMinutes:
      normalizeNumber(
        input.windowMinutes,
        null,
      ),

    objectives:
      input.objectives
      || DEFAULT_OBJECTIVES,
  });
}

export default AirtelSlaManager;