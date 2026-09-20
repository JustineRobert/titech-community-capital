/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Provider Intelligence Engine
 * ============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/intelligence/command-center/providerIntelligence.js
 *
 * Architectural role
 * ------------------
 * Read-oriented provider intelligence boundary for the Airtel payment domain.
 * The engine composes provider telemetry, transaction outcome summaries,
 * latency/error observations, resilience signals, reconciliation evidence,
 * retry intelligence, regulatory/governance signals, and other injected
 * advisory sources into a bounded, tenant-scoped operational intelligence
 * model.
 *
 * Responsibilities
 * ----------------
 * - Enforce Airtel-only provider scope.
 * - Enforce tenant isolation and bounded query context.
 * - Normalize heterogeneous provider-health/intelligence payloads.
 * - Produce deterministic operational health, reliability and trend signals.
 * - Distinguish observed facts from advisory intelligence and missing data.
 * - Surface provider degradation, uncertainty and data-quality limitations.
 * - Provide bounded overview/summary/analysis APIs for command-center consumers.
 * - Preserve provenance and fingerprints without persisting sensitive values.
 * - Support injected persistence for snapshots/history when required.
 * - Integrate observability through safe logging, metrics and tracing hooks.
 *
 * Non-responsibilities
 * --------------------
 * - Does NOT initiate, authorize, post, settle, reverse, refund, capture,
 *   debit, credit, disburse or otherwise mutate financial state.
 * - Does NOT call Airtel's production API directly.
 * - Does NOT become the canonical transaction, balance, ledger or settlement
 *   source of truth.
 * - Does NOT replace reconciliation, AML/KYC/sanctions, fraud or policy engines.
 * - Does NOT make credit/adverse-action decisions.
 * - Does NOT train, deploy or promote ML models.
 * - Does NOT own incident lifecycle, workflow scheduling or notifications.
 *
 * Production principles
 * ---------------------
 * - Provider boundary is fail-closed: only AIRTEL is accepted.
 * - Tenant identity is mandatory by default and included in fingerprints.
 * - Sensitive data is redacted before persistence/logging.
 * - Identifiers are represented by SHA-256 digests when emitted for correlation.
 * - Source methods are allow-listed; arbitrary reflection is not permitted.
 * - Downstream calls are bounded by timeouts and record-level limits.
 * - Missing/partial source data is explicit and never silently promoted to fact.
 * - Advisory scores are operational indicators, never financial decisions.
 * - Offline/local queued payment states are not treated as settlement success.
 * - Deterministic fingerprints exclude volatile timestamps.
 * - Output objects are deeply frozen before returning to callers.
 * - Persistence is injected; default in-memory persistence is test/development
 *   support only and is not a production durability guarantee.
 *
 * Module format
 * -------------
 * Native Node.js ESM. Node 24+ compatible. No external runtime dependencies.
 * ============================================================================
 */

import crypto from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const COMPONENT = 'airtel-provider-intelligence';
export const ENGINE_NAME = COMPONENT;
export const ENGINE_VERSION = '2.0.0';
export const SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = 'sha256';

export const INTELLIGENCE_STATUS = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  CRITICAL: 'CRITICAL',
  INDETERMINATE: 'INDETERMINATE',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const DATA_STATE = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  PARTIAL: 'PARTIAL',
  EMPTY: 'EMPTY',
  UNAVAILABLE: 'UNAVAILABLE',
  TRUNCATED: 'TRUNCATED',
});

export const TREND = Object.freeze({
  IMPROVING: 'IMPROVING',
  STABLE: 'STABLE',
  WORSENING: 'WORSENING',
  INDETERMINATE: 'INDETERMINATE',
});

