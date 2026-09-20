/**
 * TITech Community Capital
 * File: backend/modules/payment/airtel/intelligence/command-center/executiveRiskCenter.js
 *
 * Architectural role
 * ------------------
 * Enterprise executive risk read-model for the Airtel payment intelligence
 * command center. Composes bounded governance, compliance, alert, model-risk,
 * explainability, diagnostic and operational signals into an executive-facing
 * tenant-scoped risk posture without becoming a new risk engine.
 *
 * Important boundaries / non-responsibilities
 * --------------------------------------------
 * - NOT the financial source of truth, ledger, balance service, or settlement service.
 * - NOT an Airtel provider adapter and never owns provider credentials.
 * - NOT a fraud, credit, AML, KYC, sanctions, prediction or machine-learning engine.
 * - NOT a policy engine and never interprets a policy pack independently.
 * - NOT an approval/maker-checker state machine and never grants approval.
 * - NOT an audit ledger and never rewrites historical audit evidence.
 * - NOT a payment executor, settlement processor, reconciliation engine or notification transport.
 * - NOT a replacement for governanceDashboard.js, dashboardAggregator.js,
 *   complianceCenter.js or diagnosticsService.js.js; it composes their read models.
 * - NOT an adverse-action engine. Executive risk signals are operational/governance
 *   observability and must never be used as an automatic credit decision.
 * - Never mutates financial state, policy state, compliance cases, alerts, model state,
 *   approvals, provider state or customer records.
 *
 * Production principles
 * ---------------------
 * - Airtel provider scope is fail-closed.
 * - Tenant scope is explicit and tenant identifiers are never emitted raw.
 * - Source methods are allow-listed and executed with bounded concurrency and timeouts.
 * - Missing data is visible as unavailable/partial rather than silently treated as zero.
 * - Operational risk scoring is deterministic, explainable and bounded to 0..100.
 * - Score semantics are explicitly operational and are not a financial/credit score.
 * - Sensitive values are redacted; direct identifiers are one-way digested.
 * - Diagnostic fingerprints exclude generated timestamps and run identifiers.
 * - Source failures remain visible as data quality and confidence degradation.
 * - All returned records are deeply frozen.
 * - Persistence is injected and optional for read-model caching/history.
 * - No internal scheduler is created.
 *
 * Module format
 * -------------
 * - Native ECMAScript module (ESM).
 * - Node.js built-ins only.
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME =
  'airtel-command-center-executive-risk-center';

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

export const RISK_BANDS =
  Object.freeze({
    LOW:
      'LOW',

    GUARDED:
      'GUARDED',

    ELEVATED:
      'ELEVATED',

    HIGH:
      'HIGH',

    CRITICAL:
      'CRITICAL',

    UNKNOWN:
      'UNKNOWN',
  });

export const RISK_DIRECTIONS =
  Object.freeze({
    IMPROVING:
      'IMPROVING',

    STABLE:
      'STABLE',

    WORSENING:
      'WORSENING',

    UNKNOWN:
      'UNKNOWN',
  });

export const DATA_STATES =
  Object.freeze({
    AVAILABLE:
      'AVAILABLE',

    PARTIAL:
      'PARTIAL',

    EMPTY:
      'EMPTY',

    UNAVAILABLE:
      'UNAVAILABLE',

    TRUNCATED:
      'TRUNCATED',
  });

export const HEALTH_STATES =
  Object.freeze({
    HEALTHY:
      'HEALTHY',

    DEGRADED:
      'DEGRADED',

    UNAVAILABLE:
      'UNAVAILABLE',
  });

export const EXECUTIVE_SEVERITIES =
  Object.freeze({
    INFO:
      'INFO',

    LOW:
      'LOW',

    MEDIUM:
      'MEDIUM',

    HIGH:
      'HIGH',

    CRITICAL:
      'CRITICAL',
  });

export const EXECUTIVE_RISK_FAMILIES =
  Object.freeze({
    GOVERNANCE:
      'GOVERNANCE',

    COMPLIANCE:
      'COMPLIANCE',

    OPERATIONAL:
      'OPERATIONAL',

    FRAUD:
      'FRAUD',

    MODEL_RISK:
      'MODEL_RISK',

    DATA_INTEGRITY:
      'DATA_INTEGRITY',

    PROVIDER:
      'PROVIDER',

    APPROVAL:
      'APPROVAL',

    EXPLAINABILITY:
      'EXPLAINABILITY',

    OBSERVABILITY:
      'OBSERVABILITY',
  });

export const EXECUTIVE_RISK_ERROR_CODES =
  Object.freeze({
    INVALID_INPUT:
      'EXECUTIVE_RISK_INVALID_INPUT',

    TENANT_REQUIRED:
      'EXECUTIVE_RISK_TENANT_REQUIRED',

    SYSTEM_SCOPE_FORBIDDEN:
      'EXECUTIVE_RISK_SYSTEM_SCOPE_FORBIDDEN',

    PROVIDER_SCOPE_VIOLATION:
      'EXECUTIVE_RISK_PROVIDER_SCOPE_VIOLATION',

    RANGE_INVALID:
      'EXECUTIVE_RISK_RANGE_INVALID',

    RANGE_TOO_LARGE:
      'EXECUTIVE_RISK_RANGE_TOO_LARGE',

    SOURCE_UNAVAILABLE:
      'EXECUTIVE_RISK_SOURCE_UNAVAILABLE',

    SOURCE_PROTOCOL_ERROR:
      'EXECUTIVE_RISK_SOURCE_PROTOCOL_ERROR',

    SOURCE_UNSAFE:
      'EXECUTIVE_RISK_SOURCE_UNSAFE',

    TIMEOUT:
      'EXECUTIVE_RISK_TIMEOUT',

    PAYLOAD_TOO_LARGE:
      'EXECUTIVE_RISK_PAYLOAD_TOO_LARGE',

    EXPORT_TOO_LARGE:
      'EXECUTIVE_RISK_EXPORT_TOO_LARGE',

    REPOSITORY_REQUIRED:
      'EXECUTIVE_RISK_REPOSITORY_REQUIRED',

    PERSISTENCE_FAILED:
      'EXECUTIVE_RISK_PERSISTENCE_FAILED',

    IDEMPOTENCY_CONFLICT:
      'EXECUTIVE_RISK_IDEMPOTENCY_CONFLICT',
  });

const DEFAULT_CONFIG =
  Object.freeze({
    provider:
      PROVIDER,

    tenantRequired:
      true,

    allowSystemScope:
      true,

    maxTenantIdLength:
      160,

    defaultRangeDays:
      30,

    maxRangeDays:
      366,

    defaultTimeoutMs:
      5_000,

    maxTimeoutMs:
      30_000,

    maxConcurrency:
      8,

    maxSourceRecords:
      5_000,

    maxTopRisks:
      25,

    maxTrendBuckets:
      366,

    maxEvidenceItems:
      100,

    maxPayloadBytes:
      768 * 1024,

    maxExportBytes:
      4 * 1024 * 1024,

    maxHistoryLimit:
      100,

    defaultHistoryLimit:
      20,

    persistSnapshots:
      true,

    requireRepository:
      false,

    failClosedOnRequiredSourceFailure:
      true,

    failClosedOnUnsafeSource:
      true,

    score:
      Object.freeze({
        governance:
          0.22,

        compliance:
          0.20,

        operational:
          0.12,

        fraud:
          0.14,

        modelRisk:
          0.12,

        dataIntegrity:
          0.10,

        approval:
          0.10,
      }),
  });

const SENSITIVE_KEY_PATTERNS =
  Object.freeze([
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

const IDENTIFIER_KEY_PATTERNS =
  Object.freeze([
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
    /session.?id/i,
    /request.?id/i,
  ]);

const ALLOWED_SOURCE_METHODS =
  Object.freeze({
    governanceDashboard: [
      'getOverview',
      'getSnapshot',
      'getDashboardSummary',
      'health',
      'readiness',
      'getComponentInfo',
    ],

    dashboardAggregator: [
      'getOverview',
      'getSnapshot',
      'getSummary',
      'getRisk',
      'getOperations',
      'getCompliance',
      'health',
      'readiness',
      'getComponentInfo',
    ],

    complianceCenter: [
      'summary',
      'getSummary',
      'listCases',
      'health',
      'readiness',
      'getComponentInfo',
    ],

    alertManager: [
      'summary',
      'listAlerts',
      'list',
      'health',
      'readiness',
      'getComponentInfo',
    ],

    agentOrchestrator: [
      'listRuns',
      'summary',
      'health',
      'readiness',
      'getComponentInfo',
    ],

    modelDriftMonitor: [
      'summary',
      'getDashboardSummary',
      'listReports',
      'health',
      'readiness',
      'getComponentInfo',
    ],

    explainabilityStore: [
      'listTenant',
      'health',
      'readiness',
      'getComponentInfo',
    ],

    auditLedger: [
      'listTenantAudit',
      'listTenant',
      'getDashboardSummary',
      'health',
      'readiness',
      'getComponentInfo',
    ],

    diagnosticsService: [
      'health',
      'readiness',
      'diagnose',
      'run',
      'getComponentInfo',
    ],
  });

function isPlainObject(
  value,
) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(
      value,
    );

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function assertPlainObject(
  value,
  label = 'value',
) {
  if (
    !isPlainObject(
      value,
    )
  ) {
    throw new ExecutiveRiskCenterError(
      EXECUTIVE_RISK_ERROR_CODES.INVALID_INPUT,
      `${label} must be a plain object.`,
    );
  }
}

function isPromiseLike(
  value,
) {
  return Boolean(
    value &&
      typeof value.then ===
        'function',
  );
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

  return normalized.length >
    maxLength
    ? normalized.slice(
      0,
      maxLength,
    )
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

function finiteNumber(
  value,
  fallback = null,
) {
  const number =
    Number(value);

  return Number.isFinite(
    number,
  )
    ? number
    : fallback;
}

function integer(
  value,
  fallback,
  min = 0,
  max =
    Number.MAX_SAFE_INTEGER,
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number,
    )
  ) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(
      min,
      Math.trunc(
        number,
      ),
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
  return `sha256:${createHash(
    'sha256',
  )
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

  const output = {};

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
    3_000;

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
    seen.has(
      value,
    )
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

    const result =
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
      result.push(
        `[TRUNCATED:${value.length - maxArrayItems}]`,
      );
    }

    seen.delete(
      value,
    );

    return result;
  }

  seen.set(
    value,
    true,
  );

  const result = {};

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
          pattern.test(
            key,
          ),
      )
    ) {
      result[key] =
        '[REDACTED]';

      continue;
    }

    if (
      IDENTIFIER_KEY_PATTERNS.some(
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

      result[key] =
        identifier
          ? digest(
            identifier,
          )
          : undefined;

      continue;
    }

    result[key] =
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
    result.__truncatedKeys =
      Object.keys(
        value,
      ).length -
      keys.length;
  }

  seen.delete(
    value,
  );

  return result;
}

function safeError(
  error,
  maxMessageLength = 500,
) {
  if (!error) {
    return null;
  }

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
        maxMessageLength,
      ) ??
      'Unknown error',
  });
}

function mergeConfig(
  base,
  override,
) {
  const merged = {
    ...base,
    ...(isPlainObject(
      override,
    )
      ? override
      : {}),
  };

  merged.score =
    Object.freeze({
      ...base.score,

      ...(isPlainObject(
        override?.score,
      )
        ? override.score
        : {}),
    });

  return Object.freeze(
    merged,
  );
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

function safePercent(
  numerator,
  denominator,
) {
  const n =
    finiteNumber(
      numerator,
      null,
    );

  const d =
    finiteNumber(
      denominator,
      null,
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

function clamp(
  value,
  min = 0,
  max = 100,
) {
  return Math.min(
    max,
    Math.max(
      min,
      finiteNumber(
        value,
        min,
      ),
    ),
  );
}

function bandFromScore(
  score,
) {
  if (
    !Number.isFinite(
      score,
    )
  ) {
    return RISK_BANDS.UNKNOWN;
  }

  if (score < 20) {
    return RISK_BANDS.LOW;
  }

  if (score < 40) {
    return RISK_BANDS.GUARDED;
  }

  if (score < 60) {
    return RISK_BANDS.ELEVATED;
  }

  if (score < 80) {
    return RISK_BANDS.HIGH;
  }

  return RISK_BANDS.CRITICAL;
}

function severityWeight(
  value,
) {
  switch (
    upper(
      value,
      30,
    )
  ) {
    case EXECUTIVE_SEVERITIES.CRITICAL:
      return 1.0;

    case EXECUTIVE_SEVERITIES.HIGH:
      return 0.75;

    case EXECUTIVE_SEVERITIES.MEDIUM:
      return 0.5;

    case EXECUTIVE_SEVERITIES.LOW:
      return 0.25;

    default:
      return 0;
  }
}

function trendDirection(
  current,
  previous,
  threshold = 2,
) {
  const c =
    finiteNumber(
      current,
      null,
    );

  const p =
    finiteNumber(
      previous,
      null,
    );

  if (
    c === null ||
    p === null
  ) {
    return RISK_DIRECTIONS.UNKNOWN;
  }

  const delta =
    c - p;

  if (
    Math.abs(
      delta,
    ) < threshold
  ) {
    return RISK_DIRECTIONS.STABLE;
  }

  return delta > 0
    ? RISK_DIRECTIONS.WORSENING
    : RISK_DIRECTIONS.IMPROVING;
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
          config.defaultRangeDays *
            86_400_000,
      );

  if (
    Number.isNaN(
      start.getTime(),
    ) ||
    Number.isNaN(
      end.getTime(),
    )
  ) {
    throw new ExecutiveRiskCenterError(
      EXECUTIVE_RISK_ERROR_CODES.RANGE_INVALID,
      'startAt/endAt must be valid dates.',
    );
  }

  if (
    start >= end
  ) {
    throw new ExecutiveRiskCenterError(
      EXECUTIVE_RISK_ERROR_CODES.RANGE_INVALID,
      'startAt must be before endAt.',
    );
  }

  const days =
    (
      end.getTime() -
      start.getTime()
    ) /
    86_400_000;

  if (
    days >
    config.maxRangeDays
  ) {
    throw new ExecutiveRiskCenterError(
      EXECUTIVE_RISK_ERROR_CODES.RANGE_TOO_LARGE,
      `Risk-center range cannot exceed ${config.maxRangeDays} days.`,
      {
        maxRangeDays:
          config.maxRangeDays,
      },
    );
  }

  return {
    startAt:
      start.toISOString(),

    endAt:
      end.toISOString(),

    days,
  };
}

function normalizeScope(
  {
    tenantId,
    scope,
  },
  config,
) {
  const normalizedScope =
    upper(
      scope ?? 'TENANT',
      40,
    );

  if (
    normalizedScope ===
    'SYSTEM'
  ) {
    if (
      !config.allowSystemScope
    ) {
      throw new ExecutiveRiskCenterError(
        EXECUTIVE_RISK_ERROR_CODES.SYSTEM_SCOPE_FORBIDDEN,
        'System risk-center scope is disabled.',
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

  const normalizedTenantId =
    normalizeString(
      tenantId,
      config.maxTenantIdLength,
    );

  if (
    config.tenantRequired &&
    !normalizedTenantId
  ) {
    throw new ExecutiveRiskCenterError(
      EXECUTIVE_RISK_ERROR_CODES.TENANT_REQUIRED,
      'tenantId is required for tenant-scoped executive risk diagnostics.',
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
      normalizedTenantId ??
      null,

    tenantScope:
      normalizedTenantId
        ? digest(
          normalizedTenantId,
        )
        : 'TENANT:UNSPECIFIED',
  };
}

function getArray(
  value,
  fallback = [],
) {
  return Array.isArray(
    value,
  )
    ? value
    : fallback;
}

function firstDefined(
  ...values
) {
  return values.find(
    (value) =>
      value !==
        undefined &&
      value !== null,
  );
}

function sourceAvailable(
  source,
) {
  return Boolean(
    source &&
      typeof source ===
        'object',
  );
}

function safeList(
  value,
  max,
) {
  return getArray(
    value,
  ).slice(
    0,
    max,
  );
}

function extractCount(
  source,
  ...paths
) {
  for (
    const path of
    paths
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

    const number =
      finiteNumber(
        current,
        null,
      );

    if (
      number !== null
    ) {
      return number;
    }
  }

  return 0;
}

function extractNullableCount(
  source,
  ...paths
) {
  for (
    const path of
    paths
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

    const number =
      finiteNumber(
        current,
        null,
      );

    if (
      number !== null
    ) {
      return number;
    }
  }

  return null;
}

function extractRecords(
  source,
  ...paths
) {
  for (
    const path of
    paths
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

    if (
      Array.isArray(
        current,
      )
    ) {
      return current;
    }
  }

  return [];
}

function normalizeRiskSignal(
  {
    family,
    severity,
    code,
    title,
    status,
    weight,
    evidence,
    source,
    explanation,
  },
) {
  const normalizedSeverity =
    upper(
      severity ??
        'INFO',
      30,
    );

  return {
    family:
      upper(
        family ??
          EXECUTIVE_RISK_FAMILIES.OPERATIONAL,
        60,
      ),

    severity:
      Object.values(
        EXECUTIVE_SEVERITIES,
      ).includes(
        normalizedSeverity,
      )
        ? normalizedSeverity
        : EXECUTIVE_SEVERITIES.INFO,

    code:
      normalizeString(
        code,
        160,
      ) ??
      'UNSPECIFIED',

    title:
      normalizeString(
        title ??
          'Risk signal',
        240,
      ) ??
      'Risk signal',

    status:
      normalizeString(
        status,
        120,
      ) ??
      null,

    weight:
      clamp(
        weight ??
          severityWeight(
            normalizedSeverity,
          ),
        0,
        1,
      ),

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
        800,
      ) ??
      null,
  };
}

function buildSignalScore(
  signals,
) {
  if (
    !signals.length
  ) {
    return null;
  }

  const weighted =
    signals.reduce(
      (
        sum,
        signal,
      ) => {
        const severity =
          severityWeight(
            signal.severity,
          );

        const weight =
          clamp(
            signal.weight,
            0,
            1,
          );

        return (
          sum +
          severity *
            weight
        );
      },
      0,
    );

  const normalizer =
    signals.reduce(
      (
        sum,
        signal,
      ) =>
        sum +
        clamp(
          signal.weight,
          0,
          1,
        ),
      0,
    );

  if (
    normalizer <= 0
  ) {
    return 0;
  }

  return clamp(
    (weighted /
      normalizer) *
      100,
  );
}

function summarizeFamilySignals(
  signals,
) {
  const byFamily = {};

  for (
    const signal of
    signals
  ) {
    if (
      !byFamily[
        signal.family
      ]
    ) {
      byFamily[
        signal.family
      ] = [];
    }

    byFamily[
      signal.family
    ].push(
      signal,
    );
  }

  const families = {};

  for (
    const [
      family,
      familySignals,
    ] of Object.entries(
      byFamily,
    )
  ) {
    const score =
      buildSignalScore(
        familySignals,
      );

    families[
      family
    ] = {
      family,

      score,

      band:
        bandFromScore(
          score,
        ),

      signalCount:
        familySignals.length,

      critical:
        familySignals.filter(
          (item) =>
            item.severity ===
            EXECUTIVE_SEVERITIES.CRITICAL,
        ).length,

      high:
        familySignals.filter(
          (item) =>
            item.severity ===
            EXECUTIVE_SEVERITIES.HIGH,
        ).length,

      medium:
        familySignals.filter(
          (item) =>
            item.severity ===
            EXECUTIVE_SEVERITIES.MEDIUM,
        ).length,

      low:
        familySignals.filter(
          (item) =>
            item.severity ===
            EXECUTIVE_SEVERITIES.LOW,
        ).length,

      info:
        familySignals.filter(
          (item) =>
            item.severity ===
            EXECUTIVE_SEVERITIES.INFO,
        ).length,

      topSignals:
        familySignals
          .slice()
          .sort(
            (
              a,
              b,
            ) =>
              severityWeight(
                b.severity,
              ) -
                severityWeight(
                  a.severity,
                ) ||
              a.code.localeCompare(
                b.code,
              ),
          )
          .slice(
            0,
            5,
          ),
    };
  }

  return families;
}

function aggregateTrendBuckets(
  records,
  startAt,
  endAt,
  maxBuckets,
) {
  const start =
    new Date(
      startAt,
    ).getTime();

  const end =
    new Date(
      endAt,
    ).getTime();

  const days =
    Math.max(
      1,
      Math.ceil(
        (end - start) /
          86_400_000,
      ),
    );

  const bucketCount =
    Math.min(
      maxBuckets,
      days,
    );

  const bucketMs =
    Math.max(
      86_400_000,
      (end - start) /
        bucketCount,
    );

  const buckets = [];

  for (
    let index = 0;
    index <
      bucketCount;
    index += 1
  ) {
    const bucketStart =
      start +
      index *
        bucketMs;

    const bucketEnd =
      index ===
      bucketCount - 1
        ? end
        : bucketStart +
          bucketMs;

    buckets.push({
      startAt:
        new Date(
          bucketStart,
        ).toISOString(),

      endAt:
        new Date(
          bucketEnd,
        ).toISOString(),

      signalCount:
        0,

      high:
        0,

      critical:
        0,

      scoreSum:
        0,

      scoreCount:
        0,
    });
  }

  for (
    const record of
    records
  ) {
    const time =
      new Date(
        record.timestamp ??
          record.createdAt ??
          record.generatedAt ??
          0,
      ).getTime();

    if (
      !Number.isFinite(
        time,
      ) ||
      time <
        start ||
      time >
        end
    ) {
      continue;
    }

    const rawIndex =
      Math.floor(
        (time - start) /
          bucketMs,
      );

    const index =
      Math.min(
        bucketCount - 1,
        Math.max(
          0,
          rawIndex,
        ),
      );

    const bucket =
      buckets[index];

    bucket.signalCount +=
      1;

    if (
      record.severity ===
      EXECUTIVE_SEVERITIES.HIGH
    ) {
      bucket.high += 1;
    }

    if (
      record.severity ===
      EXECUTIVE_SEVERITIES.CRITICAL
    ) {
      bucket.critical +=
        1;
    }

    const score =
      finiteNumber(
        record.score,
        null,
      );

    if (
      score !== null
    ) {
      bucket.scoreSum +=
        score;

      bucket.scoreCount +=
        1;
    }
  }

  return buckets.map(
    (
      bucket,
    ) => ({
      ...bucket,

      averageScore:
        bucket.scoreCount
          ? Number(
            (
              bucket.scoreSum /
              bucket.scoreCount
            ).toFixed(4),
          )
          : null,

      scoreSum:
        undefined,

      scoreCount:
        undefined,
    }),
  );
}

function deriveDataState(
  {
    configured,
    available,
    partial,
    count,
  },
) {
  if (!configured) {
    return DATA_STATES.UNAVAILABLE;
  }

  if (!available) {
    return DATA_STATES.UNAVAILABLE;
  }

  if (partial) {
    return DATA_STATES.PARTIAL;
  }

  if (
    count === 0
  ) {
    return DATA_STATES.EMPTY;
  }

  return DATA_STATES.AVAILABLE;
}

function buildFingerprintPayload(
  value,
  key = null,
) {
  if (
    [
      'generatedAt',
      'startedAt',
      'completedAt',
      'runId',
      'durationMs',
      'replay',
      'persistence',
      'diagnosticFingerprint',
      'snapshotId',
    ].includes(key)
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
          buildFingerprintPayload(
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
    const output = {};

    for (
      const childKey of
      Object.keys(
        value,
      ).sort()
    ) {
      const child =
        buildFingerprintPayload(
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
        ] = child;
      }
    }

    return output;
  }

  return value;
}

function buildSemanticFingerprint(
  value,
) {
  return `sha256:${sha256(
    buildFingerprintPayload(
      value,
    ),
  )}`;
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
          () =>
            reject(
              new ExecutiveRiskCenterError(
                EXECUTIVE_RISK_ERROR_CODES.TIMEOUT,
                `Risk-center source call timed out after ${timeoutMs} ms.`,
              ),
            ),
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

  const workers = [];

  const count =
    Math.min(
      Math.max(
        1,
        concurrency,
      ),
      items.length ||
        1,
    );

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    workers.push(
      consume(),
    );
  }

  await Promise.all(
    workers,
  );

  return results;
}

export class ExecutiveRiskCenterError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message);

    this.name =
      'ExecutiveRiskCenterError';

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

export class InMemoryExecutiveRiskRepository {
  constructor(
    seed = {},
  ) {
    this.snapshots =
      Array.isArray(
        seed.snapshots,
      )
        ? seed.snapshots.map(
          (item) =>
            redact(item),
        )
        : [];

    this.closed =
      false;
  }

  _assertOpen() {
    if (
      this.closed
    ) {
      throw new ExecutiveRiskCenterError(
        EXECUTIVE_RISK_ERROR_CODES.PERSISTENCE_FAILED,
        'Executive-risk repository is closed.',
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
      this.snapshots.find(
        (item) =>
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
      redact(record);

    const existing =
      normalized.idempotencyKey
        ? await this.findByIdempotencyKey(
          {
            tenantScope:
              normalized.tenantScope,

            idempotencyKey:
              normalized.idempotencyKey,
          },
        )
        : null;

    if (
      existing
    ) {
      if (
        existing.requestFingerprint !==
        normalized.requestFingerprint
      ) {
        throw new ExecutiveRiskCenterError(
          EXECUTIVE_RISK_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'Executive-risk idempotency key maps to a different request.',
        );
      }

      return {
        record:
          existing,

        replay:
          true,
      };
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

  async getSnapshot(
    {
      tenantScope,
      snapshotId,
    } = {},
  ) {
    this._assertOpen();

    return (
      this.snapshots.find(
        (item) =>
          item.tenantScope ===
            tenantScope &&
          item.snapshotId ===
            snapshotId,
      ) ??
      null
    );
  }

  async listSnapshots(
    {
      tenantScope,
      limit = 20,
      offset = 0,
    } = {},
  ) {
    this._assertOpen();

    return this.snapshots
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
        this.snapshots.length,
    };
  }

  async close() {
    this.closed =
      true;
  }
}

export class ExecutiveRiskCenter {
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
      !validateProvider(
        this.config.provider,
      )
    ) {
      throw new ExecutiveRiskCenterError(
        EXECUTIVE_RISK_ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        `Executive risk center supports provider ${PROVIDER} only.`,
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
      options.executiveRiskRepository ??
      null;

    if (
      !this.repository &&
      this.config
        .requireRepository
    ) {
      throw new ExecutiveRiskCenterError(
        EXECUTIVE_RISK_ERROR_CODES.REPOSITORY_REQUIRED,
        'A durable executive-risk repository must be injected in production.',
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
          `executive-risk-${Date.now()}-${sha256(
            `${Date.now()}-${Math.random()}`,
          ).slice(
            0,
            20,
          )}`;

    this.sources =
      Object.freeze({
        governanceDashboard:
          options.governanceDashboard ??
          null,

        dashboardAggregator:
          options.dashboardAggregator ??
          null,

        complianceCenter:
          options.complianceCenter ??
          null,

        alertManager:
          options.alertManager ??
          null,

        agentOrchestrator:
          options.agentOrchestrator ??
          null,

        modelDriftMonitor:
          options.modelDriftMonitor ??
          null,

        explainabilityStore:
          options.explainabilityStore ??
          null,

        auditLedger:
          options.auditLedger ??
          options.decisionAuditLedger ??
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
          : [
            'governanceDashboard',
          ],
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
        ALLOWED_SOURCE_METHODS[
          name
        ] ??
        [];

      const hasAllowedMethod =
        allowed.some(
          (
            method,
          ) =>
            typeof source[
              method
            ] === 'function',
        );

      if (
        !hasAllowedMethod &&
        this.requiredSources.has(
          name,
        )
      ) {
        throw new ExecutiveRiskCenterError(
          EXECUTIVE_RISK_ERROR_CODES.SOURCE_PROTOCOL_ERROR,
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

    const logger =
      this.logger;

    if (!logger) {
      return;
    }

    const fn =
      typeof logger[
        level
      ] === 'function'
        ? logger[
          level
        ]
        : typeof logger.info ===
          'function'
          ? logger.info
          : null;

    if (fn) {
      try {
        fn.call(
          logger,
          payload,
          message,
        );
      } catch {
        /* logging must never alter business outcome */
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
      } else if (
        typeof this.metrics?.observe ===
        'function'
      ) {
        this.metrics.observe(
          name,
          value,
          labels,
        );
      }
    } catch (
      error
    ) {
      this._log(
        'warn',
        'Executive-risk metric emission failed.',
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
      );

    if (
      !validateProvider(
        provider,
      )
    ) {
      throw new ExecutiveRiskCenterError(
        EXECUTIVE_RISK_ERROR_CODES.PROVIDER_SCOPE_VIOLATION,
        `Executive risk center supports provider ${PROVIDER} only.`,
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

    const timeoutMs =
      integer(
        input.timeoutMs,
        this.config
          .defaultTimeoutMs,
        1,
        this.config
          .maxTimeoutMs,
      );

    const idempotencyKey =
      normalizeString(
        input.idempotencyKey,
        240,
      ) ??
      null;

    const mode =
      upper(
        input.mode ??
          'EXECUTIVE',
        40,
      ) ??
      'EXECUTIVE';

    return {
      ...scope,

      provider:
        PROVIDER,

      range,

      timeoutMs,

      idempotencyKey,

      mode,

      includeEvidence:
        input.includeEvidence !==
        false,

      includeTrends:
        input.includeTrends !==
        false,

      includeSources:
        input.includeSources !==
        false,

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
    preferredMethods,
  ) {
    if (!source) {
      return null;
    }

    const allowList =
      new Set(
        ALLOWED_SOURCE_METHODS[
          sourceName
        ] ??
          [],
      );

    for (
      const method of
      preferredMethods
    ) {
      if (
        allowList.has(
          method,
        ) &&
        typeof source[
          method
        ] === 'function'
      ) {
        return method;
      }
    }

    for (
      const method of
      allowList
    ) {
      if (
        typeof source[
          method
        ] === 'function'
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

    if (!source) {
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

    if (!method) {
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

        error:
          safeError(
            new ExecutiveRiskCenterError(
              EXECUTIVE_RISK_ERROR_CODES.SOURCE_PROTOCOL_ERROR,
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

        scope:
          input.scope,
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

      const tenantReported =
        raw?.tenantId ??
        raw?.tenant;

      if (
        input.scope ===
          'TENANT' &&
        tenantReported &&
        input.tenantId
      ) {
        const reportedDigest =
          normalizeString(
            tenantReported,
            600,
          );

        const expectedDigest =
          digest(
            input.tenantId,
          );

        if (
          reportedDigest !==
            expectedDigest &&
          reportedDigest !==
            input.tenantId
        ) {
          unsafeFlags.push(
            'tenant-scope-mismatch',
          );
        }
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
              new ExecutiveRiskCenterError(
                EXECUTIVE_RISK_ERROR_CODES.SOURCE_UNSAFE,
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

  _sourceCallPlan() {
    return [
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
        'dashboardAggregator',
        [
          'getOverview',
          'getSummary',
          'getSnapshot',
          'getRisk',
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
        'alertManager',
        [
          'summary',
          'health',
        ],
      ],

      [
        'agentOrchestrator',
        [
          'summary',
          'listRuns',
          'health',
        ],
      ],

      [
        'modelDriftMonitor',
        [
          'summary',
          'getDashboardSummary',
          'health',
        ],
      ],

      [
        'explainabilityStore',
        [
          'listTenant',
          'health',
        ],
      ],

      [
        'auditLedger',
        [
          'getDashboardSummary',
          'listTenantAudit',
          'health',
        ],
      ],

      [
        'diagnosticsService',
        [
          'diagnose',
          'health',
        ],
      ],
    ];
  }

  async _collectSources(
    input,
  ) {
    const plan =
      this._sourceCallPlan();

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

    const sources = {};

    for (
      let index = 0;
      index <
        plan.length;
      index += 1
    ) {
      const item =
        results[index]
          ?.error
          ? {
            source:
              plan[index][
                0
              ],

            configured:
              Boolean(
                this.sources[
                  plan[index][
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
                results[index]
                  .error,
              ),
          }
          : results[index];

      sources[
        plan[index][
          0
        ]
      ] = item;
    }

    return sources;
  }

  _buildGovernanceSignals(
    source,
  ) {
    const data =
      source?.data ??
      {};

    const totalDecisions =
      extractCount(
        data,
        'summary.totalDecisions',
        'totalDecisions',
        'counts.total',
      );

    const blocked =
      extractCount(
        data,
        'summary.blockedDecisions',
        'blockedDecisions',
        'counts.blocked',
        'distribution.outcomes.BLOCK',
      );

    const conflicts =
      extractCount(
        data,
        'summary.conflicts',
        'conflicts',
        'distribution.outcomes.CONFLICT',
      );

    const integrityFailures =
      extractCount(
        data,
        'summary.integrityFailures',
        'integrityFailures',
        'distribution.integrity.FAILED',
      );

    const reviewRequired =
      extractCount(
        data,
        'summary.reviewRequired',
        'reviewRequired',
        'distribution.outcomes.REQUIRE_REVIEW',
      );

    const approvalRequired =
      extractCount(
        data,
        'summary.approvalsRequired',
        'approvalsRequired',
      );

    const signals = [];

    if (
      blocked > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.GOVERNANCE,

          severity:
            blocked >= 10
              ? 'CRITICAL'
              : 'HIGH',

          code:
            'GOVERNANCE_BLOCKS',

          title:
            'Governance blocks present',

          weight:
            1,

          evidence: {
            blocked,
            totalDecisions,
          },

          source:
            'governance',

          explanation:
            'Governance read models report blocked decisions within the selected range.',
        }),
      );
    }

    if (
      conflicts > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.GOVERNANCE,

          severity:
            conflicts >= 5
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'GOVERNANCE_CONFLICTS',

          title:
            'Governance conflicts present',

          weight:
            0.9,

          evidence: {
            conflicts,
            totalDecisions,
          },

          source:
            'governance',

          explanation:
            'Governance conflicts indicate unresolved or competing decision evidence.',
        }),
      );
    }

    if (
      integrityFailures > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.DATA_INTEGRITY,

          severity:
            integrityFailures >= 3
              ? 'CRITICAL'
              : 'HIGH',

          code:
            'INTEGRITY_FAILURES',

          title:
            'Decision integrity failures',

          weight:
            1,

          evidence: {
            integrityFailures,
            totalDecisions,
          },

          source:
            'governance',

          explanation:
            'The governance read model reports failed integrity verification.',
        }),
      );
    }

    if (
      reviewRequired > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.GOVERNANCE,

          severity:
            reviewRequired >= 20
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'REVIEW_BACKLOG',

          title:
            'Governance review demand',

          weight:
            0.6,

          evidence: {
            reviewRequired,
            totalDecisions,
          },

          source:
            'governance',
        }),
      );
    }

    if (
      approvalRequired > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.APPROVAL,

          severity:
            approvalRequired >= 20
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'APPROVAL_DEMAND',

          title:
            'Approval demand',

          weight:
            0.55,

          evidence: {
            approvalRequired,
            totalDecisions,
          },

          source:
            'governance',
        }),
      );
    }

    return {
      signals,

      metrics: {
        totalDecisions,
        blocked,
        conflicts,
        integrityFailures,
        reviewRequired,
        approvalRequired,
      },
    };
  }

  _buildComplianceSignals(
    source,
  ) {
    const data =
      source?.data ??
      {};

    const activeCases =
      extractCount(
        data,
        'activeCases',
        'counts.active',
        'summary.activeCases',
        'summary.openCases',
      );

    const blockedCases =
      extractCount(
        data,
        'blockedCases',
        'counts.blocked',
        'summary.blockedCases',
      );

    const escalatedCases =
      extractCount(
        data,
        'escalatedCases',
        'counts.escalated',
        'summary.escalatedCases',
      );

    const reviewRequired =
      extractCount(
        data,
        'reviewRequired',
        'counts.reviewRequired',
        'summary.reviewRequired',
      );

    const signals = [];

    if (
      blockedCases > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.COMPLIANCE,

          severity:
            blockedCases >= 5
              ? 'CRITICAL'
              : 'HIGH',

          code:
            'COMPLIANCE_BLOCKS',

          title:
            'Compliance blocks present',

          weight:
            1,

          evidence: {
            blockedCases,
            activeCases,
          },

          source:
            'complianceCenter',
        }),
      );
    }

    if (
      escalatedCases > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.COMPLIANCE,

          severity:
            escalatedCases >= 10
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'COMPLIANCE_ESCALATIONS',

          title:
            'Compliance escalations',

          weight:
            0.9,

          evidence: {
            escalatedCases,
            activeCases,
          },

          source:
            'complianceCenter',
        }),
      );
    }

    if (
      reviewRequired > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.COMPLIANCE,

          severity:
            reviewRequired >= 20
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'COMPLIANCE_REVIEW_DEMAND',

          title:
            'Compliance review demand',

          weight:
            0.7,

          evidence: {
            reviewRequired,
            activeCases,
          },

          source:
            'complianceCenter',
        }),
      );
    }

    return {
      signals,

      metrics: {
        activeCases,
        blockedCases,
        escalatedCases,
        reviewRequired,
      },
    };
  }

  _buildAlertSignals(
    source,
  ) {
    const data =
      source?.data ??
      {};

    const critical =
      extractCount(
        data,
        'critical',
        'counts.critical',
        'summary.critical',
        'activeCritical',
      );

    const high =
      extractCount(
        data,
        'high',
        'counts.high',
        'summary.high',
        'activeHigh',
      );

    const active =
      extractCount(
        data,
        'active',
        'activeAlerts',
        'counts.active',
        'summary.active',
      );

    const escalated =
      extractCount(
        data,
        'escalated',
        'counts.escalated',
        'summary.escalated',
      );

    const signals = [];

    if (
      critical > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.OPERATIONAL,

          severity:
            'CRITICAL',

          code:
            'CRITICAL_ALERTS',

          title:
            'Critical operational alerts',

          weight:
            1,

          evidence: {
            critical,
            active,
          },

          source:
            'alertManager',
        }),
      );
    }

    if (
      high > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.OPERATIONAL,

          severity:
            high >= 10
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'HIGH_ALERTS',

          title:
            'High-severity operational alerts',

          weight:
            0.85,

          evidence: {
            high,
            active,
          },

          source:
            'alertManager',
        }),
      );
    }

    if (
      escalated > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.OPERATIONAL,

          severity:
            escalated >= 5
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'ALERT_ESCALATIONS',

          title:
            'Operational alert escalations',

          weight:
            0.8,

          evidence: {
            escalated,
            active,
          },

          source:
            'alertManager',
        }),
      );
    }

    return {
      signals,

      metrics: {
        critical,
        high,
        active,
        escalated,
      },
    };
  }

  _buildAgentSignals(
    source,
  ) {
    const data =
      source?.data ??
      {};

    const failed =
      extractCount(
        data,
        'failed',
        'counts.failed',
        'summary.failed',
      );

    const blocked =
      extractCount(
        data,
        'blocked',
        'counts.blocked',
        'summary.blocked',
      );

    const timedOut =
      extractCount(
        data,
        'timedOut',
        'counts.timedOut',
        'summary.timedOut',
      );

    const partial =
      extractCount(
        data,
        'partial',
        'counts.partial',
        'summary.partial',
      );

    const signals = [];

    if (
      failed > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.OPERATIONAL,

          severity:
            failed >= 5
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'AGENT_FAILURES',

          title:
            'Agent execution failures',

          weight:
            0.65,

          evidence: {
            failed,
          },

          source:
            'agentOrchestrator',
        }),
      );
    }

    if (
      blocked > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.OPERATIONAL,

          severity:
            blocked >= 5
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'AGENT_BLOCKS',

          title:
            'Agent runs blocked',

          weight:
            0.7,

          evidence: {
            blocked,
          },

          source:
            'agentOrchestrator',
        }),
      );
    }

    if (
      timedOut > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.OBSERVABILITY,

          severity:
            timedOut >= 5
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'AGENT_TIMEOUTS',

          title:
            'Agent execution timeouts',

          weight:
            0.5,

          evidence: {
            timedOut,
          },

          source:
            'agentOrchestrator',
        }),
      );
    }

    if (
      partial > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.OBSERVABILITY,

          severity:
            partial >= 10
              ? 'MEDIUM'
              : 'LOW',

          code:
            'AGENT_PARTIAL_RUNS',

          title:
            'Partial agent runs',

          weight:
            0.35,

          evidence: {
            partial,
          },

          source:
            'agentOrchestrator',
        }),
      );
    }

    return {
      signals,

      metrics: {
        failed,
        blocked,
        timedOut,
        partial,
      },
    };
  }

  _buildModelRiskSignals(
    source,
  ) {
    const data =
      source?.data ??
      {};

    const critical =
      extractCount(
        data,
        'critical',
        'counts.critical',
        'summary.critical',
      );

    const significant =
      extractCount(
        data,
        'significant',
        'counts.significant',
        'summary.significant',
      );

    const elevated =
      extractCount(
        data,
        'elevated',
        'counts.elevated',
        'summary.elevated',
      );

    const indeterminate =
      extractCount(
        data,
        'indeterminate',
        'counts.indeterminate',
        'summary.indeterminate',
      );

    const signals = [];

    if (
      critical > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.MODEL_RISK,

          severity:
            'CRITICAL',

          code:
            'CRITICAL_MODEL_DRIFT',

          title:
            'Critical model-risk findings',

          weight:
            1,

          evidence: {
            critical,
          },

          source:
            'modelDriftMonitor',
        }),
      );
    }

    if (
      significant > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.MODEL_RISK,

          severity:
            significant >= 5
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'SIGNIFICANT_MODEL_DRIFT',

          title:
            'Significant model-risk findings',

          weight:
            0.9,

          evidence: {
            significant,
          },

          source:
            'modelDriftMonitor',
        }),
      );
    }

    if (
      elevated > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.MODEL_RISK,

          severity:
            elevated >= 10
              ? 'MEDIUM'
              : 'LOW',

          code:
            'ELEVATED_MODEL_DRIFT',

          title:
            'Elevated model drift',

          weight:
            0.6,

          evidence: {
            elevated,
          },

          source:
            'modelDriftMonitor',
        }),
      );
    }

    if (
      indeterminate > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.MODEL_RISK,

          severity:
            'MEDIUM',

          code:
            'INDETERMINATE_MODEL_RISK',

          title:
            'Indeterminate model-risk findings',

          weight:
            0.55,

          evidence: {
            indeterminate,
          },

          source:
            'modelDriftMonitor',
        }),
      );
    }

    return {
      signals,

      metrics: {
        critical,
        significant,
        elevated,
        indeterminate,
      },
    };
  }

  _buildExplainabilitySignals(
    source,
  ) {
    const data =
      source?.data ??
      {};

    const total =
      extractCount(
        data,
        'total',
        'count',
        'summary.total',
        'counts.total',
      );

    const unavailable =
      extractCount(
        data,
        'unavailable',
        'counts.unavailable',
        'summary.unavailable',
      );

    const failures =
      extractCount(
        data,
        'failures',
        'counts.failures',
        'summary.failures',
        'integrityFailures',
      );

    const signals = [];

    if (
      failures > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.EXPLAINABILITY,

          severity:
            failures >= 3
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'EXPLAINABILITY_FAILURES',

          title:
            'Explainability evidence failures',

          weight:
            0.75,

          evidence: {
            failures,
            total,
          },

          source:
            'explainabilityStore',
        }),
      );
    }

    if (
      unavailable > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.EXPLAINABILITY,

          severity:
            unavailable >= 10
              ? 'MEDIUM'
              : 'LOW',

          code:
            'EXPLAINABILITY_UNAVAILABLE',

          title:
            'Explainability evidence unavailable',

          weight:
            0.45,

          evidence: {
            unavailable,
            total,
          },

          source:
            'explainabilityStore',
        }),
      );
    }

    return {
      signals,

      metrics: {
        total,
        unavailable,
        failures,
      },
    };
  }

  _buildDiagnosticsSignals(
    source,
  ) {
    const data =
      source?.data ??
      {};

    const failed =
      extractCount(
        data,
        'counts.fail',
        'failed',
        'summary.fail',
        'countFail',
      );

    const warn =
      extractCount(
        data,
        'counts.warn',
        'warn',
        'summary.warn',
        'countWarn',
      );

    const unknown =
      extractCount(
        data,
        'counts.unknown',
        'unknown',
        'summary.unknown',
      );

    const unsafe =
      extractCount(
        data,
        'counts.unsafe',
        'unsafe',
        'summary.unsafe',
      );

    const signals = [];

    if (
      unsafe > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.OBSERVABILITY,

          severity:
            'CRITICAL',

          code:
            'DIAGNOSTIC_UNSAFE',

          title:
            'Diagnostic safety violations',

          weight:
            1,

          evidence: {
            unsafe,
          },

          source:
            'diagnosticsService',
        }),
      );
    }

    if (
      failed > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.OBSERVABILITY,

          severity:
            failed >= 3
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'DIAGNOSTIC_FAILURES',

          title:
            'Diagnostic failures',

          weight:
            0.8,

          evidence: {
            failed,
          },

          source:
            'diagnosticsService',
        }),
      );
    }

    if (
      warn > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.OBSERVABILITY,

          severity:
            warn >= 10
              ? 'MEDIUM'
              : 'LOW',

          code:
            'DIAGNOSTIC_WARNINGS',

          title:
            'Diagnostic warnings',

          weight:
            0.45,

          evidence: {
            warn,
          },

          source:
            'diagnosticsService',
        }),
      );
    }

    if (
      unknown > 0
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.OBSERVABILITY,

          severity:
            'LOW',

          code:
            'DIAGNOSTIC_UNKNOWN',

          title:
            'Indeterminate diagnostic checks',

          weight:
            0.25,

          evidence: {
            unknown,
          },

          source:
            'diagnosticsService',
        }),
      );
    }

    return {
      signals,

      metrics: {
        failed,
        warn,
        unknown,
        unsafe,
      },
    };
  }

  _sourceDataState(
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
        : extractNullableCount(
          data,
          'summary.total',
          'total',
          'count',
          'counts.total',
        ) ??
          0;

    const partial =
      Boolean(
        source?.error ||
          source?.unsafe ||
          data?.dataState ===
            'PARTIAL' ||
          data?.dataState ===
            'TRUNCATED',
      );

    return {
      source:
        name,

      configured,

      available,

      dataState:
        deriveDataState({
          configured,
          available,
          partial,
          count,
        }),

      method:
        source?.method ??
        null,

      unsafe:
        Boolean(
          source?.unsafe,
        ),

      error:
        source?.error ??
        null,
    };
  }

  _buildAvailabilitySignals(
    sourceStates,
  ) {
    const unavailable =
      sourceStates.filter(
        (item) =>
          item.configured &&
          !item.available,
      );

    const unsafe =
      sourceStates.filter(
        (item) =>
          item.unsafe,
      );

    const signals = [];

    if (
      unsafe.length
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.PROVIDER,

          severity:
            'CRITICAL',

          code:
            'SOURCE_SAFETY_VIOLATIONS',

          title:
            'Unsafe command-center source boundaries',

          weight:
            1,

          evidence: {
            sources:
              unsafe.map(
                (item) =>
                  item.source,
              ),
          },

          source:
            'source-contracts',

          explanation:
            'One or more configured read models reported operations outside the executive read-only boundary.',
        }),
      );
    }

    if (
      unavailable.length
    ) {
      signals.push(
        normalizeRiskSignal({
          family:
            EXECUTIVE_RISK_FAMILIES.OBSERVABILITY,

          severity:
            unavailable.length >=
              3
              ? 'HIGH'
              : 'MEDIUM',

          code:
            'SOURCE_UNAVAILABLE',

          title:
            'Risk intelligence sources unavailable',

          weight:
            0.75,

          evidence: {
            sources:
              unavailable.map(
                (item) =>
                  item.source,
              ),
          },

          source:
            'source-contracts',
        }),
      );
    }

    return signals;
  }

  _scoreFamilies(
    families,
    availabilityPenalty = 0,
  ) {
    const weights =
      this.config.score;

    const familyScores = {
      governance:
        firstDefined(
          families[
            EXECUTIVE_RISK_FAMILIES
              .GOVERNANCE
          ]?.score,
          0,
        ),

      compliance:
        firstDefined(
          families[
            EXECUTIVE_RISK_FAMILIES
              .COMPLIANCE
          ]?.score,
          0,
        ),

      operational:
        firstDefined(
          families[
            EXECUTIVE_RISK_FAMILIES
              .OPERATIONAL
          ]?.score,
          0,
        ),

      fraud:
        firstDefined(
          families[
            EXECUTIVE_RISK_FAMILIES
              .FRAUD
          ]?.score,
          0,
        ),

      modelRisk:
        firstDefined(
          families[
            EXECUTIVE_RISK_FAMILIES
              .MODEL_RISK
          ]?.score,
          0,
        ),

      dataIntegrity:
        firstDefined(
          families[
            EXECUTIVE_RISK_FAMILIES
              .DATA_INTEGRITY
          ]?.score,
          0,
        ),

      approval:
        firstDefined(
          families[
            EXECUTIVE_RISK_FAMILIES
              .APPROVAL
          ]?.score,
          0,
        ),
    };

    let weighted =
      0;

    let availableWeight =
      0;

    for (
      const [
        key,
        weight,
      ] of Object.entries(
        weights,
      )
    ) {
      const numericWeight =
        clamp(
          weight,
          0,
          1,
        );

      if (
        familyScores[
          key
        ] !== null &&
        familyScores[
          key
        ] !== undefined
      ) {
        weighted +=
          familyScores[
            key
          ] *
          numericWeight;

        availableWeight +=
          numericWeight;
      }
    }

    const base =
      availableWeight >
      0
        ? weighted /
          availableWeight
        : null;

    const adjusted =
      base === null
        ? null
        : clamp(
          base +
            availabilityPenalty,
        );

    return {
      score:
        adjusted,

      band:
        bandFromScore(
          adjusted,
        ),

      components:
        familyScores,

      availabilityPenalty,
    };
  }

  _collectEvidenceSignals(
    sourceMap,
  ) {
    const outputs = [];

    const governance =
      this._buildGovernanceSignals(
        sourceMap
          .governanceDashboard,
      );

    const compliance =
      this._buildComplianceSignals(
        sourceMap
          .complianceCenter,
      );

    const alerts =
      this._buildAlertSignals(
        sourceMap
          .alertManager,
      );

    const agents =
      this._buildAgentSignals(
        sourceMap
          .agentOrchestrator,
      );

    const model =
      this._buildModelRiskSignals(
        sourceMap
          .modelDriftMonitor,
      );

    const explainability =
      this._buildExplainabilitySignals(
        sourceMap
          .explainabilityStore,
      );

    const diagnostics =
      this._buildDiagnosticsSignals(
        sourceMap
          .diagnosticsService,
      );

    outputs.push(
      governance,
      compliance,
      alerts,
      agents,
      model,
      explainability,
      diagnostics,
    );

    return {
      signals:
        outputs.flatMap(
          (item) =>
            item.signals,
        ),

      metrics: {
        governance:
          governance.metrics,

        compliance:
          compliance.metrics,

        alerts:
          alerts.metrics,

        agents:
          agents.metrics,

        modelRisk:
          model.metrics,

        explainability:
          explainability.metrics,

        diagnostics:
          diagnostics.metrics,
      },
    };
  }

  _buildTrendSignals(
    sourceMap,
    range,
  ) {
    const records = [];

    for (
      const [
        sourceName,
        source,
      ] of Object.entries(
        sourceMap,
      )
    ) {
      const rawRecords =
        extractRecords(
          source?.data,
          'trends',
          'records',
          'signals',
          'checks',
          'reports',
          'cases',
          'alerts',
        );

      for (
        const item of
        safeList(
          rawRecords,
          this.config
            .maxSourceRecords,
        )
      ) {
        records.push({
          timestamp:
            firstDefined(
              item.timestamp,
              item.createdAt,
              item.generatedAt,
              item.updatedAt,
            ),

          severity:
            upper(
              item.severity,
              30,
            ),

          score:
            finiteNumber(
              item.score,
              null,
            ),

          source:
            sourceName,
        });
      }
    }

    const buckets =
      aggregateTrendBuckets(
        records,
        range.startAt,
        range.endAt,
        this.config
          .maxTrendBuckets,
      );

    const midpoint =
      Math.floor(
        buckets.length /
          2,
      );

    const previous =
      buckets
        .slice(
          0,
          midpoint,
        )
        .filter(
          (item) =>
            item.averageScore !==
            null,
        );

    const current =
      buckets
        .slice(
          midpoint,
        )
        .filter(
          (item) =>
            item.averageScore !==
            null,
        );

    const previousAverage =
      previous.length
        ? previous.reduce(
          (
            sum,
            item,
          ) =>
            sum +
            item.averageScore,
          0,
        ) /
          previous.length
        : null;

    const currentAverage =
      current.length
        ? current.reduce(
          (
            sum,
            item,
          ) =>
            sum +
            item.averageScore,
          0,
        ) /
          current.length
        : null;

    return {
      bucketCount:
        buckets.length,

      buckets,

      direction:
        trendDirection(
          currentAverage,
          previousAverage,
        ),

      previousAverage:
        previousAverage ===
        null
          ? null
          : Number(
            previousAverage.toFixed(
              4,
            ),
          ),

      currentAverage:
        currentAverage ===
        null
          ? null
          : Number(
            currentAverage.toFixed(
              4,
            ),
          ),

      sourceRecordCount:
        records.length,
    };
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
        scope:
          normalized.scope,

        tenantScope:
          normalized.tenantScope,

        provider:
          normalized.provider,

        range:
          normalized.range,

        timeoutMs:
          normalized.timeoutMs,

        mode:
          normalized.mode,

        includeEvidence:
          normalized.includeEvidence,

        includeTrends:
          normalized.includeTrends,

        includeSources:
          normalized.includeSources,

        metadata:
          normalized.metadata,
      })}`;

    if (
      normalized.idempotencyKey &&
      this.repository
        ?.findByIdempotencyKey
    ) {
      const existing =
        await this.repository.findByIdempotencyKey({
          tenantScope:
            normalized.tenantScope,

          idempotencyKey:
            normalized.idempotencyKey,
        });

      if (existing) {
        if (
          existing.requestFingerprint !==
          requestFingerprint
        ) {
          throw new ExecutiveRiskCenterError(
            EXECUTIVE_RISK_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            'Executive-risk idempotency key maps to a different request.',
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

    this._metric(
      'titech.airtel.executive_risk.started',
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
          this._sourceDataState(
            name,
            source,
          ),
      );

    const evidence =
      this._collectEvidenceSignals(
        sourceMap,
      );

    const availabilitySignals =
      this._buildAvailabilitySignals(
        sourceStates,
      );

    const signals = [
      ...evidence.signals,
      ...availabilitySignals,
    ];

    const families =
      summarizeFamilySignals(
        signals,
      );

    const configuredSources =
      sourceStates.filter(
        (item) =>
          item.configured,
      );

    const availableSources =
      sourceStates.filter(
        (item) =>
          item.configured &&
          item.available,
      );

    const unavailableSources =
      sourceStates.filter(
        (item) =>
          item.configured &&
          !item.available,
      );

    const unsafeSources =
      sourceStates.filter(
        (item) =>
          item.unsafe,
      );

    const availabilityPenalty =
      configuredSources.length
        ? Math.min(
          20,
          (unavailableSources.length /
            configuredSources.length) *
            20,
        )
        : 0;

    const scoring =
      this._scoreFamilies(
        families,
        availabilityPenalty,
      );

    const requiredFailures =
      sourceStates.filter(
        (item) =>
          this.requiredSources.has(
            item.source,
          ) &&
          (
            !item.configured ||
            !item.available ||
            item.unsafe
          ),
      );

    const dataState =
      requiredFailures.length &&
      this.config
        .failClosedOnRequiredSourceFailure
        ? DATA_STATES.UNAVAILABLE
        : unsafeSources.length ||
            unavailableSources.length
          ? DATA_STATES.PARTIAL
          : configuredSources.length ===
              0
            ? DATA_STATES.UNAVAILABLE
            : availableSources.length ===
                0
              ? DATA_STATES.EMPTY
              : DATA_STATES.AVAILABLE;

    const overallStatus =
      requiredFailures.length &&
      this.config
        .failClosedOnRequiredSourceFailure
        ? 'UNAVAILABLE'
        : unsafeSources.length
          ? 'DEGRADED'
          : unavailableSources.length
            ? 'DEGRADED'
            : 'AVAILABLE';

    const scoreConfidence =
      configuredSources.length
        ? Number(
          (
            (availableSources.length /
              configuredSources.length) *
            100
          ).toFixed(4),
        )
        : 0;

    const topRisks =
      signals
        .slice()
        .sort(
          (
            a,
            b,
          ) =>
            severityWeight(
              b.severity,
            ) -
              severityWeight(
                a.severity,
              ) ||
            b.weight -
              a.weight ||
            a.code.localeCompare(
              b.code,
            ),
        )
        .slice(
          0,
          this.config
            .maxTopRisks,
        )
        .map(
          (
            signal,
          ) => ({
            ...signal,

            score:
              clamp(
                severityWeight(
                  signal.severity,
                ) *
                  100 *
                  signal.weight,
              ),
          }),
        );

    const trends =
      normalized.includeTrends
        ? this._buildTrendSignals(
          sourceMap,
          normalized.range,
        )
        : null;

    const previousScore =
      trends?.previousAverage ??
      null;

    const currentScore =
      trends?.currentAverage ??
      scoring.score;

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

      status:
        overallStatus,

      dataState,

      posture: {
        score:
          scoring.score ===
          null
            ? null
            : Number(
              scoring.score.toFixed(
                4,
              ),
            ),

        band:
          scoring.band,

        direction:
          trendDirection(
            currentScore,
            previousScore,
          ),

        confidencePercent:
          scoreConfidence,

        semantics:
          'OPERATIONAL_EXECUTIVE_RISK_POSTURE_ONLY',

        notACloudCreditScore:
          true,

        notAnAuthorizationDecision:
          true,

        notAnAdverseActionDecision:
          true,
      },

      families,

      topRisks:
        normalized.includeEvidence
          ? topRisks
          : [],

      metrics:
        evidence.metrics,

      sourceHealth:
        sourceStates,

      sourceSummary: {
        configured:
          configuredSources.length,

        available:
          availableSources.length,

        unavailable:
          unavailableSources.length,

        unsafe:
          unsafeSources.length,

        availabilityPercent:
          safePercent(
            availableSources.length,
            configuredSources.length,
          ),
      },

      trends,

      governance: {
        decisionCount:
          evidence.metrics
            .governance
            .totalDecisions,

        blocked:
          evidence.metrics
            .governance
            .blocked,

        conflicts:
          evidence.metrics
            .governance
            .conflicts,

        reviewRequired:
          evidence.metrics
            .governance
            .reviewRequired,

        integrityFailures:
          evidence.metrics
            .governance
            .integrityFailures,
      },

      compliance: {
        activeCases:
          evidence.metrics
            .compliance
            .activeCases,

        blockedCases:
          evidence.metrics
            .compliance
            .blockedCases,

        escalatedCases:
          evidence.metrics
            .compliance
            .escalatedCases,

        reviewRequired:
          evidence.metrics
            .compliance
            .reviewRequired,
      },

      operations: {
        activeAlerts:
          evidence.metrics
            .alerts
            .active,

        criticalAlerts:
          evidence.metrics
            .alerts
            .critical,

        highAlerts:
          evidence.metrics
            .alerts
            .high,

        escalatedAlerts:
          evidence.metrics
            .alerts
            .escalated,

        agentFailures:
          evidence.metrics
            .agents
            .failed,

        agentBlocks:
          evidence.metrics
            .agents
            .blocked,

        agentTimeouts:
          evidence.metrics
            .agents
            .timedOut,
      },

      modelRisk:
        evidence.metrics
          .modelRisk,

      explainability:
        evidence.metrics
          .explainability,

      observability: {
        diagnosticFailures:
          evidence.metrics
            .diagnostics
            .failed,

        diagnosticWarnings:
          evidence.metrics
            .diagnostics
            .warn,

        diagnosticUnknown:
          evidence.metrics
            .diagnostics
            .unknown,

        diagnosticUnsafe:
          evidence.metrics
            .diagnostics
            .unsafe,
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

      limitations: {
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

        scoreIsHeuristicOperationalPosture:
          true,
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

    result.diagnosticFingerprint =
      buildSemanticFingerprint(
        redact(result),
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
      throw new ExecutiveRiskCenterError(
        EXECUTIVE_RISK_ERROR_CODES.PAYLOAD_TOO_LARGE,
        `Executive-risk snapshot exceeds ${this.config.maxPayloadBytes} bytes.`,
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
      this.repository
        ?.saveSnapshot
    ) {
      try {
        await this.repository.saveSnapshot(
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
          'Executive-risk snapshot persistence failed.',
          error,
          {
            snapshotId,
          },
        );

        if (
          error?.code ===
          EXECUTIVE_RISK_ERROR_CODES.IDEMPOTENCY_CONFLICT
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
      'titech.airtel.executive_risk.completed',
      {
        scope:
          normalized.scope,

        status:
          overallStatus,

        band:
          scoring.band,
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

      posture:
        result.posture,

      topRisks:
        result.topRisks,

      families:
        result.families,

      sourceSummary:
        result.sourceSummary,

      diagnosticFingerprint:
        result.diagnosticFingerprint,
    });
  }

  async getTopRisks(
    input = {},
  ) {
    const result =
      await this.aggregate({
        ...input,

        includeEvidence:
          true,

        includeTrends:
          false,

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

      posture:
        result.posture,

      topRisks:
        result.topRisks,

      fingerprint:
        result.diagnosticFingerprint,
    });
  }

  async getTrends(
    input = {},
  ) {
    const result =
      await this.aggregate({
        ...input,

        includeEvidence:
          false,

        includeTrends:
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

      posture:
        result.posture,

      trends:
        result.trends,

      fingerprint:
        result.diagnosticFingerprint,
    });
  }

  async getSourceHealth(
    input = {},
  ) {
    const normalized =
      this._normalizeInput(
        input,
      );

    const sourceMap =
      await this._collectSources(
        normalized,
      );

    const sourceHealth =
      Object.entries(
        sourceMap,
      ).map(
        ([
          name,
          source,
        ]) =>
          this._sourceDataState(
            name,
            source,
          ),
      );

    return deepFreeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      scope:
        normalized.scope,

      tenantScope:
        normalized.tenantScope,

      sourceHealth,

      availabilityPercent:
        safePercent(
          sourceHealth.filter(
            (item) =>
              item.configured &&
              item.available,
          ).length,

          sourceHealth.filter(
            (item) =>
              item.configured,
          ).length,
        ),
    });
  }

  async listSnapshots(
    {
      tenantId,
      scope = 'TENANT',
      limit =
        this.config
          .defaultHistoryLimit,
      offset = 0,
    } = {},
  ) {
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
      !this.repository
        ?.listSnapshots
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
          (record) =>
            redact(record),
        ),

      limit:
        boundedLimit,

      offset:
        boundedOffset,
    });
  }

  async getSnapshot(
    {
      tenantId,
      scope = 'TENANT',
      snapshotId,
    } = {},
  ) {
    const scopeInfo =
      normalizeScope(
        {
          tenantId,
          scope,
        },
        this.config,
      );

    const normalizedSnapshotId =
      normalizeString(
        snapshotId,
        220,
      );

    if (
      !normalizedSnapshotId
    ) {
      throw new ExecutiveRiskCenterError(
        EXECUTIVE_RISK_ERROR_CODES.INVALID_INPUT,
        'snapshotId is required.',
      );
    }

    if (
      !this.repository
        ?.getSnapshot
    ) {
      return null;
    }

    const snapshot =
      await this.repository.getSnapshot(
        {
          tenantScope:
            scopeInfo.tenantScope,

          snapshotId:
            normalizedSnapshotId,
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

        includeTrends:
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
      throw new ExecutiveRiskCenterError(
        EXECUTIVE_RISK_ERROR_CODES.EXPORT_TOO_LARGE,
        `Executive-risk export exceeds ${this.config.maxExportBytes} bytes.`,
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
        `airtel-executive-risk-center-${result.scope.toLowerCase()}.json`,

      bytes,

      fingerprint:
        `sha256:${sha256(
          content,
        )}`,

      content,
    });
  }

  async health() {
    const sourceNames =
      Object.keys(
        this.sources,
      );

    const configured =
      sourceNames.filter(
        (
          name,
        ) =>
          sourceAvailable(
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
        (name) =>
          !sourceAvailable(
            this.sources[
              name
            ],
          ),
      );

    const repositoryConfigured =
      Boolean(
        this.repository,
      );

    let repository =
      null;

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
              raw?.ok !== false,

            state:
              upper(
                raw?.state,
                40,
              ) ??
              null,

            method,
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
    } else {
      repository = {
        configured:
          false,

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
      };
    }

    const state =
      missingRequired.length ||
      (
        this.config
          .requireRepository &&
        repository?.available ===
          false
      )
        ? HEALTH_STATES.UNAVAILABLE
        : configured.length <
            sourceNames.length
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

        sourceCount:
          sourceNames.length,

        configuredSourceCount:
          configured.length,

        missingRequiredSources:
          missingRequired,

        repository,

        readOnly:
          true,

        operationalScoreOnly:
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

      readOnly:
        true,

      tenantIsolation:
        true,

      systemDiagnostics:
        this.config
          .allowSystemScope,

      deterministicFingerprint:
        true,

      boundedConcurrency:
        true,

      boundedTimeouts:
        true,

      repositoryPersistence:
        Boolean(
          this.repository,
        ),

      operationalRiskPostureOnly:
        true,

      creditDecision:
        false,

      adverseActionDecision:
        false,

      financialMutation:
        false,

      ledgerMutation:
        false,

      balanceMutation:
        false,

      providerCalls:
        false,

      paymentExecution:
        false,

      settlement:
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
      typeof this.repository
        ?.close ===
      'function'
    ) {
      await this.repository.close();
    }
  }
}

export function createExecutiveRiskCenter(
  options = {},
) {
  return new ExecutiveRiskCenter(
    options,
  );
}

export const createAirtelExecutiveRiskCenter =
  createExecutiveRiskCenter;

export const AirtelExecutiveRiskCenter =
  ExecutiveRiskCenter;

export const constants =
  Object.freeze({
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    PROVIDER,
    SCHEMA_VERSION,
    HASH_ALGORITHM,
    RISK_BANDS,
    RISK_DIRECTIONS,
    DATA_STATES,
    HEALTH_STATES,
    EXECUTIVE_SEVERITIES,
    EXECUTIVE_RISK_FAMILIES,
    EXECUTIVE_RISK_ERROR_CODES,
  });

export function buildExecutiveRiskFingerprint(
  value,
) {
  return buildSemanticFingerprint(
    value,
  );
}

export default ExecutiveRiskCenter;