/**
 * TITech Community Capital
 * File: backend/modules/payment/airtel/intelligence/command-center/incidentPredictor.js
 *
 * Architectural role
 * ------------------
 * Enterprise early-warning and incident-prediction read model for Airtel payment
 * intelligence. Converts bounded operational evidence into deterministic,
 * explainable incident-risk signals for the command center.
 *
 * Important boundaries / non-responsibilities
 * --------------------------------------------
 * - NOT the payment, settlement, reconciliation, ledger, balance or financial-core service.
 * - NOT an Airtel provider adapter and never owns provider credentials.
 * - NOT a fraud, AML, KYC, sanctions, credit, underwriting or adverse-action engine.
 * - NOT a machine-learning training service and does not silently train or mutate a model.
 * - NOT an approval/maker-checker state machine and never grants approval or authorization.
 * - NOT an incident commander and does not open, close, resolve or escalate incidents itself.
 * - NOT a notification transport and never sends messages to external channels.
 * - NOT an audit ledger; diagnostic/audit integration is append-only and evidence-only.
 * - NOT a policy engine and never overrides governance or compliance controls.
 * - Prediction results are operational early-warning signals, not execution decisions.
 * - It never executes a provider request, payment, settlement, refund, reversal,
 *   ledger mutation, balance mutation or customer-record mutation.
 *
 * Production principles
 * ---------------------
 * - Airtel provider scope is fail-closed.
 * - Tenant scope is explicit and never crosses tenant boundaries.
 * - Input and source data are bounded, normalized and redacted before persistence/output.
 * - Predictions are deterministic for identical semantic inputs.
 * - Generated timestamps, run identifiers and persistence metadata do not affect fingerprints.
 * - Missing evidence is represented as UNKNOWN/INDETERMINATE, never as an invented zero.
 * - Source failures reduce confidence and remain visible.
 * - Thresholds are configuration, not hidden magic constants.
 * - Every prediction includes evidence, contributing factors, confidence and limitations.
 * - No prediction may imply execution authorization.
 * - No personal or sensitive identifier is emitted in raw form.
 * - Persistence is injected and tenant scoped; no database is hard-coded here.
 * - No internal scheduler is created.
 * - Returned objects are deeply frozen.
 *
 * Module format
 * -------------
 * - Native ECMAScript module (ESM).
 * - Node.js built-ins only.
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME =
  'airtel-command-center-incident-predictor';

export const ENGINE_VERSION =
  '1.0.0';

export const COMPONENT =
  ENGINE_NAME;

export const PROVIDER =
  'AIRTEL';

export const SCHEMA_VERSION =
  1;

export const HASH_ALGORITHM =
  'sha256';

export const INCIDENT_TYPES = Object.freeze({
  PROVIDER_DEGRADATION: 'PROVIDER_DEGRADATION',
  PAYMENT_FAILURE_SURGE: 'PAYMENT_FAILURE_SURGE',
  TRANSACTION_LATENCY_SURGE: 'TRANSACTION_LATENCY_SURGE',
  GOVERNANCE_DEGRADATION: 'GOVERNANCE_DEGRADATION',
  COMPLIANCE_BACKLOG: 'COMPLIANCE_BACKLOG',
  MODEL_RISK: 'MODEL_RISK',
  DATA_INTEGRITY: 'DATA_INTEGRITY',
  OPERATIONAL_ALERT_SURGE: 'OPERATIONAL_ALERT_SURGE',
  OBSERVABILITY_DEGRADATION: 'OBSERVABILITY_DEGRADATION',
  INCIDENT_CLUSTER: 'INCIDENT_CLUSTER',
});

export const PREDICTION_STATUS = Object.freeze({
  STABLE: 'STABLE',
  WATCH: 'WATCH',
  ELEVATED: 'ELEVATED',
  HIGH_RISK: 'HIGH_RISK',
  CRITICAL_RISK: 'CRITICAL_RISK',
  INDETERMINATE: 'INDETERMINATE',
});

export const CONFIDENCE_BANDS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  UNKNOWN: 'UNKNOWN',
});

export const TREND_DIRECTIONS = Object.freeze({
  IMPROVING: 'IMPROVING',
  STABLE: 'STABLE',
  WORSENING: 'WORSENING',
  UNKNOWN: 'UNKNOWN',
});

export const DATA_STATES = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  PARTIAL: 'PARTIAL',
  EMPTY: 'EMPTY',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const HEALTH_STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const SEVERITY = Object.freeze({
  INFO: 'INFO',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INCIDENT_PREDICTOR_INVALID_INPUT',
  TENANT_REQUIRED: 'INCIDENT_PREDICTOR_TENANT_REQUIRED',
  SYSTEM_SCOPE_FORBIDDEN: 'INCIDENT_PREDICTOR_SYSTEM_SCOPE_FORBIDDEN',
  PROVIDER_SCOPE_VIOLATION: 'INCIDENT_PREDICTOR_PROVIDER_SCOPE_VIOLATION',
  RANGE_INVALID: 'INCIDENT_PREDICTOR_RANGE_INVALID',
  RANGE_TOO_LARGE: 'INCIDENT_PREDICTOR_RANGE_TOO_LARGE',
  SOURCE_UNAVAILABLE: 'INCIDENT_PREDICTOR_SOURCE_UNAVAILABLE',
  SOURCE_PROTOCOL_ERROR: 'INCIDENT_PREDICTOR_SOURCE_PROTOCOL_ERROR',
  SOURCE_UNSAFE: 'INCIDENT_PREDICTOR_SOURCE_UNSAFE',
  TIMEOUT: 'INCIDENT_PREDICTOR_TIMEOUT',
  TOO_MANY_SIGNALS: 'INCIDENT_PREDICTOR_TOO_MANY_SIGNALS',
  PAYLOAD_TOO_LARGE: 'INCIDENT_PREDICTOR_PAYLOAD_TOO_LARGE',
  EXPORT_TOO_LARGE: 'INCIDENT_PREDICTOR_EXPORT_TOO_LARGE',
  REPOSITORY_REQUIRED: 'INCIDENT_PREDICTOR_REPOSITORY_REQUIRED',
  PERSISTENCE_FAILED: 'INCIDENT_PREDICTOR_PERSISTENCE_FAILED',
  IDEMPOTENCY_CONFLICT: 'INCIDENT_PREDICTOR_IDEMPOTENCY_CONFLICT',
});

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER,
  tenantRequired: true,
  allowSystemScope: true,
  maxTenantIdLength: 160,
  defaultWindowMinutes: 60,
  maxWindowMinutes: 10080,
  defaultBaselineWindows: 24,
  maxBaselineWindows: 168,
  defaultTimeoutMs: 5000,
  maxTimeoutMs: 30000,
  maxConcurrency: 8,
  maxSignals: 5000,
  maxFactors: 25,
  maxIncidents: 25,
  maxEvidenceItems: 100,
  maxPayloadBytes: 768 * 1024,
  maxExportBytes: 4 * 1024 * 1024,
  defaultHistoryLimit: 20,
  maxHistoryLimit: 100,
  persistPredictions: true,
  requireRepository: false,
  failClosedOnUnsafeSource: true,
  failClosedOnRequiredSourceFailure: false,
  minConfidencePercent: 35,
  thresholds: Object.freeze({
    providerFailureRateWatch: 5,
    providerFailureRateHigh: 10,
    providerFailureRateCritical: 20,
    transactionLatencyDeltaWatchPercent: 20,
    transactionLatencyDeltaHighPercent: 50,
    transactionLatencyDeltaCriticalPercent: 100,
    governanceBlockRateWatch: 5,
    governanceBlockRateHigh: 10,
    governanceBlockRateCritical: 20,
    complianceBacklogWatch: 5,
    complianceBacklogHigh: 15,
    complianceBacklogCritical: 30,
    modelRiskWatch: 2,
    modelRiskHigh: 5,
    modelRiskCritical: 10,
    integrityFailureWatch: 1,
    integrityFailureHigh: 3,
    integrityFailureCritical: 5,
    alertSurgeWatch: 20,
    alertSurgeHigh: 50,
    alertSurgeCritical: 100,
    sourceAvailabilityWatchPercent: 95,
    sourceAvailabilityHighPercent: 80,
    sourceAvailabilityCriticalPercent: 60,
    trendWorseningThresholdPercent: 10,
    clusterHighIncidentCount: 3,
    clusterCriticalIncidentCount: 5,
  }),
  sourceWeights: Object.freeze({
    dashboardAggregator: 1,
    governanceDashboard: 1,
    alertManager: 1,
    complianceCenter: 1,
    modelDriftMonitor: 1,
    diagnosticsService: 1,
  }),
});

const SENSITIVE_PATTERNS = Object.freeze([
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

const IDENTIFIER_PATTERNS = Object.freeze([
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
  /tenant.?id/i,
  /user.?id/i,
  /actor.?id/i,
]);

const SOURCE_METHODS = Object.freeze({
  dashboardAggregator: Object.freeze([
    'getRisk',
    'getOverview',
    'getSummary',
    'health',
    'readiness',
  ]),
  governanceDashboard: Object.freeze([
    'getOverview',
    'getSnapshot',
    'getDashboardSummary',
    'health',
    'readiness',
  ]),
  alertManager: Object.freeze([
    'summary',
    'listAlerts',
    'list',
    'health',
    'readiness',
  ]),
  complianceCenter: Object.freeze([
    'summary',
    'getSummary',
    'listCases',
    'health',
    'readiness',
  ]),
  modelDriftMonitor: Object.freeze([
    'summary',
    'getDashboardSummary',
    'listReports',
    'health',
    'readiness',
  ]),
  diagnosticsService: Object.freeze([
    'diagnose',
    'getDiagnostics',
    'health',
    'readiness',
  ]),
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label = 'value') {
  if (!isPlainObject(value)) {
    throw new IncidentPredictorError(
      ERROR_CODES.INVALID_INPUT,
      `${label} must be a plain object.`,
    );
  }
}

function isPromiseLike(value) {
  return Boolean(value && typeof value.then === 'function');
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
  const normalized = normalizeString(value, maxLength);
  return normalized ? normalized.toUpperCase() : undefined;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
    value === null ||
    value === undefined ||
    value === ''
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

function nowFrom(
  clock,
) {
  const value =
    typeof clock ===
    'function'
      ? clock()
      : new Date();

  return iso(
    value,
    new Date().toISOString(),
  );
}

function digest(
  value,
) {
  return `sha256:${createHash('sha256')
    .update(
      String(
        value ?? '',
      ),
      'utf8',
    )
    .digest('hex')}`;
}

function stableNormalize(
  value,
  seen = new WeakSet(),
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value ===
    'number'
  ) {
    if (
      Number.isNaN(
        value,
      )
    ) {
      return '[NaN]';
    }

    if (
      !Number.isFinite(
        value,
      )
    ) {
      return value > 0
        ? '[Infinity]'
        : '[-Infinity]';
    }

    return Object.is(
      value,
      -0,
    )
      ? 0
      : value;
  }

  if (
    typeof value ===
    'bigint'
  ) {
    return `${value}n`;
  }

  if (
    typeof value ===
      'string' ||
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    value instanceof Date
  ) {
    return iso(
      value,
      null,
    );
  }

  if (
    Buffer.isBuffer(
      value,
    )
  ) {
    return `buffer:${digest(
      value.toString(
        'base64',
      ),
    )}`;
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return value.map(
      (item) =>
        stableNormalize(
          item,
          seen,
        ),
    );
  }

  if (
    typeof value !==
    'object'
  ) {
    return String(value);
  }

  if (
    seen.has(
      value,
    )
  ) {
    return '[Circular]';
  }

  seen.add(
    value,
  );

  const output =
    {};

  for (
    const key of
    Object.keys(
      value,
    ).sort()
  ) {
    output[key] =
      stableNormalize(
        value[key],
        seen,
      );
  }

  seen.delete(
    value,
  );

  return output;
}

function stableStringify(
  value,
) {
  return JSON.stringify(
    stableNormalize(
      value,
    ),
  );
}

function sha256(
  value,
) {
  return createHash(
    HASH_ALGORITHM,
  )
    .update(
      stableStringify(
        value,
      ),
      'utf8',
    )
    .digest('hex');
}

function deepFreeze(
  value,
  seen = new WeakSet(),
) {
  if (
    value === null ||
    typeof value !==
      'object' ||
    seen.has(value)
  ) {
    return value;
  }

  seen.add(
    value,
  );

  for (
    const key of
    Reflect.ownKeys(
      value,
    )
  ) {
    deepFreeze(
      value[key],
      seen,
    );
  }

  return Object.freeze(
    value,
  );
}

function safeBytes(
  value,
) {
  return Buffer.byteLength(
    JSON.stringify(
      value,
    ),
    'utf8',
  );
}

function redact(
  value,
  options = {},
  seen = new WeakMap(),
) {
  const maxArrayItems =
    options.maxArrayItems ??
    100;

  const maxObjectKeys =
    options.maxObjectKeys ??
    100;

  const maxStringLength =
    options.maxStringLength ??
    3000;

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value ===
    'string'
  ) {
    return value.length >
      maxStringLength
      ? value.slice(
          0,
          maxStringLength,
        )
      : value;
  }

  if (
    typeof value ===
      'number' ||
    typeof value ===
      'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
    'bigint'
  ) {
    return `${value}n`;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    Buffer.isBuffer(
      value,
    )
  ) {
    return `[REDACTED_BUFFER:${digest(
      value.toString(
        'base64',
      ),
    ).slice(-16)}]`;
  }

  if (
    typeof value !==
    'object'
  ) {
    return String(value);
  }

  if (
    seen.has(value)
  ) {
    return '[Circular]';
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    seen.set(
      value,
      true,
    );

    const output =
      value
        .slice(
          0,
          maxArrayItems,
        )
        .map(
          (item) =>
            redact(
              item,
              options,
              seen,
            ),
        );

    if (
      value.length >
      maxArrayItems
    ) {
      output.push(
        `[TRUNCATED:${value.length - maxArrayItems}]`,
      );
    }

    seen.delete(
      value,
    );

    return output;
  }

  seen.set(
    value,
    true,
  );

  const output = {};
  const keys =
    Object.keys(
      value,
    )
      .sort()
      .slice(
        0,
        maxObjectKeys,
      );

  for (
    const key of
    keys
  ) {
    if (
      SENSITIVE_PATTERNS.some(
        (pattern) =>
          pattern.test(
            key,
          ),
      )
    ) {
      output[key] =
        '[REDACTED]';

      continue;
    }

    if (
      IDENTIFIER_PATTERNS.some(
        (pattern) =>
          pattern.test(
            key,
          ),
      )
    ) {
      const identifier =
        normalizeString(
          value[key],
          600,
        );

      output[key] =
        identifier
          ? digest(
              identifier,
            )
          : undefined;

      continue;
    }

    output[key] =
      redact(
        value[key],
        options,
        seen,
      );
  }

  if (
    Object.keys(
      value,
    ).length >
    keys.length
  ) {
    output.__truncatedKeys =
      Object.keys(
        value,
      ).length -
      keys.length;
  }

  seen.delete(
    value,
  );

  return output;
}

function safeError(
  error,
) {
  if (!error) return null;

  return redact({
    name:
      normalizeString(
        error.name,
        120,
      ) ??
      'Error',

    code:
      normalizeString(
        error.code,
        160,
      ) ??
      null,

    message:
      normalizeString(
        error.message,
        500,
      ) ??
      'Unknown error',
  });
}

function clamp(
  value,
  min = 0,
  max = 100,
) {
  const number =
    numberOrNull(
      value,
    );

  if (
    number ===
    null
  ) {
    return null;
  }

  return Math.min(
    max,
    Math.max(
      min,
      number,
    ),
  );
}

function percent(
  numerator,
  denominator,
) {
  const n =
    numberOrNull(
      numerator,
    );

  const d =
    numberOrNull(
      denominator,
    );

  if (
    n === null ||
    d === null ||
    d <= 0
  ) {
    return null;
  }

  return Number(
    (
      (n / d) *
      100
    ).toFixed(4),
  );
}

function ratioDeltaPercent(
  current,
  baseline,
) {
  const c =
    numberOrNull(
      current,
    );

  const b =
    numberOrNull(
      baseline,
    );

  if (
    c === null ||
    b === null ||
    b === 0
  ) {
    return null;
  }

  return Number(
    (
      ((c - b) /
        Math.abs(b)) *
      100
    ).toFixed(4),
  );
}

function trend(
  current,
  baseline,
  thresholdPercent,
) {
  const delta =
    ratioDeltaPercent(
      current,
      baseline,
    );

  if (
    delta ===
    null
  ) {
    return TREND_DIRECTIONS.UNKNOWN;
  }

  if (
    Math.abs(delta) <
    thresholdPercent
  ) {
    return TREND_DIRECTIONS.STABLE;
  }

  return delta > 0
    ? TREND_DIRECTIONS.WORSENING
    : TREND_DIRECTIONS.IMPROVING;
}

function confidenceBand(
  percentValue,
) {
  const value =
    numberOrNull(
      percentValue,
    );

  if (
    value ===
    null
  ) {
    return CONFIDENCE_BANDS.UNKNOWN;
  }

  if (
    value < 50
  ) {
    return CONFIDENCE_BANDS.LOW;
  }

  if (
    value < 75
  ) {
    return CONFIDENCE_BANDS.MEDIUM;
  }

  return CONFIDENCE_BANDS.HIGH;
}

function statusFromScore(
  score,
) {
  if (
    !Number.isFinite(
      score,
    )
  ) {
    return PREDICTION_STATUS.INDETERMINATE;
  }

  if (
    score < 20
  ) {
    return PREDICTION_STATUS.STABLE;
  }

  if (
    score < 40
  ) {
    return PREDICTION_STATUS.WATCH;
  }

  if (
    score < 60
  ) {
    return PREDICTION_STATUS.ELEVATED;
  }

  if (
    score < 80
  ) {
    return PREDICTION_STATUS.HIGH_RISK;
  }

  return PREDICTION_STATUS.CRITICAL_RISK;
}

function statusSeverity(
  status,
) {
  switch (
    status
  ) {
    case PREDICTION_STATUS.CRITICAL_RISK:
      return SEVERITY.CRITICAL;

    case PREDICTION_STATUS.HIGH_RISK:
      return SEVERITY.HIGH;

    case PREDICTION_STATUS.ELEVATED:
      return SEVERITY.MEDIUM;

    case PREDICTION_STATUS.WATCH:
      return SEVERITY.LOW;

    case PREDICTION_STATUS.STABLE:
      return SEVERITY.INFO;

    default:
      return SEVERITY.MEDIUM;
  }
}

function severityRank(
  value,
) {
  return [
    SEVERITY.INFO,
    SEVERITY.LOW,
    SEVERITY.MEDIUM,
    SEVERITY.HIGH,
    SEVERITY.CRITICAL,
  ].indexOf(
    upper(
      value,
      30,
    ),
  );
}

function maxSeverity(
  a,
  b,
) {
  return severityRank(a) >=
    severityRank(b)
    ? a
    : b;
}

function mergeConfig(
  base,
  override,
) {
  const result = {
    ...base,

    ...(isPlainObject(
      override,
    )
      ? override
      : {}),

    thresholds: {
      ...base.thresholds,

      ...(isPlainObject(
        override?.thresholds,
      )
        ? override.thresholds
        : {}),
    },

    sourceWeights: {
      ...base.sourceWeights,

      ...(isPlainObject(
        override?.sourceWeights,
      )
        ? override.sourceWeights
        : {}),
    },
  };

  return Object.freeze(
    result,
  );
}

function normalizeRange(
  input,
  config,
) {
  const end =
    input.endAt
      ? new Date(
          input.endAt,
        )
      : new Date();

  const start =
    input.startAt
      ? new Date(
          input.startAt,
        )
      : new Date(
          end.getTime() -
            config.defaultWindowMinutes *
              60_000,
        );

  if (
    Number.isNaN(
      start.getTime(),
    ) ||
    Number.isNaN(
      end.getTime(),
    )
  ) {
    throw new IncidentPredictorError(
      ERROR_CODES.RANGE_INVALID,
      'startAt and endAt must be valid dates.',
    );
  }

  if (
    start >= end
  ) {
    throw new IncidentPredictorError(
      ERROR_CODES.RANGE_INVALID,
      'startAt must be before endAt.',
    );
  }

  const minutes =
    (
      end.getTime() -
      start.getTime()
    ) /
    60_000;

  if (
    minutes >
    config.maxWindowMinutes
  ) {
    throw new IncidentPredictorError(
      ERROR_CODES.RANGE_TOO_LARGE,
      `Prediction window cannot exceed ${config.maxWindowMinutes} minutes.`,
    );
  }

  return {
    startAt:
      start.toISOString(),

    endAt:
      end.toISOString(),

    minutes,
  };
}

function normalizeScope(
  input,
  config,
) {
  const scope =
    upper(
      input.scope ??
        'TENANT',
      40,
    ) ??
    'TENANT';

  if (
    scope ===
    'SYSTEM'
  ) {
    if (
      !config.allowSystemScope
    ) {
      throw new IncidentPredictorError(
        ERROR_CODES.SYSTEM_SCOPE_FORBIDDEN,
        'System incident prediction scope is disabled.',
      );
    }

    return {
      scope:
        'SYSTEM',

      tenantId:
        null,

      tenantScope:
        'SYSTEM',
    };
  }

  const tenantId =
    normalizeString(
      input.tenantId,
      config.maxTenantIdLength,
    );

  if (
    config.tenantRequired &&
    !tenantId
  ) {
    throw new IncidentPredictorError(
      ERROR_CODES.TENANT_REQUIRED,
      'tenantId is required for tenant-scoped incident prediction.',
      {},
      {
        httpStatus: 400,
      },
    );
  }

  return {
    scope:
      'TENANT',

    tenantId:
      tenantId ??
      null,

    tenantScope:
      tenantId
        ? digest(
            tenantId,
          )
        : 'TENANT:UNSPECIFIED',
  };
}

function timeoutPromise(
  promiseOrValue,
  timeoutMs,
) {
  const value =
    isPromiseLike(
      promiseOrValue,
    )
      ? promiseOrValue
      : Promise.resolve(
          promiseOrValue,
        );

  let timer;

  return new Promise(
    (
      resolve,
      reject,
    ) => {
      timer =
        setTimeout(
          () => {
            reject(
              new IncidentPredictorError(
                ERROR_CODES.TIMEOUT,
                `Incident prediction source call timed out after ${timeoutMs} ms.`,
              ),
            );
          },
          timeoutMs,
        );

      if (
        typeof timer.unref ===
        'function'
      ) {
        timer.unref();
      }

      value.then(
        (
          result,
        ) => {
          clearTimeout(
            timer,
          );

          resolve(
            result,
          );
        },

        (
          error,
        ) => {
          clearTimeout(
            timer,
          );

          reject(
            error,
          );
        },
      );
    },
  );
}

async function runWithConcurrency(
  items,
  worker,
  concurrency,
) {
  const results =
    new Array(
      items.length,
    );

  let nextIndex =
    0;

  async function consume() {
    while (true) {
      const index =
        nextIndex++;

      if (
        index >=
        items.length
      ) {
        return;
      }

      try {
        results[index] =
          await worker(
            items[index],
            index,
          );
      } catch (
        error
      ) {
        results[index] = {
          error,
        };
      }
    }
  }

  const workerCount =
    Math.min(
      Math.max(
        1,
        concurrency,
      ),
      items.length ||
        1,
    );

  await Promise.all(
    Array.from(
      {
        length:
          workerCount,
      },
      () =>
        consume(),
    ),
  );

  return results;
}

function extractPath(
  source,
  path,
) {
  let current =
    source;

  for (
    const segment of
    String(
      path,
    ).split('.')
  ) {
    current =
      current?.[
        segment
      ];
  }

  return current;
}

function firstNumber(
  source,
  paths,
  fallback = null,
) {
  for (
    const path of
    paths
  ) {
    const value =
      numberOrNull(
        extractPath(
          source,
          path,
        ),
      );

    if (
      value !==
      null
    ) {
      return value;
    }
  }

  return fallback;
}

function firstArray(
  source,
  paths,
) {
  for (
    const path of
    paths
  ) {
    const value =
      extractPath(
        source,
        path,
      );

    if (
      Array.isArray(
        value,
      )
    ) {
      return value;
    }
  }

  return [];
}

function sourceCount(
  source,
) {
  return firstNumber(
    source,
    [
      'summary.total',
      'total',
      'count',
      'counts.total',
      'metrics.total',
    ],
    null,
  );
}

function normalizeMetricRecord(
  record,
) {
  if (
    !isPlainObject(
      record,
    )
  ) {
    return null;
  }

  return {
    timestamp:
      iso(
        record.timestamp ??
          record.createdAt ??
          record.generatedAt ??
          record.updatedAt,
        null,
      ),

    value:
      numberOrNull(
        record.value ??
          record.current ??
          record.score ??
          record.rate,
      ),

    baseline:
      numberOrNull(
        record.baseline ??
          record.previous ??
          record.expected,
      ),

    severity:
      upper(
        record.severity,
        30,
      ) ??
      null,

    code:
      normalizeString(
        record.code,
        160,
      ) ??
      null,

    title:
      normalizeString(
        record.title ??
          record.name,
        240,
      ) ??
      null,

    source:
      normalizeString(
        record.source,
        160,
      ) ??
      null,
  };
}

function collectMetricRecords(
  sourceName,
  data,
  maxRecords,
) {
  const paths = [
    'signals',
    'records',
    'trends',
    'alerts',
    'reports',
    'checks',
    'cases',
  ];

  const output =
    [];

  for (
    const path of
    paths
  ) {
    const items =
      firstArray(
        data,
        [path],
      );

    for (
      const item of
      items.slice(
        0,
        maxRecords -
          output.length,
      )
    ) {
      const normalized =
        normalizeMetricRecord(
          item,
        );

      if (
        normalized
      ) {
        normalized.source =
          normalized.source ??
          sourceName;

        output.push(
          normalized,
        );
      }

      if (
        output.length >=
        maxRecords
      ) {
        break;
      }
    }

    if (
      output.length >=
      maxRecords
    ) {
      break;
    }
  }

  return output;
}

function buildRequestFingerprint(
  input,
) {
  return `sha256:${sha256({
    provider:
      PROVIDER,

    scope:
      input.scope,

    tenantScope:
      input.tenantScope,

    rangeMode:
      input.rangeMode,

    range:
      input.rangeMode ===
      'EXPLICIT'
        ? input.range
        : null,

    windowMinutes:
      input.rangeMode ===
      'ROLLING'
        ? input.windowMinutes
        : null,

    baselineWindows:
      input.baselineWindows,

    timeoutMs:
      input.timeoutMs,

    includeEvidence:
      input.includeEvidence,

    includeSources:
      input.includeSources,

    metadata:
      input.metadata,
  })}`;
}

function buildSemanticFingerprint(
  result,
) {
  const strip =
    (
      value,
      key = null,
    ) => {
      if (
        key ===
          'generatedAt' ||
        key ===
          'startedAt' ||
        key ===
          'completedAt' ||
        key ===
          'durationMs' ||
        key ===
          'runId' ||
        key ===
          'snapshotId' ||
        key ===
          'replay' ||
        key ===
          'persistence' ||
        key ===
          'predictionFingerprint'
      ) {
        return undefined;
      }

      if (
        Array.isArray(
          value,
        )
      ) {
        return value
          .map(
            (item) =>
              strip(
                item,
              ),
          )
          .filter(
            (item) =>
              item !==
              undefined,
          );
      }

      if (
        isPlainObject(
          value,
        )
      ) {
        const output =
          {};

        for (
          const childKey of
          Object.keys(
            value,
          ).sort()
        ) {
          const child =
            strip(
              value[
                childKey
              ],
              childKey,
            );

          if (
            child !==
            undefined
          ) {
            output[
              childKey
            ] =
              child;
          }
        }

        return output;
      }

      return value;
    };

  return `sha256:${sha256(
    strip(
      result,
    ),
  )}`;
}

function normalizeSignal({
  incidentType,
  code,
  title,
  severity,
  score,
  confidence,
  trendDirection,
  currentValue,
  baselineValue,
  unit,
  evidence,
  source,
  explanation,
}) {
  const normalizedScore =
    clamp(
      score,
      0,
      100,
    ) ??
    0;

  const normalizedConfidence =
    clamp(
      confidence,
      0,
      100,
    );

  return {
    incidentType,
    code,
    title,
    severity,
    score:
      Number(
        normalizedScore.toFixed(
          4,
        ),
      ),
    confidencePercent:
      normalizedConfidence ===
      null
        ? null
        : Number(
            normalizedConfidence.toFixed(
              4,
            ),
          ),
    confidenceBand:
      confidenceBand(
        normalizedConfidence,
      ),
    trendDirection:
      trendDirection ??
      TREND_DIRECTIONS.UNKNOWN,
    currentValue:
      currentValue ===
      undefined
        ? null
        : numberOrNull(
            currentValue,
          ),
    baselineValue:
      baselineValue ===
      undefined
        ? null
        : numberOrNull(
            baselineValue,
          ),
    unit:
      unit ??
      null,
    evidence:
      redact(
        evidence ??
          {},
      ),
    source:
      normalizeString(
        source,
        160,
      ) ??
      null,
    explanation:
      normalizeString(
        explanation,
        900,
      ) ??
      null,
  };
}

function calculateConfidence({
  availableSources,
  configuredSources,
  evidenceCount,
  baselineAvailable,
}) {
  if (
    configuredSources <=
    0
  ) {
    return 0;
  }

  const sourcePercent =
    percent(
      availableSources,
      configuredSources,
    ) ??
    0;

  const evidenceBoost =
    Math.min(
      20,
      evidenceCount *
        2,
    );

  const baselineBoost =
    baselineAvailable
      ? 15
      : 0;

  return clamp(
    Math.min(
      100,
      sourcePercent *
        0.65 +
        evidenceBoost +
        baselineBoost,
    ),
  );
}

function chooseHighestScore(
  signals,
) {
  if (
    !signals.length
  ) {
    return null;
  }

  return signals
    .slice()
    .sort(
      (
        a,
        b,
      ) =>
        b.score -
          a.score ||
        severityRank(
          b.severity,
        ) -
          severityRank(
            a.severity,
          ) ||
        a.code.localeCompare(
          b.code,
        ),
    )[0];
}

function aggregateStatus(
  signals,
  confidencePercent,
) {
  if (
    !signals.length
  ) {
    return {
      status:
        PREDICTION_STATUS.INDETERMINATE,

      score:
        null,

      severity:
        SEVERITY.MEDIUM,
    };
  }

  const top =
    chooseHighestScore(
      signals,
    );

  const score =
    top?.score ??
    null;

  if (
    confidencePercent !==
      null &&
    confidencePercent <
      25 &&
    score !== null
  ) {
    return {
      status:
        PREDICTION_STATUS.INDETERMINATE,

      score,

      severity:
        SEVERITY.MEDIUM,
    };
  }

  const status =
    statusFromScore(
      score,
    );

  return {
    status,

    score,

    severity:
      statusSeverity(
        status,
      ),
  };
}

function safeCount(
  value,
) {
  return (
    numberOrNull(
      value,
    ) ??
    0
  );
}

function calculateRateFromCounts(
  numerator,
  denominator,
) {
  return percent(
    numerator,
    denominator,
  );
}

function signalFromFailureRate(
  input,
  metrics,
  config,
) {
  const current =
    firstNumber(
      metrics,
      [
        'currentFailureRate',
        'failureRate',
        'summary.failureRate',
      ],
      null,
    );

  const baseline =
    firstNumber(
      metrics,
      [
        'baselineFailureRate',
        'previousFailureRate',
        'summary.baselineFailureRate',
      ],
      null,
    );

  const total =
    firstNumber(
      metrics,
      [
        'totalTransactions',
        'summary.totalTransactions',
        'total',
      ],
      null,
    );

  const failures =
    firstNumber(
      metrics,
      [
        'failedTransactions',
        'summary.failedTransactions',
        'failures',
      ],
      null,
    );

  const derivedRate =
    current === null &&
    failures !== null &&
    total !== null
      ? calculateRateFromCounts(
          failures,
          total,
        )
      : current;

  if (
    derivedRate ===
    null
  ) {
    return null;
  }

  let score = 0;

  let explanation =
    'Payment failure rate is within the configured operating range.';

  if (
    derivedRate >=
    config.thresholds
      .providerFailureRateCritical
  ) {
    score =
      95;

    explanation =
      'Payment failure rate is at or above the critical threshold.';
  } else if (
    derivedRate >=
    config.thresholds
      .providerFailureRateHigh
  ) {
    score =
      75;

    explanation =
      'Payment failure rate is at or above the high-risk threshold.';
  } else if (
    derivedRate >=
    config.thresholds
      .providerFailureRateWatch
  ) {
    score =
      45;

    explanation =
      'Payment failure rate is above the watch threshold.';
  } else {
    score =
      Math.min(
        20,
        (derivedRate /
          Math.max(
            config.thresholds
              .providerFailureRateWatch,
            1,
          )) *
          20,
      );
  }

  const trendDirection =
    trend(
      derivedRate,
      baseline,
      config.thresholds
        .trendWorseningThresholdPercent,
    );

  if (
    trendDirection ===
    TREND_DIRECTIONS.WORSENING
  ) {
    score =
      Math.min(
        100,
        score +
          10,
      );
  }

  return normalizeSignal({
    incidentType:
      INCIDENT_TYPES.PAYMENT_FAILURE_SURGE,

    code:
      'PAYMENT_FAILURE_RATE',

    title:
      'Payment failure surge risk',

    severity:
      statusSeverity(
        statusFromScore(
          score,
        ),
      ),

    score,

    confidence:
      input.confidenceSeed,

    trendDirection,

    currentValue:
      derivedRate,

    baselineValue:
      baseline,

    unit:
      'percent',

    source:
      'dashboardAggregator',

    evidence: {
      totalTransactions:
        total,

      failedTransactions:
        failures,

      currentFailureRate:
        derivedRate,

      baselineFailureRate:
        baseline,
    },

    explanation,
  });
}

function signalFromLatency(
  input,
  metrics,
  config,
) {
  const current =
    firstNumber(
      metrics,
      [
        'currentLatencyMs',
        'latencyMs',
        'summary.averageLatencyMs',
      ],
      null,
    );

  const baseline =
    firstNumber(
      metrics,
      [
        'baselineLatencyMs',
        'previousLatencyMs',
        'summary.baselineLatencyMs',
      ],
      null,
    );

  if (
    current ===
      null ||
    baseline ===
      null ||
    baseline <= 0
  ) {
    return null;
  }

  const delta =
    ratioDeltaPercent(
      current,
      baseline,
    );

  if (
    delta ===
    null
  ) {
    return null;
  }

  let score =
    0;

  if (
    delta >=
    config.thresholds
      .transactionLatencyDeltaCriticalPercent
  ) {
    score =
      95;
  } else if (
    delta >=
    config.thresholds
      .transactionLatencyDeltaHighPercent
  ) {
    score =
      75;
  } else if (
    delta >=
    config.thresholds
      .transactionLatencyDeltaWatchPercent
  ) {
    score =
      45;
  } else if (
    delta > 0
  ) {
    score =
      Math.min(
        20,
        delta,
      );
  }

  return normalizeSignal({
    incidentType:
      INCIDENT_TYPES.TRANSACTION_LATENCY_SURGE,

    code:
      'TRANSACTION_LATENCY_DELTA',

    title:
      'Transaction latency surge risk',

    severity:
      statusSeverity(
        statusFromScore(
          score,
        ),
      ),

    score,

    confidence:
      input.confidenceSeed,

    trendDirection:
      trend(
        current,
        baseline,
        config.thresholds
          .trendWorseningThresholdPercent,
      ),

    currentValue:
      current,

    baselineValue:
      baseline,

    unit:
      'milliseconds',

    source:
      'dashboardAggregator',

    evidence: {
      currentLatencyMs:
        current,

      baselineLatencyMs:
        baseline,

      deltaPercent:
        delta,
    },

    explanation:
      delta >= 0
        ? 'Transaction latency is elevated against the supplied baseline.'
        : 'Transaction latency is not elevated against the supplied baseline.',
  });
}

function signalFromGovernance(
  input,
  metrics,
  config,
) {
  const total =
    firstNumber(
      metrics,
      [
        'totalDecisions',
        'summary.totalDecisions',
        'total',
      ],
      null,
    );

  const blocked =
    firstNumber(
      metrics,
      [
        'blockedDecisions',
        'summary.blockedDecisions',
        'blocked',
      ],
      null,
    );

  const conflicts =
    firstNumber(
      metrics,
      [
        'conflicts',
        'summary.conflicts',
      ],
      0,
    );

  const integrityFailures =
    firstNumber(
      metrics,
      [
        'integrityFailures',
        'summary.integrityFailures',
      ],
      0,
    );

  if (
    blocked ===
      null &&
    conflicts ===
      0 &&
    integrityFailures ===
      0
  ) {
    return null;
  }

  const blockRate =
    blocked !== null &&
    total !== null
      ? percent(
          blocked,
          total,
        )
      : null;

  let score =
    0;

  if (
    blockRate !==
    null
  ) {
    if (
      blockRate >=
      config.thresholds
        .governanceBlockRateCritical
    ) {
      score =
        Math.max(
          score,
          90,
        );
    } else if (
      blockRate >=
      config.thresholds
        .governanceBlockRateHigh
    ) {
      score =
        Math.max(
          score,
          70,
        );
    } else if (
      blockRate >=
      config.thresholds
        .governanceBlockRateWatch
    ) {
      score =
        Math.max(
          score,
          40,
        );
    }
  }

  if (
    conflicts >
    0
  ) {
    score =
      Math.max(
        score,
        Math.min(
          85,
          35 +
            conflicts *
              5,
        ),
      );
  }

  if (
    integrityFailures >
    0
  ) {
    score =
      Math.max(
        score,
        Math.min(
          100,
          55 +
            integrityFailures *
              8,
        ),
      );
  }

  return normalizeSignal({
    incidentType:
      conflicts > 0 ||
      integrityFailures >
        0
        ? INCIDENT_TYPES.GOVERNANCE_DEGRADATION
        : INCIDENT_TYPES.PAYMENT_FAILURE_SURGE,

    code:
      integrityFailures >
      0
        ? 'GOVERNANCE_INTEGRITY_FAILURE'
        : conflicts > 0
          ? 'GOVERNANCE_CONFLICT'
          : 'GOVERNANCE_BLOCK_RATE',

    title:
      'Governance degradation risk',

    severity:
      statusSeverity(
        statusFromScore(
          score,
        ),
      ),

    score,

    confidence:
      input.confidenceSeed,

    trendDirection:
      TREND_DIRECTIONS.UNKNOWN,

    currentValue:
      blockRate,

    baselineValue:
      null,

    unit:
      'percent',

    source:
      'governanceDashboard',

    evidence: {
      totalDecisions:
        total,

      blockedDecisions:
        blocked,

      blockRate,

      conflicts,

      integrityFailures,
    },

    explanation:
      integrityFailures >
      0
        ? 'Governance evidence contains integrity failures.'
        : conflicts > 0
          ? 'Governance evidence contains decision conflicts.'
          : 'Governance block activity is elevated against configured thresholds.',
  });
}

function signalFromCompliance(
  input,
  metrics,
  config,
) {
  const active =
    firstNumber(
      metrics,
      [
        'activeCases',
        'summary.activeCases',
        'openCases',
      ],
      null,
    );

  const escalated =
    firstNumber(
      metrics,
      [
        'escalatedCases',
        'summary.escalatedCases',
        'escalated',
      ],
      0,
    );

  const blocked =
    firstNumber(
      metrics,
      [
        'blockedCases',
        'summary.blockedCases',
        'blocked',
      ],
      0,
    );

  const reviewRequired =
    firstNumber(
      metrics,
      [
        'reviewRequired',
        'summary.reviewRequired',
      ],
      0,
    );

  if (
    active ===
      null &&
    escalated ===
      0 &&
    blocked ===
      0 &&
    reviewRequired ===
      0
  ) {
    return null;
  }

  const backlog =
    active ??
    0;

  let score =
    0;

  if (
    backlog >=
    config.thresholds
      .complianceBacklogCritical
  ) {
    score =
      90;
  } else if (
    backlog >=
    config.thresholds
      .complianceBacklogHigh
  ) {
    score =
      70;
  } else if (
    backlog >=
    config.thresholds
      .complianceBacklogWatch
  ) {
    score =
      40;
  } else {
    score =
      Math.min(
        20,
        backlog *
          4,
      );
  }

  if (
    escalated >
    0
  ) {
    score =
      Math.max(
        score,
        Math.min(
          90,
          35 +
            escalated *
              5,
        ),
      );
  }

  if (
    blocked >
    0
  ) {
    score =
      Math.max(
        score,
        Math.min(
          100,
          60 +
            blocked *
              5,
        ),
      );
  }

  if (
    reviewRequired >
    0
  ) {
    score =
      Math.max(
        score,
        Math.min(
          85,
          30 +
            reviewRequired *
              3,
        ),
      );
  }

  return normalizeSignal({
    incidentType:
      INCIDENT_TYPES.COMPLIANCE_BACKLOG,

    code:
      blocked > 0
        ? 'COMPLIANCE_BLOCKS'
        : 'COMPLIANCE_BACKLOG',

    title:
      'Compliance backlog risk',

    severity:
      statusSeverity(
        statusFromScore(
          score,
        ),
      ),

    score,

    confidence:
      input.confidenceSeed,

    trendDirection:
      TREND_DIRECTIONS.UNKNOWN,

    currentValue:
      backlog,

    baselineValue:
      null,

    unit:
      'cases',

    source:
      'complianceCenter',

    evidence: {
      activeCases:
        active,

      escalatedCases:
        escalated,

      blockedCases:
        blocked,

      reviewRequired,
    },

    explanation:
      blocked > 0
        ? 'Compliance evidence contains blocked cases.'
        : 'Compliance workload is above the configured operating thresholds.',
  });
}

function signalFromModelRisk(
  input,
  metrics,
  config,
) {
  const critical =
    firstNumber(
      metrics,
      [
        'critical',
        'counts.critical',
        'summary.critical',
      ],
      0,
    );

  const significant =
    firstNumber(
      metrics,
      [
        'significant',
        'counts.significant',
        'summary.significant',
      ],
      0,
    );

  const elevated =
    firstNumber(
      metrics,
      [
        'elevated',
        'counts.elevated',
        'summary.elevated',
      ],
      0,
    );

  const indeterminate =
    firstNumber(
      metrics,
      [
        'indeterminate',
        'counts.indeterminate',
        'summary.indeterminate',
      ],
      0,
    );

  if (
    critical === 0 &&
    significant === 0 &&
    elevated === 0 &&
    indeterminate === 0
  ) {
    return null;
  }

  let score =
    0;

  if (
    critical >
    0
  ) {
    score =
      95;
  } else if (
    significant >=
    config.thresholds
      .modelRiskCritical
  ) {
    score =
      85;
  } else if (
    significant >=
    config.thresholds
      .modelRiskHigh
  ) {
    score =
      70;
  } else if (
    significant >=
    config.thresholds
      .modelRiskWatch
  ) {
    score =
      45;
  } else if (
    elevated >
    0
  ) {
    score =
      Math.min(
        45,
        20 +
          elevated *
            3,
      );
  } else if (
    indeterminate >
    0
  ) {
    score =
      Math.min(
        35,
        15 +
          indeterminate *
            2,
      );
  }

  return normalizeSignal({
    incidentType:
      INCIDENT_TYPES.MODEL_RISK,

    code:
      critical > 0
        ? 'MODEL_RISK_CRITICAL'
        : 'MODEL_RISK_SIGNAL',

    title:
      'Model-risk incident signal',

    severity:
      statusSeverity(
        statusFromScore(
          score,
        ),
      ),

    score,

    confidence:
      input.confidenceSeed,

    trendDirection:
      TREND_DIRECTIONS.UNKNOWN,

    currentValue:
      critical +
      significant +
      elevated +
      indeterminate,

    baselineValue:
      null,

    unit:
      'findings',

    source:
      'modelDriftMonitor',

    evidence: {
      critical,
      significant,
      elevated,
      indeterminate,
    },

    explanation:
      critical > 0
        ? 'Critical model-risk findings are present.'
        : 'Model-risk monitoring contains elevated findings.',
  });
}

function signalFromAlerts(
  input,
  metrics,
  config,
) {
  const current =
    firstNumber(
      metrics,
      [
        'active',
        'activeAlerts',
        'summary.active',
        'counts.active',
      ],
      null,
    );

  const critical =
    firstNumber(
      metrics,
      [
        'critical',
        'counts.critical',
        'summary.critical',
      ],
      0,
    );

  const high =
    firstNumber(
      metrics,
      [
        'high',
        'counts.high',
        'summary.high',
      ],
      0,
    );

  const escalated =
    firstNumber(
      metrics,
      [
        'escalated',
        'counts.escalated',
        'summary.escalated',
      ],
      0,
    );

  const baseline =
    firstNumber(
      metrics,
      [
        'baselineActive',
        'summary.baselineActive',
      ],
      null,
    );

  if (
    current ===
      null &&
    critical ===
      0 &&
    high ===
      0 &&
    escalated ===
      0
  ) {
    return null;
  }

  let score =
    0;

  if (
    critical >
    0
  ) {
    score =
      95;
  } else if (
    current >=
    config.thresholds
      .alertSurgeCritical
  ) {
    score =
      90;
  } else if (
    current >=
    config.thresholds
      .alertSurgeHigh
  ) {
    score =
      70;
  } else if (
    current >=
    config.thresholds
      .alertSurgeWatch
  ) {
    score =
      45;
  } else {
    score =
      Math.min(
        30,
        safeCount(
          current,
        ),
      );
  }

  if (
    high >
    0
  ) {
    score =
      Math.max(
        score,
        Math.min(
          85,
          35 +
            high *
              4,
        ),
      );
  }

  if (
    escalated >
    0
  ) {
    score =
      Math.max(
        score,
        Math.min(
          90,
          40 +
            escalated *
              5,
        ),
      );
  }

  return normalizeSignal({
    incidentType:
      INCIDENT_TYPES.OPERATIONAL_ALERT_SURGE,

    code:
      critical > 0
        ? 'CRITICAL_ALERT_SURGE'
        : 'OPERATIONAL_ALERT_SURGE',

    title:
      'Operational alert surge risk',

    severity:
      statusSeverity(
        statusFromScore(
          score,
        ),
      ),

    score,

    confidence:
      input.confidenceSeed,

    trendDirection:
      trend(
        current,
        baseline,
        config.thresholds
          .trendWorseningThresholdPercent,
      ),

    currentValue:
      current,

    baselineValue:
      baseline,

    unit:
      'alerts',

    source:
      'alertManager',

    evidence: {
      active:
        current,

      critical,

      high,

      escalated,

      baselineActive:
        baseline,
    },

    explanation:
      critical > 0
        ? 'Critical operational alerts are active.'
        : 'Operational alert volume is elevated or escalating.',
  });
}

function signalFromDiagnostics(
  input,
  metrics,
) {
  const fail =
    firstNumber(
      metrics,
      [
        'fail',
        'counts.fail',
        'summary.fail',
        'failed',
      ],
      0,
    );

  const warn =
    firstNumber(
      metrics,
      [
        'warn',
        'counts.warn',
        'summary.warn',
        'warnings',
      ],
      0,
    );

  const unknown =
    firstNumber(
      metrics,
      [
        'unknown',
        'counts.unknown',
        'summary.unknown',
      ],
      0,
    );

  const unsafe =
    firstNumber(
      metrics,
      [
        'unsafe',
        'counts.unsafe',
        'summary.unsafe',
      ],
      0,
    );

  if (
    fail === 0 &&
    warn === 0 &&
    unknown === 0 &&
    unsafe === 0
  ) {
    return null;
  }

  let score =
    0;

  if (
    unsafe >
    0
  ) {
    score =
      100;
  } else if (
    fail >=
    5
  ) {
    score =
      85;
  } else if (
    fail >
    0
  ) {
    score =
      65;
  } else if (
    warn >=
    10
  ) {
    score =
      45;
  } else if (
    warn >
    0
  ) {
    score =
      25;
  } else {
    score =
      Math.min(
        20,
        unknown *
          3,
      );
  }

  return normalizeSignal({
    incidentType:
      INCIDENT_TYPES.OBSERVABILITY_DEGRADATION,

    code:
      unsafe > 0
        ? 'DIAGNOSTIC_UNSAFE'
        : 'DIAGNOSTIC_DEGRADATION',

    title:
      'Observability degradation risk',

    severity:
      statusSeverity(
        statusFromScore(
          score,
        ),
      ),

    score,

    confidence:
      input.confidenceSeed,

    trendDirection:
      TREND_DIRECTIONS.UNKNOWN,

    currentValue:
      fail +
      warn +
      unknown +
      unsafe,

    baselineValue:
      null,

    unit:
      'diagnostic-findings',

    source:
      'diagnosticsService',

    evidence: {
      fail,
      warn,
      unknown,
      unsafe,
    },

    explanation:
      unsafe > 0
        ? 'Diagnostics reported an unsafe source boundary.'
        : 'Operational diagnostics contain failures, warnings or unknown checks.',
  });
}

export class IncidentPredictorError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message);

    this.name =
      'IncidentPredictorError';

    this.code =
      code;

    this.details =
      redact(
        details,
      );

    this.cause =
      options.cause;

    this.statusCode =
      options.httpStatus ??
      500;
  }
}

export class InMemoryIncidentPredictionRepository {
  constructor(
    seed = {},
  ) {
    this.predictions =
      Array.isArray(
        seed.predictions,
      )
        ? seed.predictions.map(
            (item) =>
              redact(
                item,
              ),
          )
        : [];

    this.closed =
      false;
  }

  _assertOpen() {
    if (
      this.closed
    ) {
      throw new IncidentPredictorError(
        ERROR_CODES.PERSISTENCE_FAILED,
        'Incident prediction repository is closed.',
      );
    }
  }

  async findByIdempotencyKey(
    {
      tenantScope,
      idempotencyKey,
    } = {},
  ) {
    this._assertOpen();

    return (
      this.predictions.find(
        (item) =>
          item.tenantScope ===
            tenantScope &&
          item.idempotencyKey ===
            idempotencyKey,
      ) ??
      null
    );
  }

  async savePrediction(
    record,
  ) {
    this._assertOpen();

    const normalized =
      redact(
        record,
      );

    if (
      normalized.idempotencyKey
    ) {
      const existing =
        await this.findByIdempotencyKey(
          {
            tenantScope:
              normalized.tenantScope,

            idempotencyKey:
              normalized.idempotencyKey,
          },
        );

      if (
        existing
      ) {
        if (
          existing.requestFingerprint !==
          normalized.requestFingerprint
        ) {
          throw new IncidentPredictorError(
            ERROR_CODES.IDEMPOTENCY_CONFLICT,
            'Incident prediction idempotency key maps to a different request.',
            {},
            {
              httpStatus:
                409,
            },
          );
        }

        return {
          record:
            existing,

          replay:
            true,
        };
      }
    }

    this.predictions.push(
      normalized,
    );

    return {
      record:
        normalized,

      replay:
        false,
    };
  }

  async getPrediction(
    {
      tenantScope,
      predictionId,
    } = {},
  ) {
    this._assertOpen();

    return (
      this.predictions.find(
        (item) =>
          item.tenantScope ===
            tenantScope &&
          item.predictionId ===
            predictionId,
      ) ??
      null
    );
  }

  async listPredictions(
    {
      tenantScope,
      limit = 20,
      offset = 0,
    } = {},
  ) {
    this._assertOpen();

    return this.predictions
      .filter(
        (item) =>
          item.tenantScope ===
          tenantScope,
      )
      .sort(
        (
          a,
          b,
        ) =>
          String(
            b.generatedAt ??
              '',
          ).localeCompare(
            String(
              a.generatedAt ??
                '',
            ),
          ),
      )
      .slice(
        offset,
        offset + limit,
      );
  }

  async healthCheck() {
    return {
      ok:
        !this.closed,

      state:
        this.closed
          ? HEALTH_STATES.UNAVAILABLE
          : HEALTH_STATES.HEALTHY,

      count:
        this.predictions.length,
    };
  }

  async close() {
    this.closed =
      true;
  }
}

export class IncidentPredictor {
  constructor(
    options = {},
  ) {
    assertPlainObject(
      options,
      'options',
    );

    this.config =
      mergeConfig(
        DEFAULT_CONFIG,
        options.config,
      );

    if (
      !validateProviderScope(
        this.config.provider,
      )
    ) {
      throw new IncidentPredictorError(
        ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        `Incident predictor supports provider ${PROVIDER} only.`,
        {
          provider:
            this.config.provider,
        },
        {
          httpStatus:
            400,
        },
      );
    }

    this.repository =
      options.repository ??
      options.incidentPredictionRepository ??
      null;

    if (
      !this.repository &&
      this.config
        .requireRepository
    ) {
      throw new IncidentPredictorError(
        ERROR_CODES.REPOSITORY_REQUIRED,
        'A durable incident prediction repository must be injected in production.',
      );
    }

    this.logger =
      options.logger ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.clock =
      typeof options.clock ===
      'function'
        ? options.clock
        : () => new Date();

    this.idFactory =
      typeof options.predictionIdFactory ===
      'function'
        ? options.predictionIdFactory
        : () =>
            `incident-prediction-${Date.now()}-${sha256(
              `${Date.now()}-${Math.random()}`,
            ).slice(
              0,
              20,
            )}`;

    this.sources =
      Object.freeze({
        dashboardAggregator:
          options.dashboardAggregator ??
          null,

        governanceDashboard:
          options.governanceDashboard ??
          null,

        alertManager:
          options.alertManager ??
          null,

        complianceCenter:
          options.complianceCenter ??
          null,

        modelDriftMonitor:
          options.modelDriftMonitor ??
          null,

        diagnosticsService:
          options.diagnosticsService ??
          null,
      });

    this.requiredSources =
      new Set(
        Array.isArray(
          options.requiredSources,
        )
          ? options.requiredSources
              .map(
                (item) =>
                  normalizeString(
                    item,
                    160,
                  ),
              )
              .filter(
                Boolean,
              )
          : [],
      );

    this._validateSourceContracts();
  }

  _validateSourceContracts() {
    for (
      const [
        name,
        source,
      ] of Object.entries(
        this.sources,
      )
    ) {
      if (
        !source ||
        typeof source !==
          'object'
      ) {
        continue;
      }

      const allowed =
        SOURCE_METHODS[
          name
        ] ??
        [];

      const valid =
        allowed.some(
          (
            method,
          ) =>
            typeof source[
              method
            ] ===
            'function',
        );

      if (
        !valid &&
        this.requiredSources.has(
          name,
        )
      ) {
        throw new IncidentPredictorError(
          ERROR_CODES.SOURCE_PROTOCOL_ERROR,
          `Required source ${name} does not expose a supported read-only contract.`,
          {
            source:
              name,
          },
        );
      }
    }
  }

  _log(
    level,
    message,
    error = null,
    context = {},
  ) {
    if (
      !this.logger
    ) {
      return;
    }

    const payload =
      redact({
        component:
          COMPONENT,

        provider:
          PROVIDER,

        ...context,

        ...(error
          ? {
              error:
                safeError(
                  error,
                ),
            }
          : {}),
      });

    const fn =
      typeof this.logger[
        level
      ] ===
      'function'
        ? this.logger[
            level
          ]
        : typeof this.logger.info ===
          'function'
          ? this.logger.info
          : null;

    if (fn) {
      try {
        fn.call(
          this.logger,
          payload,
          message,
        );
      } catch {
        /*
         * Logging must never alter prediction behavior.
         */
      }
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
          ?.increment ===
        'function'
      ) {
        this.metrics.increment(
          name,
          labels,
          value,
        );
      } else if (
        typeof this.metrics?.inc ===
        'function'
      ) {
        this.metrics.inc(
          name,
          labels,
          value,
        );
      }
    } catch (
      error
    ) {
      this._log(
        'warn',
        'Incident predictor metric emission failed.',
        error,
        {
          metricName:
            name,
        },
      );
    }
  }

  _normalizeInput(
    input,
  ) {
    assertPlainObject(
      input,
      'input',
    );

    const scope =
      normalizeScope(
        input,
        this.config,
      );

    const provider =
      upper(
        input.provider ??
          PROVIDER,
        80,
      ) ??
      PROVIDER;

    if (
      !validateProviderScope(
        provider,
      )
    ) {
      throw new IncidentPredictorError(
        ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        `Incident predictor supports provider ${PROVIDER} only.`,
        {
          provider,
        },
        {
          httpStatus:
            400,
        },
      );
    }

    const range =
      normalizeRange(
        input,
        this.config,
      );

    const rangeMode =
      input.startAt ||
      input.endAt
        ? 'EXPLICIT'
        : 'ROLLING';

    const windowMinutes =
      input.windowMinutes
        ? integer(
            input.windowMinutes,
            this.config
              .defaultWindowMinutes,
            1,
            this.config
              .maxWindowMinutes,
          )
        : this.config
            .defaultWindowMinutes;

    const baselineWindows =
      integer(
        input.baselineWindows,
        this.config
          .defaultBaselineWindows,
        1,
        this.config
          .maxBaselineWindows,
      );

    const timeoutMs =
      integer(
        input.timeoutMs,
        this.config
          .defaultTimeoutMs,
        1,
        this.config
          .maxTimeoutMs,
      );

    return {
      ...scope,

      provider:
        PROVIDER,

      range,

      rangeMode,

      windowMinutes,

      baselineWindows,

      timeoutMs,

      includeEvidence:
        input.includeEvidence !==
        false,

      includeSources:
        input.includeSources !==
        false,

      idempotencyKey:
        normalizeString(
          input.idempotencyKey,
          240,
        ) ??
        null,

      metadata:
        redact(
          input.metadata ??
            {},
        ),
    };
  }

  _selectSourceMethod(
    sourceName,
    source,
    preferred = [],
  ) {
    if (
      !source
    ) {
      return null;
    }

    const allowed =
      new Set(
        SOURCE_METHODS[
          sourceName
        ] ??
          [],
      );

    for (
      const method of
      preferred
    ) {
      if (
        allowed.has(
          method,
        ) &&
        typeof source[
          method
        ] ===
          'function'
      ) {
        return method;
      }
    }

    for (
      const method of
      allowed
    ) {
      if (
        typeof source[
          method
        ] ===
        'function'
      ) {
        return method;
      }
    }

    return null;
  }

  async _callSource(
    sourceName,
    input,
    preferredMethods = [],
  ) {
    const source =
      this.sources[
        sourceName
      ];

    if (
      !source
    ) {
      return {
        source:
          sourceName,

        configured:
          false,

        available:
          false,

        method:
          null,

        data:
          null,

        unsafe:
          false,

        unsafeFlags:
          [],

        error:
          null,
      };
    }

    const method =
      this._selectSourceMethod(
        sourceName,
        source,
        preferredMethods,
      );

    if (
      !method
    ) {
      return {
        source:
          sourceName,

        configured:
          true,

        available:
          false,

        method:
          null,

        data:
          null,

        unsafe:
          true,

        unsafeFlags: [
          'missing-allow-listed-read-method',
        ],

        error:
          safeError(
            new IncidentPredictorError(
              ERROR_CODES.SOURCE_PROTOCOL_ERROR,
              `${sourceName} does not expose an allow-listed read-only method.`,
            ),
          ),
      };
    }

    const context =
      Object.freeze({
        tenantId:
          input.tenantId,

        tenantDigest:
          input.tenantId
            ? digest(
                input.tenantId,
              )
            : null,

        provider:
          PROVIDER,

        scope:
          input.scope,

        startAt:
          input.range
            .startAt,

        endAt:
          input.range
            .endAt,

        range:
          {
            ...input.range,
          },

        baselineWindows:
          input.baselineWindows,

        limit:
          this.config
            .maxSignals,
      });

    try {
      const raw =
        await timeoutPromise(
          source[
            method
          ].call(
            source,
            context,
          ),
          input.timeoutMs,
        );

      const data =
        isPlainObject(
          raw,
        ) ||
        Array.isArray(
          raw,
        )
          ? redact(
              raw,
            )
          : null;

      const safety =
        raw?.safety ??
        raw;

      const unsafeFlags = [
        'financialMutationPerformed',
        'ledgerMutationPerformed',
        'balanceMutationPerformed',
        'providerCallPerformed',
        'paymentExecutionPerformed',
        'settlementPerformed',
        'approvalGranted',
        'executionAuthorized',
        'arbitraryCodeExecutionPerformed',
      ].filter(
        (
          key,
        ) =>
          safety?.[
            key
          ] ===
          true,
      );

      const reportedProvider =
        upper(
          raw?.provider,
          80,
        );

      if (
        reportedProvider &&
        !validateProviderScope(
          reportedProvider,
        )
      ) {
        unsafeFlags.push(
          `provider:${reportedProvider}`,
        );
      }

      const unsafe =
        unsafeFlags.length >
        0;

      return {
        source:
          sourceName,

        configured:
          true,

        available:
          !unsafe ||
          !this.config
            .failClosedOnUnsafeSource,

        method,

        data,

        unsafe,

        unsafeFlags,

        error:
          unsafe &&
          this.config
            .failClosedOnUnsafeSource
            ? safeError(
                new IncidentPredictorError(
                  ERROR_CODES.SOURCE_UNSAFE,
                  `${sourceName} reported an unsafe boundary.`,
                ),
              )
            : null,
      };
    } catch (
      error
    ) {
      return {
        source:
          sourceName,

        configured:
          true,

        available:
          false,

        method,

        data:
          null,

        unsafe:
          false,

        unsafeFlags:
          [],

        error:
          safeError(
            error,
          ),
      };
    }
  }

  async _collectSources(
    input,
  ) {
    const plan = [
      [
        'dashboardAggregator',
        [
          'getRisk',
          'getOverview',
          'getSummary',
          'health',
        ],
      ],

      [
        'governanceDashboard',
        [
          'getOverview',
          'getSnapshot',
          'getDashboardSummary',
          'health',
        ],
      ],

      [
        'alertManager',
        [
          'summary',
          'listAlerts',
          'list',
          'health',
        ],
      ],

      [
        'complianceCenter',
        [
          'summary',
          'getSummary',
          'health',
        ],
      ],

      [
        'modelDriftMonitor',
        [
          'summary',
          'getDashboardSummary',
          'listReports',
          'health',
        ],
      ],

      [
        'diagnosticsService',
        [
          'diagnose',
          'getDiagnostics',
          'health',
        ],
      ],
    ];

    const results =
      await runWithConcurrency(
        plan,
        (
          [
            name,
            methods,
          ],
        ) =>
          this._callSource(
            name,
            input,
            methods,
          ),
        this.config
          .maxConcurrency,
      );

    const output =
      {};

    for (
      let index = 0;
      index <
        plan.length;
      index += 1
    ) {
      output[
        plan[index][
          0
        ]
      ] =
        results[index]
          ?.error
          ? {
              source:
                plan[
                  index
                ][
                  0
                ],

              configured:
                Boolean(
                  this.sources[
                    plan[
                      index
                    ][
                      0
                    ]
                  ],
                ),

              available:
                false,

              method:
                null,

              data:
                null,

              unsafe:
                false,

              unsafeFlags:
                [],

              error:
                safeError(
                  results[
                    index
                  ].error,
                ),
            }
          : results[
              index
            ];
    }

    return output;
  }

  _sourceState(
    sourceName,
    source,
  ) {
    const configured =
      Boolean(
        source?.configured,
      );

    const available =
      Boolean(
        source?.available,
      );

    const data =
      source?.data;

    const count =
      Array.isArray(
        data,
      )
        ? data.length
        : sourceCount(
            data,
          ) ??
          0;

    const partial =
      Boolean(
        source?.error ||
          source?.unsafe ||
          data?.dataState ===
            DATA_STATES.PARTIAL ||
          data?.dataState ===
            'TRUNCATED',
      );

    return {
      source:
        sourceName,

      configured,

      available,

      dataState:
        !configured
          ? DATA_STATES.UNAVAILABLE
          : !available
            ? DATA_STATES.UNAVAILABLE
            : partial
              ? DATA_STATES.PARTIAL
              : count === 0
                ? DATA_STATES.EMPTY
                : DATA_STATES.AVAILABLE,

      method:
        source?.method ??
        null,

      unsafe:
        Boolean(
          source?.unsafe,
        ),

      unsafeFlags:
        source?.unsafeFlags ??
        [],

      error:
        source?.error ??
        null,

      count,
    };
  }

  _normalSourceMetrics(
    sourceName,
    source,
  ) {
    const data =
      source?.data ??
      {};

    switch (
      sourceName
    ) {
      case 'dashboardAggregator':
        return {
          currentFailureRate:
            firstNumber(
              data,
              [
                'operations.failureRate',
                'summary.failureRate',
                'failureRate',
                'metrics.failureRate',
              ],
              null,
            ),

          baselineFailureRate:
            firstNumber(
              data,
              [
                'operations.baselineFailureRate',
                'baselineFailureRate',
              ],
              null,
            ),

          totalTransactions:
            firstNumber(
              data,
              [
                'operations.totalTransactions',
                'summary.totalTransactions',
              ],
              null,
            ),

          failedTransactions:
            firstNumber(
              data,
              [
                'operations.failedTransactions',
                'summary.failedTransactions',
              ],
              null,
            ),

          currentLatencyMs:
            firstNumber(
              data,
              [
                'operations.averageLatencyMs',
                'summary.averageLatencyMs',
              ],
              null,
            ),

          baselineLatencyMs:
            firstNumber(
              data,
              [
                'operations.baselineLatencyMs',
                'summary.baselineLatencyMs',
              ],
              null,
            ),
        };

      case 'governanceDashboard':
        return {
          totalDecisions:
            firstNumber(
              data,
              [
                'summary.totalDecisions',
                'totalDecisions',
                'counts.total',
              ],
              null,
            ),

          blockedDecisions:
            firstNumber(
              data,
              [
                'summary.blockedDecisions',
                'blockedDecisions',
                'counts.blocked',
              ],
              null,
            ),

          conflicts:
            firstNumber(
              data,
              [
                'summary.conflicts',
                'conflicts',
              ],
              0,
            ),

          integrityFailures:
            firstNumber(
              data,
              [
                'summary.integrityFailures',
                'integrityFailures',
              ],
              0,
            ),
        };

      case 'alertManager':
        return {
          active:
            firstNumber(
              data,
              [
                'active',
                'activeAlerts',
                'summary.active',
                'counts.active',
              ],
              null,
            ),

          baselineActive:
            firstNumber(
              data,
              [
                'baselineActive',
                'summary.baselineActive',
              ],
              null,
            ),

          critical:
            firstNumber(
              data,
              [
                'critical',
                'summary.critical',
                'counts.critical',
              ],
              0,
            ),

          high:
            firstNumber(
              data,
              [
                'high',
                'summary.high',
                'counts.high',
              ],
              0,
            ),

          escalated:
            firstNumber(
              data,
              [
                'escalated',
                'summary.escalated',
                'counts.escalated',
              ],
              0,
            ),
        };

      case 'complianceCenter':
        return {
          activeCases:
            firstNumber(
              data,
              [
                'activeCases',
                'summary.activeCases',
                'summary.openCases',
                'counts.active',
              ],
              null,
            ),

          escalatedCases:
            firstNumber(
              data,
              [
                'escalatedCases',
                'summary.escalatedCases',
                'counts.escalated',
              ],
              0,
            ),

          blockedCases:
            firstNumber(
              data,
              [
                'blockedCases',
                'summary.blockedCases',
                'counts.blocked',
              ],
              0,
            ),

          reviewRequired:
            firstNumber(
              data,
              [
                'reviewRequired',
                'summary.reviewRequired',
                'counts.reviewRequired',
              ],
              0,
            ),
        };

      case 'modelDriftMonitor':
        return {
          critical:
            firstNumber(
              data,
              [
                'critical',
                'counts.critical',
                'summary.critical',
              ],
              0,
            ),

          significant:
            firstNumber(
              data,
              [
                'significant',
                'counts.significant',
                'summary.significant',
              ],
              0,
            ),

          elevated:
            firstNumber(
              data,
              [
                'elevated',
                'counts.elevated',
                'summary.elevated',
              ],
              0,
            ),

          indeterminate:
            firstNumber(
              data,
              [
                'indeterminate',
                'counts.indeterminate',
                'summary.indeterminate',
              ],
              0,
            ),
        };

      case 'diagnosticsService':
        return {
          fail:
            firstNumber(
              data,
              [
                'counts.fail',
                'fail',
                'summary.fail',
              ],
              0,
            ),

          warn:
            firstNumber(
              data,
              [
                'counts.warn',
                'warn',
                'summary.warn',
              ],
              0,
            ),

          unknown:
            firstNumber(
              data,
              [
                'counts.unknown',
                'unknown',
                'summary.unknown',
              ],
              0,
            ),

          unsafe:
            firstNumber(
              data,
              [
                'counts.unsafe',
                'unsafe',
                'summary.unsafe',
              ],
              0,
            ),
        };

      default:
        return {};
    }
  }

  _buildSignals(
    input,
    sourceMap,
    confidenceSeed,
  ) {
    const signalInput =
      {
        ...input,
        confidenceSeed,
      };

    const governanceMetrics =
      this._normalSourceMetrics(
        'governanceDashboard',
        sourceMap
          .governanceDashboard,
      );

    const dashboardMetrics =
      this._normalSourceMetrics(
        'dashboardAggregator',
        sourceMap
          .dashboardAggregator,
      );

    const alertMetrics =
      this._normalSourceMetrics(
        'alertManager',
        sourceMap
          .alertManager,
      );

    const complianceMetrics =
      this._normalSourceMetrics(
        'complianceCenter',
        sourceMap
          .complianceCenter,
      );

    const modelMetrics =
      this._normalSourceMetrics(
        'modelDriftMonitor',
        sourceMap
          .modelDriftMonitor,
      );

    const diagnosticMetrics =
      this._normalSourceMetrics(
        'diagnosticsService',
        sourceMap
          .diagnosticsService,
      );

    const signals =
      [];

    const failureRate =
      signalFromFailureRate(
        signalInput,
        dashboardMetrics,
        this.config,
      );

    const latency =
      signalFromLatency(
        signalInput,
        dashboardMetrics,
        this.config,
      );

    const governance =
      signalFromGovernance(
        signalInput,
        governanceMetrics,
        this.config,
      );

    const compliance =
      signalFromCompliance(
        signalInput,
        complianceMetrics,
        this.config,
      );

    const alerts =
      signalFromAlerts(
        signalInput,
        alertMetrics,
        this.config,
      );

    const modelRisk =
      signalFromModelRisk(
        signalInput,
        modelMetrics,
        this.config,
      );

    const diagnostics =
      signalFromDiagnostics(
        signalInput,
        diagnosticMetrics,
      );

    for (
      const signal of [
        failureRate,
        latency,
        governance,
        compliance,
        alerts,
        modelRisk,
        diagnostics,
      ]
    ) {
      if (
        signal
      ) {
        signals.push(
          signal,
        );
      }
    }

    return signals;
  }

  _buildAvailabilitySignal(
    sourceStates,
    confidenceSeed,
  ) {
    const configured =
      sourceStates.filter(
        (
          item,
        ) =>
          item.configured,
      );

    const available =
      configured.filter(
        (
          item,
        ) =>
          item.available,
      );

    const unsafe =
      configured.filter(
        (
          item,
        ) =>
          item.unsafe,
      );

    if (
      configured.length ===
      0
    ) {
      return normalizeSignal({
        incidentType:
          INCIDENT_TYPES.OBSERVABILITY_DEGRADATION,

        code:
          'NO_RISK_SOURCES',

        title:
          'Risk intelligence source availability',

        severity:
          SEVERITY.CRITICAL,

        score:
          100,

        confidence:
          0,

        trendDirection:
          TREND_DIRECTIONS.UNKNOWN,

        currentValue:
          0,

        baselineValue:
          null,

        unit:
          'percent',

        source:
          'source-health',

        evidence: {
          configured:
            0,

          available:
            0,
        },

        explanation:
          'No risk intelligence source is configured.',
      });
    }

    const availability =
      percent(
        available.length,
        configured.length,
      ) ??
      0;

    let score =
      0;

    if (
      availability <
      this.config.thresholds
        .sourceAvailabilityCriticalPercent
    ) {
      score =
        95;
    } else if (
      availability <
      this.config.thresholds
        .sourceAvailabilityHighPercent
    ) {
      score =
        75;
    } else if (
      availability <
      this.config.thresholds
        .sourceAvailabilityWatchPercent
    ) {
      score =
        45;
    } else {
      score =
        0;
    }

    if (
      unsafe.length >
      0
    ) {
      score =
        100;
    }

    if (
      score ===
      0
    ) {
      return null;
    }

    return normalizeSignal({
      incidentType:
        INCIDENT_TYPES.PROVIDER_DEGRADATION,

      code:
        unsafe.length >
        0
          ? 'UNSAFE_SOURCE_BOUNDARY'
          : 'SOURCE_AVAILABILITY',

      title:
        'Command-center intelligence availability risk',

      severity:
        statusSeverity(
          statusFromScore(
            score,
          ),
        ),

      score,

      confidence:
        confidenceSeed,

      trendDirection:
        TREND_DIRECTIONS.UNKNOWN,

      currentValue:
        availability,

      baselineValue:
        null,

      unit:
        'percent',

      source:
        'source-health',

      evidence: {
        configuredSources:
          configured.length,

        availableSources:
          available.length,

        unsafeSources:
          unsafe.length,

        unavailableSources:
          configured.length -
          available.length,
      },

      explanation:
        unsafe.length >
        0
          ? 'One or more source boundaries reported unsafe operations.'
          : 'One or more configured risk intelligence sources are unavailable.',
    });
  }

  _buildClusterSignal(
    signals,
    confidenceSeed,
  ) {
    const nonStable =
      signals.filter(
        (
          signal,
        ) =>
          signal.score >=
          40,
      );

    if (
      nonStable.length <
      this.config.thresholds
        .clusterHighIncidentCount
    ) {
      return null;
    }

    let score =
      Math.min(
        100,
        50 +
          nonStable.length *
            8,
      );

    if (
      nonStable.some(
        (
          signal,
        ) =>
          signal.severity ===
          SEVERITY.CRITICAL,
      )
    ) {
      score =
        Math.max(
          score,
          90,
        );
    }

    const types =
      [
        ...new Set(
          nonStable.map(
            (
              signal,
            ) =>
              signal.incidentType,
          ),
        ),
      ].sort();

    return normalizeSignal({
      incidentType:
        INCIDENT_TYPES.INCIDENT_CLUSTER,

      code:
        nonStable.length >=
        this.config.thresholds
          .clusterCriticalIncidentCount
          ? 'MULTI_SIGNAL_CRITICAL_CLUSTER'
          : 'MULTI_SIGNAL_INCIDENT_CLUSTER',

      title:
        'Multi-signal incident cluster',

      severity:
        statusSeverity(
          statusFromScore(
            score,
          ),
        ),

      score,

      confidence:
        confidenceSeed,

      trendDirection:
        TREND_DIRECTIONS.UNKNOWN,

      currentValue:
        nonStable.length,

      baselineValue:
        null,

      unit:
        'signals',

      source:
        'incident-predictor',

      evidence: {
        contributingSignalCount:
          nonStable.length,

        incidentTypes:
          types,

        contributingCodes:
          nonStable.map(
            (
              signal,
            ) =>
              signal.code,
          ).sort(),
      },

      explanation:
        'Multiple independent operational signals indicate correlated incident risk.',
    });
  }

  _applySourceWeights(
    signals,
  ) {
    return signals.map(
      (
        signal,
      ) => {
        const sourceWeight =
          this.config
            .sourceWeights[
            signal.source
          ] ??
          1;

        return {
          ...signal,

          score:
            Number(
              clamp(
                signal.score *
                  clamp(
                    sourceWeight,
                    0,
                    1,
                  ),
                0,
                100,
              ).toFixed(
                4,
              ),
            ),
        };
      },
    );
  }

  async predict(
    input = {},
  ) {
    const normalized =
      this._normalizeInput(
        input,
      );

    const predictionId =
      this.idFactory();

    const startedAt =
      nowFrom(
        this.clock,
      );

    const requestFingerprint =
      buildRequestFingerprint(
        normalized,
      );

    if (
      normalized.idempotencyKey &&
      typeof this.repository
        ?.findByIdempotencyKey ===
        'function'
    ) {
      const existing =
        await this.repository.findByIdempotencyKey(
          {
            tenantScope:
              normalized.tenantScope,

            idempotencyKey:
              normalized.idempotencyKey,
          },
        );

      if (
        existing
      ) {
        if (
          existing.requestFingerprint !==
          requestFingerprint
        ) {
          throw new IncidentPredictorError(
            ERROR_CODES.IDEMPOTENCY_CONFLICT,
            'Incident prediction idempotency key maps to a different request.',
            {},
            {
              httpStatus:
                409,
            },
          );
        }

        return deepFreeze({
          ...redact(
            existing,
          ),

          replay:
            true,

          replayedFromPredictionId:
            existing.predictionId ??
            null,
        });
      }
    }

    this._metric(
      'titech.airtel.incident_prediction.started',
      {
        scope:
          normalized.scope,
      },
    );

    const sourceMap =
      await this._collectSources(
        normalized,
      );

    const sourceStates =
      Object.entries(
        sourceMap,
      ).map(
        ([
          name,
          source,
        ]) =>
          this._sourceState(
            name,
            source,
          ),
      );

    const configuredSources =
      sourceStates.filter(
        (
          item,
        ) =>
          item.configured,
      );

    const availableSources =
      sourceStates.filter(
        (
          item,
        ) =>
          item.configured &&
          item.available,
      );

    const unsafeSources =
      sourceStates.filter(
        (
          item,
        ) =>
          item.unsafe,
      );

    const evidenceCount =
      sourceStates.reduce(
        (
          sum,
          item,
        ) =>
          sum +
          safeCount(
            item.count,
          ),
        0,
      );

    const baselineAvailable =
      sourceStates.some(
        (
          item,
        ) =>
          item.available &&
          Boolean(
            extractPath(
              sourceMap[
                item.source
              ]?.data,
              'trends',
            )?.length,
          ),
      );

    const confidence =
      calculateConfidence({
        availableSources:
          availableSources.length,

        configuredSources:
          configuredSources.length,

        evidenceCount,

        baselineAvailable,
      });

    let signals =
      this._buildSignals(
        normalized,
        sourceMap,
        confidence,
      );

    const availabilitySignal =
      this._buildAvailabilitySignal(
        sourceStates,
        confidence,
      );

    if (
      availabilitySignal
    ) {
      signals.push(
        availabilitySignal,
      );
    }

    signals =
      this._applySourceWeights(
        signals,
      );

    const clusterSignal =
      this._buildClusterSignal(
        signals,
        confidence,
      );

    if (
      clusterSignal
    ) {
      signals.push(
        clusterSignal,
      );
    }

    signals =
      signals
        .sort(
          (
            a,
            b,
          ) =>
            b.score -
              a.score ||
            severityRank(
              b.severity,
            ) -
              severityRank(
                a.severity,
              ) ||
            a.code.localeCompare(
              b.code,
            ),
        )
        .slice(
          0,
          this.config
            .maxIncidents,
        );

    const aggregate =
      aggregateStatus(
        signals,
        confidence,
      );

    const dataState =
      configuredSources.length ===
      0
        ? DATA_STATES.UNAVAILABLE
        : availableSources.length ===
          0
          ? DATA_STATES.UNAVAILABLE
          : unsafeSources.length >
              0 ||
              availableSources.length <
                configuredSources.length
            ? DATA_STATES.PARTIAL
            : signals.length ===
                0
              ? DATA_STATES.EMPTY
              : DATA_STATES.AVAILABLE;

    const requiredSourceFailure =
      [
        ...this.requiredSources,
      ].some(
        (
          name,
        ) =>
          !sourceMap[
            name
          ]?.configured ||
          !sourceMap[
            name
          ]?.available ||
          sourceMap[
            name
          ]?.unsafe,
      );

    const finalStatus =
      requiredSourceFailure &&
      this.config
        .failClosedOnRequiredSourceFailure
        ? PREDICTION_STATUS.INDETERMINATE
        : aggregate.status;

    const result = {
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

      predictionId,

      replay:
        false,

      scope:
        normalized.scope,

      tenantScope:
        normalized.tenantScope,

      tenantDigest:
        normalized.tenantId
          ? digest(
              normalized.tenantId,
            )
          : null,

      range:
        normalized.range,

      rangeMode:
        normalized.rangeMode,

      windowMinutes:
        normalized.windowMinutes,

      baselineWindows:
        normalized.baselineWindows,

      generatedAt:
        nowFrom(
          this.clock,
        ),

      startedAt,

      completedAt:
        nowFrom(
          this.clock,
        ),

      durationMs:
        null,

      status:
        finalStatus,

      severity:
        finalStatus ===
        PREDICTION_STATUS.INDETERMINATE
          ? SEVERITY.MEDIUM
          : aggregate.severity,

      predictedIncidentRiskScore:
        aggregate.score ===
        null
          ? null
          : Number(
              aggregate.score.toFixed(
                4,
              ),
            ),

      confidencePercent:
        confidence ===
        null
          ? null
          : Number(
              confidence.toFixed(
                4,
              ),
            ),

      confidenceBand:
        confidenceBand(
          confidence,
        ),

      dataState,

      earlyWarning: {
        active:
          finalStatus !==
          PREDICTION_STATUS.STABLE,

        operationalOnly:
          true,

        estimatedIncidentLikely:
          finalStatus !==
            PREDICTION_STATUS.STABLE &&
          finalStatus !==
            PREDICTION_STATUS.INDETERMINATE,

        executionAuthorization:
          false,

        paymentAction:
          false,

        settlementAction:
          false,

        approvalAction:
          false,
      },

      signals:
        normalized.includeEvidence
          ? signals
          : [],

      topSignal:
        normalized.includeEvidence
          ? signals[0] ??
            null
          : signals[0]
            ? {
                incidentType:
                  signals[0]
                    .incidentType,

                code:
                  signals[0]
                    .code,

                title:
                  signals[0]
                    .title,

                severity:
                  signals[0]
                    .severity,

                score:
                  signals[0]
                    .score,

                confidencePercent:
                  signals[0]
                    .confidencePercent,
              }
            : null,

      sourceSummary: {
        configured:
          configuredSources.length,

        available:
          availableSources.length,

        unavailable:
          configuredSources.length -
          availableSources.length,

        unsafe:
          unsafeSources.length,

        availabilityPercent:
          percent(
            availableSources.length,
            configuredSources.length,
          ),
      },

      limitations: {
        predictionIsDeterministicHeuristic:
          true,

        autonomousExecution:
          false,

        autonomousIncidentCreation:
          false,

        rawProviderPayloadsIncluded:
          false,

        rawCustomerIdentifiersIncluded:
          false,

        sourceDataMayBePartial:
          dataState ===
          DATA_STATES.PARTIAL,

        sourceDataUnavailable:
          dataState ===
          DATA_STATES.UNAVAILABLE,

        lowConfidenceWarning:
          confidence <
          this.config
            .minConfidencePercent,
      },

      safety: {
        readOnly:
          true,

        financialMutationPerformed:
          false,

        ledgerMutationPerformed:
          false,

        balanceMutationPerformed:
          false,

        providerCallPerformed:
          false,

        paymentExecutionPerformed:
          false,

        settlementPerformed:
          false,

        approvalGranted:
          false,

        executionAuthorized:
          false,

        arbitraryCodeExecutionPerformed:
          false,
      },

      metadata:
        normalized.metadata,

      requestFingerprint,
    };

    result.durationMs =
      Math.max(
        0,
        Date.parse(
          result.completedAt,
        ) -
          Date.parse(
            result.startedAt,
          ),
      );

    if (
      normalized.includeSources
    ) {
      result.sources =
        Object.fromEntries(
          sourceStates.map(
            (
              item,
            ) => [
              item.source,
              item,
            ],
          ),
        );
    }

    result.predictionFingerprint =
      buildSemanticFingerprint(
        redact(
          result,
        ),
      );

    const bytes =
      safeBytes(
        result,
      );

    if (
      bytes >
      this.config
        .maxPayloadBytes
    ) {
      throw new IncidentPredictorError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        `Incident prediction exceeds ${this.config.maxPayloadBytes} bytes.`,
        {
          bytes,

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

    let persisted =
      false;

    let persistenceError =
      null;

    if (
      this.config
        .persistPredictions &&
      typeof this.repository
        ?.savePrediction ===
        'function'
    ) {
      try {
        await this.repository.savePrediction(
          redact({
            ...result,

            idempotencyKey:
              normalized.idempotencyKey,
          }),
        );

        persisted =
          true;
      } catch (
        error
      ) {
        persistenceError =
          safeError(
            error,
          );

        this._log(
          'error',
          'Incident prediction persistence failed.',
          error,
          {
            predictionId,
          },
        );

        if (
          error?.code ===
          ERROR_CODES.IDEMPOTENCY_CONFLICT
        ) {
          throw error;
        }
      }
    }

    result.persistence = {
      attempted:
        Boolean(
          this.config
            .persistPredictions &&
            this.repository
              ?.savePrediction,
        ),

      persisted,

      error:
        persistenceError,
    };

    this._metric(
      'titech.airtel.incident_prediction.completed',
      {
        scope:
          normalized.scope,

        status:
          finalStatus,
      },
    );

    return deepFreeze(
      redact(
        result,
      ),
    );
  }

  async predictIncident(
    input = {},
  ) {
    return this.predict(
      input,
    );
  }

  async getPrediction(
    input = {},
  ) {
    return this.predict(
      input,
    );
  }

  async getOverview(
    input = {},
  ) {
    const result =
      await this.predict(
        input,
      );

    return deepFreeze({
      component:
        result.component,

      provider:
        result.provider,

      scope:
        result.scope,

      tenantScope:
        result.tenantScope,

      range:
        result.range,

      status:
        result.status,

      severity:
        result.severity,

      predictedIncidentRiskScore:
        result.predictedIncidentRiskScore,

      confidencePercent:
        result.confidencePercent,

      confidenceBand:
        result.confidenceBand,

      dataState:
        result.dataState,

      earlyWarning:
        result.earlyWarning,

      topSignal:
        result.topSignal,

      sourceSummary:
        result.sourceSummary,

      predictionFingerprint:
        result.predictionFingerprint,
    });
  }

  async getTopRisks(
    input = {},
  ) {
    const result =
      await this.predict({
        ...input,

        includeEvidence:
          true,

        includeSources:
          false,
      });

    return deepFreeze({
      provider:
        PROVIDER,

      tenantScope:
        result.tenantScope,

      range:
        result.range,

      status:
        result.status,

      risks:
        result.signals,

      predictionFingerprint:
        result.predictionFingerprint,
    });
  }

  async getSignals(
    input = {},
  ) {
    const result =
      await this.predict({
        ...input,

        includeEvidence:
          true,
      });

    return deepFreeze({
      provider:
        PROVIDER,

      tenantScope:
        result.tenantScope,

      range:
        result.range,

      signals:
        result.signals,

      confidencePercent:
        result.confidencePercent,

      dataState:
        result.dataState,

      predictionFingerprint:
        result.predictionFingerprint,
    });
  }

  async listPredictions({
    tenantId,
    scope = 'TENANT',
    limit =
      this.config
        .defaultHistoryLimit,
    offset = 0,
  } = {}) {
    const scopeInfo =
      normalizeScope(
        {
          tenantId,
          scope,
        },
        this.config,
      );

    const boundedLimit =
      integer(
        limit,
        this.config
          .defaultHistoryLimit,
        1,
        this.config
          .maxHistoryLimit,
      );

    const boundedOffset =
      integer(
        offset,
        0,
        0,
        Number.MAX_SAFE_INTEGER,
      );

    if (
      typeof this.repository
        ?.listPredictions !==
      'function'
    ) {
      return deepFreeze({
        scope:
          scopeInfo.scope,

        tenantScope:
          scopeInfo.tenantScope,

        dataState:
          DATA_STATES.UNAVAILABLE,

        records:
          [],

        limit:
          boundedLimit,

        offset:
          boundedOffset,
      });
    }

    const records =
      await this.repository.listPredictions(
        {
          tenantScope:
            scopeInfo.tenantScope,

          limit:
            boundedLimit,

          offset:
            boundedOffset,
        },
      );

    return deepFreeze({
      scope:
        scopeInfo.scope,

      tenantScope:
        scopeInfo.tenantScope,

      dataState:
        records.length
          ? DATA_STATES.AVAILABLE
          : DATA_STATES.EMPTY,

      records:
        records.map(
          (
            record,
          ) =>
            redact(
              record,
            ),
        ),

      limit:
        boundedLimit,

      offset:
        boundedOffset,
    });
  }

  async getStoredPrediction({
    tenantId,
    scope = 'TENANT',
    predictionId,
  } = {}) {
    const scopeInfo =
      normalizeScope(
        {
          tenantId,
          scope,
        },
        this.config,
      );

    const normalizedPredictionId =
      normalizeString(
        predictionId,
        240,
      );

    if (
      !normalizedPredictionId
    ) {
      throw new IncidentPredictorError(
        ERROR_CODES.INVALID_INPUT,
        'predictionId is required.',
      );
    }

    if (
      typeof this.repository
        ?.getPrediction !==
      'function'
    ) {
      return null;
    }

    const result =
      await this.repository.getPrediction(
        {
          tenantScope:
            scopeInfo.tenantScope,

          predictionId:
            normalizedPredictionId,
        },
      );

    return result
      ? deepFreeze(
          redact(
            result,
          ),
        )
      : null;
  }

  async exportPrediction(
    input = {},
  ) {
    const result =
      await this.predict({
        ...input,

        includeEvidence:
          true,

        includeSources:
          true,
      });

    const content =
      JSON.stringify(
        result,
        null,
        2,
      );

    const bytes =
      Buffer.byteLength(
        content,
        'utf8',
      );

    if (
      bytes >
      this.config
        .maxExportBytes
    ) {
      throw new IncidentPredictorError(
        ERROR_CODES.EXPORT_TOO_LARGE,
        `Incident prediction export exceeds ${this.config.maxExportBytes} bytes.`,
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

    return deepFreeze({
      contentType:
        'application/json',

      filename:
        `airtel-incident-prediction-${result.scope.toLowerCase()}-${result.status.toLowerCase()}.json`,

      bytes,

      fingerprint:
        `sha256:${sha256(
          content,
        )}`,

      content,
    });
  }

  async health() {
    const configured =
      Object.entries(
        this.sources,
      ).filter(
        (
          [
            ,
            source,
          ],
        ) =>
          Boolean(
            source,
          ),
      );

    const missingRequired =
      [
        ...this
          .requiredSources,
      ].filter(
        (
          name,
        ) =>
          !this.sources[
            name
          ],
      );

    let repository = {
      configured:
        Boolean(
          this.repository,
        ),

      available:
        !this.config
          .requireRepository,

      state:
        this.config
          .requireRepository
          ? HEALTH_STATES.UNAVAILABLE
          : HEALTH_STATES.HEALTHY,

      method:
        null,

      error:
        null,
    };

    if (
      this.repository
    ) {
      try {
        const method =
          typeof this.repository
            .healthCheck ===
          'function'
            ? 'healthCheck'
            : typeof this.repository.health ===
              'function'
              ? 'health'
              : null;

        if (
          method
        ) {
          const raw =
            await timeoutPromise(
              this.repository[
                method
              ](),
              this.config
                .defaultTimeoutMs,
            );

          repository = {
            configured:
              true,

            available:
              raw?.ok !==
              false,

            state:
              upper(
                raw?.state,
                40,
              ) ??
              HEALTH_STATES.HEALTHY,

            method,

            error:
              null,
          };
        } else {
          repository = {
            configured:
              true,

            available:
              true,

            state:
              'UNKNOWN',

            method:
              null,

            error:
              null,
          };
        }
      } catch (
        error
      ) {
        repository = {
          configured:
            true,

          available:
            false,

          state:
            HEALTH_STATES.UNAVAILABLE,

          method:
            null,

          error:
            safeError(
              error,
            ),
        };
      }
    }

    const state =
      missingRequired.length >
        0 ||
      (
        this.config
          .requireRepository &&
        !repository.available
      )
        ? HEALTH_STATES.UNAVAILABLE
        : configured.length <
            Object.keys(
              this.sources,
            ).length
          ? HEALTH_STATES.DEGRADED
          : HEALTH_STATES.HEALTHY;

    return deepFreeze(
      redact({
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
          state ===
          HEALTH_STATES.HEALTHY,

        degraded:
          state ===
          HEALTH_STATES.DEGRADED,

        unavailable:
          state ===
          HEALTH_STATES.UNAVAILABLE,

        configuredSources:
          configured.map(
            ([
              name,
            ]) =>
              name,
          ),

        missingRequiredSources:
          missingRequired,

        repository,

        readOnly:
          true,

        operationalEarlyWarningOnly:
          true,
      }),
    );
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

      tenantIsolation:
        true,

      deterministicPrediction:
        true,

      evidenceBased:
        true,

      boundedConcurrency:
        true,

      boundedTimeouts:
        true,

      repositoryPersistence:
        Boolean(
          this.repository,
        ),

      operationalEarlyWarningOnly:
        true,

      autonomousExecution:
        false,

      incidentCreation:
        false,

      paymentExecution:
        false,

      settlement:
        false,

      providerCalls:
        false,

      financialMutation:
        false,

      ledgerMutation:
        false,

      balanceMutation:
        false,

      approvalGrant:
        false,

      executionAuthorization:
        false,

      arbitraryCodeExecution:
        false,

      policyMutation:
        false,

      complianceMutation:
        false,

      alertMutation:
        false,

      modelMutation:
        false,

      internalScheduler:
        false,
    });
  }

  async close() {
    if (
      typeof this.repository?.close ===
      'function'
    ) {
      await this.repository.close();
    }
  }
}

function validateProviderScope(
  provider,
) {
  return (
    upper(
      provider,
      80,
    ) ===
    PROVIDER
  );
}

export function createIncidentPredictor(
  options = {},
) {
  return new IncidentPredictor(
    options,
  );
}

export const createAirtelIncidentPredictor =
  createIncidentPredictor;

export const AirtelIncidentPredictor =
  IncidentPredictor;

export const constants =
  Object.freeze({
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    PROVIDER,
    SCHEMA_VERSION,
    HASH_ALGORITHM,
    INCIDENT_TYPES,
    PREDICTION_STATUS,
    CONFIDENCE_BANDS,
    TREND_DIRECTIONS,
    DATA_STATES,
    HEALTH_STATES,
    SEVERITY,
    ERROR_CODES,
  });

export function buildIncidentPredictionFingerprint(
  value,
) {
  return buildSemanticFingerprint(
    value,
  );
}

export default IncidentPredictor;