export const SEVERITY = Object.freeze({
  INFO: 'INFO',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const INTELLIGENCE_COMMAND = Object.freeze({
  OVERVIEW: 'OVERVIEW',
  SUMMARY: 'SUMMARY',
  ANALYZE: 'ANALYZE',
  HEALTH: 'HEALTH',
  READINESS: 'READINESS',
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'AIRTEL_PROVIDER_INTELLIGENCE_INVALID_INPUT',
  TENANT_REQUIRED: 'AIRTEL_PROVIDER_INTELLIGENCE_TENANT_REQUIRED',
  TENANT_INVALID: 'AIRTEL_PROVIDER_INTELLIGENCE_TENANT_INVALID',
  PROVIDER_SCOPE_VIOLATION: 'AIRTEL_PROVIDER_INTELLIGENCE_PROVIDER_SCOPE_VIOLATION',
  RANGE_INVALID: 'AIRTEL_PROVIDER_INTELLIGENCE_RANGE_INVALID',
  RANGE_TOO_LARGE: 'AIRTEL_PROVIDER_INTELLIGENCE_RANGE_TOO_LARGE',
  TIMEOUT: 'AIRTEL_PROVIDER_INTELLIGENCE_TIMEOUT',
  SOURCE_UNAVAILABLE: 'AIRTEL_PROVIDER_INTELLIGENCE_SOURCE_UNAVAILABLE',
  SOURCE_PROTOCOL_ERROR: 'AIRTEL_PROVIDER_INTELLIGENCE_SOURCE_PROTOCOL_ERROR',
  SOURCE_UNSAFE: 'AIRTEL_PROVIDER_INTELLIGENCE_SOURCE_UNSAFE',
  PAYLOAD_TOO_LARGE: 'AIRTEL_PROVIDER_INTELLIGENCE_PAYLOAD_TOO_LARGE',
  REPOSITORY_REQUIRED: 'AIRTEL_PROVIDER_INTELLIGENCE_REPOSITORY_REQUIRED',
  PERSISTENCE_FAILED: 'AIRTEL_PROVIDER_INTELLIGENCE_PERSISTENCE_FAILED',
  IDEMPOTENCY_CONFLICT: 'AIRTEL_PROVIDER_INTELLIGENCE_IDEMPOTENCY_CONFLICT',
  EXPORT_TOO_LARGE: 'AIRTEL_PROVIDER_INTELLIGENCE_EXPORT_TOO_LARGE',
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
  maxSignals: 30,
  maxEvidence: 100,
  maxRecommendations: 20,
  maxBreakdownItems: 100,

  maxPayloadBytes: 768 * 1024,
  maxExportBytes: 4 * 1024 * 1024,

  defaultHistoryLimit: 20,
  maxHistory: 100,

  persistSnapshots: true,
  requireRepository: false,

  failClosedOnRequiredSourceFailure: false,
  failClosedOnUnsafeSource: true,

  requiredSources: Object.freeze(['providerTelemetry']),
});

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

  governanceService: Object.freeze({
    required: false,
    methods: Object.freeze([
      'evaluate',
      'getDecision',
      'getOverview',
      'getSummary',
    ]),
  }),

  regulatoryIntelligence: Object.freeze({
    required: false,
    methods: Object.freeze([
      'evaluate',
      'getDecision',
      'getOverview',
      'getSummary',
    ]),
  }),

  retryIntelligence: Object.freeze({
    required: false,
    methods: Object.freeze([
      'analyze',
      'getOverview',
      'getSummary',
      'classify',
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

  modelDriftMonitor: Object.freeze({
    required: false,
    methods: Object.freeze([
      'getOverview',
      'getSummary',
      'summary',
      'listReports',
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

  governanceService: [
    'getOverview',
    'getSummary',
    'getDecision',
    'evaluate',
  ],

  regulatoryIntelligence: [
    'getOverview',
    'getSummary',
    'getDecision',
    'evaluate',
  ],

  retryIntelligence: [
    'getOverview',
    'getSummary',
    'analyze',
    'classify',
  ],

  reconciliationIntelligence: [
    'getOverview',
    'getSummary',
    'analyze',
  ],

  modelDriftMonitor: [
    'getOverview',
    'getSummary',
    'summary',
    'listReports',
  ],
});

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

const BAD_STATUSES = new Set([
  'DOWN',
  'FAILED',
  'UNAVAILABLE',
  'ERROR',
  'NOT_READY',
  'DEGRADED_CRITICAL',
]);

const SEVERITY_WEIGHT = Object.freeze({
  [SEVERITY.INFO]: 1,
  [SEVERITY.LOW]: 2,
  [SEVERITY.MEDIUM]: 3,
  [SEVERITY.HIGH]: 4,
  [SEVERITY.CRITICAL]: 5,
});

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

  const normalized = value.trim();

  return normalized
    ? normalized.slice(0, max)
    : fallback;
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

  const numeric = Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : fallback;
}

function normalizeNonNegativeNumber(
  value,
  fallback = 0,
) {
  const numeric = normalizeNumber(
    value,
    fallback,
  );

  return numeric !== null
    && numeric >= 0
    ? numeric
    : fallback;
}

function normalizePositiveNumber(
  value,
  fallback = null,
) {
  const numeric = normalizeNumber(
    value,
    fallback,
  );

  return numeric !== null
    && numeric > 0
    ? numeric
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
  const numeric = Number(value);

  if (!Number.isInteger(numeric)) {
    return fallback;
  }

  return Math.min(
    Math.max(numeric, min),
    max,
  );
}

function normalizeBoolean(
  value,
  fallback = false,
) {
  return typeof value === 'boolean'
    ? value
    : fallback;
}

function normalizeProvider(value) {
  return normalizeString(
    value,
    { max: 32 },
  ).toUpperCase();
}

function normalizeTenantId(value) {
  return normalizeString(
    value,
    { max: 160 },
  );
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
      (item) => stableNormalize(
        item,
        depth + 1,
      ),
    );
  }

  const output = {};

  for (const key of Object.keys(value).sort()) {
    output[key] = stableNormalize(
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

function digest(value) {
  return crypto
    .createHash(HASH_ALGORITHM)
    .update(
      typeof value === 'string'
        ? value
        : stableStringify(value),
      'utf8',
    )
    .digest('hex');
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

  for (const key of Reflect.ownKeys(value)) {
    try {
      deepFreeze(
        value[key],
        seen,
      );
    } catch {
      // Best effort. Returned data remains bounded.
    }
  }

  try {
    Object.freeze(value);
  } catch {
    // Best effort.
  }

  return value;
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
        (item) => redact(
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

    output[key] = redact(
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
  return now(clock).toISOString();
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

function safePercent(value) {
  const numeric =
    normalizeNumber(value);

  if (numeric === null) {
    return null;
  }

  return clamp(
    numeric,
    0,
    100,
  );
}

function percentage(
  numerator,
  denominator,
) {
  const n =
    normalizeNonNegativeNumber(
      numerator,
      0,
    );

  const d =
    normalizeNonNegativeNumber(
      denominator,
      0,
    );

  if (d <= 0) {
    return null;
  }

  return Number(
    ((n / d) * 100).toFixed(4),
  );
}

function firstNumber(...values) {
  for (const value of values) {
    const numeric =
      normalizeNumber(value);

    if (numeric !== null) {
      return numeric;
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
        current == null
        || !(part in Object(current))
      ) {
        found = false;
        break;
      }

      current = current[part];
    }

    if (
      found
      && current !== undefined
      && current !== null
    ) {
      return current;
    }
  }

  return null;
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

function classifyStatus(status) {
  const value =
    String(status || 'UNKNOWN')
      .toUpperCase();

  if (BAD_STATUSES.has(value)) {
    return INTELLIGENCE_STATUS.UNAVAILABLE;
  }

  if (value.includes('DEGRAD')) {
    return INTELLIGENCE_STATUS.DEGRADED;
  }

  if (value === 'CRITICAL') {
    return INTELLIGENCE_STATUS.CRITICAL;
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
    return INTELLIGENCE_STATUS.HEALTHY;
  }

  return INTELLIGENCE_STATUS.INDETERMINATE;
}

function severityForScore(score) {
  if (score >= 90) {
    return SEVERITY.CRITICAL;
  }

  if (score >= 75) {
    return SEVERITY.HIGH;
  }

  if (score >= 50) {
    return SEVERITY.MEDIUM;
  }

  if (score >= 25) {
    return SEVERITY.LOW;
  }

  return SEVERITY.INFO;
}

function operationalBand(score) {
  if (score >= 90) {
    return 'CRITICAL';
  }

  if (score >= 75) {
    return 'HIGH';
  }

  if (score >= 50) {
    return 'ELEVATED';
  }

  if (score >= 25) {
    return 'WATCH';
  }

  return 'NORMAL';
}

function scoreFromReliability({
  failureRate,
  latencyDeltaPercent,
  sourceAvailabilityPercent,
  activeIncidentCount,
  retryAmbiguityRate,
  reconciliationBacklog,
}) {
  let score = 0;
  let evidence = 0;

  if (failureRate !== null) {
    score += clamp(
      failureRate * 2.5,
      0,
      45,
    );

    evidence += 1;
  }

  if (
    latencyDeltaPercent !== null
  ) {
    score += clamp(
      latencyDeltaPercent * 0.35,
      0,
      20,
    );

    evidence += 1;
  }

  if (
    sourceAvailabilityPercent !== null
  ) {
    score += clamp(
      (100 - sourceAvailabilityPercent)
        * 0.5,
      0,
      10,
    );

    evidence += 1;
  }

  if (
    activeIncidentCount !== null
  ) {
    score += clamp(
      activeIncidentCount * 5,
      0,
      15,
    );

    evidence += 1;
  }

  if (
    retryAmbiguityRate !== null
  ) {
    score += clamp(
      retryAmbiguityRate * 0.2,
      0,
      5,
    );

    evidence += 1;
  }

  if (
    reconciliationBacklog !== null
  ) {
    score += clamp(
      reconciliationBacklog * 0.05,
      0,
      5,
    );

    evidence += 1;
  }

  return {
    score:
      evidence > 0
        ? Number(
            clamp(
              score,
              0,
              100,
            ).toFixed(4),
          )
        : null,

    evidenceCount: evidence,
  };
}

function deriveTrend(
  current,
  baseline,
  direction = 'higherIsWorse',
) {
  if (
    !Number.isFinite(current)
    || !Number.isFinite(baseline)
  ) {
    return TREND.INDETERMINATE;
  }

  const difference =
    current - baseline;

  const relative =
    baseline === 0
      ? Math.abs(difference)
      : Math.abs(
          difference / baseline,
        ) * 100;

  if (relative < 5) {
    return TREND.STABLE;
  }

  if (direction === 'higherIsWorse') {
    return difference < 0
      ? TREND.IMPROVING
      : TREND.WORSENING;
  }

  return difference > 0
    ? TREND.IMPROVING
    : TREND.WORSENING;
}

function normalizeTimestamp(
  value,
  fallback,
) {
  if (!value) {
    return fallback;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? fallback
    : date.toISOString();
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

export class ProviderIntelligenceError extends Error {
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
      'ProviderIntelligenceError';

    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class InMemoryProviderIntelligenceRepository {
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

  async saveSnapshot(snapshot) {
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
        `${this._tenantKey(tenantId)}:${idempotencyKeyDigest}`,
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

export class AirtelProviderIntelligence {
  constructor({
    providerTelemetry,
    operationsCockpit,
    incidentPredictor,
    executiveRiskCenter,
    dashboardAggregator,
    governanceService,
    regulatoryIntelligence,
    retryIntelligence,
    reconciliationIntelligence,
    modelDriftMonitor,
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

    this.incidentPredictor =
      incidentPredictor;

    this.executiveRiskCenter =
      executiveRiskCenter;

    this.dashboardAggregator =
      dashboardAggregator;

    this.governanceService =
      governanceService;

    this.regulatoryIntelligence =
      regulatoryIntelligence;

    this.retryIntelligence =
      retryIntelligence;

    this.reconciliationIntelligence =
      reconciliationIntelligence;

    this.modelDriftMonitor =
      modelDriftMonitor;

    this.repository =
      repository
      || new InMemoryProviderIntelligenceRepository();

    this.logger = logger;
    this.metrics = metrics;
    this.tracer = tracer;
    this.clock = clock;
    this.snapshotIdFactory =
      snapshotIdFactory;

    const mergedConfig = {
      ...DEFAULT_CONFIG,
      ...(isPlainObject(config)
        ? config
        : {}),
      provider: PROVIDER,
    };

    if (
      Array.isArray(
        config?.requiredSources,
      )
    ) {
      mergedConfig.requiredSources =
        Object.freeze(
          config.requiredSources.slice(),
        );
    }

    this.config =
      deepFreeze(
        mergedConfig,
      );

    this.statistics = {
      analyses: 0,
      successfulAnalyses: 0,
      failedAnalyses: 0,
      replayedAnalyses: 0,
      sourceFailures: 0,
      sourceTimeouts: 0,
      snapshotsPersisted: 0,
    };

    this._closed = false;
  }

  async getOverview(input = {}) {
    return this.analyze({
      ...input,
      mode:
        INTELLIGENCE_COMMAND.OVERVIEW,
    });
  }

  async getSummary(input = {}) {
    return this.analyze({
      ...input,
      mode:
        INTELLIGENCE_COMMAND.SUMMARY,
    });
  }

  async summary(input = {}) {
    return this.getSummary(
      input,
    );
  }

  async getIntelligence(
    input = {},
  ) {
    return this.analyze({
      ...input,
      mode:
        INTELLIGENCE_COMMAND.ANALYZE,
    });
  }

  async analyze(input = {}) {
    this.statistics.analyses += 1;

    if (this._closed) {
      throw new ProviderIntelligenceError(
        ERROR_CODES.SOURCE_UNAVAILABLE,
        'Airtel provider intelligence engine is closed.',
        503,
      );
    }

    const context =
      this._normalizeContext(
        input,
      );

    const analysisStarted =
      Date.now();

    try {
      const replay =
        await this._findReplay(
          context,
        );

      if (replay) {
        this.statistics.replayedAnalyses += 1;

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

      const sourceMetrics =
        this._extractMetrics(
          sources,
        );

      const reliability =
        this._buildReliability(
          sourceMetrics,
        );

      const signals =
        this._buildSignals(
          sourceMetrics,
          sources,
        );

      const recommendations =
        this._buildRecommendations(
          signals,
          sourceMetrics,
        );

      const evidence =
        context.includeEvidence
          ? this._buildEvidence(
              sources,
              sourceMetrics,
            )
          : [];

      const providerStatus =
        this._deriveStatus({
          sources,
          sourceMetrics,
          reliability,
        });

      const sourceAvailabilityPercent =
        this._sourceAvailability(
          sources,
        );

      const dataState =
        this._deriveDataState({
          sources,
          sourceAvailabilityPercent,
        });

      const result = {
        component: COMPONENT,
        engine: ENGINE_NAME,
        engineVersion:
          ENGINE_VERSION,
        schemaVersion:
          SCHEMA_VERSION,
        provider: PROVIDER,

        tenantId:
          context.tenantId,

        tenantDigest:
          context.tenantDigest,

        scope:
          context.scope,

        mode:
          context.mode,

        status:
          providerStatus.status,

        severity:
          providerStatus.severity,

        operationalBand:
          providerStatus.operationalBand,

        dataState,

        range: {
          startAt:
            context.startAt,

          endAt:
            context.endAt,

          windowMinutes:
            context.windowMinutes,
        },

        metrics:
          sourceMetrics,

        reliability: {
          score:
            reliability.score,

          confidence:
            reliability.confidence,

          trend:
            reliability.trend,

          evidenceCount:
            reliability.evidenceCount,
        },

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

        generatedAt:
          nowIso(this.clock),

        durationMs:
          Date.now()
          - analysisStarted,
      };

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

      this.statistics.successfulAnalyses += 1;

      this._metric(
        'airtel_provider_intelligence_analysis_total',
        1,
        {
          status:
            providerStatus.status,

          mode:
            context.mode,
        },
      );

      return this._freeze(
        result,
      );
    } catch (error) {
      this.statistics.failedAnalyses += 1;

      const normalized =
        this._normalizeError(
          error,
        );

      this._metric(
        'airtel_provider_intelligence_analysis_failed_total',
        1,
        {
          code:
            normalized.code,
        },
      );

      this._log(
        'warn',
        'Airtel provider intelligence analysis failed.',
        {
          code:
            normalized.code,

          tenantDigest:
            context.tenantDigest,

          command:
            context.mode,
        },
      );

      throw error;
    }
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

    const status =
      repository.ok
        && provider.ok
        ? INTELLIGENCE_STATUS.HEALTHY
        : provider.ok
          ? INTELLIGENCE_STATUS.DEGRADED
          : INTELLIGENCE_STATUS.UNAVAILABLE;

    return this._freeze({
      component: COMPONENT,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      provider: PROVIDER,

      status,

      tenantDigest:
        digest(
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
    const health =
      await this.health({
        tenantId,
      });

    return this._freeze({
      ...health,

      ready:
        health.status
          !== INTELLIGENCE_STATUS.UNAVAILABLE,
    });
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
    );

    if (!snapshotId) {
      throw new ProviderIntelligenceError(
        ERROR_CODES.INVALID_INPUT,
        'snapshotId is required.',
        400,
      );
    }

    if (
      !this.repository
      || typeof this.repository.getSnapshot
        !== 'function'
    ) {
      throw new ProviderIntelligenceError(
        ERROR_CODES.REPOSITORY_REQUIRED,
        'Snapshot repository is unavailable.',
        503,
      );
    }

    const snapshot =
      await this.repository.getSnapshot({
        tenantId:
          normalizedTenantId,

        snapshotId:
          normalizeString(
            snapshotId,
            { max: 160 },
          ),
      });

    return snapshot
      ? this._freeze(snapshot)
      : null;
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
    );

    const boundedLimit =
      normalizeInteger(
        limit,
        this.config.defaultHistoryLimit,
        {
          min: 1,
          max:
            this.config.maxHistory,
        },
      );

    if (
      !this.repository
      || typeof this.repository.listSnapshots
        !== 'function'
    ) {
      throw new ProviderIntelligenceError(
        ERROR_CODES.REPOSITORY_REQUIRED,
        'Snapshot repository is unavailable.',
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
      component: COMPONENT,
      provider: PROVIDER,

      tenantId:
        normalizedTenantId,

      tenantDigest:
        digest(
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
      throw new ProviderIntelligenceError(
        ERROR_CODES.EXPORT_TOO_LARGE,
        'Provider intelligence export exceeds the configured size limit.',
        413,
      );
    }

    return this._freeze({
      contentType:
        'application/json',

      filename:
        'airtel-provider-intelligence.json',

      bytes,

      fingerprint:
        digest(result),

      payload,
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

  _normalizeContext(
    input,
  ) {
    if (!isPlainObject(input)) {
      throw new ProviderIntelligenceError(
        ERROR_CODES.INVALID_INPUT,
        'Provider intelligence input must be a plain object.',
        400,
      );
    }

    const provider =
      normalizeProvider(
        input.provider
          || PROVIDER,
      );

    if (provider !== PROVIDER) {
      throw new ProviderIntelligenceError(
        ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        'This intelligence engine is restricted to Airtel.',
        403,
        { provider },
      );
    }

    const tenantId =
      normalizeTenantId(
        input.tenantId,
      );

    const scope =
      normalizeString(
        input.scope,
        { max: 20 },
      ).toUpperCase()
      || 'TENANT';

    if (
      scope === 'SYSTEM'
      && !this.config.systemScopeAllowed
    ) {
      throw new ProviderIntelligenceError(
        ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        'System scope is disabled for Airtel provider intelligence.',
        403,
      );
    }

    this._assertTenant(
      tenantId,
      scope,
    );

    const endAt =
      this._parseDate(
        input.endAt,
      )
      || now(this.clock);

    const requestedWindow =
      normalizePositiveNumber(
        input.windowMinutes,
        this.config.defaultWindowMinutes,
      );

    const startFromInput =
      this._parseDate(
        input.startAt,
      );

    const startAt =
      startFromInput
      || new Date(
        endAt.getTime()
        - requestedWindow
          * 60_000,
      );

    if (
      startAt.getTime()
      >= endAt.getTime()
    ) {
      throw new ProviderIntelligenceError(
        ERROR_CODES.RANGE_INVALID,
        'startAt must be earlier than endAt.',
        400,
      );
    }

    const windowMinutes =
      (
        endAt.getTime()
        - startAt.getTime()
      )
      / 60_000;

    if (
      windowMinutes
      > this.config.maxWindowMinutes
    ) {
      throw new ProviderIntelligenceError(
        ERROR_CODES.RANGE_TOO_LARGE,
        'Requested intelligence window exceeds the configured limit.',
        400,
        {
          maxWindowMinutes:
            this.config.maxWindowMinutes,
        },
      );
    }

    const mode =
      normalizeString(
        input.mode,
        { max: 30 },
      ).toUpperCase()
      || INTELLIGENCE_COMMAND.ANALYZE;

    if (
      !Object.values(
        INTELLIGENCE_COMMAND,
      ).includes(mode)
    ) {
      throw new ProviderIntelligenceError(
        ERROR_CODES.INVALID_INPUT,
        'Unsupported provider intelligence mode.',
        400,
      );
    }

    const contextInput =
      redact(input);

    if (
      safeBytes(contextInput)
      > this.config.maxPayloadBytes
    ) {
      throw new ProviderIntelligenceError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        'Provider intelligence request exceeds the configured payload limit.',
        413,
      );
    }

    const timeoutMs =
      normalizeInteger(
        input.timeoutMs,
        this.config.defaultTimeoutMs,
        {
          min: 100,
          max:
            this.config.maxTimeoutMs,
        },
      );

    const maxSourceRecords =
      normalizeInteger(
        input.maxSourceRecords,
        this.config.maxSourceRecords,
        {
          min: 1,
          max:
            this.config.maxSourceRecords,
        },
      );

    return {
      provider: PROVIDER,

      tenantId,

      tenantDigest:
        digest(
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
          windowMinutes.toFixed(4),
        ),

      timeoutMs,

      maxSourceRecords,

      mode,

      persist:
        input.persist !== false
        && this.config.persistSnapshots,

      idempotencyKey:
        normalizeString(
          input.idempotencyKey,
          { max: 200 },
        ),

      idempotencyKeyDigest:
        input.idempotencyKey
          ? digest(
              normalizeString(
                input.idempotencyKey,
                { max: 200 },
              ),
            )
          : null,

      correlationId:
        normalizeString(
          input.correlationId,
          { max: 160 },
        )
        || crypto.randomUUID(),

      includeEvidence:
        input.includeEvidence
        !== false,

      dryRun:
        normalizeBoolean(
          input.dryRun,
          false,
        ),
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
      throw new ProviderIntelligenceError(
        ERROR_CODES.TENANT_REQUIRED,
        'tenantId is required for tenant-scoped Airtel provider intelligence.',
        400,
      );
    }

    if (
      tenantId
      && tenantId.length < 2
    ) {
      throw new ProviderIntelligenceError(
        ERROR_CODES.TENANT_INVALID,
        'tenantId is invalid.',
        400,
      );
    }
  }

  _parseDate(value) {
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

  async _findReplay(context) {
    if (
      !context.idempotencyKeyDigest
      || !this.repository
    ) {
      return null;
    }

    if (
      typeof this.repository.getByIdempotency
        !== 'function'
    ) {
      return null;
    }

    const prior =
      await this.repository.getByIdempotency({
        tenantId:
          context.tenantId,

        idempotencyKeyDigest:
          context.idempotencyKeyDigest,
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
      throw new ProviderIntelligenceError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        'The idempotency key was previously used with a different request.',
        409,
        {
          idempotencyKeyDigest:
            context.idempotencyKeyDigest,
        },
      );
    }

    return prior;
  }

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
            adapter: this[name],
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
          ? this.config.requiredSources
          : [],
      );

    const sourceResults = {};

    let cursor = 0;

    const workerCount =
      Math.min(
        this.config.maxConcurrency,
        entries.length || 1,
      );

    const workers =
      Array.from(
        {
          length: workerCount,
        },
        async () => {
          while (true) {
            const current =
              entries[cursor++];

            if (!current) {
              return;
            }

            const {
              name,
              definition,
              adapter,
            } = current;

            const method =
              pickMethod(
                adapter,
                SOURCE_METHOD_PREFERENCE[
                  name
                ]
                  || definition.methods,
              );

            if (!method) {
              sourceResults[name] = {
                source: name,

                status:
                  'UNSUPPORTED',

                intelligenceStatus:
                  INTELLIGENCE_STATUS.INDETERMINATE,

                available: false,

                required:
                  requiredNames.has(name)
                  || definition.required,

                provider: PROVIDER,

                latencyMs: 0,

                data: null,

                errorCode:
                  ERROR_CODES.SOURCE_UNAVAILABLE,
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
                !isPlainObject(result)
                && !Array.isArray(result)
              ) {
                throw new ProviderIntelligenceError(
                  ERROR_CODES.SOURCE_PROTOCOL_ERROR,
                  'Provider intelligence source returned an unsupported payload.',
                  502,
                  {
                    source: name,
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
                && returnedProvider
                  !== PROVIDER
              ) {
                throw new ProviderIntelligenceError(
                  ERROR_CODES.SOURCE_UNSAFE,
                  'Provider intelligence source returned a different provider.',
                  502,
                  {
                    source: name,
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
                throw new ProviderIntelligenceError(
                  ERROR_CODES.SOURCE_UNSAFE,
                  'Provider intelligence source returned a different tenant.',
                  502,
                  {
                    source: name,
                  },
                );
              }

              const status =
                sourceStatus(
                  result,
                );

              sourceResults[name] = {
                source: name,

                status,

                intelligenceStatus:
                  classifyStatus(
                    status,
                  ),

                available: true,

                required:
                  requiredNames.has(name)
                  || definition.required,

                provider: PROVIDER,

                tenantDigest:
                  context.tenantDigest,

                method,

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

              this.statistics.sourceFailures += 1;

              if (
                normalized.code
                  === ERROR_CODES.TIMEOUT
              ) {
                this.statistics.sourceTimeouts += 1;
              }

              sourceResults[name] = {
                source: name,

                status:
                  'FAILED',

                intelligenceStatus:
                  INTELLIGENCE_STATUS.UNAVAILABLE,

                available: false,

                required:
                  requiredNames.has(name)
                  || definition.required,

                provider: PROVIDER,

                tenantDigest:
                  context.tenantDigest,

                method,

                latencyMs:
                  Date.now()
                  - startedAt,

                data: null,

                errorCode:
                  normalized.code,
              };

              if (
                (
                  requiredNames.has(name)
                  || definition.required
                )
                && this.config
                  .failClosedOnRequiredSourceFailure
              ) {
                throw error;
              }

              if (
                normalized.code
                  === ERROR_CODES.SOURCE_UNSAFE
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

    return sourceResults;
  }

  async _invokeSource({
    adapter,
    method,
    context,
  }) {
    const payload = {
      provider: PROVIDER,

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

      dryRun: true,
    };

    return this._withTimeout(
      this._withSpan(
        `provider-intelligence.${method}`,
        () => adapter[method](
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
    let timer;

    const timeoutPromise =
      new Promise(
        (_, reject) => {
          timer = setTimeout(
            () => {
              reject(
                new ProviderIntelligenceError(
                  ERROR_CODES.TIMEOUT,
                  'Provider intelligence source timed out.',
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
        timeoutPromise,
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
        (resolve, reject) => {
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

                resolve(result);
              } catch (error) {
                span?.recordException?.(
                  error,
                );

                span?.end?.();

                reject(error);
              }
            },
          );
        },
      );
    }

    if (
      typeof this.tracer.startSpan
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

    const dashboard =
      sources.dashboardAggregator
        ?.data
      || {};

    const risk =
      sources.executiveRiskCenter
        ?.data
      || {};

    const incidents =
      sources.incidentPredictor
        ?.data
      || {};

    const governance =
      sources.governanceService
        ?.data
      || {};

    const retry =
      sources.retryIntelligence
        ?.data
      || {};

    const reconciliation =
      sources.reconciliationIntelligence
        ?.data
      || {};

    const model =
      sources.modelDriftMonitor
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
            'data.totalTransactions',
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
          cockpit,
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

    const failureRate =
      safePercent(
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
            cockpit,
            [
              'metrics.failureRate',
              'failureRate',
            ],
          ),

          nested(
            dashboard,
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

    const successRate =
      safePercent(
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
            cockpit,
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
          cockpit,
          [
            'metrics.averageLatencyMs',
            'averageLatencyMs',
          ],
        ),

        nested(
          dashboard,
          [
            'metrics.averageLatencyMs',
            'averageLatencyMs',
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
          cockpit,
          [
            'metrics.baselineLatencyMs',
            'baselineLatencyMs',
          ],
        ),
      );

    const latencyDeltaPercent =
      safePercent(
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
            cockpit,
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
      safePercent(
        firstNumber(
          nested(
            incidents,
            [
              'risk.score',
              'riskScore',
              'metrics.predictedIncidentRiskScore',
              'predictedIncidentRiskScore',
            ],
          ),

          nested(
            risk,
            [
              'incidentRiskScore',
              'risk.score',
            ],
          ),

          nested(
            cockpit,
            [
              'metrics.predictedIncidentRiskScore',
              'predictedIncidentRiskScore',
            ],
          ),
        ),
      );

    const activeAlerts =
      firstNumber(
        nested(
          cockpit,
          [
            'metrics.activeAlerts',
            'activeAlerts',
          ],
        ),

        nested(
          dashboard,
          [
            'metrics.activeAlerts',
            'activeAlerts',
          ],
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
          governance,
          [
            'metrics.complianceBacklog',
            'complianceBacklog',
          ],
        ),
      );

    const governanceBlockRate =
      safePercent(
        firstNumber(
          nested(
            governance,
            [
              'metrics.governanceBlockRate',
              'governanceBlockRate',
              'blockRate',
            ],
          ),

          nested(
            cockpit,
            [
              'metrics.governanceBlockRate',
              'governanceBlockRate',
            ],
          ),
        ),
      );

    const modelRiskFindings =
      firstNumber(
        nested(
          model,
          [
            'metrics.riskFindings',
            'riskFindings',
            'metrics.modelRiskFindings',
            'modelRiskFindings',
          ],
        ),

        nested(
          cockpit,
          [
            'metrics.modelRiskFindings',
            'modelRiskFindings',
          ],
        ),
      );

    const retryAmbiguityRate =
      safePercent(
        firstNumber(
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
      );

    const providerAvailabilityPercent =
      safePercent(
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
            provider,
            [
              'availability',
            ],
          ),
        ),
      );

    const throughputPerMinute =
      firstNumber(
        nested(
          provider,
          [
            'metrics.throughputPerMinute',
            'throughputPerMinute',
          ],
        ),

        totalTransactions !== null
          ? totalTransactions / 60
          : null,
      );

    const currentStatus =
      sourceStatus(
        provider,
      );

    return {
      totalTransactions,
      successfulTransactions,
      failedTransactions,
      ambiguousTransactions,

      successRate,
      failureRate,

      averageLatencyMs,
      baselineLatencyMs,
      latencyDeltaPercent,

      throughputPerMinute,

      providerAvailabilityPercent,

      activeIncidentCount,
      predictedIncidentRiskScore,

      activeAlerts,
      criticalAlerts,

      complianceBacklog,
      governanceBlockRate,

      modelRiskFindings,

      retryAmbiguityRate,
      reconciliationBacklog,

      providerStatus:
        currentStatus,

      providerIntelligenceStatus:
        classifyStatus(
          currentStatus,
        ),

      observedAt:
        normalizeTimestamp(
          nested(
            provider,
            [
              'observedAt',
              'generatedAt',
              'timestamp',
              'data.observedAt',
            ],
          ),
          null,
        ),

      baseline: {
        latencyMs:
          baselineLatencyMs,

        failureRate:
          safePercent(
            firstNumber(
              nested(
                provider,
                [
                  'baseline.failureRate',
                  'metrics.baselineFailureRate',
                ],
              ),
            ),
          ),
      },
    };
  }

  _buildReliability(
    metrics,
  ) {
    const calculation =
      scoreFromReliability({
        failureRate:
          metrics.failureRate,

        latencyDeltaPercent:
          metrics.latencyDeltaPercent,

        sourceAvailabilityPercent:
          metrics.providerAvailabilityPercent,

        activeIncidentCount:
          metrics.activeIncidentCount,

        retryAmbiguityRate:
          metrics.retryAmbiguityRate,

        reconciliationBacklog:
          metrics.reconciliationBacklog,
      });

    const trendSignals = [];

    if (
      metrics.failureRate !== null
      && metrics.baseline
        .failureRate !== null
    ) {
      trendSignals.push(
        deriveTrend(
          metrics.failureRate,
          metrics.baseline
            .failureRate,
          'higherIsWorse',
        ),
      );
    }

    if (
      metrics.averageLatencyMs !== null
      && metrics.baselineLatencyMs !== null
    ) {
      trendSignals.push(
        deriveTrend(
          metrics.averageLatencyMs,
          metrics.baselineLatencyMs,
          'higherIsWorse',
        ),
      );
    }

    const worsening =
      trendSignals.filter(
        (item) =>
          item
          === TREND.WORSENING,
      ).length;

    const improving =
      trendSignals.filter(
        (item) =>
          item
          === TREND.IMPROVING,
      ).length;

    const trend =
      worsening > improving
        ? TREND.WORSENING
        : improving > worsening
          ? TREND.IMPROVING
          : trendSignals.length
            ? TREND.STABLE
            : TREND.INDETERMINATE;

    const confidence =
      clamp(
        calculation.evidenceCount
          * 18
          + (
            metrics.totalTransactions
              !== null
              ? 15
              : 0
          )
          + (
            metrics.providerAvailabilityPercent
              !== null
              ? 10
              : 0
          ),
        0,
        100,
      );

    return {
      score:
        calculation.score,

      evidenceCount:
        calculation.evidenceCount,

      confidence:
        Number(
          confidence.toFixed(2),
        ),

      trend,
    };
  }

  _buildSignals(
    metrics,
    sources,
  ) {
    const signals = [];

    const add = ({
      code,
      area,
      severity,
      score,
      title,
      description,
      evidence = {},
    }) => {
      if (
        signals.length
        >= this.config.maxSignals
      ) {
        return;
      }

      signals.push({
        code,
        area,
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
          redact(evidence),
      });
    };

    if (
      metrics.failureRate !== null
      && metrics.failureRate >= 20
    ) {
      add({
        code:
          'PAYMENT_FAILURE_SURGE',

        area:
          'PAYMENTS',

        severity:
          SEVERITY.CRITICAL,

        score:
          clamp(
            metrics.failureRate * 3,
            0,
            100,
          ),

        title:
          'Provider payment failure rate is critically elevated.',

        description:
          'Observed Airtel payment failures exceed the critical operational threshold.',

        evidence: {
          failureRate:
            metrics.failureRate,
        },
      });
    } else if (
      metrics.failureRate !== null
      && metrics.failureRate >= 10
    ) {
      add({
        code:
          'PAYMENT_FAILURE_ELEVATED',

        area:
          'PAYMENTS',

        severity:
          SEVERITY.HIGH,

        score:
          clamp(
            metrics.failureRate * 4,
            0,
            100,
          ),

        title:
          'Provider payment failures are elevated.',

        description:
          'Observed Airtel payment failures warrant operational review.',

        evidence: {
          failureRate:
            metrics.failureRate,
        },
      });
    } else if (
      metrics.failureRate !== null
      && metrics.failureRate >= 5
    ) {
      add({
        code:
          'PAYMENT_FAILURE_WATCH',

        area:
          'PAYMENTS',

        severity:
          SEVERITY.MEDIUM,

        score:
          clamp(
            metrics.failureRate * 5,
            0,
            100,
          ),

        title:
          'Provider payment failures are above the watch threshold.',

        description:
          'Observed failure rate is above the normal operating range.',

        evidence: {
          failureRate:
            metrics.failureRate,
        },
      });
    }

    if (
      metrics.latencyDeltaPercent !== null
      && metrics.latencyDeltaPercent >= 100
    ) {
      add({
        code:
          'LATENCY_SURGE_CRITICAL',

        area:
          'PERFORMANCE',

        severity:
          SEVERITY.CRITICAL,

        score:
          clamp(
            metrics.latencyDeltaPercent
              * 0.8,
            0,
            100,
          ),

        title:
          'Provider latency is critically above baseline.',

        description:
          'Observed Airtel latency has increased materially relative to baseline.',

        evidence: {
          averageLatencyMs:
            metrics.averageLatencyMs,

          baselineLatencyMs:
            metrics.baselineLatencyMs,

          deltaPercent:
            metrics.latencyDeltaPercent,
        },
      });
    } else if (
      metrics.latencyDeltaPercent !== null
      && metrics.latencyDeltaPercent >= 50
    ) {
      add({
        code:
          'LATENCY_SURGE_HIGH',

        area:
          'PERFORMANCE',

        severity:
          SEVERITY.HIGH,

        score:
          clamp(
            metrics.latencyDeltaPercent,
            0,
            100,
          ),

        title:
          'Provider latency is materially elevated.',

        description:
          'Observed Airtel latency is significantly above baseline.',

        evidence: {
          averageLatencyMs:
            metrics.averageLatencyMs,

          baselineLatencyMs:
            metrics.baselineLatencyMs,

          deltaPercent:
            metrics.latencyDeltaPercent,
        },
      });
    } else if (
      metrics.latencyDeltaPercent !== null
      && metrics.latencyDeltaPercent >= 20
    ) {
      add({
        code:
          'LATENCY_WATCH',

        area:
          'PERFORMANCE',

        severity:
          SEVERITY.MEDIUM,

        score:
          clamp(
            metrics.latencyDeltaPercent
              * 1.5,
            0,
            100,
          ),

        title:
          'Provider latency is above baseline.',

        description:
          'Observed Airtel latency warrants continued observation.',

        evidence: {
          averageLatencyMs:
            metrics.averageLatencyMs,

          baselineLatencyMs:
            metrics.baselineLatencyMs,

          deltaPercent:
            metrics.latencyDeltaPercent,
        },
      });
    }

    if (
      metrics.providerAvailabilityPercent !== null
      && metrics.providerAvailabilityPercent < 60
    ) {
      add({
        code:
          'PROVIDER_AVAILABILITY_CRITICAL',

        area:
          'PROVIDER',

        severity:
          SEVERITY.CRITICAL,

        score:
          clamp(
            (
              100
              - metrics.providerAvailabilityPercent
            )
            * 1.2,
            0,
            100,
          ),

        title:
          'Provider availability is critically low.',

        description:
          'Observed Airtel provider availability is below the critical threshold.',

        evidence: {
          availabilityPercent:
            metrics.providerAvailabilityPercent,
        },
      });
    } else if (
      metrics.providerAvailabilityPercent !== null
      && metrics.providerAvailabilityPercent < 80
    ) {
      add({
        code:
          'PROVIDER_AVAILABILITY_HIGH_RISK',

        area:
          'PROVIDER',

        severity:
          SEVERITY.HIGH,

        score:
          clamp(
            (
              100
              - metrics.providerAvailabilityPercent
            )
            * 1.1,
            0,
            100,
          ),

        title:
          'Provider availability is materially degraded.',

        description:
          'Observed Airtel provider availability is below the preferred operating range.',

        evidence: {
          availabilityPercent:
            metrics.providerAvailabilityPercent,
        },
      });
    } else if (
      metrics.providerAvailabilityPercent !== null
      && metrics.providerAvailabilityPercent < 95
    ) {
      add({
        code:
          'PROVIDER_AVAILABILITY_WATCH',

        area:
          'PROVIDER',

        severity:
          SEVERITY.MEDIUM,

        score:
          clamp(
            (
              100
              - metrics.providerAvailabilityPercent
            )
            * 1.5,
            0,
            100,
          ),

        title:
          'Provider availability is below target.',

        description:
          'Observed Airtel availability is below the preferred target.',

        evidence: {
          availabilityPercent:
            metrics.providerAvailabilityPercent,
        },
      });
    }

    if (
      metrics.activeIncidentCount !== null
      && metrics.activeIncidentCount >= 5
    ) {
      add({
        code:
          'INCIDENT_CLUSTER',

        area:
          'INCIDENTS',

        severity:
          SEVERITY.CRITICAL,

        score:
          clamp(
            metrics.activeIncidentCount
              * 15,
            0,
            100,
          ),

        title:
          'Multiple active provider incidents are present.',

        description:
          'Incident intelligence indicates a material concentration of active operational issues.',

        evidence: {
          activeIncidentCount:
            metrics.activeIncidentCount,
        },
      });
    } else if (
      metrics.activeIncidentCount !== null
      && metrics.activeIncidentCount >= 3
    ) {
      add({
        code:
          'INCIDENT_ELEVATION',

        area:
          'INCIDENTS',

        severity:
          SEVERITY.HIGH,

        score:
          clamp(
            metrics.activeIncidentCount
              * 18,
            0,
            100,
          ),

        title:
          'Active provider incidents are elevated.',

        description:
          'Incident intelligence indicates more active operational issues than normal.',

        evidence: {
          activeIncidentCount:
            metrics.activeIncidentCount,
        },
      });
    } else if (
      metrics.activeIncidentCount !== null
      && metrics.activeIncidentCount >= 1
    ) {
      add({
        code:
          'INCIDENT_WATCH',

        area:
          'INCIDENTS',

        severity:
          SEVERITY.MEDIUM,

        score:
          clamp(
            metrics.activeIncidentCount
              * 20,
            0,
            100,
          ),

        title:
          'An active provider incident is present.',

        description:
          'An active incident signal is present and should remain under observation.',

        evidence: {
          activeIncidentCount:
            metrics.activeIncidentCount,
        },
      });
    }

    if (
      metrics.predictedIncidentRiskScore !== null
      && metrics.predictedIncidentRiskScore >= 90
    ) {
      add({
        code:
          'PREDICTED_INCIDENT_CRITICAL',

        area:
          'INCIDENTS',

        severity:
          SEVERITY.CRITICAL,

        score:
          metrics.predictedIncidentRiskScore,

        title:
          'Incident intelligence indicates critical operational risk.',

        description:
          'A downstream prediction source reports a high operational incident-risk signal.',

        evidence: {
          predictedIncidentRiskScore:
            metrics.predictedIncidentRiskScore,
        },
      });
    } else if (
      metrics.predictedIncidentRiskScore !== null
      && metrics.predictedIncidentRiskScore >= 75
    ) {
      add({
        code:
          'PREDICTED_INCIDENT_HIGH',

        area:
          'INCIDENTS',

        severity:
          SEVERITY.HIGH,

        score:
          metrics.predictedIncidentRiskScore,

        title:
          'Incident intelligence indicates elevated operational risk.',

        description:
          'A downstream prediction source reports elevated operational incident risk.',

        evidence: {
          predictedIncidentRiskScore:
            metrics.predictedIncidentRiskScore,
        },
      });
    }

    if (
      metrics.criticalAlerts !== null
      && metrics.criticalAlerts >= 5
    ) {
      add({
        code:
          'CRITICAL_ALERT_CLUSTER',

        area:
          'ALERTING',

        severity:
          SEVERITY.CRITICAL,

        score:
          clamp(
            metrics.criticalAlerts
              * 15,
            0,
            100,
          ),

        title:
          'Critical operational alerts are clustered.',

        description:
          'The command-center alert stream contains a material number of critical alerts.',

        evidence: {
          criticalAlerts:
            metrics.criticalAlerts,

          activeAlerts:
            metrics.activeAlerts,
        },
      });
    } else if (
      metrics.criticalAlerts !== null
      && metrics.criticalAlerts >= 1
    ) {
      add({
        code:
          'CRITICAL_ALERT_PRESENT',

        area:
          'ALERTING',

        severity:
          SEVERITY.HIGH,

        score:
          clamp(
            metrics.criticalAlerts
              * 25,
            0,
            100,
          ),

        title:
          'Critical operational alerts are present.',

        description:
          'Critical alerts are present in the current operational intelligence window.',

        evidence: {
          criticalAlerts:
            metrics.criticalAlerts,

          activeAlerts:
            metrics.activeAlerts,
        },
      });
    }

    if (
      metrics.retryAmbiguityRate !== null
      && metrics.retryAmbiguityRate >= 10
    ) {
      add({
        code:
          'RETRY_AMBIGUITY_HIGH',

        area:
          'RESILIENCE',

        severity:
          SEVERITY.HIGH,

        score:
          clamp(
            metrics.retryAmbiguityRate
              * 3,
            0,
            100,
          ),

        title:
          'Ambiguous retry outcomes are elevated.',

        description:
          'Retry intelligence indicates an elevated rate of ambiguous payment outcomes.',

        evidence: {
          retryAmbiguityRate:
            metrics.retryAmbiguityRate,
        },
      });
    } else if (
      metrics.retryAmbiguityRate !== null
      && metrics.retryAmbiguityRate >= 5
    ) {
      add({
        code:
          'RETRY_AMBIGUITY_WATCH',

        area:
          'RESILIENCE',

        severity:
          SEVERITY.MEDIUM,

        score:
          clamp(
            metrics.retryAmbiguityRate
              * 4,
            0,
            100,
          ),

        title:
          'Ambiguous retry outcomes require observation.',

        description:
          'Retry intelligence indicates uncertainty around a meaningful subset of outcomes.',

        evidence: {
          retryAmbiguityRate:
            metrics.retryAmbiguityRate,
        },
      });
    }

    if (
      metrics.reconciliationBacklog !== null
      && metrics.reconciliationBacklog >= 100
    ) {
      add({
        code:
          'RECONCILIATION_BACKLOG_HIGH',

        area:
          'RECONCILIATION',

        severity:
          SEVERITY.HIGH,

        score:
          clamp(
            metrics.reconciliationBacklog
              * 0.8,
            0,
            100,
          ),

        title:
          'Reconciliation backlog is materially elevated.',

        description:
          'Reconciliation intelligence reports a substantial unresolved backlog.',

        evidence: {
          reconciliationBacklog:
            metrics.reconciliationBacklog,
        },
      });
    } else if (
      metrics.reconciliationBacklog !== null
      && metrics.reconciliationBacklog >= 25
    ) {
      add({
        code:
          'RECONCILIATION_BACKLOG_WATCH',

        area:
          'RECONCILIATION',

        severity:
          SEVERITY.MEDIUM,

        score:
          clamp(
            metrics.reconciliationBacklog
              * 1.5,
            0,
            100,
          ),

        title:
          'Reconciliation backlog is above watch level.',

        description:
          'Reconciliation intelligence reports unresolved work requiring monitoring.',

        evidence: {
          reconciliationBacklog:
            metrics.reconciliationBacklog,
        },
      });
    }

    if (
      metrics.governanceBlockRate !== null
      && metrics.governanceBlockRate >= 20
    ) {
      add({
        code:
          'GOVERNANCE_BLOCK_RATE_HIGH',

        area:
          'GOVERNANCE',

        severity:
          SEVERITY.HIGH,

        score:
          clamp(
            metrics.governanceBlockRate
              * 3,
            0,
            100,
          ),

        title:
          'Governance blocks are elevated.',

        description:
          'Governance intelligence reports an elevated proportion of blocked decisions.',

        evidence: {
          governanceBlockRate:
            metrics.governanceBlockRate,
        },
      });
    } else if (
      metrics.governanceBlockRate !== null
      && metrics.governanceBlockRate >= 10
    ) {
      add({
        code:
          'GOVERNANCE_BLOCK_RATE_WATCH',

        area:
          'GOVERNANCE',

        severity:
          SEVERITY.MEDIUM,

        score:
          clamp(
            metrics.governanceBlockRate
              * 3.5,
            0,
            100,
          ),

        title:
          'Governance block rate is above watch level.',

        description:
          'Governance intelligence reports increased policy/governance intervention.',

        evidence: {
          governanceBlockRate:
            metrics.governanceBlockRate,
        },
      });
    }

    if (
      metrics.modelRiskFindings !== null
      && metrics.modelRiskFindings >= 10
    ) {
      add({
        code:
          'MODEL_RISK_FINDINGS_HIGH',

        area:
          'MODEL_RISK',

        severity:
          SEVERITY.HIGH,

        score:
          clamp(
            metrics.modelRiskFindings
              * 5,
            0,
            100,
          ),

        title:
          'Model-risk findings are elevated.',

        description:
          'Model monitoring reports a significant number of provider-intelligence model-risk findings.',

        evidence: {
          modelRiskFindings:
            metrics.modelRiskFindings,
        },
      });
    } else if (
      metrics.modelRiskFindings !== null
      && metrics.modelRiskFindings >= 1
    ) {
      add({
        code:
          'MODEL_RISK_FINDINGS_PRESENT',

        area:
          'MODEL_RISK',

        severity:
          SEVERITY.MEDIUM,

        score:
          clamp(
            metrics.modelRiskFindings
              * 8,
            0,
            100,
          ),

        title:
          'Model-risk findings are present.',

        description:
          'Model monitoring reports findings that should remain under review.',

        evidence: {
          modelRiskFindings:
            metrics.modelRiskFindings,
        },
      });
    }

    const sourceFailures =
      Object.values(
        sources,
      ).filter(
        (item) =>
          item.available
          === false,
      ).length;

    if (
      sourceFailures >= 3
    ) {
      add({
        code:
          'INTELLIGENCE_SOURCE_FRAGMENTATION',

        area:
          'OBSERVABILITY',

        severity:
          SEVERITY.HIGH,

        score:
          clamp(
            sourceFailures
              * 20,
            0,
            100,
          ),

        title:
          'Provider intelligence has significant source fragmentation.',

        description:
          'Multiple intelligence sources are unavailable, reducing confidence in the aggregate view.',

        evidence: {
          sourceFailures,
        },
      });
    } else if (
      sourceFailures >= 1
    ) {
      add({
        code:
          'INTELLIGENCE_SOURCE_PARTIAL',

        area:
          'OBSERVABILITY',

        severity:
          SEVERITY.MEDIUM,

        score:
          clamp(
            sourceFailures
              * 25,
            0,
            100,
          ),

        title:
          'Provider intelligence is partially degraded.',

        description:
          'One or more advisory sources are unavailable, reducing evidence coverage.',

        evidence: {
          sourceFailures,
        },
      });
    }

    if (
      signals.length === 0
      && metrics.providerIntelligenceStatus
        === INTELLIGENCE_STATUS.HEALTHY
    ) {
      add({
        code:
          'PROVIDER_STABLE',

        area:
          'PROVIDER',

        severity:
          SEVERITY.INFO,

        score:
          0,

        title:
          'Provider operational signals are within observed normal bounds.',

        description:
          'No material degradation signal was identified from the available evidence.',

        evidence: {
          providerStatus:
            metrics.providerStatus,

          failureRate:
            metrics.failureRate,

          latencyDeltaPercent:
            metrics.latencyDeltaPercent,
        },
      });
    }

    signals.sort(
      (a, b) => {
        const severityDifference =
          SEVERITY_WEIGHT[
            b.severity
          ]
          - SEVERITY_WEIGHT[
            a.severity
          ];

        return (
          severityDifference
          || b.score - a.score
        );
      },
    );

    return signals.slice(
      0,
      this.config.maxSignals,
    );
  }

  _buildRecommendations(
    signals,
    metrics,
  ) {
    const recommendations = [];

    const add = (
      code,
      intent,
      priority,
      title,
      description,
      evidence = {},
    ) => {
      if (
        recommendations.length
        >= this.config.maxRecommendations
      ) {
        return;
      }

      recommendations.push({
        code,
        intent,
        priority,
        title,
        description,
        executable: false,
        evidence:
          redact(evidence),
      });
    };

    for (const signal of signals) {
      switch (signal.code) {
        case 'PAYMENT_FAILURE_SURGE':
        case 'PAYMENT_FAILURE_ELEVATED':
          add(
            'REVIEW_PROVIDER_FAILURES',
            'INVESTIGATE',
            signal.severity,
            'Investigate Airtel payment failure concentration.',
            'Review provider error classes, affected operations, retry outcomes and reconciliation evidence before changing operational policy.',
            signal.evidence,
          );
          break;

        case 'LATENCY_SURGE_CRITICAL':
        case 'LATENCY_SURGE_HIGH':
          add(
            'REVIEW_PROVIDER_LATENCY',
            'INVESTIGATE',
            signal.severity,
            'Investigate Airtel latency degradation.',
            'Correlate latency with endpoint, operation, time window and provider status telemetry.',
            signal.evidence,
          );
          break;

        case 'PROVIDER_AVAILABILITY_CRITICAL':
        case 'PROVIDER_AVAILABILITY_HIGH_RISK':
          add(
            'ESCALATE_PROVIDER_AVAILABILITY',
            'ESCALATE',
            signal.severity,
            'Escalate provider availability degradation through the established incident process.',
            'Use the incident-management workflow and provider operational contacts; this intelligence layer does not execute escalation itself.',
            signal.evidence,
          );
          break;

        case 'INCIDENT_CLUSTER':
        case 'INCIDENT_ELEVATION':
        case 'PREDICTED_INCIDENT_CRITICAL':
        case 'PREDICTED_INCIDENT_HIGH':
          add(
            'REVIEW_INCIDENT_CONTEXT',
            'REVIEW',
            signal.severity,
            'Review current Airtel incident intelligence.',
            'Compare observed telemetry with active incidents and downstream predictive signals; do not convert predictions directly into financial actions.',
            signal.evidence,
          );
          break;

        case 'CRITICAL_ALERT_CLUSTER':
        case 'CRITICAL_ALERT_PRESENT':
          add(
            'REVIEW_CRITICAL_ALERTS',
            'REVIEW',
            signal.severity,
            'Review critical Airtel operational alerts.',
            'Validate alert provenance, duplicate alerts, affected services and current incident ownership.',
            signal.evidence,
          );
          break;

        case 'RETRY_AMBIGUITY_HIGH':
        case 'RETRY_AMBIGUITY_WATCH':
          add(
            'REVIEW_AMBIGUOUS_OUTCOMES',
            'INVESTIGATE',
            signal.severity,
            'Review ambiguous payment outcomes before retries.',
            'Prefer provider status lookup or reconciliation evidence for ambiguous financial outcomes instead of blind repeated retries.',
            signal.evidence,
          );
          break;

        case 'RECONCILIATION_BACKLOG_HIGH':
        case 'RECONCILIATION_BACKLOG_WATCH':
          add(
            'REVIEW_RECONCILIATION_BACKLOG',
            'REVIEW',
            signal.severity,
            'Review unresolved reconciliation work.',
            'Prioritize investigation of unresolved provider outcomes while preserving the canonical financial ledger as the accounting source of truth.',
            signal.evidence,
          );
          break;

        case 'GOVERNANCE_BLOCK_RATE_HIGH':
        case 'GOVERNANCE_BLOCK_RATE_WATCH':
          add(
            'REVIEW_GOVERNANCE_INTERVENTION',
            'REVIEW',
            signal.severity,
            'Review elevated governance intervention.',
            'Inspect policy, evidence and approval context; this intelligence output does not override governance or maker-checker controls.',
            signal.evidence,
          );
          break;

        case 'MODEL_RISK_FINDINGS_HIGH':
        case 'MODEL_RISK_FINDINGS_PRESENT':
          add(
            'REVIEW_MODEL_RISK',
            'REVIEW',
            signal.severity,
            'Review provider-intelligence model-risk findings.',
            'Validate drift, data-quality, explainability and governance evidence before relying on model-derived operational signals.',
            signal.evidence,
          );
          break;

        case 'INTELLIGENCE_SOURCE_FRAGMENTATION':
        case 'INTELLIGENCE_SOURCE_PARTIAL':
          add(
            'RESTORE_INTELLIGENCE_COVERAGE',
            'INVESTIGATE',
            signal.severity,
            'Restore intelligence-source coverage.',
            'Investigate unavailable downstream sources and explicitly record reduced evidence confidence while coverage is incomplete.',
            signal.evidence,
          );
          break;

        default:
          break;
      }
    }

    if (
      recommendations.length === 0
      && metrics.providerIntelligenceStatus
        === INTELLIGENCE_STATUS.HEALTHY
    ) {
      add(
        'CONTINUE_OBSERVATION',
        'OBSERVE',
        SEVERITY.INFO,
        'Continue routine provider observation.',
        'Current evidence does not indicate a material provider-operational degradation signal.',
        {
          failureRate:
            metrics.failureRate,

          latencyDeltaPercent:
            metrics.latencyDeltaPercent,

          providerStatus:
            metrics.providerStatus,
        },
      );
    }

    return recommendations.slice(
      0,
      this.config.maxRecommendations,
    );
  }

  _buildEvidence(
    sources,
    metrics,
  ) {
    const evidence = [];

    for (
      const [name, source]
      of Object.entries(sources)
    ) {
      if (
        !source.available
        || !source.data
      ) {
        continue;
      }

      evidence.push({
        source: name,

        method:
          source.method,

        status:
          source.status,

        intelligenceStatus:
          source.intelligenceStatus,

        latencyMs:
          source.latencyMs,

        observedAt:
          normalizeTimestamp(
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

        fingerprint:
          digest(
            source.data,
          ),
      });
    }

    if (metrics.observedAt) {
      evidence.push({
        source:
          'providerTelemetry.observedAt',

        status:
          'AVAILABLE',

        observedAt:
          metrics.observedAt,

        fingerprint:
          digest(
            metrics.observedAt,
          ),
      });
    }

    return evidence.slice(
      0,
      this.config.maxEvidence,
    );
  }

  _deriveStatus({
    sources,
    sourceMetrics,
    reliability,
  }) {
    const providerSource =
      sources.providerTelemetry;

    if (
      !providerSource?.available
    ) {
      return {
        status:
          INTELLIGENCE_STATUS.UNAVAILABLE,

        severity:
          SEVERITY.CRITICAL,

        operationalBand:
          'UNKNOWN',
      };
    }

    const unavailableRequired =
      Object.values(
        sources,
      ).filter(
        (source) =>
          source.required
          && !source.available,
      ).length;

    if (
      unavailableRequired > 0
      && this.config
        .failClosedOnRequiredSourceFailure
    ) {
      return {
        status:
          INTELLIGENCE_STATUS.UNAVAILABLE,

        severity:
          SEVERITY.CRITICAL,

        operationalBand:
          'UNKNOWN',
      };
    }

    if (
      sourceMetrics
        .providerIntelligenceStatus
        === INTELLIGENCE_STATUS.CRITICAL
      || (
        reliability.score !== null
        && reliability.score >= 90
      )
    ) {
      return {
        status:
          INTELLIGENCE_STATUS.CRITICAL,

        severity:
          SEVERITY.CRITICAL,

        operationalBand:
          'CRITICAL',
      };
    }

    if (
      sourceMetrics
        .providerIntelligenceStatus
        === INTELLIGENCE_STATUS.DEGRADED
      || (
        reliability.score !== null
        && reliability.score >= 50
      )
    ) {
      const score =
        reliability.score
        || 50;

      return {
        status:
          INTELLIGENCE_STATUS.DEGRADED,

        severity:
          severityForScore(
            score,
          ),

        operationalBand:
          operationalBand(
            score,
          ),
      };
    }

    if (
      reliability.score === null
      && Object.values(
        sources,
      ).every(
        (source) =>
          !source.available,
      )
    ) {
      return {
        status:
          INTELLIGENCE_STATUS.INDETERMINATE,

        severity:
          SEVERITY.MEDIUM,

        operationalBand:
          'UNKNOWN',
      };
    }

    return {
      status:
        INTELLIGENCE_STATUS.HEALTHY,

      severity:
        SEVERITY.INFO,

      operationalBand:
        operationalBand(
          reliability.score
          || 0,
        ),
    };
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

  _deriveDataState({
    sources,
    sourceAvailabilityPercent,
  }) {
    const entries =
      Object.values(
        sources,
      );

    const available =
      entries.filter(
        (source) =>
          source.available,
      ).length;

    if (
      !entries.length
      || available === 0
    ) {
      return DATA_STATE.UNAVAILABLE;
    }

    if (
      available < entries.length
    ) {
      return DATA_STATE.PARTIAL;
    }

    if (
      sourceAvailabilityPercent
        !== null
      && sourceAvailabilityPercent
        < 100
    ) {
      return DATA_STATE.PARTIAL;
    }

    const truncated =
      entries.some(
        (source) => {
          const rows =
            firstArray(
              nested(
                source.data,
                ['records'],
              ),

              nested(
                source.data,
                ['data.records'],
              ),

              nested(
                source.data,
                ['items'],
              ),

              nested(
                source.data,
                ['data.items'],
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
      ? DATA_STATE.TRUNCATED
      : DATA_STATE.AVAILABLE;
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
          source.method || null,

        status:
          source.status,

        intelligenceStatus:
          source.intelligenceStatus,

        available:
          source.available,

        required:
          source.required,

        latencyMs:
          source.latencyMs,

        errorCode:
          source.errorCode
          || null,
      }),
    );
  }

  _buildLimitations({
    sources,
    dataState,
    sourceAvailabilityPercent,
  }) {
    const limitations = [];

    if (
      dataState
        !== DATA_STATE.AVAILABLE
    ) {
      limitations.push(
        'Intelligence coverage is incomplete; unavailable sources reduce evidence confidence.',
      );
    }

    if (
      sourceAvailabilityPercent
        !== null
      && sourceAvailabilityPercent
        < 100
    ) {
      limitations.push(
        `Source availability is ${sourceAvailabilityPercent}%.`,
      );
    }

    if (
      !sources.incidentPredictor
        ?.available
    ) {
      limitations.push(
        'Incident prediction evidence is unavailable or not configured.',
      );
    }

    if (
      !sources.retryIntelligence
        ?.available
    ) {
      limitations.push(
        'Retry intelligence evidence is unavailable or not configured.',
      );
    }

    if (
      !sources.reconciliationIntelligence
        ?.available
    ) {
      limitations.push(
        'Reconciliation intelligence evidence is unavailable or not configured.',
      );
    }

    limitations.push(
      'Operational intelligence is advisory and does not authorize financial posting or settlement.',
    );

    return limitations;
  }

  _requestFingerprint(
    context,
  ) {
    return digest({
      component: COMPONENT,

      provider: PROVIDER,

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

      maxSourceRecords:
        context.maxSourceRecords,

      includeEvidence:
        context.includeEvidence,

      dryRun:
        context.dryRun,
    });
  }

  _fingerprint(
    result,
  ) {
    const fingerprintPayload = {
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

      dataState:
        result.dataState,

      metrics:
        result.metrics,

      reliability:
        result.reliability,

      signals:
        result.signals,

      recommendations:
        result.recommendations,

      evidence:
        result.evidence,

      sources:
        result.sources,
    };

    return digest(
      fingerprintPayload,
    );
  }

  async _persist(
    result,
    context,
  ) {
    if (
      !this.config.persistSnapshots
    ) {
      return;
    }

    if (
      !this.repository
      || typeof this.repository.saveSnapshot
        !== 'function'
    ) {
      if (
        this.config.requireRepository
      ) {
        throw new ProviderIntelligenceError(
          ERROR_CODES.REPOSITORY_REQUIRED,
          'Provider intelligence snapshot repository is unavailable.',
          503,
        );
      }

      return;
    }

    const snapshot = {
      ...result,

      snapshotId:
        typeof this.snapshotIdFactory
          === 'function'
          ? (
              normalizeString(
                this.snapshotIdFactory(),
                { max: 160 },
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

      this.statistics.snapshotsPersisted += 1;
    } catch (error) {
      const normalized =
        this._normalizeError(
          error,
        );

      this._log(
        'error',
        'Airtel provider intelligence snapshot persistence failed.',
        {
          code:
            normalized.code,

          tenantDigest:
            context.tenantDigest,
        },
      );

      if (
        this.config.requireRepository
      ) {
        throw new ProviderIntelligenceError(
          ERROR_CODES.PERSISTENCE_FAILED,
          'Provider intelligence snapshot persistence failed.',
          503,
          undefined,
          error,
        );
      }
    }
  }

  async _safeHealthCheck(
    adapter,
    name,
  ) {
    if (!adapter) {
      return {
        name,
        ok: false,
        status: 'MISSING',
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
        ok: false,
        status: 'UNSUPPORTED',
      };
    }

    try {
      const result =
        await this._withTimeout(
          Promise.resolve(
            adapter[method]({
              provider: PROVIDER,
            }),
          ),
          Math.min(
            this.config.defaultTimeoutMs,
            5_000,
          ),
          `${name}.${method}`,
        );

      const status =
        sourceStatus(
          result,
        );

      const classification =
        classifyStatus(
          status,
        );

      return {
        name,

        ok:
          classification
            !== INTELLIGENCE_STATUS.UNAVAILABLE,

        status,

        intelligenceStatus:
          classification,

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
        ok: false,
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
        instanceof ProviderIntelligenceError
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
        ERROR_CODES.SOURCE_PROTOCOL_ERROR,

      status:
        502,

      public: {
        code:
          ERROR_CODES.SOURCE_PROTOCOL_ERROR,

        status:
          502,

        message:
          'Provider intelligence source operation failed.',
      },
    };
  }

  _freeze(
    value,
  ) {
    return deepFreeze(
      redact(value),
    );
  }

  _metric(
    name,
    value = 1,
    tags = {},
  ) {
    try {
      if (
        typeof this.metrics?.increment
          === 'function'
      ) {
        this.metrics.increment(
          name,
          value,
          {
            provider: PROVIDER,
            ...tags,
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
            provider: PROVIDER,
            ...tags,
          },
        );
      }
    } catch {
      // Metrics must never change business semantics.
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
        typeof method === 'function'
      ) {
        method.call(
          this.logger,

          redact({
            component: COMPONENT,
            provider: PROVIDER,
            ...context,
          }),

          message,
        );
      }
    } catch {
      // Logging must never change intelligence semantics.
    }
  }
}

export function createProviderIntelligence(
  options = {},
) {
  return new AirtelProviderIntelligence(
    options,
  );
}

export function createAirtelProviderIntelligence(
  options = {},
) {
  return new AirtelProviderIntelligence({
    ...options,

    config: {
      ...(options.config || {}),
      provider: PROVIDER,
    },
  });
}

export const ProviderIntelligence =
  AirtelProviderIntelligence;

export const AirtelPaymentProviderIntelligence =
  AirtelProviderIntelligence;

export const constants = Object.freeze({
  PROVIDER,
  COMPONENT,
  ENGINE_NAME,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  HASH_ALGORITHM,

  INTELLIGENCE_STATUS,
  DATA_STATE,
  TREND,
  SEVERITY,
  INTELLIGENCE_COMMAND,

  ERROR_CODES,
  SOURCE_DEFINITIONS,
});

export function buildProviderIntelligenceFingerprint(
  input = {},
) {
  return digest({
    component: COMPONENT,

    provider: PROVIDER,

    tenantDigest:
      digest(
        normalizeTenantId(
          input.tenantId,
        ) || 'system',
      ),

    scope:
      normalizeString(
        input.scope,
        { max: 20 },
      ).toUpperCase()
      || 'TENANT',

    mode:
      normalizeString(
        input.mode,
        { max: 30 },
      ).toUpperCase()
      || INTELLIGENCE_COMMAND.ANALYZE,

    startAt:
      normalizeTimestamp(
        input.startAt,
        null,
      ),

    endAt:
      normalizeTimestamp(
        input.endAt,
        null,
      ),

    windowMinutes:
      normalizeNumber(
        input.windowMinutes,
      ),
  });
}

export default AirtelProviderIntelligence;