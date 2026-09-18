/**
 * TITech Community Capital
 * File: backend/modules/payment/airtel/intelligence/governance/modelDriftMonitor.js
 *
 * Architectural role
 * ------------------
 * Enterprise model-drift detection and model-risk observability boundary for
 * Airtel payment intelligence models used by the TITech governance stack.
 *
 * This module evaluates whether observed model inputs, outputs, confidence
 * distributions, and (when legitimately available) outcome/performance
 * signals have materially changed relative to an approved baseline.
 *
 * Important boundaries / non-responsibilities
 * --------------------------------------------
 * - NOT a model-serving or inference engine.
 * - NOT a model-training, retraining, fine-tuning, or feature-engineering job.
 * - NOT a payment execution or settlement service.
 * - NOT the financial source of truth.
 * - NOT the canonical double-entry accounting ledger.
 * - NOT a policy engine or authorization engine.
 * - NOT an approval workflow state machine.
 * - NOT an AML/KYC/sanctions decision engine.
 * - NOT a replacement for independent model validation.
 * - NOT an automatic model-disable switch unless an explicitly injected,
 *   separately governed control consumes its output. This module itself never
 *   disables a model, rejects a payment, changes limits, or mutates money.
 * - NOT a demographic scoring mechanism. Protected or demographic attributes
 *   must not be used as direct adverse-decision drivers by this component.
 * - NOT a raw feature warehouse. Sensitive values are summarized, hashed,
 *   bounded, or omitted.
 *
 * Production principles
 * ---------------------
 * - Tenant isolation is mandatory by default.
 * - Airtel provider scope is fail-closed.
 * - Baselines are explicit, versioned, approved, immutable records.
 * - Current observations are bounded by count, dimensions, categories, and
 *   payload size to protect API/database resources.
 * - Numeric drift uses PSI and normalized distribution statistics.
 * - Categorical drift uses PSI plus Jensen-Shannon divergence.
 * - Missingness and schema-change signals are monitored independently.
 * - Output/score drift is separated from feature drift.
 * - Performance drift is only evaluated when valid observed labels are present;
 *   this module never invents labels or treats proxy outcomes as ground truth.
 * - No single statistical metric is treated as absolute proof. Results are
 *   combined into deterministic severity bands and surfaced for governance.
 * - Evidence quality is explicit: healthy, stale, missing, conflicting,
 *   insufficient-sample, or unavailable.
 * - Drift results are reproducible from normalized inputs and configuration.
 * - Findings are audit-friendly and tamper-evident through fingerprints.
 * - Optional persistence is injected through a repository contract. Production
 *   must use a durable repository; the in-memory adapter is for tests/local use.
 * - Observability/audit failures never mutate model or financial state.
 *
 * Module format
 * -------------
 * - Native ECMAScript module (ESM).
 * - Node.js built-ins only.
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME = 'airtel-model-drift-monitor';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = 'sha256';

export const DRIFT_STATUS = Object.freeze({
  NO_DRIFT: 'NO_DRIFT',
  OBSERVE: 'OBSERVE',
  ELEVATED: 'ELEVATED',
  SIGNIFICANT: 'SIGNIFICANT',
  CRITICAL: 'CRITICAL',
  INDETERMINATE: 'INDETERMINATE',
});

export const EVIDENCE_STATUS = Object.freeze({
  HEALTHY: 'HEALTHY',
  STALE: 'STALE',
  MISSING: 'MISSING',
  CONFLICTING: 'CONFLICTING',
  INSUFFICIENT_SAMPLE: 'INSUFFICIENT_SAMPLE',
  UNAVAILABLE: 'UNAVAILABLE',
  INVALID: 'INVALID',
});

export const DRIFT_TYPES = Object.freeze({
  FEATURE_DISTRIBUTION: 'FEATURE_DISTRIBUTION',
  FEATURE_MISSINGNESS: 'FEATURE_MISSINGNESS',
  FEATURE_SCHEMA: 'FEATURE_SCHEMA',
  OUTPUT_DISTRIBUTION: 'OUTPUT_DISTRIBUTION',
  CONFIDENCE_DISTRIBUTION: 'CONFIDENCE_DISTRIBUTION',
  PERFORMANCE: 'PERFORMANCE',
  CALIBRATION: 'CALIBRATION',
  PREDICTION_RATE: 'PREDICTION_RATE',
});

export const SEVERITY = Object.freeze({
  INFO: 'INFO',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const MODEL_DRIFT_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'MODEL_DRIFT_INVALID_INPUT',
  TENANT_REQUIRED: 'MODEL_DRIFT_TENANT_REQUIRED',
  PROVIDER_SCOPE_VIOLATION: 'MODEL_DRIFT_PROVIDER_SCOPE_VIOLATION',
  MODEL_REQUIRED: 'MODEL_DRIFT_MODEL_REQUIRED',
  VERSION_REQUIRED: 'MODEL_DRIFT_MODEL_VERSION_REQUIRED',
  BASELINE_REQUIRED: 'MODEL_DRIFT_BASELINE_REQUIRED',
  OBSERVATIONS_REQUIRED: 'MODEL_DRIFT_OBSERVATIONS_REQUIRED',
  OBSERVATIONS_INVALID: 'MODEL_DRIFT_OBSERVATIONS_INVALID',
  SAMPLE_TOO_LARGE: 'MODEL_DRIFT_SAMPLE_TOO_LARGE',
  SAMPLE_TOO_SMALL: 'MODEL_DRIFT_SAMPLE_TOO_SMALL',
  PAYLOAD_TOO_LARGE: 'MODEL_DRIFT_PAYLOAD_TOO_LARGE',
  REPOSITORY_REQUIRED: 'MODEL_DRIFT_REPOSITORY_REQUIRED',
  REPOSITORY_UNAVAILABLE: 'MODEL_DRIFT_REPOSITORY_UNAVAILABLE',
  IDEMPOTENCY_CONFLICT: 'MODEL_DRIFT_IDEMPOTENCY_CONFLICT',
  BASELINE_IMMUTABLE: 'MODEL_DRIFT_BASELINE_IMMUTABLE',
  INTEGRITY_FAILURE: 'MODEL_DRIFT_INTEGRITY_FAILURE',
  INVALID_BASELINE: 'MODEL_DRIFT_INVALID_BASELINE',
  UNSUPPORTED_METRIC: 'MODEL_DRIFT_UNSUPPORTED_METRIC',
});

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER,
  tenantRequired: true,
  maxTenantIdLength: 160,
  maxModelNameLength: 160,
  maxModelVersionLength: 120,
  maxFeatureNameLength: 160,
  maxDimensionCount: 250,
  maxCategoryCount: 100,
  maxObservationCount: 10000,
  maxNumericValuesPerFeature: 10000,
  maxMetadataKeys: 100,
  maxReasonCodes: 50,
  defaultMinSampleSize: 100,
  minDimensionSampleSize: 30,
  maxDriftAgeDays: 30,
  defaultPsiThresholds: Object.freeze({
    observe: 0.05,
    elevated: 0.10,
    significant: 0.20,
    critical: 0.25,
  }),
  defaultJsThresholds: Object.freeze({
    observe: 0.03,
    elevated: 0.05,
    significant: 0.10,
    critical: 0.20,
  }),
  defaultMissingRateDeltaThresholds: Object.freeze({
    observe: 0.02,
    elevated: 0.05,
    significant: 0.10,
    critical: 0.20,
  }),
  defaultPerformanceDropThresholds: Object.freeze({
    observe: 0.02,
    elevated: 0.05,
    significant: 0.10,
    critical: 0.20,
  }),
  defaultConfidenceMeanDeltaThresholds: Object.freeze({
    observe: 0.03,
    elevated: 0.05,
    significant: 0.10,
    critical: 0.20,
  }),
  defaultPredictionRateDeltaThresholds: Object.freeze({
    observe: 0.03,
    elevated: 0.07,
    significant: 0.15,
    critical: 0.25,
  }),
  psiBins: 10,
  histogramPrecision: 6,
  minProbability: 0.000001,
  staleBaselineDays: 30,
  staleObservationDays: 2,
  failClosedOnRepositoryError: false,
  failClosedOnAuditError: false,
  integrityMode: 'hash',
  defaultWindowHours: 24,
  maxWindowHours: 24 * 31,
  defaultBucketHours: 24,
  maxTrendBuckets: 744,
});

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

function toFiniteNumber(value, fallback = undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function toIso(
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

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return fallback;
  }

  return date.toISOString();
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(
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

  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      return value;
    }

    if (Number.isNaN(value)) {
      return 'NaN';
    }

    return value > 0
      ? 'Infinity'
      : '-Infinity';
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

  if (seen.has(value)) {
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
    typeof value.toJSON === 'function'
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

function canonicalize(value) {
  return JSON.stringify(
    stableNormalize(value),
  );
}

function sha256(value) {
  const input =
    typeof value === 'string'
    || Buffer.isBuffer(value)
      ? value
      : canonicalize(value);

  return createHash(
    HASH_ALGORITHM,
  )
    .update(input)
    .digest('hex');
}

function digest(value) {
  return `sha256:${sha256(
    String(value),
  ).slice(0, 40)}`;
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

  return Object.freeze(value);
}

function safeMinMax(items) {
  if (!items.length) {
    return {
      min: null,
      max: null,
    };
  }

  let min = Infinity;
  let max = -Infinity;

  for (
    const value
    of items
  ) {
    if (value < min) {
      min = value;
    }

    if (value > max) {
      max = value;
    }
  }

  return {
    min,
    max,
  };
}

function sum(items) {
  let total = 0;

  for (
    const item
    of items
  ) {
    total += item;
  }

  return total;
}

function mean(items) {
  return items.length
    ? sum(items) / items.length
    : null;
}

function variance(
  items,
  sample = false,
) {
  if (
    items.length
    < (sample ? 2 : 1)
  ) {
    return null;
  }

  const m =
    mean(items);

  const divisor =
    sample
      ? items.length - 1
      : items.length;

  return (
    sum(
      items.map(
        (value) =>
          (value - m) ** 2,
      ),
    )
    / divisor
  );
}

function standardDeviation(
  items,
  sample = false,
) {
  const v =
    variance(
      items,
      sample,
    );

  return v === null
    ? null
    : Math.sqrt(v);
}

function quantile(
  items,
  q,
) {
  if (!items.length) {
    return null;
  }

  const sorted =
    [...items].sort(
      (a, b) => a - b,
    );

  const position =
    (sorted.length - 1) * q;

  const lower =
    Math.floor(position);

  const upper =
    Math.ceil(position);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight =
    position - lower;

  return (
    sorted[lower]
    + (
      sorted[upper]
      - sorted[lower]
    ) * weight
  );
}

function round(
  value,
  precision = 6,
) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const factor =
    10 ** precision;

  return (
    Math.round(
      value * factor,
    )
    / factor
  );
}

function clamp(
  value,
  min,
  max,
) {
  return Math.min(
    max,
    Math.max(
      min,
      value,
    ),
  );
}

function probability(
  value,
  minProbability,
) {
  return clamp(
    Number(value) || 0,
    minProbability,
    1,
  );
}

function safePercentage(
  numerator,
  denominator,
  precision = 2,
) {
  if (!denominator) {
    return 0;
  }

  return round(
    (numerator / denominator)
      * 100,
    precision,
  );
}

function safeRatio(
  numerator,
  denominator,
  precision = 6,
) {
  if (!denominator) {
    return null;
  }

  return round(
    numerator / denominator,
    precision,
  );
}

function normalizeDateRange(
  input = {},
  config = DEFAULT_CONFIG,
  clock = () => new Date(),
) {
  const now =
    toIso(
      clock(),
      new Date().toISOString(),
    );

  const to =
    toIso(
      input.to,
      now,
    );

  const from =
    toIso(
      input.from,
      new Date(
        new Date(to).getTime()
        - config.defaultWindowHours
          * 3_600_000,
      ).toISOString(),
    );

  const fromDate =
    new Date(from);

  const toDate =
    new Date(to);

  if (
    Number.isNaN(
      fromDate.getTime(),
    )
    || Number.isNaN(
      toDate.getTime(),
    )
    || fromDate >= toDate
  ) {
    throw new ModelDriftMonitorError(
      MODEL_DRIFT_ERROR_CODES.INVALID_INPUT,
      'Observation window is invalid.',
      {
        from,
        to,
      },
    );
  }

  const hours =
    (
      toDate.getTime()
      - fromDate.getTime()
    ) / 3_600_000;

  if (
    hours
    > config.maxWindowHours
  ) {
    throw new ModelDriftMonitorError(
      MODEL_DRIFT_ERROR_CODES.INVALID_INPUT,
      `Observation window exceeds ${config.maxWindowHours} hours.`,
      {
        hours,
        maxWindowHours:
          config.maxWindowHours,
      },
    );
  }

  return Object.freeze({
    from,
    to,
    hours:
      round(
        hours,
        3,
      ),
  });
}

function assertPlainObject(
  value,
  name,
) {
  if (!isPlainObject(value)) {
    throw new ModelDriftMonitorError(
      MODEL_DRIFT_ERROR_CODES.INVALID_INPUT,
      `${name} must be an object.`,
    );
  }
}

function redact(
  value,
  key = '',
  depth = 0,
  maxDepth = 6,
) {
  if (depth > maxDepth) {
    return '[TRUNCATED]';
  }

  if (
    value === undefined
    || value === null
  ) {
    return value;
  }

  const sensitive =
    /password|secret|token|authorization|cookie|session|otp|pin|cvv|cvc|pan|private.?key|api.?key|credential|signature|raw.?payload|raw.?request|raw.?response/i;

  const identifier =
    /phone|msisdn|email|national.?id|nin|account(number)?|wallet(number|id)?|customer(number|id)?|device.?id|ip(address)?/i;

  if (
    sensitive.test(key)
  ) {
    return '[REDACTED]';
  }

  if (
    identifier.test(key)
  ) {
    return digest(value);
  }

  if (
    typeof value !== 'object'
  ) {
    return (
      typeof value === 'string'
      && value.length > 400
    )
      ? `${value.slice(0, 397)}...`
      : value;
  }

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
      .map(
        (item) =>
          redact(
            item,
            '',
            depth + 1,
            maxDepth,
          ),
      );
  }

  const result =
    Object.create(null);

  for (
    const entryKey
    of Object.keys(value).slice(
      0,
      100,
    )
  ) {
    result[entryKey] =
      redact(
        value[entryKey],
        entryKey,
        depth + 1,
        maxDepth,
      );
  }

  return result;
}

function normalizeThresholds(
  source,
  defaults,
) {
  const input =
    isPlainObject(source)
      ? source
      : {};

  const observe =
    Math.max(
      0,
      toFiniteNumber(
        input.observe,
        defaults.observe,
      ),
    );

  const elevated =
    Math.max(
      observe,
      toFiniteNumber(
        input.elevated,
        defaults.elevated,
      ),
    );

  const significant =
    Math.max(
      elevated,
      toFiniteNumber(
        input.significant,
        defaults.significant,
      ),
    );

  const critical =
    Math.max(
      significant,
      toFiniteNumber(
        input.critical,
        defaults.critical,
      ),
    );

  return {
    observe,
    elevated,
    significant,
    critical,
  };
}

function severityFromMetric(
  value,
  thresholds,
) {
  if (!Number.isFinite(value)) {
    return DRIFT_STATUS.INDETERMINATE;
  }

  if (
    value
    >= thresholds.critical
  ) {
    return DRIFT_STATUS.CRITICAL;
  }

  if (
    value
    >= thresholds.significant
  ) {
    return DRIFT_STATUS.SIGNIFICANT;
  }

  if (
    value
    >= thresholds.elevated
  ) {
    return DRIFT_STATUS.ELEVATED;
  }

  if (
    value
    >= thresholds.observe
  ) {
    return DRIFT_STATUS.OBSERVE;
  }

  return DRIFT_STATUS.NO_DRIFT;
}

function maxStatus(statuses) {
  const order =
    Object.freeze([
      DRIFT_STATUS.NO_DRIFT,
      DRIFT_STATUS.OBSERVE,
      DRIFT_STATUS.ELEVATED,
      DRIFT_STATUS.SIGNIFICANT,
      DRIFT_STATUS.CRITICAL,
      DRIFT_STATUS.INDETERMINATE,
    ]);

  let current =
    DRIFT_STATUS.NO_DRIFT;

  for (
    const status
    of statuses
  ) {
    if (
      status
      === DRIFT_STATUS.INDETERMINATE
    ) {
      if (
        current
        !== DRIFT_STATUS.CRITICAL
      ) {
        current =
          DRIFT_STATUS.INDETERMINATE;
      }

      continue;
    }

    if (
      order.indexOf(status)
      > order.indexOf(current)
    ) {
      current = status;
    }
  }

  return current;
}

function statusSeverity(
  status,
) {
  const mapping = {
    [DRIFT_STATUS.NO_DRIFT]:
      SEVERITY.INFO,

    [DRIFT_STATUS.OBSERVE]:
      SEVERITY.LOW,

    [DRIFT_STATUS.ELEVATED]:
      SEVERITY.MEDIUM,

    [DRIFT_STATUS.SIGNIFICANT]:
      SEVERITY.HIGH,

    [DRIFT_STATUS.CRITICAL]:
      SEVERITY.CRITICAL,

    [DRIFT_STATUS.INDETERMINATE]:
      SEVERITY.HIGH,
  };

  return (
    mapping[status]
    ?? SEVERITY.HIGH
  );
}

function validateNumericArray(
  values,
  maxItems,
) {
  if (!Array.isArray(values)) {
    return [];
  }

  const output = [];

  for (
    const value
    of values.slice(
      0,
      maxItems,
    )
  ) {
    const numeric =
      toFiniteNumber(
        value,
        null,
      );

    if (numeric !== null) {
      output.push(numeric);
    }
  }

  return output;
}

function histogram(
  values,
  edges,
) {
  const counts =
    new Array(
      Math.max(
        edges.length - 1,
        1,
      ),
    ).fill(0);

  for (
    const value
    of values
  ) {
    let index =
      edges.length - 2;

    for (
      let i = 0;
      i < edges.length - 1;
      i += 1
    ) {
      const lower =
        edges[i];

      const upper =
        edges[i + 1];

      const last =
        i === edges.length - 2;

      if (
        (
          value >= lower
          && value < upper
        )
        || (
          last
          && value <= upper
        )
      ) {
        index = i;
        break;
      }
    }

    counts[index] += 1;
  }

  return counts;
}

function buildQuantileEdges(
  values,
  binCount,
) {
  const sorted =
    [...values].sort(
      (a, b) => a - b,
    );

  if (!sorted.length) {
    return [];
  }

  const min =
    sorted[0];

  const max =
    sorted[
      sorted.length - 1
    ];

  if (min === max) {
    return [
      min,
      max + 1,
    ];
  }

  const edges = [];

  for (
    let index = 0;
    index <= binCount;
    index += 1
  ) {
    const q =
      index / binCount;

    edges.push(
      quantile(
        sorted,
        q,
      ),
    );
  }

  const deduped = [];

  for (
    const edge
    of edges
  ) {
    if (
      !deduped.length
      || edge
        > deduped[
          deduped.length - 1
        ]
    ) {
      deduped.push(edge);
    }
  }

  if (
    deduped.length < 2
  ) {
    return [
      min,
      max + 1,
    ];
  }

  return deduped;
}

function alignProbabilities(
  baseCounts,
  currentCounts,
  minProbability,
) {
  const baseTotal =
    sum(baseCounts);

  const currentTotal =
    sum(currentCounts);

  const length =
    Math.max(
      baseCounts.length,
      currentCounts.length,
    );

  const base = [];
  const current = [];

  for (
    let i = 0;
    i < length;
    i += 1
  ) {
    base.push(
      probability(
        baseCounts[i] ?? 0,
        minProbability,
      ),
    );

    current.push(
      probability(
        currentCounts[i] ?? 0,
        minProbability,
      ),
    );
  }

  const baseSum =
    sum(base);

  const currentSum =
    sum(current);

  return {
    base:
      base.map(
        (value) =>
          value / baseSum,
      ),

    current:
      current.map(
        (value) =>
          value / currentSum,
      ),

    baseTotal,
    currentTotal,
  };
}

function populationStabilityIndex(
  baseCounts,
  currentCounts,
  minProbability,
) {
  const {
    base,
    current,
    baseTotal,
    currentTotal,
  } =
    alignProbabilities(
      baseCounts,
      currentCounts,
      minProbability,
    );

  let value = 0;

  for (
    let i = 0;
    i < base.length;
    i += 1
  ) {
    value +=
      (
        current[i]
        - base[i]
      )
      * Math.log(
        current[i]
        / base[i],
      );
  }

  return {
    psi: value,
    baseTotal,
    currentTotal,
    baseDistribution: base,
    currentDistribution:
      current,
  };
}

function jensenShannonDivergence(
  baseCounts,
  currentCounts,
  minProbability,
) {
  const {
    base,
    current,
    baseTotal,
    currentTotal,
  } =
    alignProbabilities(
      baseCounts,
      currentCounts,
      minProbability,
    );

  const midpoint =
    base.map(
      (value, index) =>
        (
          value
          + current[index]
        ) / 2,
    );

  const kl = (
    left,
    right,
  ) =>
    left.reduce(
      (
        total,
        value,
        index,
      ) =>
        total
        + value
        * Math.log(
          value
          / right[index],
        ),
      0,
    );

  const js =
    0.5 * kl(
      base,
      midpoint,
    )
    + 0.5 * kl(
      current,
      midpoint,
    );

  return {
    js,
    baseTotal,
    currentTotal,
    baseDistribution: base,
    currentDistribution:
      current,
  };
}

function normalizedMeanShift(
  baseValues,
  currentValues,
) {
  if (
    !baseValues.length
    || !currentValues.length
  ) {
    return null;
  }

  const baseMean =
    mean(baseValues);

  const currentMean =
    mean(currentValues);

  const baseStd =
    standardDeviation(
      baseValues,
      false,
    ) ?? 0;

  const denominator =
    Math.max(
      Math.abs(baseStd),
      1e-9,
    );

  return Math.abs(
    currentMean
    - baseMean,
  ) / denominator;
}

function absoluteMeanDelta(
  baseValues,
  currentValues,
) {
  if (
    !baseValues.length
    || !currentValues.length
  ) {
    return null;
  }

  return Math.abs(
    mean(currentValues)
    - mean(baseValues),
  );
}

function ksStatistic(
  baseValues,
  currentValues,
) {
  if (
    !baseValues.length
    || !currentValues.length
  ) {
    return null;
  }

  const a =
    [...baseValues].sort(
      (x, y) => x - y,
    );

  const b =
    [...currentValues].sort(
      (x, y) => x - y,
    );

  let i = 0;
  let j = 0;
  let max = 0;

  while (
    i < a.length
    && j < b.length
  ) {
    const value =
      a[i] <= b[j]
        ? a[i]
        : b[j];

    while (
      i < a.length
      && a[i] <= value
    ) {
      i += 1;
    }

    while (
      j < b.length
      && b[j] <= value
    ) {
      j += 1;
    }

    max =
      Math.max(
        max,
        Math.abs(
          i / a.length
          - j / b.length,
        ),
      );
  }

  return max;
}

function categoricalCounts(
  values,
  categories,
  maxCategoryCount,
) {
  const known =
    new Set(
      categories
        .map(
          (item) =>
            normalizeString(
              item,
              160,
            ),
        )
        .filter(Boolean)
        .slice(
          0,
          maxCategoryCount,
        ),
    );

  const counts =
    new Map();

  for (
    const value
    of values.slice(
      0,
      maxCategoryCount * 1000,
    )
  ) {
    const key =
      normalizeString(
        value,
        160,
      )
      ?? '__MISSING__';

    if (
      known.size
      && !known.has(key)
    ) {
      counts.set(
        '__OTHER__',
        (
          counts.get(
            '__OTHER__',
          )
          ?? 0
        ) + 1,
      );
    } else {
      counts.set(
        key,
        (
          counts.get(key)
          ?? 0
        ) + 1,
      );
    }
  }

  for (
    const category
    of known
  ) {
    if (
      !counts.has(category)
    ) {
      counts.set(
        category,
        0,
      );
    }
  }

  return counts;
}

function countsArray(
  baseValues,
  currentValues,
  categories,
  maxCategoryCount,
) {
  const baseCountsMap =
    categoricalCounts(
      baseValues,
      categories,
      maxCategoryCount,
    );

  const currentCountsMap =
    categoricalCounts(
      currentValues,
      categories,
      maxCategoryCount,
    );

  const keys =
    [
      ...new Set([
        ...baseCountsMap.keys(),
        ...currentCountsMap.keys(),
      ]),
    ].sort();

  return {
    keys,

    baseCounts:
      keys.map(
        (key) =>
          baseCountsMap.get(
            key,
          ) ?? 0,
      ),

    currentCounts:
      keys.map(
        (key) =>
          currentCountsMap.get(
            key,
          ) ?? 0,
      ),
  };
}

function classificationMetrics(
  observations,
) {
  const rows =
    observations.filter(
      (row) =>
        row
        && row.actual !== undefined
        && row.predicted !== undefined,
    );

  if (!rows.length) {
    return null;
  }

  let correct = 0;
  let positiveActual = 0;
  let positivePredicted = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;

  for (
    const row
    of rows
  ) {
    const actual =
      String(
        row.actual,
      ).toUpperCase();

    const predicted =
      String(
        row.predicted,
      ).toUpperCase();

    if (
      actual
      === predicted
    ) {
      correct += 1;
    }

    if (
      actual === '1'
      || actual === 'TRUE'
      || actual === 'POSITIVE'
      || actual === 'YES'
    ) {
      positiveActual += 1;
    }

    if (
      predicted === '1'
      || predicted === 'TRUE'
      || predicted === 'POSITIVE'
      || predicted === 'YES'
    ) {
      positivePredicted += 1;
    }

    const actualPositive =
      actual === '1'
      || actual === 'TRUE'
      || actual === 'POSITIVE'
      || actual === 'YES';

    const predictedPositive =
      predicted === '1'
      || predicted === 'TRUE'
      || predicted === 'POSITIVE'
      || predicted === 'YES';

    if (
      actualPositive
      && predictedPositive
    ) {
      truePositive += 1;
    } else if (
      !actualPositive
      && predictedPositive
    ) {
      falsePositive += 1;
    } else if (
      !actualPositive
      && !predictedPositive
    ) {
      trueNegative += 1;
    } else {
      falseNegative += 1;
    }
  }

  const accuracy =
    safeRatio(
      correct,
      rows.length,
    );

  const precision =
    safeRatio(
      truePositive,
      truePositive
      + falsePositive,
    );

  const recall =
    safeRatio(
      truePositive,
      truePositive
      + falseNegative,
    );

  const specificity =
    safeRatio(
      trueNegative,
      trueNegative
      + falsePositive,
    );

  const f1 =
    precision !== null
    && recall !== null
    && precision + recall > 0
      ? round(
          (
            2
            * precision
            * recall
          )
          / (
            precision + recall
          ),
          6,
        )
      : null;

  return {
    sampleSize:
      rows.length,

    accuracy,

    precision,

    recall,

    specificity,

    f1,

    positiveActualRate:
      safeRatio(
        positiveActual,
        rows.length,
      ),

    positivePredictionRate:
      safeRatio(
        positivePredicted,
        rows.length,
      ),
  };
}

function calibrationError(
  observations,
  bins = 10,
) {
  const rows =
    observations.filter(
      (row) =>
        row
        && row.actual !== undefined
        && row.probability !== undefined,
    );

  if (!rows.length) {
    return null;
  }

  const bucketStats =
    Array.from(
      {
        length: bins,
      },
      (_, index) => ({
        bucket: index,
        count: 0,
        meanProbability: 0,
        empiricalRate: 0,
      }),
    );

  for (
    const row
    of rows
  ) {
    const probabilityValue =
      clamp(
        Number(
          row.probability,
        ),
        0,
        1,
      );

    const actual =
      String(
        row.actual,
      ).toUpperCase();

    const label =
      (
        actual === '1'
        || actual === 'TRUE'
        || actual === 'POSITIVE'
        || actual === 'YES'
      )
        ? 1
        : 0;

    const bucket =
      Math.min(
        bins - 1,
        Math.floor(
          probabilityValue
          * bins,
        ),
      );

    const item =
      bucketStats[bucket];

    item.count += 1;

    item.meanProbability +=
      probabilityValue;

    item.empiricalRate +=
      label;
  }

  let weighted = 0;

  for (
    const item
    of bucketStats
  ) {
    if (!item.count) {
      continue;
    }

    item.meanProbability =
      round(
        item.meanProbability
        / item.count,
        6,
      );

    item.empiricalRate =
      round(
        item.empiricalRate
        / item.count,
        6,
      );

    weighted +=
      (
        item.count / rows.length
      )
      * Math.abs(
        item.meanProbability
        - item.empiricalRate,
      );
  }

  return {
    sampleSize:
      rows.length,

    expectedCalibrationError:
      round(
        weighted,
        6,
      ),

    bins:
      bucketStats,
  };
}

function percentileSummary(
  values,
) {
  if (!values.length) {
    return {
      count: 0,
      mean: null,
      std: null,
      min: null,
      p05: null,
      p25: null,
      p50: null,
      p75: null,
      p95: null,
      max: null,
    };
  }

  const {
    min,
    max,
  } =
    safeMinMax(values);

  return {
    count:
      values.length,

    mean:
      round(
        mean(values),
      ),

    std:
      round(
        standardDeviation(
          values,
        ),
      ),

    min:
      round(min),

    p05:
      round(
        quantile(
          values,
          0.05,
        ),
      ),

    p25:
      round(
        quantile(
          values,
          0.25,
        ),
      ),

    p50:
      round(
        quantile(
          values,
          0.50,
        ),
      ),

    p75:
      round(
        quantile(
          values,
          0.75,
        ),
      ),

    p95:
      round(
        quantile(
          values,
          0.95,
        ),
      ),

    max:
      round(max),
  };
}

function normalizeModelIdentifier(
  value,
  config,
  name,
) {
  const normalized =
    normalizeString(
      value,
      name === 'modelName'
        ? config.maxModelNameLength
        : config.maxModelVersionLength,
    );

  if (!normalized) {
    throw new ModelDriftMonitorError(
      name === 'modelName'
        ? MODEL_DRIFT_ERROR_CODES.MODEL_REQUIRED
        : MODEL_DRIFT_ERROR_CODES.VERSION_REQUIRED,
      `${name} is required.`,
    );
  }

  return normalized;
}

function normalizeDimensionName(
  value,
  config,
) {
  return normalizeString(
    value,
    config.maxFeatureNameLength,
  );
}

function normalizeObservationValue(
  value,
) {
  if (
    value === null
    || value === undefined
  ) {
    return null;
  }

  if (
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    typeof value === 'number'
    && Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === 'string'
  ) {
    return value.slice(
      0,
      200,
    );
  }

  return String(value).slice(
    0,
    200,
  );
}

function normalizeObservationRows(
  input,
  config,
) {
  if (!Array.isArray(input)) {
    throw new ModelDriftMonitorError(
      MODEL_DRIFT_ERROR_CODES.OBSERVATIONS_REQUIRED,
      'observations must be an array.',
    );
  }

  if (
    input.length
    > config.maxObservationCount
  ) {
    throw new ModelDriftMonitorError(
      MODEL_DRIFT_ERROR_CODES.SAMPLE_TOO_LARGE,
      `Observation count exceeds ${config.maxObservationCount}.`,
      {
        count: input.length,
        max:
          config.maxObservationCount,
      },
    );
  }

  return input
    .map(
      (row) => {
        if (!isPlainObject(row)) {
          return null;
        }

        const normalized =
          Object.create(null);

        for (
          const key
          of Object.keys(row).slice(
            0,
            config.maxMetadataKeys,
          )
        ) {
          if (
            /password|secret|token|authorization|cookie|session|otp|pin|cvv|cvc|pan|private.?key|api.?key|credential|signature|raw.?payload|raw.?request|raw.?response/i.test(key)
          ) {
            continue;
          }

          normalized[key] =
            normalizeObservationValue(
              row[key],
            );
        }

        return normalized;
      },
    )
    .filter(Boolean);
}

function extractDimensionValues(
  observations,
  dimension,
) {
  return observations
    .map(
      (row) =>
        row[dimension],
    )
    .filter(
      (value) =>
        value !== null
        && value !== undefined,
    );
}

function buildNumericBaseline(
  values,
  config,
) {
  const numeric =
    validateNumericArray(
      values,
      config.maxNumericValuesPerFeature,
    );

  if (
    numeric.length
    < config.minDimensionSampleSize
  ) {
    throw new ModelDriftMonitorError(
      MODEL_DRIFT_ERROR_CODES.INVALID_BASELINE,
      'Numeric baseline does not contain enough observations.',
      {
        sampleSize:
          numeric.length,

        minimum:
          config.minDimensionSampleSize,
      },
    );
  }

  const edges =
    buildQuantileEdges(
      numeric,
      config.psiBins,
    );

  return {
    type: 'NUMERIC',

    sampleSize:
      numeric.length,

    summary:
      percentileSummary(
        numeric,
      ),

    edges,

    histogram:
      histogram(
        numeric,
        edges,
      ),

    missingRate: 0,
  };
}

function buildCategoricalBaseline(
  values,
  categories,
  config,
) {
  const nonNull =
    values
      .filter(
        (value) =>
          value !== null
          && value !== undefined,
      )
      .slice(
        0,
        config.maxNumericValuesPerFeature,
      );

  if (
    nonNull.length
    < config.minDimensionSampleSize
  ) {
    throw new ModelDriftMonitorError(
      MODEL_DRIFT_ERROR_CODES.INVALID_BASELINE,
      'Categorical baseline does not contain enough observations.',
      {
        sampleSize:
          nonNull.length,

        minimum:
          config.minDimensionSampleSize,
      },
    );
  }

  const normalizedCategories =
    (
      Array.isArray(categories)
        ? categories
        : []
    )
      .map(
        (value) =>
          normalizeString(
            value,
            160,
          ),
      )
      .filter(Boolean)
      .slice(
        0,
        config.maxCategoryCount,
      );

  const derived =
    normalizedCategories.length
      ? normalizedCategories
      : [
          ...new Set(
            nonNull.map(
              (value) =>
                String(value).slice(
                  0,
                  160,
                ),
            ),
          ),
        ].slice(
          0,
          config.maxCategoryCount,
        );

  const counts =
    categoricalCounts(
      nonNull,
      derived,
      config.maxCategoryCount,
    );

  return {
    type: 'CATEGORICAL',

    sampleSize:
      nonNull.length,

    categories:
      [
        ...counts.keys(),
      ].sort(),

    counts:
      [
        ...counts.keys(),
      ]
        .sort()
        .map(
          (key) =>
            counts.get(key)
            ?? 0,
        ),

    missingRate:
      (
        values.length
        - nonNull.length
      )
      / Math.max(
        values.length,
        1,
      ),
  };
}

export class ModelDriftMonitorError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(message);

    this.name =
      'ModelDriftMonitorError';

    this.code =
      code;

    this.details =
      redact(details);

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

export class InMemoryModelDriftRepository {
  constructor(seed = {}) {
    this.baselines =
      Array.isArray(
        seed.baselines,
      )
        ? clone(
            seed.baselines,
          )
        : [];

    this.snapshots =
      Array.isArray(
        seed.snapshots,
      )
        ? clone(
            seed.snapshots,
          )
        : [];

    this.findings =
      Array.isArray(
        seed.findings,
      )
        ? clone(
            seed.findings,
          )
        : [];
  }

  async saveBaseline(
    record,
  ) {
    const existing =
      this.baselines.find(
        (item) =>
          item.tenantId
            === record.tenantId
          && item.modelName
            === record.modelName
          && item.modelVersion
            === record.modelVersion,
      );

    if (existing) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES.BASELINE_IMMUTABLE,
        'An immutable baseline already exists for this tenant/model/version.',
      );
    }

    this.baselines.push(
      clone(record),
    );

    return clone(record);
  }

  async getBaseline({
    tenantId,
    modelName,
    modelVersion,
  }) {
    const record =
      this.baselines.find(
        (item) =>
          item.tenantId
            === tenantId
          && item.modelName
            === modelName
          && item.modelVersion
            === modelVersion
          && upper(
            item.provider,
            30,
          ) === PROVIDER,
      );

    return record
      ? clone(record)
      : null;
  }

  async listBaselines({
    tenantId,
    modelName,
    limit = 50,
    offset = 0,
  }) {
    const records =
      this.baselines.filter(
        (item) =>
          item.tenantId
            === tenantId
          && upper(
            item.provider,
            30,
          ) === PROVIDER
          && (
            !modelName
            || item.modelName
              === modelName
          ),
      );

    return {
      entries:
        records
          .slice(
            offset,
            offset + limit,
          )
          .map(clone),

      total:
        records.length,

      hasMore:
        offset + limit
        < records.length,
    };
  }

  async saveSnapshot(
    record,
  ) {
    this.snapshots.push(
      clone(record),
    );

    return clone(record);
  }

  async getSnapshotById({
    tenantId,
    snapshotId,
  }) {
    const record =
      this.snapshots.find(
        (item) =>
          item.tenantId
            === tenantId
          && item.snapshotId
            === snapshotId,
      );

    return record
      ? clone(record)
      : null;
  }

  async findSnapshotByIdempotencyKey({
    tenantId,
    idempotencyKey,
  }) {
    const record =
      this.snapshots.find(
        (item) =>
          item.tenantId
            === tenantId
          && item.idempotencyKey
            === idempotencyKey,
      );

    return record
      ? clone(record)
      : null;
  }

  async listSnapshots({
    tenantId,
    modelName,
    modelVersion,
    limit = 50,
    offset = 0,
  }) {
    const records =
      this.snapshots.filter(
        (item) =>
          item.tenantId
            === tenantId
          && upper(
            item.provider,
            30,
          ) === PROVIDER
          && (
            !modelName
            || item.modelName
              === modelName
          )
          && (
            !modelVersion
            || item.modelVersion
              === modelVersion
          ),
      );

    return {
      entries:
        records
          .slice(
            offset,
            offset + limit,
          )
          .map(clone),

      total:
        records.length,

      hasMore:
        offset + limit
        < records.length,
    };
  }

  async saveFinding(
    record,
  ) {
    this.findings.push(
      clone(record),
    );

    return clone(record);
  }

  async listFindings({
    tenantId,
    modelName,
    modelVersion,
    limit = 50,
    offset = 0,
  }) {
    const records =
      this.findings.filter(
        (item) =>
          item.tenantId
            === tenantId
          && upper(
            item.provider,
            30,
          ) === PROVIDER
          && (
            !modelName
            || item.modelName
              === modelName
          )
          && (
            !modelVersion
            || item.modelVersion
              === modelVersion
          ),
      );

    return {
      entries:
        records
          .slice(
            offset,
            offset + limit,
          )
          .map(clone),

      total:
        records.length,

      hasMore:
        offset + limit
        < records.length,
    };
  }

  async healthCheck() {
    return {
      ok: true,
      component:
        'in-memory-model-drift-repository',
    };
  }

  async close() {}
}

export class ModelDriftMonitor {
  constructor(options = {}) {
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

        defaultPsiThresholds:
          normalizeThresholds(
            options.config
              ?.defaultPsiThresholds,
            DEFAULT_CONFIG
              .defaultPsiThresholds,
          ),

        defaultJsThresholds:
          normalizeThresholds(
            options.config
              ?.defaultJsThresholds,
            DEFAULT_CONFIG
              .defaultJsThresholds,
          ),

        defaultMissingRateDeltaThresholds:
          normalizeThresholds(
            options.config
              ?.defaultMissingRateDeltaThresholds,
            DEFAULT_CONFIG
              .defaultMissingRateDeltaThresholds,
          ),

        defaultPerformanceDropThresholds:
          normalizeThresholds(
            options.config
              ?.defaultPerformanceDropThresholds,
            DEFAULT_CONFIG
              .defaultPerformanceDropThresholds,
          ),

        defaultConfidenceMeanDeltaThresholds:
          normalizeThresholds(
            options.config
              ?.defaultConfidenceMeanDeltaThresholds,
            DEFAULT_CONFIG
              .defaultConfidenceMeanDeltaThresholds,
          ),

        defaultPredictionRateDeltaThresholds:
          normalizeThresholds(
            options.config
              ?.defaultPredictionRateDeltaThresholds,
            DEFAULT_CONFIG
              .defaultPredictionRateDeltaThresholds,
          ),
      });

    this.repository =
      options.repository
      ?? options.modelDriftRepository
      ?? null;

    this.audit =
      options.audit
      ?? options.decisionAuditLedger
      ?? null;

    this.metrics =
      options.metrics
      ?? null;

    this.logger =
      options.logger
      ?? null;

    this.clock =
      typeof options.clock === 'function'
        ? options.clock
        : () => new Date();

    this.idFactory =
      typeof options.idFactory === 'function'
        ? options.idFactory
        : () =>
            `drift-${Date.now()}-${sha256(
              `${Date.now()}-${Math.random()}`,
            ).slice(0, 16)}`;

    if (!this.repository) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES.REPOSITORY_REQUIRED,
        'A durable model-drift repository must be injected in production.',
      );
    }
  }

  _tenantId(
    tenantId,
  ) {
    const normalized =
      normalizeString(
        tenantId,
        this.config.maxTenantIdLength,
      );

    if (
      this.config.tenantRequired
      && !normalized
    ) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES.TENANT_REQUIRED,
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
        provider ?? PROVIDER,
        30,
      );

    if (
      normalized
      !== PROVIDER
    ) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .PROVIDER_SCOPE_VIOLATION,
        `Model drift monitor scope is ${PROVIDER}.`,
        {
          provider:
            normalized,
        },
      );
    }

    return PROVIDER;
  }

  _modelName(
    value,
  ) {
    return normalizeModelIdentifier(
      value,
      this.config,
      'modelName',
    );
  }

  _modelVersion(
    value,
  ) {
    return normalizeModelIdentifier(
      value,
      this.config,
      'modelVersion',
    );
  }

  _log(
    level,
    message,
    error = null,
    context = {},
  ) {
    try {
      const method =
        this.logger?.[level]
        ?? this.logger?.info;

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
                },
              }
            : {}),
        },
        message,
      );
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
        typeof this.metrics?.inc
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

  async _audit(
    event,
  ) {
    if (!this.audit) {
      return {
        attempted: false,
        recorded: false,
      };
    }

    const payload =
      redact({
        eventType:
          'MODEL_DRIFT_DETECTED',

        stage:
          'MODEL_GOVERNANCE',

        provider:
          PROVIDER,

        ...event,
      });

    const methods = [
      'recordDecisionEvent',
      'append',
      'record',
      'write',
    ];

    for (
      const methodName
      of methods
    ) {
      if (
        typeof this.audit[
          methodName
        ]
        !== 'function'
      ) {
        continue;
      }

      try {
        await this.audit[
          methodName
        ](
          payload,
        );

        return {
          attempted: true,
          recorded: true,
          method: methodName,
        };
      } catch (error) {
        this._log(
          'warn',
          'Model drift audit write failed.',
          error,
          {
            eventType:
              payload.eventType,
          },
        );

        if (
          this.config
            .failClosedOnAuditError
        ) {
          throw new ModelDriftMonitorError(
            MODEL_DRIFT_ERROR_CODES
              .REPOSITORY_UNAVAILABLE,
            'Model drift audit write failed.',
            {},
            {
              httpStatus: 503,
              retryable: true,
              cause: error,
            },
          );
        }

        return {
          attempted: true,
          recorded: false,
          method: methodName,
        };
      }
    }

    return {
      attempted: false,
      recorded: false,
    };
  }

  _dimensionsFromBaseline(
    baseline,
  ) {
    if (
      !isPlainObject(
        baseline?.dimensions,
      )
    ) {
      return [];
    }

    return Object.keys(
      baseline.dimensions,
    ).slice(
      0,
      this.config.maxDimensionCount,
    );
  }

  _normalizeBaselineDimension(
    dimension,
    definition,
  ) {
    assertPlainObject(
      definition,
      `baseline dimension ${dimension}`,
    );

    const type =
      upper(
        definition.type,
        30,
      );

    if (
      ![
        'NUMERIC',
        'CATEGORICAL',
        'BINARY',
      ].includes(type)
    ) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .INVALID_BASELINE,
        `Unsupported baseline dimension type for ${dimension}.`,
      );
    }

    if (
      type === 'NUMERIC'
    ) {
      const histogramValues =
        validateNumericArray(
          definition.histogram,
          this.config.psiBins * 4,
        );

      const edges =
        validateNumericArray(
          definition.edges,
          this.config.psiBins + 2,
        );

      if (
        !histogramValues.length
        || edges.length < 2
      ) {
        throw new ModelDriftMonitorError(
          MODEL_DRIFT_ERROR_CODES
            .INVALID_BASELINE,
          `Numeric baseline for ${dimension} is missing histogram data.`,
        );
      }

      return {
        type,

        sampleSize:
          toInteger(
            definition.sampleSize,
            0,
            {
              min: 0,
              max:
                this.config
                  .maxObservationCount,
            },
          ),

        edges,

        histogram:
          histogramValues,

        missingRate:
          clamp(
            toFiniteNumber(
              definition.missingRate,
              0,
            ),
            0,
            1,
          ),

        summary:
          isPlainObject(
            definition.summary,
          )
            ? redact(
                definition.summary,
              )
            : null,
      };
    }

    const categories =
      Array.isArray(
        definition.categories,
      )
        ? definition.categories
            .map(
              (value) =>
                normalizeString(
                  value,
                  160,
                ),
            )
            .filter(Boolean)
            .slice(
              0,
              this.config.maxCategoryCount,
            )
        : [];

    const counts =
      Array.isArray(
        definition.counts,
      )
        ? definition.counts.map(
            (value) =>
              toInteger(
                value,
                0,
                {
                  min: 0,
                  max:
                    this.config
                      .maxObservationCount,
                },
              ),
          )
        : [];

    if (
      !categories.length
      || categories.length
        !== counts.length
    ) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .INVALID_BASELINE,
        `Categorical baseline for ${dimension} has invalid categories/counts.`,
      );
    }

    return {
      type,

      sampleSize:
        toInteger(
          definition.sampleSize,
          sum(counts),
          {
            min: 0,
            max:
              this.config
                .maxObservationCount,
          },
        ),

      categories,

      counts,

      missingRate:
        clamp(
          toFiniteNumber(
            definition.missingRate,
            0,
          ),
          0,
          1,
        ),
    };
  }

  _normalizeBaselineRecord({
    tenantId,
    modelName,
    modelVersion,
    provider,
    baseline,
  }) {
    this._provider(
      provider
      ?? baseline?.provider,
    );

    if (
      !baseline
      || !isPlainObject(baseline)
    ) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES.BASELINE_REQUIRED,
        'An approved model baseline is required.',
      );
    }

    const dimensions =
      Object.create(null);

    for (
      const name
      of Object.keys(
        baseline.dimensions
          ?? {},
      ).slice(
        0,
        this.config.maxDimensionCount,
      )
    ) {
      const normalizedName =
        normalizeDimensionName(
          name,
          this.config,
        );

      if (!normalizedName) {
        continue;
      }

      dimensions[
        normalizedName
      ] =
        this._normalizeBaselineDimension(
          normalizedName,
          baseline.dimensions[
            name
          ],
        );
    }

    return {
      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      tenantId,

      modelName,

      modelVersion,

      baselineId:
        normalizeString(
          baseline.baselineId,
          180,
        )
        ?? this.idFactory(),

      approvedAt:
        toIso(
          baseline.approvedAt,
          null,
        ),

      createdAt:
        toIso(
          baseline.createdAt,
          toIso(
            this.clock(),
            new Date().toISOString(),
          ),
        ),

      approvedByDigest:
        baseline.approvedBy
          ? digest(
              baseline.approvedBy,
            )
          : null,

      baselineFingerprint:
        normalizeString(
          baseline.baselineFingerprint,
          120,
        )
        ?? `sha256:${sha256({
          tenantId:
            digest(tenantId),

          modelName,

          modelVersion,

          dimensions,
        })}`,

      trainingDataWindow:
        isPlainObject(
          baseline.trainingDataWindow,
        )
          ? redact(
              baseline.trainingDataWindow,
            )
          : null,

      featureSchemaFingerprint:
        normalizeString(
          baseline.featureSchemaFingerprint,
          120,
        ),

      outputSchemaFingerprint:
        normalizeString(
          baseline.outputSchemaFingerprint,
          120,
        ),

      dimensions,

      output:
        isPlainObject(
          baseline.output,
        )
          ? redact(
              baseline.output,
            )
          : null,

      performance:
        isPlainObject(
          baseline.performance,
        )
          ? redact(
              baseline.performance,
            )
          : null,

      calibration:
        isPlainObject(
          baseline.calibration,
        )
          ? redact(
              baseline.calibration,
            )
          : null,

      notes:
        normalizeString(
          baseline.notes,
          600,
        ),
    };
  }

  async registerBaseline(
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

    const modelName =
      this._modelName(
        input.modelName,
      );

    const modelVersion =
      this._modelVersion(
        input.modelVersion,
      );

    this._provider(
      input.provider,
    );

    const baseline =
      this._normalizeBaselineRecord(
        {
          tenantId,
          modelName,
          modelVersion,
          provider:
            input.provider,
          baseline:
            input.baseline,
        },
      );

    if (!baseline.approvedAt) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .INVALID_BASELINE,
        'Baseline must include an approvedAt timestamp.',
      );
    }

    if (
      new Date(
        baseline.approvedAt,
      )
      > new Date(
        toIso(
          this.clock(),
        ),
      )
    ) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .INVALID_BASELINE,
        'Baseline approvedAt cannot be in the future.',
      );
    }

    if (
      typeof this.repository
        .saveBaseline
      !== 'function'
    ) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,
        'Model drift repository does not implement saveBaseline.',
      );
    }

    let saved;

    try {
      saved =
        await this.repository
          .saveBaseline(
            clone(baseline),
          );
    } catch (error) {
      if (
        error
          instanceof ModelDriftMonitorError
      ) {
        throw error;
      }

      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,
        'Unable to persist model baseline.',
        {},
        {
          httpStatus: 503,
          retryable: true,
          cause: error,
        },
      );
    }

    this._metric(
      'model_drift_baseline_registered_total',
      {
        model:
          digest(modelName),

        version:
          digest(modelVersion),
      },
    );

    await this._audit({
      action:
        'BASELINE_REGISTERED',

      tenantId:
        digest(tenantId),

      modelName:
        digest(modelName),

      modelVersion:
        digest(modelVersion),

      baselineId:
        digest(
          baseline.baselineId,
        ),

      baselineFingerprint:
        baseline.baselineFingerprint,
    });

    return deepFreeze(
      saved ?? baseline,
    );
  }

  async getBaseline({
    tenantId,
    modelName,
    modelVersion,
    provider,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    const scopedModel =
      this._modelName(
        modelName,
      );

    const scopedVersion =
      this._modelVersion(
        modelVersion,
      );

    this._provider(
      provider,
    );

    if (
      typeof this.repository
        .getBaseline
      !== 'function'
    ) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,
        'Model drift repository does not implement getBaseline.',
      );
    }

    try {
      const record =
        await this.repository
          .getBaseline({
            tenantId:
              scopedTenant,

            modelName:
              scopedModel,

            modelVersion:
              scopedVersion,

            provider:
              PROVIDER,
          });

      return record
        ? deepFreeze(
            redact(record),
          )
        : null;
    } catch (error) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,
        'Unable to read model baseline.',
        {},
        {
          httpStatus: 503,
          retryable: true,
          cause: error,
        },
      );
    }
  }

  _normalizeCurrentFeature(
    values,
    baselineDimension,
  ) {
    const raw =
      Array.isArray(values)
        ? values.slice(
            0,
            this.config
              .maxNumericValuesPerFeature,
          )
        : [];

    const missingCount =
      raw.filter(
        (value) =>
          value === null
          || value === undefined
          || value === '',
      ).length;

    const missingRate =
      raw.length
        ? missingCount
          / raw.length
        : null;

    if (
      baselineDimension.type
      === 'NUMERIC'
    ) {
      const numeric =
        validateNumericArray(
          raw,
          this.config
            .maxNumericValuesPerFeature,
        );

      return {
        type: 'NUMERIC',
        rawCount:
          raw.length,
        values:
          numeric,
        missingRate,
      };
    }

    const categorical =
      raw.map(
        (value) =>
          value === null
          || value === undefined
            ? null
            : String(value).slice(
                0,
                160,
              ),
      );

    return {
      type:
        baselineDimension.type,

      rawCount:
        raw.length,

      values:
        categorical,

      missingRate,
    };
  }

  _evaluateNumericDimension(
    name,
    baseline,
    current,
  ) {
    if (
      current.values.length
      < this.config.minDimensionSampleSize
    ) {
      return {
        dimension: name,

        type:
          DRIFT_TYPES.FEATURE_DISTRIBUTION,

        evidenceStatus:
          EVIDENCE_STATUS
            .INSUFFICIENT_SAMPLE,

        sampleSize:
          current.values.length,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {},
      };
    }

    const baseHistogram =
      baseline.histogram;

    const edges =
      baseline.edges;

    const currentHistogram =
      histogram(
        current.values,
        edges,
      );

    const psiResult =
      populationStabilityIndex(
        baseHistogram,
        currentHistogram,
        this.config.minProbability,
      );

    const jsResult =
      jensenShannonDivergence(
        baseHistogram,
        currentHistogram,
        this.config.minProbability,
      );

    const ks =
      ksStatistic(
        this._valuesFromHistogram(
          baseHistogram,
          edges,
        ),
        current.values,
      );

    const meanShift =
      normalizedMeanShift(
        this._baselineValuesApproximation(
          baseline,
          edges,
        ),
        current.values,
      );

    const psiStatus =
      severityFromMetric(
        psiResult.psi,
        normalizeThresholds(
          null,
          this.config
            .defaultPsiThresholds,
        ),
      );

    const jsStatus =
      severityFromMetric(
        jsResult.js,
        normalizeThresholds(
          null,
          this.config
            .defaultJsThresholds,
        ),
      );

    const status =
      maxStatus([
        psiStatus,
        jsStatus,
      ]);

    return {
      dimension: name,

      type:
        DRIFT_TYPES.FEATURE_DISTRIBUTION,

      evidenceStatus:
        EVIDENCE_STATUS.HEALTHY,

      sampleSize:
        current.values.length,

      status,

      severity:
        statusSeverity(status),

      metrics: {
        psi:
          round(
            psiResult.psi,
          ),

        jsDivergence:
          round(
            jsResult.js,
          ),

        ksStatistic:
          round(
            ks,
            6,
          ),

        normalizedMeanShift:
          round(
            meanShift,
            6,
          ),

        baseSummary:
          baseline.summary
          ?? null,

        currentSummary:
          percentileSummary(
            current.values,
          ),
      },
    };
  }

  _baselineValuesApproximation(
    baseline,
    edges,
  ) {
    const result = [];

    for (
      let i = 0;
      i < baseline.histogram.length;
      i += 1
    ) {
      const count =
        baseline.histogram[i]
        ?? 0;

      const lower =
        edges[i]
        ?? 0;

      const upper =
        edges[i + 1]
        ?? lower;

      const midpoint =
        lower
        + (
          upper - lower
        ) / 2;

      const capped =
        Math.min(
          count,
          this.config
            .maxNumericValuesPerFeature,
        );

      for (
        let j = 0;
        j < capped;
        j += 1
      ) {
        result.push(
          midpoint,
        );
      }
    }

    return result;
  }

  _valuesFromHistogram(
    histogramValues,
    edges,
  ) {
    return this
      ._baselineValuesApproximation(
        {
          histogram:
            histogramValues,
        },
        edges,
      );
  }

  _evaluateCategoricalDimension(
    name,
    baseline,
    current,
  ) {
    if (
      current.values.filter(
        (value) =>
          value !== null,
      ).length
      < this.config
        .minDimensionSampleSize
    ) {
      return {
        dimension: name,

        type:
          DRIFT_TYPES.FEATURE_DISTRIBUTION,

        evidenceStatus:
          EVIDENCE_STATUS
            .INSUFFICIENT_SAMPLE,

        sampleSize:
          current.rawCount,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {},
      };
    }

    const currentValues =
      current.values.filter(
        (value) =>
          value !== null,
      );

    const aligned =
      countsArray(
        currentValues,
        currentValues,
        baseline.categories,
        this.config
          .maxCategoryCount,
      );

    const baseCounts =
      baseline.categories.map(
        (
          category,
          index,
        ) =>
          baseline.counts[
            index
          ] ?? 0,
      );

    const currentCounts =
      baseline.categories.map(
        (
          category,
        ) => {
          const index =
            aligned.keys.indexOf(
              category,
            );

          return index >= 0
            ? aligned
                .currentCounts[
                  index
                ]
            : 0;
        },
      );

    const psiResult =
      populationStabilityIndex(
        baseCounts,
        currentCounts,
        this.config.minProbability,
      );

    const jsResult =
      jensenShannonDivergence(
        baseCounts,
        currentCounts,
        this.config.minProbability,
      );

    const psiStatus =
      severityFromMetric(
        psiResult.psi,
        normalizeThresholds(
          null,
          this.config
            .defaultPsiThresholds,
        ),
      );

    const jsStatus =
      severityFromMetric(
        jsResult.js,
        normalizeThresholds(
          null,
          this.config
            .defaultJsThresholds,
        ),
      );

    const status =
      maxStatus([
        psiStatus,
        jsStatus,
      ]);

    return {
      dimension: name,

      type:
        DRIFT_TYPES.FEATURE_DISTRIBUTION,

      evidenceStatus:
        EVIDENCE_STATUS.HEALTHY,

      sampleSize:
        currentValues.length,

      status,

      severity:
        statusSeverity(status),

      metrics: {
        psi:
          round(
            psiResult.psi,
          ),

        jsDivergence:
          round(
            jsResult.js,
          ),

        categories:
          baseline.categories,

        baseDistribution:
          psiResult.baseDistribution,

        currentDistribution:
          psiResult.currentDistribution,

        baseCount:
          sum(baseCounts),

        currentCount:
          sum(currentCounts),
      },
    };
  }

  _evaluateMissingnessDimension(
    name,
    baseline,
    current,
  ) {
    if (
      !Number.isFinite(
        current.missingRate,
      )
    ) {
      return {
        dimension: name,

        type:
          DRIFT_TYPES
            .FEATURE_MISSINGNESS,

        evidenceStatus:
          EVIDENCE_STATUS.MISSING,

        sampleSize:
          current.rawCount,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {},
      };
    }

    const delta =
      Math.abs(
        current.missingRate
        - baseline.missingRate,
      );

    const status =
      severityFromMetric(
        delta,
        normalizeThresholds(
          null,
          this.config
            .defaultMissingRateDeltaThresholds,
        ),
      );

    return {
      dimension: name,

      type:
        DRIFT_TYPES
          .FEATURE_MISSINGNESS,

      evidenceStatus:
        EVIDENCE_STATUS.HEALTHY,

      sampleSize:
        current.rawCount,

      status,

      severity:
        statusSeverity(status),

      metrics: {
        baselineMissingRate:
          round(
            baseline.missingRate,
            6,
          ),

        currentMissingRate:
          round(
            current.missingRate,
            6,
          ),

        absoluteDelta:
          round(
            delta,
            6,
          ),

        baselineMissingPercentage:
          safePercentage(
            baseline.missingRate,
            1,
          ),

        currentMissingPercentage:
          safePercentage(
            current.missingRate,
            1,
          ),
      },
    };
  }

  _evaluateSchema({
    baseline,
    currentSchema,
  }) {
    if (!currentSchema) {
      return {
        type:
          DRIFT_TYPES.FEATURE_SCHEMA,

        evidenceStatus:
          EVIDENCE_STATUS.MISSING,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {},
      };
    }

    const baselineNames =
      new Set(
        this._dimensionsFromBaseline(
          baseline,
        ),
      );

    const currentNames =
      new Set(
        Object.keys(
          currentSchema,
        ).slice(
          0,
          this.config
            .maxDimensionCount,
        ),
      );

    const added =
      [
        ...currentNames,
      ]
        .filter(
          (name) =>
            !baselineNames.has(
              name,
            ),
        )
        .sort();

    const removed =
      [
        ...baselineNames,
      ]
        .filter(
          (name) =>
            !currentNames.has(
              name,
            ),
        )
        .sort();

    const changed = [];

    for (
      const name
      of [
        ...baselineNames,
      ].filter(
        (item) =>
          currentNames.has(
            item,
          ),
      )
    ) {
      const baselineType =
        baseline
          .dimensions[
            name
          ]?.type;

      const currentType =
        upper(
          currentSchema[name],
          30,
        );

      if (
        baselineType
        && currentType
        && baselineType
          !== currentType
      ) {
        changed.push(name);
      }
    }

    const status =
      added.length
      || removed.length
      || changed.length
        ? DRIFT_STATUS.SIGNIFICANT
        : DRIFT_STATUS.NO_DRIFT;

    return {
      type:
        DRIFT_TYPES.FEATURE_SCHEMA,

      evidenceStatus:
        EVIDENCE_STATUS.HEALTHY,

      status,

      severity:
        statusSeverity(status),

      metrics: {
        added,
        removed,
        changed,

        baselineDimensionCount:
          baselineNames.size,

        currentDimensionCount:
          currentNames.size,
      },
    };
  }

  _evaluateOutputDrift(
    baselineOutput,
    currentOutputs,
  ) {
    if (
      !baselineOutput
      || !isPlainObject(
        baselineOutput,
      )
    ) {
      return {
        type:
          DRIFT_TYPES
            .OUTPUT_DISTRIBUTION,

        evidenceStatus:
          EVIDENCE_STATUS.MISSING,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {},
      };
    }

    if (
      !Array.isArray(
        currentOutputs,
      )
      || currentOutputs.length
        < this.config
          .minDimensionSampleSize
    ) {
      return {
        type:
          DRIFT_TYPES
            .OUTPUT_DISTRIBUTION,

        evidenceStatus:
          EVIDENCE_STATUS
            .INSUFFICIENT_SAMPLE,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {
          currentSampleSize:
            currentOutputs?.length
            ?? 0,
        },
      };
    }

    const baselineType =
      upper(
        baselineOutput.type,
        30,
      );

    if (
      baselineType
      === 'NUMERIC'
    ) {
      const baselineValues =
        validateNumericArray(
          baselineOutput.values,
          this.config
            .maxNumericValuesPerFeature,
        );

      const currentValues =
        validateNumericArray(
          currentOutputs,
          this.config
            .maxNumericValuesPerFeature,
        );

      if (
        baselineValues.length
        < this.config
          .minDimensionSampleSize
        || currentValues.length
          < this.config
            .minDimensionSampleSize
      ) {
        return {
          type:
            DRIFT_TYPES
              .OUTPUT_DISTRIBUTION,

          evidenceStatus:
            EVIDENCE_STATUS
              .INSUFFICIENT_SAMPLE,

          status:
            DRIFT_STATUS
              .INDETERMINATE,

          severity:
            SEVERITY.HIGH,

          metrics: {},
        };
      }

      const edges =
        buildQuantileEdges(
          baselineValues,
          this.config.psiBins,
        );

      const psiResult =
        populationStabilityIndex(
          histogram(
            baselineValues,
            edges,
          ),
          histogram(
            currentValues,
            edges,
          ),
          this.config.minProbability,
        );

      const jsResult =
        jensenShannonDivergence(
          histogram(
            baselineValues,
            edges,
          ),
          histogram(
            currentValues,
            edges,
          ),
          this.config.minProbability,
        );

      const status =
        maxStatus([
          severityFromMetric(
            psiResult.psi,
            normalizeThresholds(
              null,
              this.config
                .defaultPsiThresholds,
            ),
          ),

          severityFromMetric(
            jsResult.js,
            normalizeThresholds(
              null,
              this.config
                .defaultJsThresholds,
            ),
          ),
        ]);

      return {
        type:
          DRIFT_TYPES
            .OUTPUT_DISTRIBUTION,

        evidenceStatus:
          EVIDENCE_STATUS.HEALTHY,

        status,

        severity:
          statusSeverity(status),

        metrics: {
          psi:
            round(
              psiResult.psi,
            ),

          jsDivergence:
            round(
              jsResult.js,
            ),

          baselineSummary:
            percentileSummary(
              baselineValues,
            ),

          currentSummary:
            percentileSummary(
              currentValues,
            ),
        },
      };
    }

    const baselineCategories =
      Array.isArray(
        baselineOutput.categories,
      )
        ? baselineOutput.categories
        : [];

    const baselineCounts =
      Array.isArray(
        baselineOutput.counts,
      )
        ? baselineOutput.counts
        : [];

    const currentCountMap =
      categoricalCounts(
        currentOutputs,
        baselineCategories,
        this.config
          .maxCategoryCount,
      );

    const currentCounts =
      baselineCategories.map(
        (category) =>
          currentCountMap.get(
            category,
          )
          ?? 0,
      );

    const psiResult =
      populationStabilityIndex(
        baselineCounts,
        currentCounts,
        this.config.minProbability,
      );

    const jsResult =
      jensenShannonDivergence(
        baselineCounts,
        currentCounts,
        this.config.minProbability,
      );

    const status =
      maxStatus([
        severityFromMetric(
          psiResult.psi,
          normalizeThresholds(
            null,
            this.config
              .defaultPsiThresholds,
          ),
        ),

        severityFromMetric(
          jsResult.js,
          normalizeThresholds(
            null,
            this.config
              .defaultJsThresholds,
          ),
        ),
      ]);

    return {
      type:
        DRIFT_TYPES
          .OUTPUT_DISTRIBUTION,

      evidenceStatus:
        EVIDENCE_STATUS.HEALTHY,

      status,

      severity:
        statusSeverity(status),

      metrics: {
        psi:
          round(
            psiResult.psi,
          ),

        jsDivergence:
          round(
            jsResult.js,
          ),

        categories:
          baselineCategories,

        baselineDistribution:
          psiResult.baseDistribution,

        currentDistribution:
          psiResult.currentDistribution,
      },
    };
  }

  _evaluateConfidenceDrift(
    baselineConfidence,
    currentConfidence,
  ) {
    const base =
      validateNumericArray(
        baselineConfidence,
        this.config
          .maxNumericValuesPerFeature,
      );

    const current =
      validateNumericArray(
        currentConfidence,
        this.config
          .maxNumericValuesPerFeature,
      );

    if (
      base.length
        < this.config
          .minDimensionSampleSize
      || current.length
        < this.config
          .minDimensionSampleSize
    ) {
      return {
        type:
          DRIFT_TYPES
            .CONFIDENCE_DISTRIBUTION,

        evidenceStatus:
          EVIDENCE_STATUS
            .INSUFFICIENT_SAMPLE,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {
          baselineSampleSize:
            base.length,

          currentSampleSize:
            current.length,
        },
      };
    }

    const baseEdges =
      buildQuantileEdges(
        base,
        this.config.psiBins,
      );

    const psiResult =
      populationStabilityIndex(
        histogram(
          base,
          baseEdges,
        ),
        histogram(
          current,
          baseEdges,
        ),
        this.config.minProbability,
      );

    const meanDelta =
      absoluteMeanDelta(
        base,
        current,
      );

    const status =
      maxStatus([
        severityFromMetric(
          psiResult.psi,
          normalizeThresholds(
            null,
            this.config
              .defaultPsiThresholds,
          ),
        ),

        severityFromMetric(
          meanDelta,
          normalizeThresholds(
            null,
            this.config
              .defaultConfidenceMeanDeltaThresholds,
          ),
        ),
      ]);

    return {
      type:
        DRIFT_TYPES
          .CONFIDENCE_DISTRIBUTION,

      evidenceStatus:
        EVIDENCE_STATUS.HEALTHY,

      status,

      severity:
        statusSeverity(status),

      metrics: {
        psi:
          round(
            psiResult.psi,
          ),

        meanDelta:
          round(
            meanDelta,
          ),

        baselineSummary:
          percentileSummary(
            base,
          ),

        currentSummary:
          percentileSummary(
            current,
          ),
      },
    };
  }

  _evaluatePredictionRate(
    baselineRate,
    currentRate,
  ) {
    if (
      !Number.isFinite(
        baselineRate,
      )
      || !Number.isFinite(
        currentRate,
      )
    ) {
      return {
        type:
          DRIFT_TYPES
            .PREDICTION_RATE,

        evidenceStatus:
          EVIDENCE_STATUS.MISSING,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {},
      };
    }

    const delta =
      Math.abs(
        currentRate
        - baselineRate,
      );

    const status =
      severityFromMetric(
        delta,
        normalizeThresholds(
          null,
          this.config
            .defaultPredictionRateDeltaThresholds,
        ),
      );

    return {
      type:
        DRIFT_TYPES.PREDICTION_RATE,

      evidenceStatus:
        EVIDENCE_STATUS.HEALTHY,

      status,

      severity:
        statusSeverity(status),

      metrics: {
        baselineRate:
          round(
            baselineRate,
          ),

        currentRate:
          round(
            currentRate,
          ),

        absoluteDelta:
          round(
            delta,
          ),
      },
    };
  }

  _evaluatePerformance(
    baselinePerformance,
    currentObservations,
  ) {
    if (
      !baselinePerformance
      || !isPlainObject(
        baselinePerformance,
      )
    ) {
      return {
        type:
          DRIFT_TYPES.PERFORMANCE,

        evidenceStatus:
          EVIDENCE_STATUS.MISSING,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {},
      };
    }

    if (
      !Array.isArray(
        currentObservations,
      )
      || currentObservations.length
        < this.config
          .minDimensionSampleSize
    ) {
      return {
        type:
          DRIFT_TYPES.PERFORMANCE,

        evidenceStatus:
          EVIDENCE_STATUS
            .INSUFFICIENT_SAMPLE,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {},
      };
    }

    const current =
      classificationMetrics(
        currentObservations,
      );

    if (!current) {
      return {
        type:
          DRIFT_TYPES.PERFORMANCE,

        evidenceStatus:
          EVIDENCE_STATUS.MISSING,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {},
      };
    }

    const candidateMetrics = [
      'accuracy',
      'precision',
      'recall',
      'f1',
      'specificity',
    ];

    const metricFindings = [];
    const statuses = [];

    for (
      const metric
      of candidateMetrics
    ) {
      const baselineValue =
        toFiniteNumber(
          baselinePerformance[
            metric
          ],
          null,
        );

      const currentValue =
        toFiniteNumber(
          current[metric],
          null,
        );

      if (
        baselineValue === null
        || currentValue === null
      ) {
        continue;
      }

      const drop =
        Math.max(
          0,
          baselineValue
          - currentValue,
        );

      const status =
        severityFromMetric(
          drop,
          normalizeThresholds(
            null,
            this.config
              .defaultPerformanceDropThresholds,
          ),
        );

      statuses.push(status);

      metricFindings.push({
        metric,

        baseline:
          round(
            baselineValue,
          ),

        current:
          round(
            currentValue,
          ),

        drop:
          round(drop),

        status,
      });
    }

    if (!metricFindings.length) {
      return {
        type:
          DRIFT_TYPES.PERFORMANCE,

        evidenceStatus:
          EVIDENCE_STATUS.MISSING,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {
          current,
        },
      };
    }

    const status =
      maxStatus(statuses);

    return {
      type:
        DRIFT_TYPES.PERFORMANCE,

      evidenceStatus:
        EVIDENCE_STATUS.HEALTHY,

      status,

      severity:
        statusSeverity(status),

      metrics: {
        comparisons:
          metricFindings,

        current,
      },
    };
  }

  _evaluateCalibration(
    baselineCalibration,
    currentObservations,
  ) {
    if (
      !baselineCalibration
      || !isPlainObject(
        baselineCalibration,
      )
    ) {
      return {
        type:
          DRIFT_TYPES.CALIBRATION,

        evidenceStatus:
          EVIDENCE_STATUS.MISSING,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {},
      };
    }

    const current =
      calibrationError(
        currentObservations,
        this.config.psiBins,
      );

    const baselineEce =
      toFiniteNumber(
        baselineCalibration
          .expectedCalibrationError
          ?? baselineCalibration.ece,
        null,
      );

    if (
      !current
      || baselineEce === null
    ) {
      return {
        type:
          DRIFT_TYPES.CALIBRATION,

        evidenceStatus:
          EVIDENCE_STATUS.MISSING,

        status:
          DRIFT_STATUS.INDETERMINATE,

        severity:
          SEVERITY.HIGH,

        metrics: {
          current,
        },
      };
    }

    const delta =
      Math.max(
        0,
        current
          .expectedCalibrationError
          - baselineEce,
      );

    const status =
      severityFromMetric(
        delta,
        normalizeThresholds(
          null,
          this.config
            .defaultPerformanceDropThresholds,
        ),
      );

    return {
      type:
        DRIFT_TYPES.CALIBRATION,

      evidenceStatus:
        EVIDENCE_STATUS.HEALTHY,

      status,

      severity:
        statusSeverity(status),

      metrics: {
        baselineExpectedCalibrationError:
          round(
            baselineEce,
          ),

        currentExpectedCalibrationError:
          current
            .expectedCalibrationError,

        positiveDelta:
          round(delta),
      },
    };
  }

  _buildFindings(
    results,
  ) {
    const findings = [];

    for (
      const result
      of results
    ) {
      if (
        !result
        || result.status
          === DRIFT_STATUS.NO_DRIFT
      ) {
        continue;
      }

      const reasonCode =
        `${result.type}:${result.status}`;

      findings.push({
        findingId:
          `finding-${sha256({
            type:
              result.type,

            dimension:
              result.dimension
              ?? null,

            metrics:
              result.metrics,
          }).slice(0, 24)}`,

        driftType:
          result.type,

        dimension:
          result.dimension
          ?? null,

        status:
          result.status,

        severity:
          result.severity,

        reasonCode,

        evidenceStatus:
          result.evidenceStatus,

        metrics:
          redact(
            result.metrics,
          ),

        humanReviewRequired:
          [
            DRIFT_STATUS.SIGNIFICANT,
            DRIFT_STATUS.CRITICAL,
            DRIFT_STATUS.INDETERMINATE,
          ].includes(
            result.status,
          ),
      });
    }

    return findings.slice(
      0,
      this.config.maxReasonCodes,
    );
  }

  _overallStatus(
    results,
    evidenceState,
  ) {
    if (
      results.some(
        (result) =>
          result.status
          === DRIFT_STATUS.CRITICAL,
      )
    ) {
      return DRIFT_STATUS.CRITICAL;
    }

    if (
      results.some(
        (result) =>
          result.status
          === DRIFT_STATUS.SIGNIFICANT,
      )
    ) {
      return DRIFT_STATUS.SIGNIFICANT;
    }

    if (
      results.some(
        (result) =>
          result.status
          === DRIFT_STATUS.ELEVATED,
      )
    ) {
      return DRIFT_STATUS.ELEVATED;
    }

    if (
      results.some(
        (result) =>
          result.status
          === DRIFT_STATUS.OBSERVE,
      )
    ) {
      return DRIFT_STATUS.OBSERVE;
    }

    if (
      results.some(
        (result) =>
          result.status
          === DRIFT_STATUS.INDETERMINATE,
      )
      || evidenceState
        !== EVIDENCE_STATUS.HEALTHY
    ) {
      return DRIFT_STATUS.INDETERMINATE;
    }

    return DRIFT_STATUS.NO_DRIFT;
  }

  async evaluate(
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

    const modelName =
      this._modelName(
        input.modelName,
      );

    const modelVersion =
      this._modelVersion(
        input.modelVersion,
      );

    this._provider(
      input.provider,
    );

    const range =
      normalizeDateRange(
        input,
        this.config,
        this.clock,
      );

    const observations =
      normalizeObservationRows(
        input.observations,
        this.config,
      );

    if (
      observations.length
      < this.config
        .defaultMinSampleSize
    ) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .SAMPLE_TOO_SMALL,
        `Observation sample must contain at least ${this.config.defaultMinSampleSize} rows.`,
        {
          actual:
            observations.length,

          minimum:
            this.config
              .defaultMinSampleSize,
        },
      );
    }

    let baseline =
      input.baseline
      ? input.baseline
      : null;

    if (
      !baseline
      && typeof this.repository
        .getBaseline
      === 'function'
    ) {
      baseline =
        await this.repository
          .getBaseline({
            tenantId,

            modelName,

            modelVersion,

            provider:
              PROVIDER,
          });
    }

    if (!baseline) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .BASELINE_REQUIRED,
        'No approved baseline exists for the tenant/model/version.',
      );
    }

    baseline =
      this._normalizeBaselineRecord(
        {
          tenantId,
          modelName,
          modelVersion,
          provider:
            PROVIDER,
          baseline,
        },
      );

    const results = [];

    const dimensions =
      this._dimensionsFromBaseline(
        baseline,
      );

    for (
      const dimension
      of dimensions
    ) {
      const definition =
        baseline
          .dimensions[
            dimension
          ];

      const currentValues =
        extractDimensionValues(
          observations,
          dimension,
        );

      const current =
        this._normalizeCurrentFeature(
          observations.map(
            (row) =>
              row[dimension],
          ),
          definition,
        );

      let distributionResult;

      if (
        definition.type
        === 'NUMERIC'
      ) {
        distributionResult =
          this
            ._evaluateNumericDimension(
              dimension,
              definition,
              current,
            );
      } else {
        distributionResult =
          this
            ._evaluateCategoricalDimension(
              dimension,
              definition,
              current,
            );
      }

      results.push(
        distributionResult,
      );

      results.push(
        this
          ._evaluateMissingnessDimension(
            dimension,
            definition,
            current,
          ),
      );

      if (
        !currentValues.length
      ) {
        results.push({
          dimension,

          type:
            DRIFT_TYPES
              .FEATURE_SCHEMA,

          evidenceStatus:
            EVIDENCE_STATUS.MISSING,

          status:
            DRIFT_STATUS.SIGNIFICANT,

          severity:
            SEVERITY.HIGH,

          metrics: {
            observedValueCount:
              0,
          },
        });
      }
    }

    results.push(
      this._evaluateSchema({
        baseline,

        currentSchema:
          input.featureSchema,
      }),
    );

    results.push(
      this._evaluateOutputDrift(
        baseline.output,
        input.outputs,
      ),
    );

    results.push(
      this._evaluateConfidenceDrift(
        baseline.calibration
          ?.confidenceValues
        ?? baseline.output
          ?.confidenceValues
        ?? [],

        input.confidenceValues
          ?? [],
      ),
    );

    const currentPerformanceObservations =
      input.labeledObservations
      ?? observations;

    results.push(
      this._evaluatePerformance(
        baseline.performance,
        currentPerformanceObservations,
      ),
    );

    results.push(
      this._evaluateCalibration(
        baseline.calibration,
        currentPerformanceObservations,
      ),
    );

    const currentPredictionRate =
      Number.isFinite(
        toFiniteNumber(
          input.predictionRate,
          null,
        ),
      )
        ? Number(
            input.predictionRate,
          )
        : null;

    const baselinePredictionRate =
      toFiniteNumber(
        baseline.output
          ?.predictionRate
        ?? baseline.performance
          ?.positivePredictionRate,
        null,
      );

    results.push(
      this._evaluatePredictionRate(
        baselinePredictionRate,
        currentPredictionRate,
      ),
    );

    const evidenceState =
      [
        baseline.approvedAt
          ? EVIDENCE_STATUS.HEALTHY
          : EVIDENCE_STATUS.MISSING,

        ...results.map(
          (result) =>
            result.evidenceStatus,
        ),
      ].includes(
        EVIDENCE_STATUS.HEALTHY,
      )
        ? results.some(
            (result) =>
              result.evidenceStatus
              === EVIDENCE_STATUS.CONFLICTING,
          )
          ? EVIDENCE_STATUS.CONFLICTING
          : results.some(
              (result) =>
                result.evidenceStatus
                === EVIDENCE_STATUS.MISSING,
            )
            ? EVIDENCE_STATUS.MISSING
            : results.some(
                (result) =>
                  result.evidenceStatus
                  === EVIDENCE_STATUS
                    .INSUFFICIENT_SAMPLE,
              )
              ? EVIDENCE_STATUS
                  .INSUFFICIENT_SAMPLE
              : EVIDENCE_STATUS.HEALTHY
        : EVIDENCE_STATUS.MISSING;

    const overallStatus =
      this._overallStatus(
        results,
        evidenceState,
      );

    const findings =
      this._buildFindings(
        results,
      );

    const now =
      toIso(
        this.clock(),
        new Date().toISOString(),
      );

    const observationWindowAgeHours =
      Math.max(
        0,
        (
          new Date(now).getTime()
          - new Date(
              range.to,
            ).getTime()
        )
        / 3_600_000,
      );

    const staleObservation =
      observationWindowAgeHours
      > this.config
        .staleObservationDays
        * 24;

    const baselineAgeDays =
      baseline.approvedAt
        ? Math.max(
            0,
            (
              new Date(now).getTime()
              - new Date(
                  baseline.approvedAt,
                ).getTime()
            )
            / 86_400_000,
          )
        : null;

    const staleBaseline =
      baselineAgeDays !== null
      && baselineAgeDays
        > this.config
          .staleBaselineDays;

    const finalStatus =
      staleObservation
      || staleBaseline
        ? maxStatus([
            overallStatus,
            DRIFT_STATUS.OBSERVE,
          ])
        : overallStatus;

    const report = {
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
        digest(tenantId),

      modelName:
        digest(modelName),

      modelVersion:
        digest(modelVersion),

      generatedAt:
        now,

      observationWindow:
        range,

      baseline: {
        baselineId:
          digest(
            baseline.baselineId,
          ),

        baselineFingerprint:
          baseline.baselineFingerprint,

        approvedAt:
          baseline.approvedAt,

        ageDays:
          round(
            baselineAgeDays,
            3,
          ),

        stale:
          staleBaseline,
      },

      evidence: {
        state:
          staleObservation
          || staleBaseline
            ? EVIDENCE_STATUS.STALE
            : evidenceState,

        staleObservation,

        staleBaseline,

        observationSampleSize:
          observations.length,
      },

      overallStatus:
        finalStatus,

      overallSeverity:
        statusSeverity(
          finalStatus,
        ),

      summary: {
        dimensionsEvaluated:
          dimensions.length,

        testsEvaluated:
          results.length,

        findings:
          findings.length,

        criticalFindings:
          findings.filter(
            (item) =>
              item.status
              === DRIFT_STATUS.CRITICAL,
          ).length,

        significantFindings:
          findings.filter(
            (item) =>
              item.status
              === DRIFT_STATUS.SIGNIFICANT,
          ).length,

        elevatedFindings:
          findings.filter(
            (item) =>
              item.status
              === DRIFT_STATUS.ELEVATED,
          ).length,

        observeFindings:
          findings.filter(
            (item) =>
              item.status
              === DRIFT_STATUS.OBSERVE,
          ).length,

        indeterminateFindings:
          findings.filter(
            (item) =>
              item.status
              === DRIFT_STATUS.INDETERMINATE,
          ).length,
      },

      results,

      findings,

      controls: {
        humanReviewRequired:
          findings.some(
            (item) =>
              item.humanReviewRequired,
          ),

        modelChangeRequired:
          false,

        modelExecutionBlockedByThisModule:
          false,

        retrainingTriggered:
          false,

        paymentRejectedByThisModule:
          false,

        financialMutationPerformed:
          false,
      },

      safety: {
        financialMutationPerformed:
          false,

        providerCallPerformed:
          false,

        paymentExecutionPerformed:
          false,

        settlementPerformed:
          false,

        ledgerMutationPerformed:
          false,

        approvalGranted:
          false,

        modelDisabled:
          false,

        modelRetrained:
          false,

        featureValuePersistence:
          false,
      },
    };

    report.reportFingerprint =
      `sha256:${sha256({
        component:
          report.component,

        schemaVersion:
          report.schemaVersion,

        provider:
          report.provider,

        tenantId:
          report.tenantId,

        modelName:
          report.modelName,

        modelVersion:
          report.modelVersion,

        observationWindow:
          report.observationWindow,

        baseline:
          report.baseline,

        evidence:
          report.evidence,

        overallStatus:
          report.overallStatus,

        summary:
          report.summary,

        results:
          report.results,

        findings:
          report.findings,
      })}`;

    const idempotencyKey =
      normalizeString(
        input.idempotencyKey
          ?? `${tenantId}:${modelName}:${modelVersion}:${range.from}:${range.to}`,
        300,
      );

    report.idempotencyKeyDigest =
      digest(
        idempotencyKey,
      );

    if (
      typeof this.repository
        .findSnapshotByIdempotencyKey
      === 'function'
    ) {
      let existing = null;

      try {
        existing =
          await this.repository
            .findSnapshotByIdempotencyKey(
              {
                tenantId,

                idempotencyKey,

                provider:
                  PROVIDER,
              },
            );
      } catch (error) {
        if (
          this.config
            .failClosedOnRepositoryError
        ) {
          throw new ModelDriftMonitorError(
            MODEL_DRIFT_ERROR_CODES
              .REPOSITORY_UNAVAILABLE,
            'Unable to check drift report idempotency.',
            {},
            {
              httpStatus: 503,
              retryable: true,
              cause: error,
            },
          );
        }
      }

      if (existing) {
        if (
          existing.reportFingerprint
          !== report.reportFingerprint
        ) {
          throw new ModelDriftMonitorError(
            MODEL_DRIFT_ERROR_CODES
              .IDEMPOTENCY_CONFLICT,
            'Idempotency key already exists for a different drift report.',
          );
        }

        existing.idempotentReplay =
          true;

        return deepFreeze(
          redact(existing),
        );
      }
    }

    const record = {
      ...report,

      snapshotId:
        normalizeString(
          input.snapshotId,
          180,
        )
        ?? this.idFactory(),

      idempotentReplay:
        false,
    };

    if (
      typeof this.repository
        .saveSnapshot
      === 'function'
    ) {
      try {
        await this.repository
          .saveSnapshot(
            clone({
              ...record,

              tenantId,

              modelName,

              modelVersion,

              idempotencyKey,
            }),
          );
      } catch (error) {
        throw new ModelDriftMonitorError(
          MODEL_DRIFT_ERROR_CODES
            .REPOSITORY_UNAVAILABLE,
          'Unable to persist model drift report.',
          {},
          {
            httpStatus: 503,
            retryable: true,
            cause: error,
          },
        );
      }
    }

    if (
      typeof this.repository
        .saveFinding
      === 'function'
    ) {
      for (
        const finding
        of findings
      ) {
        try {
          await this.repository
            .saveFinding({
              schemaVersion:
                SCHEMA_VERSION,

              provider:
                PROVIDER,

              tenantId,

              modelName,

              modelVersion,

              snapshotId:
                record.snapshotId,

              ...finding,

              findingFingerprint:
                `sha256:${sha256({
                  snapshotId:
                    record.snapshotId,

                  finding,
                })}`,
            });
        } catch (error) {
          this._log(
            'warn',
            'Model drift finding persistence failed.',
            error,
            {
              modelName:
                digest(
                  modelName,
                ),

              modelVersion:
                digest(
                  modelVersion,
                ),
            },
          );
        }
      }
    }

    await this._audit({
      action:
        'DRIFT_EVALUATED',

      tenantId:
        digest(
          tenantId,
        ),

      modelName:
        digest(
          modelName,
        ),

      modelVersion:
        digest(
          modelVersion,
        ),

      snapshotId:
        digest(
          record.snapshotId,
        ),

      reportFingerprint:
        record.reportFingerprint,

      overallStatus:
        record.overallStatus,

      overallSeverity:
        record.overallSeverity,

      findingCount:
        findings.length,

      humanReviewRequired:
        record.controls
          .humanReviewRequired,
    });

    this._metric(
      'model_drift_evaluations_total',
      {
        status:
          record.overallStatus,

        model:
          digest(
            modelName,
          ),

        version:
          digest(
            modelVersion,
          ),
      },
    );

    if (
      record.controls
        .humanReviewRequired
    ) {
      this._metric(
        'model_drift_human_review_required_total',
        {
          status:
            record.overallStatus,
        },
      );
    }

    return deepFreeze(
      redact(record),
    );
  }

  async monitor(
    input = {},
  ) {
    return this.evaluate(
      input,
    );
  }

  async check(
    input = {},
  ) {
    return this.evaluate(
      input,
    );
  }

  async listReports({
    tenantId,
    modelName,
    modelVersion,
    provider,
    limit = 50,
    offset = 0,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    this._provider(
      provider,
    );

    const scopedModel =
      modelName
        ? this._modelName(
            modelName,
          )
        : undefined;

    const scopedVersion =
      modelVersion
        ? this._modelVersion(
            modelVersion,
          )
        : undefined;

    if (
      typeof this.repository
        .listSnapshots
      !== 'function'
    ) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,
        'Model drift repository does not implement listSnapshots.',
      );
    }

    const boundedLimit =
      toInteger(
        limit,
        50,
        {
          min: 1,
          max: 250,
        },
      );

    const boundedOffset =
      toInteger(
        offset,
        0,
        {
          min: 0,
          max:
            Number.MAX_SAFE_INTEGER,
        },
      );

    try {
      const result =
        await this.repository
          .listSnapshots({
            tenantId:
              scopedTenant,

            modelName:
              scopedModel,

            modelVersion:
              scopedVersion,

            provider:
              PROVIDER,

            limit:
              boundedLimit,

            offset:
              boundedOffset,
          });

      return deepFreeze(
        redact(result),
      );
    } catch (error) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,
        'Unable to list model-drift reports.',
        {},
        {
          httpStatus: 503,
          retryable: true,
          cause: error,
        },
      );
    }
  }

  async listFindings({
    tenantId,
    modelName,
    modelVersion,
    provider,
    limit = 50,
    offset = 0,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    this._provider(
      provider,
    );

    const scopedModel =
      modelName
        ? this._modelName(
            modelName,
          )
        : undefined;

    const scopedVersion =
      modelVersion
        ? this._modelVersion(
            modelVersion,
          )
        : undefined;

    if (
      typeof this.repository
        .listFindings
      !== 'function'
    ) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,
        'Model drift repository does not implement listFindings.',
      );
    }

    const result =
      await this.repository
        .listFindings({
          tenantId:
            scopedTenant,

          modelName:
            scopedModel,

          modelVersion:
            scopedVersion,

          provider:
            PROVIDER,

          limit:
            toInteger(
              limit,
              50,
              {
                min: 1,
                max: 250,
              },
            ),

          offset:
            toInteger(
              offset,
              0,
              {
                min: 0,
                max:
                  Number.MAX_SAFE_INTEGER,
              },
            ),
        });

    return deepFreeze(
      redact(result),
    );
  }

  async getReport({
    tenantId,
    snapshotId,
    provider,
  } = {}) {
    const scopedTenant =
      this._tenantId(
        tenantId,
      );

    this._provider(
      provider,
    );

    const normalizedId =
      normalizeString(
        snapshotId,
        180,
      );

    if (!normalizedId) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .INVALID_INPUT,
        'snapshotId is required.',
      );
    }

    if (
      typeof this.repository
        .getSnapshotById
      !== 'function'
    ) {
      throw new ModelDriftMonitorError(
        MODEL_DRIFT_ERROR_CODES
          .REPOSITORY_UNAVAILABLE,
        'Model drift repository does not implement getSnapshotById.',
      );
    }

    const record =
      await this.repository
        .getSnapshotById({
          tenantId:
            scopedTenant,

          snapshotId:
            normalizedId,

          provider:
            PROVIDER,
        });

    return record
      ? deepFreeze(
          redact(record),
        )
      : null;
  }

  async health() {
    let repositoryHealth =
      null;

    let state =
      'HEALTHY';

    try {
      if (
        typeof this.repository
          .healthCheck
        === 'function'
      ) {
        repositoryHealth =
          await this.repository
            .healthCheck();
      } else if (
        typeof this.repository
          .health
        === 'function'
      ) {
        repositoryHealth =
          await this.repository
            .health();
      } else {
        repositoryHealth = {
          ok: true,
          reason:
            'health method not implemented; repository is configured',
        };
      }
    } catch (error) {
      state =
        'UNAVAILABLE';

      repositoryHealth = {
        ok: false,

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

    if (
      repositoryHealth?.ok === false
      && state
        !== 'UNAVAILABLE'
    ) {
      state =
        'DEGRADED';
    }

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
        state === 'HEALTHY',

      degraded:
        state === 'DEGRADED',

      unavailable:
        state === 'UNAVAILABLE',

      repository:
        redact(
          repositoryHealth,
        ),

      safety: {
        readOnlyAgainstFinancialCore:
          true,

        financialMutationPerformed:
          false,

        paymentExecutionPerformed:
          false,

        ledgerMutationPerformed:
          false,

        modelRetrainingPerformed:
          false,

        modelDisabled:
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

      tenantIsolation:
        true,

      baselineVersioning:
        true,

      immutableBaselines:
        true,

      statistics: [
        'PSI',
        'Jensen-Shannon divergence',
        'Kolmogorov-Smirnov statistic',
        'missingness delta',
        'performance delta',
        'calibration error',
        'prediction-rate delta',
      ],

      readOnlyAgainstFinancialCore:
        true,

      automaticRetraining:
        false,

      automaticPaymentBlocking:
        false,

      automaticModelDisabling:
        false,

      rawFeaturePersistence:
        false,
    });
  }
}

export function createModelDriftMonitor(
  options = {},
) {
  return new ModelDriftMonitor(
    options,
  );
}

export const createAirtelModelDriftMonitor =
  createModelDriftMonitor;

export const AirtelModelDriftMonitor =
  ModelDriftMonitor;

export const constants =
  Object.freeze({
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    PROVIDER,
    SCHEMA_VERSION,
    HASH_ALGORITHM,
    DRIFT_STATUS,
    EVIDENCE_STATUS,
    DRIFT_TYPES,
    SEVERITY,
    MODEL_DRIFT_ERROR_CODES,
  });

export function buildDriftFingerprint(
  value,
) {
  return `sha256:${sha256(
    value,
  )}`;
}

export function calculatePSI(
  baseCounts,
  currentCounts,
  options = {},
) {
  const minProbability =
    toFiniteNumber(
      options.minProbability,
      DEFAULT_CONFIG
        .minProbability,
    );

  return populationStabilityIndex(
    baseCounts,
    currentCounts,
    minProbability,
  );
}

export function calculateJensenShannon(
  baseCounts,
  currentCounts,
  options = {},
) {
  const minProbability =
    toFiniteNumber(
      options.minProbability,
      DEFAULT_CONFIG
        .minProbability,
    );

  return jensenShannonDivergence(
    baseCounts,
    currentCounts,
    minProbability,
  );
}

export default ModelDriftMonitor;