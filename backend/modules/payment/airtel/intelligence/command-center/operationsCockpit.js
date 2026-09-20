/**
 * TITech Community Capital
 * File: backend/modules/payment/airtel/intelligence/command-center/operationsCockpit.js
 *
 * Architectural role
 * ------------------
 * Enterprise operational command-center read model for Airtel payment intelligence.
 * Composes bounded governance, executive-risk, incident-prediction, alerting,
 * compliance, diagnostic and provider-operational signals into a tenant-scoped
 * operations cockpit.
 *
 * Important boundaries / non-responsibilities
 * --------------------------------------------
 * - NOT the financial source of truth, ledger, balance service, reconciliation
 *   service, payment executor or settlement service.
 * - NOT an Airtel provider adapter and never owns provider credentials.
 * - NOT a risk, fraud, AML, KYC, sanctions, policy, prediction or model-training engine.
 * - NOT an incident-management state machine. It does not create, resolve, close,
 *   acknowledge or escalate incidents.
 * - NOT an approval/maker-checker state machine and never grants approval.
 * - NOT a notification transport and never sends notifications itself.
 * - NOT a workflow executor and never performs operational actions derived from the cockpit.
 * - NOT a scheduler, queue worker or event consumer.
 * - NOT a raw analytics warehouse or source-of-truth operational datastore.
 * - It consumes other bounded read models and presents an integrated operational view.
 *
 * Production principles
 * ---------------------
 * - Airtel provider scope is fail-closed.
 * - Tenant scope is explicit and never leaks raw tenant identifiers.
 * - Sources are allow-listed, bounded and timeout protected.
 * - Missing data is visible as partial/unavailable rather than invented zeros.
 * - Scores shown here are operational posture indicators, not credit decisions.
 * - Incident predictions remain predictions; this module never converts them into actions.
 * - Sensitive values and direct identifiers are redacted or digested.
 * - Source failures reduce cockpit confidence and remain visible.
 * - Snapshot fingerprints exclude generated timestamps and runtime-only identifiers.
 * - History persistence is injected and tenant scoped.
 * - Results are deeply frozen after normalization/redaction.
 * - No internal scheduler is created.
 *
 * Module format
 * -------------
 * - Native ECMAScript module (ESM).
 * - Node.js built-ins only.
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME =
  'airtel-command-center-operations-cockpit';

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

export const COCKPIT_STATUS = Object.freeze({
  OPERATIONAL: 'OPERATIONAL',
  DEGRADED: 'DEGRADED',
  INCIDENT_RISK: 'INCIDENT_RISK',
  UNAVAILABLE: 'UNAVAILABLE',
  INDETERMINATE: 'INDETERMINATE',
});

export const DATA_STATES = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  PARTIAL: 'PARTIAL',
  EMPTY: 'EMPTY',
  UNAVAILABLE: 'UNAVAILABLE',
  TRUNCATED: 'TRUNCATED',
});

export const OPERATING_BANDS = Object.freeze({
  NORMAL: 'NORMAL',
  WATCH: 'WATCH',
  ELEVATED: 'ELEVATED',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
  UNKNOWN: 'UNKNOWN',
});

export const SEVERITY = Object.freeze({
  INFO: 'INFO',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const OPERATIONAL_AREAS = Object.freeze({
  PAYMENTS: 'PAYMENTS',
  PROVIDER: 'PROVIDER',
  GOVERNANCE: 'GOVERNANCE',
  COMPLIANCE: 'COMPLIANCE',
  INCIDENTS: 'INCIDENTS',
  MODEL_RISK: 'MODEL_RISK',
  OBSERVABILITY: 'OBSERVABILITY',
  NOTIFICATIONS: 'NOTIFICATIONS',
});

export const ACTION_INTENTS = Object.freeze({
  OBSERVE: 'OBSERVE',
  REVIEW: 'REVIEW',
  INVESTIGATE: 'INVESTIGATE',
  ESCALATE: 'ESCALATE',
});

export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'OPERATIONS_COCKPIT_INVALID_INPUT',
  TENANT_REQUIRED: 'OPERATIONS_COCKPIT_TENANT_REQUIRED',
  SYSTEM_SCOPE_FORBIDDEN: 'OPERATIONS_COCKPIT_SYSTEM_SCOPE_FORBIDDEN',
  PROVIDER_SCOPE_VIOLATION: 'OPERATIONS_COCKPIT_PROVIDER_SCOPE_VIOLATION',
  RANGE_INVALID: 'OPERATIONS_COCKPIT_RANGE_INVALID',
  RANGE_TOO_LARGE: 'OPERATIONS_COCKPIT_RANGE_TOO_LARGE',
  SOURCE_PROTOCOL_ERROR: 'OPERATIONS_COCKPIT_SOURCE_PROTOCOL_ERROR',
  SOURCE_UNAVAILABLE: 'OPERATIONS_COCKPIT_SOURCE_UNAVAILABLE',
  SOURCE_UNSAFE: 'OPERATIONS_COCKPIT_SOURCE_UNSAFE',
  TIMEOUT: 'OPERATIONS_COCKPIT_TIMEOUT',
  PAYLOAD_TOO_LARGE: 'OPERATIONS_COCKPIT_PAYLOAD_TOO_LARGE',
  EXPORT_TOO_LARGE: 'OPERATIONS_COCKPIT_EXPORT_TOO_LARGE',
  REPOSITORY_REQUIRED: 'OPERATIONS_COCKPIT_REPOSITORY_REQUIRED',
  PERSISTENCE_FAILED: 'OPERATIONS_COCKPIT_PERSISTENCE_FAILED',
  IDEMPOTENCY_CONFLICT: 'OPERATIONS_COCKPIT_IDEMPOTENCY_CONFLICT',
});

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER,
  tenantRequired: true,
  allowSystemScope: true,
  maxTenantIdLength: 160,
  defaultWindowMinutes: 60,
  maxWindowMinutes: 10080,
  defaultTimeoutMs: 5000,
  maxTimeoutMs: 30000,
  maxConcurrency: 8,
  maxSourceRecords: 5000,
  maxTopSignals: 25,
  maxTopIncidents: 25,
  maxEvidenceItems: 100,
  maxPayloadBytes: 768 * 1024,
  maxExportBytes: 4 * 1024 * 1024,
  defaultHistoryLimit: 20,
  maxHistoryLimit: 100,
  persistSnapshots: true,
  requireRepository: false,
  failClosedOnUnsafeSource: true,
  failClosedOnRequiredSourceFailure: true,
  requiredSources: Object.freeze([
    'dashboardAggregator',
    'governanceDashboard',
  ]),
  thresholds: Object.freeze({
    failureRateWatch: 5,
    failureRateHigh: 10,
    failureRateCritical: 20,
    latencyDeltaWatch: 20,
    latencyDeltaHigh: 50,
    latencyDeltaCritical: 100,
    sourceAvailabilityWatch: 95,
    sourceAvailabilityHigh: 80,
    sourceAvailabilityCritical: 60,
    activeIncidentWatch: 1,
    activeIncidentHigh: 3,
    activeIncidentCritical: 5,
    criticalAlertWatch: 1,
    criticalAlertHigh: 3,
    criticalAlertCritical: 5,
  }),
});

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
  /tenant.?id/i,
  /user.?id/i,
  /actor.?id/i,
  /recipient/i,
]);

const FORBIDDEN_SAFETY_KEYS = Object.freeze([
  'financialMutationPerformed',
  'ledgerMutationPerformed',
  'balanceMutationPerformed',
  'providerCallPerformed',
  'paymentExecutionPerformed',
  'settlementPerformed',
  'approvalGranted',
  'executionAuthorized',
  'arbitraryCodeExecutionPerformed',
]);

const SOURCE_METHODS = Object.freeze({
  dashboardAggregator: Object.freeze([
    'getRisk',
    'getOverview',
    'getSummary',
    'getOperations',
    'health',
    'readiness',
  ]),
  executiveRiskCenter: Object.freeze([
    'getRisk',
    'getOverview',
    'health',
    'readiness',
  ]),
  incidentPredictor: Object.freeze([
    'predictIncident',
    'predict',
    'getOverview',
    'getSignals',
    'health',
    'readiness',
  ]),
  alertManager: Object.freeze([
    'summary',
    'getSummary',
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
  governanceDashboard: Object.freeze([
    'getOverview',
    'getSnapshot',
    'getDashboardSummary',
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
  notificationGateway: Object.freeze([
    'health',
    'readiness',
  ]),
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;

  const prototype = Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function assertPlainObject(
  value,
  label = 'value',
) {
  if (!isPlainObject(value)) {
    throw new OperationsCockpitError(
      ERROR_CODES.INVALID_INPUT,
      `${label} must be a plain object.`,
    );
  }
}

function normalizeString(
  value,
  maxLength = 200,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return undefined;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function upper(
  value,
  maxLength = 80,
) {
  const normalized =
    normalizeString(
      value,
      maxLength,
    );

  return normalized
    ? normalized.toUpperCase()
    : undefined;
}

function numberOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
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
    value === undefined ||
    value === null ||
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

function nowFrom(clock) {
  return iso(
    typeof clock === 'function'
      ? clock()
      : new Date(),
    new Date().toISOString(),
  );
}

function digest(value) {
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
    typeof value === 'number'
  ) {
    if (
      Number.isNaN(value)
    ) {
      return '[NaN]';
    }

    if (
      !Number.isFinite(value)
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
    typeof value === 'bigint'
  ) {
    return `${value}n`;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'boolean'
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
    Buffer.isBuffer(value)
  ) {
    return `buffer:${digest(
      value.toString(
        'base64',
      ),
    )}`;
  }

  if (
    Array.isArray(value)
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
    seen.has(value)
  ) {
    return '[Circular]';
  }

  seen.add(value);

  const output = {};

  for (
    const key of
    Object.keys(value).sort()
  ) {
    output[key] =
      stableNormalize(
        value[key],
        seen,
      );
  }

  seen.delete(value);

  return output;
}

function stableStringify(value) {
  return JSON.stringify(
    stableNormalize(
      value,
    ),
  );
}

function sha256(value) {
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

  seen.add(value);

  for (
    const key of
    Reflect.ownKeys(value)
  ) {
    deepFreeze(
      value[key],
      seen,
    );
  }

  return Object.freeze(value);
}

function safeBytes(value) {
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
    4000;

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
    Array.isArray(value)
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
      SENSITIVE_KEY_PATTERNS.some(
        (pattern) =>
          pattern.test(key),
      )
    ) {
      output[key] =
        '[REDACTED]';

      continue;
    }

    if (
      IDENTIFIER_KEY_PATTERNS.some(
        (pattern) =>
          pattern.test(key),
      )
    ) {
      const identifier =
        normalizeString(
          value[key],
          800,
        );

      output[key] =
        identifier
          ? digest(identifier)
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
    Object.keys(value).length >
    keys.length
  ) {
    output.__truncatedKeys =
      Object.keys(value).length -
      keys.length;
  }

  seen.delete(value);

  return output;
}

function safeError(error) {
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

function validateProvider(
  provider,
  expected = PROVIDER,
) {
  return (
    upper(
      provider,
      80,
    ) ===
    upper(
      expected,
      80,
    )
  );
}

function clamp(
  value,
  min = 0,
  max = 100,
) {
  const number =
    numberOrNull(value);

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

function safePercent(
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

function resolveRange(
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
            (input.windowMinutes
              ? integer(
                  input.windowMinutes,
                  config
                    .defaultWindowMinutes,
                  1,
                  config
                    .maxWindowMinutes,
                )
              : config
                  .defaultWindowMinutes) *
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
    throw new OperationsCockpitError(
      ERROR_CODES.RANGE_INVALID,
      'startAt/endAt must be valid dates.',
    );
  }

  if (
    start >= end
  ) {
    throw new OperationsCockpitError(
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
    throw new OperationsCockpitError(
      ERROR_CODES.RANGE_TOO_LARGE,
      `Operations range cannot exceed ${config.maxWindowMinutes} minutes.`,
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
      throw new OperationsCockpitError(
        ERROR_CODES.SYSTEM_SCOPE_FORBIDDEN,
        'System operations-cockpit scope is disabled.',
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
    throw new OperationsCockpitError(
      ERROR_CODES.TENANT_REQUIRED,
      'tenantId is required for tenant-scoped operations cockpit.',
      {},
      {
        httpStatus:
          400,
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
    promiseOrValue &&
    typeof promiseOrValue.then ===
      'function'
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
              new OperationsCockpitError(
                ERROR_CODES.TIMEOUT,
                `Operations cockpit source call timed out after ${timeoutMs} ms.`,
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

function normalizeIncidentRecord(
  record,
  source,
) {
  if (
    !isPlainObject(
      record,
    )
  ) {
    return null;
  }

  const score =
    clamp(
      record.score ??
        record.riskScore ??
        record.predictedIncidentRiskScore,
      0,
      100,
    );

  return {
    incidentType:
      upper(
        record.incidentType ??
          record.type ??
          'UNKNOWN',
        100,
      ) ??
      'UNKNOWN',

    code:
      normalizeString(
        record.code ??
          record.reasonCode,
        160,
      ) ??
      'UNSPECIFIED',

    title:
      normalizeString(
        record.title ??
          record.name ??
          'Operational incident signal',
        240,
      ) ??
      'Operational incident signal',

    severity:
      normalizeSeverity(
        record.severity ??
          record.status,
      ),

    score:
      score ??
      0,

    confidencePercent:
      clamp(
        record.confidencePercent ??
          record.confidence,
        0,
        100,
      ),

    timestamp:
      iso(
        record.timestamp ??
          record.createdAt ??
          record.generatedAt ??
          record.updatedAt,
        null,
      ),

    source,

    evidence:
      redact(
        record.evidence ??
          record.details ??
          {},
      ),
  };
}

function normalizeSeverity(
  value,
) {
  const normalized =
    upper(
      value,
      30,
    );

  return Object.values(
    SEVERITY,
  ).includes(
    normalized,
  )
    ? normalized
    : SEVERITY.INFO;
}

function statusBand(
  score,
) {
  if (
    !Number.isFinite(
      score,
    )
  ) {
    return OPERATING_BANDS.UNKNOWN;
  }

  if (
    score < 20
  ) {
    return OPERATING_BANDS.NORMAL;
  }

  if (
    score < 40
  ) {
    return OPERATING_BANDS.WATCH;
  }

  if (
    score < 60
  ) {
    return OPERATING_BANDS.ELEVATED;
  }

  if (
    score < 80
  ) {
    return OPERATING_BANDS.HIGH;
  }

  return OPERATING_BANDS.CRITICAL;
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
    normalizeSeverity(
      value,
    ),
  );
}

function buildSemanticFingerprint(
  value,
) {
  const strip =
    (
      current,
      key = null,
    ) => {
      if (
        [
          'generatedAt',
          'startedAt',
          'completedAt',
          'durationMs',
          'runId',
          'snapshotId',
          'replay',
          'persistence',
          'operationsFingerprint',
        ].includes(
          key,
        )
      ) {
        return undefined;
      }

      if (
        Array.isArray(
          current,
        )
      ) {
        return current
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
          current,
        )
      ) {
        const output =
          {};

        for (
          const childKey of
          Object.keys(
            current,
          ).sort()
        ) {
          const child =
            strip(
              current[
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

      return current;
    };

  return `sha256:${sha256(
    strip(
      value,
    ),
  )}`;
}

export class OperationsCockpitError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message);

    this.name =
      'OperationsCockpitError';

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

export class InMemoryOperationsCockpitRepository {
  constructor(
    seed = {},
  ) {
    this.snapshots =
      Array.isArray(
        seed.snapshots,
      )
        ? seed.snapshots.map(
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
      throw new OperationsCockpitError(
        ERROR_CODES.PERSISTENCE_FAILED,
        'Operations cockpit repository is closed.',
      );
    }
  }

  async findByIdempotencyKey({
    tenantScope,
    idempotencyKey,
  } = {}) {
    this._assertOpen();

    return (
      this.snapshots.find(
        (
          item,
        ) =>
          item.tenantScope ===
            tenantScope &&
          item.idempotencyKey ===
            idempotencyKey,
      ) ??
      null
    );
  }

  async saveSnapshot(
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
          throw new OperationsCockpitError(
            ERROR_CODES.IDEMPOTENCY_CONFLICT,
            'Operations-cockpit idempotency key maps to a different request.',
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

    this.snapshots.push(
      normalized,
    );

    return {
      record:
        normalized,

      replay:
        false,
    };
  }

  async getSnapshot({
    tenantScope,
    snapshotId,
  } = {}) {
    this._assertOpen();

    return (
      this.snapshots.find(
        (
          item,
        ) =>
          item.tenantScope ===
            tenantScope &&
          item.snapshotId ===
            snapshotId,
      ) ??
      null
    );
  }

  async listSnapshots({
    tenantScope,
    limit = 20,
    offset = 0,
  } = {}) {
    this._assertOpen();

    return this.snapshots
      .filter(
        (
          item,
        ) =>
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
        offset +
          limit,
      );
  }

  async healthCheck() {
    return {
      ok:
        !this.closed,

      state:
        this.closed
          ? 'UNAVAILABLE'
          : 'HEALTHY',

      count:
        this.snapshots.length,
    };
  }

  async close() {
    this.closed =
      true;
  }
}

export class OperationsCockpit {
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

        ...(isPlainObject(
          options.config,
        )
          ? options.config
          : {}),

        thresholds: {
          ...DEFAULT_CONFIG
            .thresholds,

          ...(isPlainObject(
            options.config
              ?.thresholds,
          )
            ? options.config
                .thresholds
            : {}),
        },
      });

    if (
      !validateProvider(
        this.config.provider,
      )
    ) {
      throw new OperationsCockpitError(
        ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        `Operations cockpit supports provider ${PROVIDER} only.`,
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
      options.operationsCockpitRepository ??
      null;

    if (
      !this.repository &&
      this.config
        .requireRepository
    ) {
      throw new OperationsCockpitError(
        ERROR_CODES.REPOSITORY_REQUIRED,
        'A durable operations-cockpit repository must be injected in production.',
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
        : () =>
          new Date();

    this.snapshotIdFactory =
      typeof options.snapshotIdFactory ===
      'function'
        ? options.snapshotIdFactory
        : () =>
          `operations-cockpit-${Date.now()}-${sha256(
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

        executiveRiskCenter:
          options.executiveRiskCenter ??
          null,

        incidentPredictor:
          options.incidentPredictor ??
          null,

        alertManager:
          options.alertManager ??
          null,

        complianceCenter:
          options.complianceCenter ??
          null,

        governanceDashboard:
          options.governanceDashboard ??
          null,

        modelDriftMonitor:
          options.modelDriftMonitor ??
          null,

        diagnosticsService:
          options.diagnosticsService ??
          null,

        notificationGateway:
          options.notificationGateway ??
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
          : this.config
              .requiredSources,
      );

    this._validateSources();
  }

  _validateSources() {
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
        throw new OperationsCockpitError(
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
      ] === 'function'
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
        /* logging must never alter operational behavior */
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
        'Operations-cockpit metric emission failed.',
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
      !validateProvider(
        provider,
      )
    ) {
      throw new OperationsCockpitError(
        ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        `Operations cockpit supports provider ${PROVIDER} only.`,
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
      resolveRange(
        input,
        this.config,
      );

    return {
      ...scope,

      provider:
        PROVIDER,

      range,

      timeoutMs:
        integer(
          input.timeoutMs,
          this.config
            .defaultTimeoutMs,
          1,
          this.config
            .maxTimeoutMs,
        ),

      mode:
        upper(
          input.mode ??
            'EXECUTIVE_OPERATIONS',
          60,
        ) ??
        'EXECUTIVE_OPERATIONS',

      includeEvidence:
        input.includeEvidence !==
        false,

      includeSources:
        input.includeSources !==
        false,

      includeRecommendations:
        input.includeRecommendations !==
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
    preferredMethods = [],
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
      preferredMethods
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

        unsafeFlags:
          [
            'missing-read-only-method',
          ],

        error:
          safeError(
            new OperationsCockpitError(
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

        limit:
          this.config
            .maxSourceRecords,
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

      const safety =
        raw?.safety ??
        raw;

      const unsafeFlags =
        FORBIDDEN_SAFETY_KEYS.filter(
          (
            key,
          ) =>
            safety?.[
              key
            ] === true,
        );

      const reportedProvider =
        upper(
          raw?.provider,
          80,
        );

      if (
        reportedProvider &&
        !validateProvider(
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

        data:
          isPlainObject(
            raw,
          ) ||
          Array.isArray(
            raw,
          )
            ? redact(
                raw,
              )
            : null,

        unsafe,

        unsafeFlags,

        error:
          unsafe &&
          this.config
            .failClosedOnUnsafeSource
            ? safeError(
                new OperationsCockpitError(
                  ERROR_CODES.SOURCE_UNSAFE,
                  `${sourceName} reported operations outside the cockpit read-only boundary.`,
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
          'getOperations',
          'getRisk',
          'getOverview',
          'getSummary',
          'health',
        ],
      ],

      [
        'executiveRiskCenter',
        [
          'getRisk',
          'getOverview',
          'health',
        ],
      ],

      [
        'incidentPredictor',
        [
          'getOverview',
          'predictIncident',
          'predict',
          'getSignals',
          'health',
        ],
      ],

      [
        'alertManager',
        [
          'summary',
          'getSummary',
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
        'governanceDashboard',
        [
          'getOverview',
          'getDashboardSummary',
          'getSnapshot',
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
          'health',
          'readiness',
          'diagnose',
          'getDiagnostics',
        ],
      ],

      [
        'notificationGateway',
        [
          'health',
          'readiness',
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
    name,
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
        : firstNumber(
            data,
            [
              'summary.total',
              'summary.totalDecisions',
              'summary.active',
              'total',
              'count',
              'counts.total',
            ],
            0,
          );

    const partial =
      Boolean(
        source?.error ||
          source?.unsafe ||
          data?.dataState ===
            DATA_STATES.PARTIAL ||
          data?.dataState ===
            DATA_STATES.TRUNCATED,
      );

    return {
      source:
        name,

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

      count,

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
    };
  }

  _extractOperationalMetrics(
    sourceMap,
  ) {
    const dashboard =
      sourceMap
        .dashboardAggregator
        ?.data ??
      {};

    const risk =
      sourceMap
        .executiveRiskCenter
        ?.data ??
      {};

    const incident =
      sourceMap
        .incidentPredictor
        ?.data ??
      {};

    const alerts =
      sourceMap
        .alertManager
        ?.data ??
      {};

    const compliance =
      sourceMap
        .complianceCenter
        ?.data ??
      {};

    const governance =
      sourceMap
        .governanceDashboard
        ?.data ??
      {};

    const model =
      sourceMap
        .modelDriftMonitor
        ?.data ??
      {};

    const diagnostics =
      sourceMap
        .diagnosticsService
        ?.data ??
      {};

    const notification =
      sourceMap
        .notificationGateway
        ?.data ??
      {};

    const totalTransactions =
      firstNumber(
        dashboard,
        [
          'operations.totalTransactions',
          'summary.totalTransactions',
          'metrics.totalTransactions',
        ],
        null,
      );

    const failedTransactions =
      firstNumber(
        dashboard,
        [
          'operations.failedTransactions',
          'summary.failedTransactions',
          'metrics.failedTransactions',
        ],
        null,
      );

    const failureRate =
      firstNumber(
        dashboard,
        [
          'operations.failureRate',
          'summary.failureRate',
          'metrics.failureRate',
        ],
        totalTransactions !==
            null &&
          failedTransactions !==
            null
          ? safePercent(
              failedTransactions,
              totalTransactions,
            )
          : null,
      );

    const averageLatencyMs =
      firstNumber(
        dashboard,
        [
          'operations.averageLatencyMs',
          'summary.averageLatencyMs',
          'metrics.averageLatencyMs',
        ],
        null,
      );

    const baselineLatencyMs =
      firstNumber(
        dashboard,
        [
          'operations.baselineLatencyMs',
          'summary.baselineLatencyMs',
        ],
        null,
      );

    const latencyDeltaPercent =
      averageLatencyMs !==
          null &&
        baselineLatencyMs !==
          null &&
        baselineLatencyMs > 0
        ? Number(
            (
              (
                (
                  averageLatencyMs -
                  baselineLatencyMs
                ) /
                baselineLatencyMs
              ) *
              100
            ).toFixed(4),
          )
        : null;

    const predictedIncidentRiskScore =
      firstNumber(
        incident,
        [
          'predictedIncidentRiskScore',
          'posture.score',
          'score',
        ],
        firstNumber(
          risk,
          [
            'posture.score',
            'predictedIncidentRiskScore',
            'score',
          ],
          null,
        ),
      );

    const activeIncidentCount =
      firstNumber(
        incident,
        [
          'activeIncidentCount',
          'activeIncidents',
          'counts.activeIncidents',
        ],
        null,
      ) ??
      firstArray(
        incident,
        [
          'signals',
          'incidents',
        ],
      ).filter(
        (
          item,
        ) =>
          Number(
            item?.score ??
              item?.riskScore ??
              0,
          ) >= 40,
      ).length;

    const criticalAlerts =
      firstNumber(
        alerts,
        [
          'critical',
          'summary.critical',
          'counts.critical',
          'activeCritical',
        ],
        0,
      );

    const activeAlerts =
      firstNumber(
        alerts,
        [
          'active',
          'activeAlerts',
          'summary.active',
          'counts.active',
        ],
        null,
      );

    const complianceBacklog =
      firstNumber(
        compliance,
        [
          'activeCases',
          'summary.activeCases',
          'summary.openCases',
          'counts.active',
        ],
        null,
      );

    const complianceEscalations =
      firstNumber(
        compliance,
        [
          'escalatedCases',
          'summary.escalatedCases',
          'counts.escalated',
        ],
        0,
      );

    const governanceBlocks =
      firstNumber(
        governance,
        [
          'summary.blockedDecisions',
          'blockedDecisions',
          'counts.blocked',
        ],
        0,
      );

    const governanceDecisions =
      firstNumber(
        governance,
        [
          'summary.totalDecisions',
          'totalDecisions',
          'counts.total',
        ],
        null,
      );

    const governanceBlockRate =
      governanceDecisions !==
        null
        ? safePercent(
            governanceBlocks,
            governanceDecisions,
          )
        : null;

    const modelRiskFindings =
      firstNumber(
        model,
        [
          'summary.total',
          'total',
          'counts.total',
        ],
        firstNumber(
          model,
          [
            'critical',
            'significant',
            'elevated',
            'indeterminate',
          ],
          null,
        ),
      );

    const diagnosticFailures =
      firstNumber(
        diagnostics,
        [
          'counts.fail',
          'summary.fail',
          'fail',
        ],
        0,
      );

    const notificationState =
      upper(
        notification?.state,
        40,
      ) ??
      null;

    return {
      totalTransactions,

      failedTransactions,

      failureRate,

      averageLatencyMs,

      baselineLatencyMs,

      latencyDeltaPercent,

      predictedIncidentRiskScore,

      activeIncidentCount,

      criticalAlerts,

      activeAlerts,

      complianceBacklog,

      complianceEscalations,

      governanceBlocks,

      governanceDecisions,

      governanceBlockRate,

      modelRiskFindings,

      diagnosticFailures,

      notificationState,
    };
  }

  _buildOperationalSignals(
    metrics,
    sourceStates,
  ) {
    const signals =
      [];

    const thresholds =
      this.config
        .thresholds;

    if (
      metrics.failureRate !==
        null &&
      metrics.failureRate >=
        thresholds.failureRateWatch
    ) {
      const score =
        metrics.failureRate >=
          thresholds.failureRateCritical
          ? 95
          : metrics.failureRate >=
              thresholds.failureRateHigh
            ? 75
            : 45;

      signals.push({
        area:
          OPERATIONAL_AREAS.PAYMENTS,

        code:
          'PAYMENT_FAILURE_RATE',

        title:
          'Payment failure rate is elevated',

        severity:
          score >= 90
            ? SEVERITY.CRITICAL
            : score >= 70
              ? SEVERITY.HIGH
              : SEVERITY.MEDIUM,

        score,

        evidence: {
          failureRate:
            metrics.failureRate,

          failedTransactions:
            metrics.failedTransactions,

          totalTransactions:
            metrics.totalTransactions,
        },
      });
    }

    if (
      metrics.latencyDeltaPercent !==
        null &&
      metrics.latencyDeltaPercent >=
        thresholds.latencyDeltaWatch
    ) {
      const score =
        metrics.latencyDeltaPercent >=
          thresholds.latencyDeltaCritical
          ? 95
          : metrics.latencyDeltaPercent >=
              thresholds.latencyDeltaHigh
            ? 75
            : 45;

      signals.push({
        area:
          OPERATIONAL_AREAS.PAYMENTS,

        code:
          'TRANSACTION_LATENCY',

        title:
          'Transaction latency is elevated',

        severity:
          score >= 90
            ? SEVERITY.CRITICAL
            : score >= 70
              ? SEVERITY.HIGH
              : SEVERITY.MEDIUM,

        score,

        evidence: {
          averageLatencyMs:
            metrics.averageLatencyMs,

          baselineLatencyMs:
            metrics.baselineLatencyMs,

          latencyDeltaPercent:
            metrics.latencyDeltaPercent,
        },
      });
    }

    if (
      metrics.activeIncidentCount !==
        null &&
      metrics.activeIncidentCount >=
        thresholds.activeIncidentWatch
    ) {
      const score =
        metrics.activeIncidentCount >=
          thresholds.activeIncidentCritical
          ? 95
          : metrics.activeIncidentCount >=
              thresholds.activeIncidentHigh
            ? 75
            : 45;

      signals.push({
        area:
          OPERATIONAL_AREAS.INCIDENTS,

        code:
          'ACTIVE_INCIDENT_RISK',

        title:
          'Predicted or active incident signals are elevated',

        severity:
          score >= 90
            ? SEVERITY.CRITICAL
            : score >= 70
              ? SEVERITY.HIGH
              : SEVERITY.MEDIUM,

        score,

        evidence: {
          activeIncidentCount:
            metrics.activeIncidentCount,

          predictedIncidentRiskScore:
            metrics.predictedIncidentRiskScore,
        },
      });
    }

    if (
      metrics.criticalAlerts >=
      thresholds.criticalAlertWatch
    ) {
      const score =
        metrics.criticalAlerts >=
          thresholds.criticalAlertCritical
          ? 95
          : metrics.criticalAlerts >=
              thresholds.criticalAlertHigh
            ? 75
            : 45;

      signals.push({
        area:
          OPERATIONAL_AREAS.OBSERVABILITY,

        code:
          'CRITICAL_ALERTS',

        title:
          'Critical operational alerts are active',

        severity:
          score >= 90
            ? SEVERITY.CRITICAL
            : score >= 70
              ? SEVERITY.HIGH
              : SEVERITY.MEDIUM,

        score,

        evidence: {
          criticalAlerts:
            metrics.criticalAlerts,

          activeAlerts:
            metrics.activeAlerts,
        },
      });
    }

    if (
      metrics.complianceBacklog !==
        null &&
      metrics.complianceBacklog > 0
    ) {
      const score =
        Math.min(
          90,
          25 +
            metrics
              .complianceBacklog *
              3 +
            metrics
              .complianceEscalations *
              5,
        );

      signals.push({
        area:
          OPERATIONAL_AREAS.COMPLIANCE,

        code:
          'COMPLIANCE_BACKLOG',

        title:
          'Compliance workload requires operational attention',

        severity:
          score >= 80
            ? SEVERITY.HIGH
            : score >= 50
              ? SEVERITY.MEDIUM
              : SEVERITY.LOW,

        score,

        evidence: {
          complianceBacklog:
            metrics
              .complianceBacklog,

          complianceEscalations:
            metrics
              .complianceEscalations,
        },
      });
    }

    if (
      metrics.governanceBlockRate !==
        null &&
      metrics.governanceBlockRate >=
        5
    ) {
      const score =
        metrics
          .governanceBlockRate >=
          20
          ? 90
          : metrics
                .governanceBlockRate >=
              10
            ? 70
            : 45;

      signals.push({
        area:
          OPERATIONAL_AREAS.GOVERNANCE,

        code:
          'GOVERNANCE_BLOCK_RATE',

        title:
          'Governance block activity is elevated',

        severity:
          score >= 80
            ? SEVERITY.HIGH
            : SEVERITY.MEDIUM,

        score,

        evidence: {
          governanceBlockRate:
            metrics
              .governanceBlockRate,

          governanceBlocks:
            metrics.governanceBlocks,

          governanceDecisions:
            metrics.governanceDecisions,
        },
      });
    }

    if (
      metrics.modelRiskFindings !==
        null &&
      metrics.modelRiskFindings > 0
    ) {
      const score =
        Math.min(
          90,
          30 +
            metrics.modelRiskFindings *
              8,
        );

      signals.push({
        area:
          OPERATIONAL_AREAS.MODEL_RISK,

        code:
          'MODEL_RISK_FINDINGS',

        title:
          'Model-risk findings require review',

        severity:
          score >= 80
            ? SEVERITY.HIGH
            : score >= 50
              ? SEVERITY.MEDIUM
              : SEVERITY.LOW,

        score,

        evidence: {
          modelRiskFindings:
            metrics.modelRiskFindings,
        },
      });
    }

    if (
      metrics.diagnosticFailures >
      0
    ) {
      const score =
        Math.min(
          95,
          50 +
            metrics.diagnosticFailures *
              10,
        );

      signals.push({
        area:
          OPERATIONAL_AREAS.OBSERVABILITY,

        code:
          'DIAGNOSTIC_FAILURES',

        title:
          'Operational diagnostic failures are present',

        severity:
          score >= 80
            ? SEVERITY.HIGH
            : SEVERITY.MEDIUM,

        score,

        evidence: {
          diagnosticFailures:
            metrics
              .diagnosticFailures,
        },
      });
    }

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

    const availability =
      safePercent(
        availableSources.length,
        configuredSources.length,
      );

    if (
      availability !==
        null &&
      availability <
        thresholds.sourceAvailabilityWatch
    ) {
      const score =
        availability <
          thresholds.sourceAvailabilityCritical
          ? 95
          : availability <
              thresholds.sourceAvailabilityHigh
            ? 75
            : 45;

      signals.push({
        area:
          OPERATIONAL_AREAS.OBSERVABILITY,

        code:
          'SOURCE_AVAILABILITY',

        title:
          'Command-center source availability is degraded',

        severity:
          score >= 90
            ? SEVERITY.CRITICAL
            : score >= 70
              ? SEVERITY.HIGH
              : SEVERITY.MEDIUM,

        score,

        evidence: {
          configuredSources:
            configuredSources.length,

          availableSources:
            availableSources.length,

          availabilityPercent:
            availability,
        },
      });
    }

    return signals
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
          .maxTopSignals,
      )
      .map(
        (
          signal,
        ) => ({
          ...signal,

          evidence:
            redact(
              signal.evidence,
            ),
        }),
      );
  }

  _buildRecommendations(
    signals,
    sourceStates,
  ) {
    const recommendations =
      [];

    for (
      const signal of
      signals.slice(
        0,
        this.config
          .maxTopSignals,
      )
    ) {
      const intent =
        signal.severity ===
          SEVERITY.CRITICAL
          ? ACTION_INTENTS.ESCALATE
          : signal.severity ===
              SEVERITY.HIGH
            ? ACTION_INTENTS.INVESTIGATE
            : signal.severity ===
                SEVERITY.MEDIUM
              ? ACTION_INTENTS.REVIEW
              : ACTION_INTENTS.OBSERVE;

      recommendations.push({
        code:
          `OP_${signal.code}`,

        area:
          signal.area,

        intent,

        title:
          signal.title,

        rationale:
          `Operational evidence for ${signal.code} requires ${intent.toLowerCase()} based on configured thresholds.`,

        executable:
          false,
      });
    }

    const unavailable =
      sourceStates.filter(
        (
          item,
        ) =>
          item.configured &&
          !item.available,
      );

    if (
      unavailable.length
    ) {
      recommendations.push({
        code:
          'OP_SOURCE_RECOVERY_REVIEW',

        area:
          OPERATIONAL_AREAS.OBSERVABILITY,

        intent:
          ACTION_INTENTS.INVESTIGATE,

        title:
          'Review unavailable command-center sources',

        rationale:
          'Unavailable sources reduce cockpit completeness and confidence.',

        executable:
          false,
      });
    }

    return recommendations.slice(
      0,
      this.config
        .maxTopSignals,
    );
  }

  _deriveStatus(
    signals,
    sourceStates,
  ) {
    const requiredFailures =
      sourceStates.filter(
        (
          item,
        ) =>
          this.requiredSources.has(
            item.source,
          ) &&
          (
            !item.configured ||
            !item.available ||
            item.unsafe
          ),
      );

    if (
      requiredFailures.length &&
      this.config
        .failClosedOnRequiredSourceFailure
    ) {
      return COCKPIT_STATUS.UNAVAILABLE;
    }

    if (
      sourceStates.some(
        (
          item,
        ) =>
          item.unsafe,
      ) &&
      this.config
        .failClosedOnUnsafeSource
    ) {
      return COCKPIT_STATUS.DEGRADED;
    }

    const critical =
      signals.filter(
        (
          item,
        ) =>
          item.severity ===
          SEVERITY.CRITICAL,
      ).length;

    const elevated =
      signals.filter(
        (
          item,
        ) =>
          item.severity ===
            SEVERITY.HIGH ||
          item.severity ===
            SEVERITY.MEDIUM,
      ).length;

    if (
      critical > 0
    ) {
      return COCKPIT_STATUS.INCIDENT_RISK;
    }

    if (
      elevated > 0
    ) {
      return COCKPIT_STATUS.DEGRADED;
    }

    if (
      !sourceStates.some(
        (
          item,
        ) =>
          item.available,
      )
    ) {
      return COCKPIT_STATUS.INDETERMINATE;
    }

    return COCKPIT_STATUS.OPERATIONAL;
  }

  async aggregate(
    input = {},
  ) {
    const normalized =
      this._normalizeInput(
        input,
      );

    const snapshotId =
      this.snapshotIdFactory();

    const startedAt =
      nowFrom(
        this.clock,
      );

    const requestFingerprint =
      `sha256:${sha256({
        provider:
          PROVIDER,

        scope:
          normalized.scope,

        tenantScope:
          normalized.tenantScope,

        range:
          normalized.range,

        mode:
          normalized.mode,

        includeEvidence:
          normalized.includeEvidence,

        includeSources:
          normalized.includeSources,

        includeRecommendations:
          normalized
            .includeRecommendations,

        metadata:
          normalized.metadata,
      })}`;

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
          throw new OperationsCockpitError(
            ERROR_CODES.IDEMPOTENCY_CONFLICT,
            'Operations-cockpit idempotency key maps to a different request.',
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
        });
      }
    }

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

    const metrics =
      this._extractOperationalMetrics(
        sourceMap,
      );

    const signals =
      this._buildOperationalSignals(
        metrics,
        sourceStates,
      );

    const incidentRecords = [
      ...firstArray(
        sourceMap
          .incidentPredictor
          ?.data,
        [
          'signals',
          'incidents',
          'topSignals',
        ],
      ).map(
        (
          item,
        ) =>
          normalizeIncidentRecord(
            item,
            'incidentPredictor',
          ),
      ),

      ...firstArray(
        sourceMap
          .executiveRiskCenter
          ?.data,
        [
          'topRisks',
          'signals',
        ],
      ).map(
        (
          item,
        ) =>
          normalizeIncidentRecord(
            item,
            'executiveRiskCenter',
          ),
      ),
    ].filter(
      Boolean,
    );

    const dedupedIncidents =
      [];

    const seenIncidents =
      new Set();

    for (
      const incident of
      incidentRecords
    ) {
      const key =
        `${incident.source}:${incident.code}:${incident.timestamp ?? 'none'}`;

      if (
        seenIncidents.has(
          key,
        )
      ) {
        continue;
      }

      seenIncidents.add(
        key,
      );

      dedupedIncidents.push(
        incident,
      );
    }

    dedupedIncidents.sort(
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
    );

    const recommendations =
      normalized
        .includeRecommendations
        ? this._buildRecommendations(
            signals,
            sourceStates,
          )
        : [];

    const status =
      this._deriveStatus(
        signals,
        sourceStates,
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

    const availabilityPercent =
      safePercent(
        availableSources.length,
        configuredSources.length,
      );

    const maxSignalScore =
      signals.length
        ? Math.max(
            ...signals.map(
              (
                item,
              ) =>
                item.score,
            ),
          )
        : 0;

    const meanSignalScore =
      signals.length
        ? Number(
            (
              signals.reduce(
                (
                  sum,
                  item,
                ) =>
                  sum +
                  item.score,
                0,
              ) /
              signals.length
            ).toFixed(4),
          )
        : 0;

    const operationalScore =
      clamp(
        Math.max(
          maxSignalScore,
          meanSignalScore,
          metrics
            .predictedIncidentRiskScore ??
            0,
        ),
        0,
        100,
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
            : DATA_STATES.AVAILABLE;

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

      snapshotId,

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

      status,

      dataState,

      operatingBand:
        statusBand(
          operationalScore,
        ),

      operationalScore:
        operationalScore ===
          null
          ? null
          : Number(
              operationalScore.toFixed(
                4,
              ),
            ),

      confidencePercent:
        availabilityPercent,

      metrics,

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

        availabilityPercent,
      },

      signals,

      incidentSignals:
        dedupedIncidents.slice(
          0,
          this.config
            .maxTopIncidents,
        ),

      recommendations,

      executionBoundary: {
        readOnly:
          true,

        actionExecution:
          false,

        paymentExecution:
          false,

        providerCalls:
          false,

        settlement:
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

        incidentCreation:
          false,

        incidentResolution:
          false,

        notificationDispatch:
          false,

        policyMutation:
          false,

        modelMutation:
          false,
      },

      limitations: {
        operationalPostureOnly:
          true,

        predictionIsNotAuthorization:
          true,

        predictionIsNotCreditDecision:
          true,

        sourceDataMayBePartial:
          dataState ===
          DATA_STATES.PARTIAL,

        sourceDataUnavailable:
          dataState ===
          DATA_STATES.UNAVAILABLE,

        rawProviderPayloadsIncluded:
          false,

        rawCustomerIdentifiersIncluded:
          false,
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

    result.operationsFingerprint =
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
      throw new OperationsCockpitError(
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        `Operations-cockpit snapshot exceeds ${this.config.maxPayloadBytes} bytes.`,
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
        .persistSnapshots &&
      typeof this.repository
        ?.saveSnapshot ===
        'function'
    ) {
      try {
        await this.repository.saveSnapshot(
          {
            ...redact(
              result,
            ),

            idempotencyKey:
              normalized
                .idempotencyKey,
          },
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
          'Operations-cockpit snapshot persistence failed.',
          error,
          {
            snapshotId,
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
            .persistSnapshots &&
          this.repository
            ?.saveSnapshot,
        ),

      persisted,

      error:
        persistenceError,
    };

    this._metric(
      'titech.airtel.operations_cockpit.completed',
      {
        provider:
          PROVIDER,

        scope:
          normalized.scope,

        status,
      },
    );

    return deepFreeze(
      redact(
        result,
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

  async getOperations(
    input = {},
  ) {
    return this.aggregate(
      input,
    );
  }

  async getRisk(
    input = {},
  ) {
    const result =
      await this.aggregate(
        input,
      );

    return deepFreeze({
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

      dataState:
        result.dataState,

      operationalScore:
        result.operationalScore,

      operatingBand:
        result.operatingBand,

      confidencePercent:
        result.confidencePercent,

      signals:
        result.signals,

      incidentSignals:
        result.incidentSignals,

      sourceSummary:
        result.sourceSummary,

      operationsFingerprint:
        result.operationsFingerprint,
    });
  }

  async getIncidents(
    input = {},
  ) {
    const result =
      await this.aggregate({
        ...input,

        includeEvidence:
          true,

        includeSources:
          false,

        includeRecommendations:
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

      incidentSignals:
        result.incidentSignals,

      fingerprint:
        result.operationsFingerprint,
    });
  }

  async getSources(
    input = {},
  ) {
    const result =
      await this.aggregate({
        ...input,

        includeEvidence:
          false,

        includeSources:
          true,

        includeRecommendations:
          false,
      });

    return deepFreeze({
      provider:
        PROVIDER,

      tenantScope:
        result.tenantScope,

      sourceSummary:
        result.sourceSummary,

      sources:
        result.sources,

      fingerprint:
        result.operationsFingerprint,
    });
  }

  async listSnapshots({
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
        ?.listSnapshots !==
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
      await this.repository.listSnapshots(
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
            item,
          ) =>
            redact(
              item,
            ),
        ),

      limit:
        boundedLimit,

      offset:
        boundedOffset,
    });
  }

  async getSnapshot({
    tenantId,
    scope = 'TENANT',
    snapshotId,
  } = {}) {
    const scopeInfo =
      normalizeScope(
        {
          tenantId,
          scope,
        },
        this.config,
      );

    const id =
      normalizeString(
        snapshotId,
        240,
      );

    if (
      !id
    ) {
      throw new OperationsCockpitError(
        ERROR_CODES.INVALID_INPUT,
        'snapshotId is required.',
      );
    }

    if (
      typeof this.repository
        ?.getSnapshot !==
      'function'
    ) {
      return null;
    }

    const snapshot =
      await this.repository.getSnapshot(
        {
          tenantScope:
            scopeInfo.tenantScope,

          snapshotId:
            id,
        },
      );

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
    const result =
      await this.aggregate({
        ...input,

        includeEvidence:
          true,

        includeSources:
          true,

        includeRecommendations:
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
      throw new OperationsCockpitError(
        ERROR_CODES.EXPORT_TOO_LARGE,
        `Operations-cockpit export exceeds ${this.config.maxExportBytes} bytes.`,
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
        `airtel-operations-cockpit-${result.scope.toLowerCase()}.json`,

      bytes,

      fingerprint:
        `sha256:${sha256(
          content,
        )}`,

      content,
    });
  }

  async health() {
    const names =
      Object.keys(
        this.sources,
      );

    const configured =
      names.filter(
        (
          name,
        ) =>
          Boolean(
            this.sources[
              name
            ],
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

    const repositoryConfigured =
      Boolean(
        this.repository,
      );

    let repository = {
      configured:
        repositoryConfigured,

      available:
        !this.config
          .requireRepository,

      state:
        this.config
          .requireRepository
          ? 'UNAVAILABLE'
          : 'HEALTHY',

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
            : typeof this.repository
                .health ===
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
              (
                raw?.ok ===
                false
                  ? 'UNAVAILABLE'
                  : 'HEALTHY'
              ),

            method,

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
            'UNAVAILABLE',

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
        ? 'UNAVAILABLE'
        : configured.length <
            names.length
          ? 'DEGRADED'
          : 'HEALTHY';

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
          'HEALTHY',

        degraded:
          state ===
          'DEGRADED',

        unavailable:
          state ===
          'UNAVAILABLE',

        sourceCount:
          names.length,

        configuredSourceCount:
          configured.length,

        missingRequiredSources:
          missingRequired,

        repository,

        readOnly:
          true,

        actionExecution:
          false,
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

      readOnly:
        true,

      boundedConcurrency:
        true,

      boundedTimeouts:
        true,

      deterministicFingerprint:
        true,

      repositoryPersistence:
        Boolean(
          this.repository,
        ),

      operationalReadModel:
        true,

      actionExecution:
        false,

      paymentExecution:
        false,

      providerCalls:
        false,

      settlement:
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

      incidentCreation:
        false,

      incidentResolution:
        false,

      notificationDispatch:
        false,

      policyMutation:
        false,

      modelMutation:
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

export function createOperationsCockpit(
  options = {},
) {
  return new OperationsCockpit(
    options,
  );
}

export const createAirtelOperationsCockpit =
  createOperationsCockpit;

export const AirtelOperationsCockpit =
  OperationsCockpit;

export const constants =
  Object.freeze({
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    PROVIDER,
    SCHEMA_VERSION,
    HASH_ALGORITHM,
    COCKPIT_STATUS,
    DATA_STATES,
    OPERATING_BANDS,
    SEVERITY,
    OPERATIONAL_AREAS,
    ACTION_INTENTS,
    ERROR_CODES,
  });

export function buildOperationsFingerprint(
  value,
) {
  return buildSemanticFingerprint(
    value,
  );
}

export default OperationsCockpit;