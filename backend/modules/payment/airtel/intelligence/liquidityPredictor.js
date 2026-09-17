'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Liquidity Predictor
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/liquidityPredictor.js
 *
 * Architectural Role:
 *   Governed liquidity forecasting and cash-flow intelligence boundary for the
 *   Airtel payment intelligence stack.
 *
 * Responsibilities:
 *   - Normalize historical Airtel inflow/outflow observations.
 *   - Forecast future liquidity demand and supply using deterministic,
 *     explainable forecasting methods.
 *   - Calculate projected inflows, projected outflows, net flow and cumulative
 *     liquidity trajectory using exact minor-unit arithmetic.
 *   - Produce confidence/quality indicators for forecasts.
 *   - Detect projected liquidity pressure, deficit windows and concentration.
 *   - Incorporate bounded operational signals such as callback backlog,
 *     payment failures, pending transactions and settlement timing where
 *     supplied as evidence.
 *   - Support scenario analysis.
 *   - Support historical backtesting.
 *   - Support batch forecasting.
 *   - Persist forecasting artifacts through an optional repository.
 *   - Emit sanitized intelligence events and audit records.
 *   - Provide health, diagnostics and capability information.
 *
 * Explicitly NOT Responsible For:
 *   - Payment authorization.
 *   - Payment execution.
 *   - Airtel API/HTTP communication.
 *   - OAuth/token management.
 *   - Wallet or bank balance mutation.
 *   - Treasury transfers.
 *   - Cash reservation.
 *   - Settlement authorization.
 *   - Ledger posting.
 *   - Reconciliation authority.
 *   - Loan approval.
 *   - Credit decisions.
 *   - Fraud blocking.
 *   - AML/KYC decisions.
 *   - Regulatory determinations.
 *   - Autonomous treasury actions.
 *
 * Financial Safety:
 *   - Monetary values are represented as exact decimal strings / bigint minor
 *     units.
 *   - Monetary addition/subtraction is performed with BigInt.
 *   - Number is never used for money arithmetic.
 *   - Forecast values are projections and MUST NOT be treated as authoritative
 *     balances.
 *   - A forecast cannot create, reserve, release or settle funds.
 *
 * Forecasting Governance:
 *   - Forecast confidence reflects data quality and model agreement, not
 *     certainty.
 *   - Missing evidence produces explicit uncertainty.
 *   - Scenario outputs are advisory.
 *   - No forecast automatically changes a payment or treasury action.
 *   - Model/version lineage is retained where available.
 *
 * Module Format:
 *   CommonJS
 *
 * =============================================================================
 */

const crypto = require('node:crypto');

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PROVIDER = 'AIRTEL';

const FLOW_TYPES = Object.freeze({
  INFLOW: 'INFLOW',
  OUTFLOW: 'OUTFLOW',
  NET: 'NET',
});

const FORECAST_METHODS = Object.freeze({
  MOVING_AVERAGE: 'MOVING_AVERAGE',
  WEIGHTED_MOVING_AVERAGE: 'WEIGHTED_MOVING_AVERAGE',
  EXPONENTIAL_SMOOTHING: 'EXPONENTIAL_SMOOTHING',
  ENSEMBLE: 'ENSEMBLE',
  SCENARIO: 'SCENARIO',
});

const FORECAST_STATUS = Object.freeze({
  GENERATED: 'GENERATED',
  PARTIAL: 'PARTIAL',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  FAILED: 'FAILED',
});

const PRESSURE_LEVELS = Object.freeze({
  NONE: 'NONE',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
  UNKNOWN: 'UNKNOWN',
});

const TREND = Object.freeze({
  INCREASING: 'INCREASING',
  DECREASING: 'DECREASING',
  STABLE: 'STABLE',
  UNKNOWN: 'UNKNOWN',
});

const SCENARIOS = Object.freeze({
  BASELINE: 'BASELINE',
  CONSERVATIVE: 'CONSERVATIVE',
  STRESS: 'STRESS',
  UPSIDE: 'UPSIDE',
});

const LIMITS = Object.freeze({
  MAX_OBSERVATIONS: 1000,
  MAX_FORECAST_POINTS: 366,
  MAX_SCENARIOS: 10,
  MAX_METADATA_KEYS: 40,
  MAX_METADATA_VALUE_LENGTH: 500,
  MAX_STRING_LENGTH: 1200,
  MAX_REASON_LENGTH: 1500,
  MAX_HISTORY: 250,
  MAX_BATCH: 100,
  MAX_CURRENCY_LENGTH: 10,
  MAX_WINDOW: 365,
  DEFAULT_LOOKBACK: 30,
  DEFAULT_HORIZON: 7,
  MAX_HORIZON: 366,
  DEFAULT_SMOOTHING_ALPHA: 0.30,
  DEFAULT_MIN_OBSERVATIONS: 7,
  DEFAULT_PRESSURE_BUFFER_RATIO: 0.10,
  MAX_PRESSURE_BUFFER_RATIO: 10,
  MAX_VOLATILITY_RATIO: 10,
});

const DEFAULT_GOVERNANCE = Object.freeze({
  minimumObservations:
    LIMITS.DEFAULT_MIN_OBSERVATIONS,
  lookback:
    LIMITS.DEFAULT_LOOKBACK,
  horizon:
    LIMITS.DEFAULT_HORIZON,
  smoothingAlpha:
    LIMITS.DEFAULT_SMOOTHING_ALPHA,
  pressureBufferRatio:
    LIMITS.DEFAULT_PRESSURE_BUFFER_RATIO,
  minimumConfidence:
    0.40,
});

const SECRET_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /signature/i,
  /private.?key/i,
  /client.?secret/i,
  /api.?key/i,
  /credential/i,
];

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
  );
}

function boundedText(
  value,
  maxLength = LIMITS.MAX_STRING_LENGTH
) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  return text.slice(0, maxLength);
}

function normalizeId(value) {
  return boundedText(value, 200);
}

function normalizeProvider(value) {
  return (
    boundedText(value, 50)?.toUpperCase() ||
    PROVIDER
  );
}

function normalizeCurrency(value) {
  return (
    boundedText(
      value,
      LIMITS.MAX_CURRENCY_LENGTH
    )?.toUpperCase() || null
  );
}

function normalizeTimestamp(
  value,
  fallback = new Date()
) {
  if (
    value instanceof Date &&
    !Number.isNaN(value.getTime())
  ) {
    return value.toISOString();
  }

  if (
    value !== null &&
    value !== undefined
  ) {
    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return fallback.toISOString();
}

function normalizeInteger(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (typeof value === 'bigint') {
    return value;
  }

  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value)
  ) {
    return BigInt(value);
  }

  const text = String(value).trim();

  if (!/^-?\d+$/.test(text)) {
    return null;
  }

  try {
    return BigInt(text);
  } catch {
    return null;
  }
}

function normalizeMoneyMinor(value) {
  const amount = normalizeInteger(value);

  return amount === null
    ? null
    : amount.toString();
}

function moneyAdd(
  a,
  b
) {
  const left =
    normalizeInteger(a) ?? 0n;
  const right =
    normalizeInteger(b) ?? 0n;

  return (
    left + right
  ).toString();
}

function moneySubtract(
  a,
  b
) {
  const left =
    normalizeInteger(a) ?? 0n;
  const right =
    normalizeInteger(b) ?? 0n;

  return (
    left - right
  ).toString();
}

function moneyMax(
  values
) {
  if (!Array.isArray(values) || !values.length) {
    return '0';
  }

  let maximum =
    normalizeInteger(values[0]) ?? 0n;

  for (const value of values.slice(1)) {
    const current =
      normalizeInteger(value) ?? 0n;

    if (current > maximum) {
      maximum = current;
    }
  }

  return maximum.toString();
}

function moneyMin(
  values
) {
  if (!Array.isArray(values) || !values.length) {
    return '0';
  }

  let minimum =
    normalizeInteger(values[0]) ?? 0n;

  for (const value of values.slice(1)) {
    const current =
      normalizeInteger(value) ?? 0n;

    if (current < minimum) {
      minimum = current;
    }
  }

  return minimum.toString();
}

function moneyAbs(
  value
) {
  const amount =
    normalizeInteger(value) ?? 0n;

  return (
    amount < 0n
      ? -amount
      : amount
  ).toString();
}

function moneyMultiplyRatio(
  value,
  ratio
) {
  const amount =
    normalizeInteger(value) ?? 0n;

  const numericRatio =
    Number(ratio);

  if (
    !Number.isFinite(numericRatio)
  ) {
    return '0';
  }

  /*
   * Convert the bounded ratio to an integer basis-point multiplier.
   * This avoids floating point arithmetic over the monetary value itself.
   */
  const basisPoints = BigInt(
    Math.round(
      numericRatio * 10000
    )
  );

  const sign =
    basisPoints < 0n
      ? -1n
      : 1n;

  const positiveBasisPoints =
    basisPoints < 0n
      ? -basisPoints
      : basisPoints;

  const result =
    (
      amount *
      positiveBasisPoints
    ) / 10000n;

  return (
    result * sign
  ).toString();
}

function moneyAverage(
  values
) {
  if (!Array.isArray(values) || !values.length) {
    return '0';
  }

  let total = 0n;
  let count = 0n;

  for (const value of values) {
    const normalized =
      normalizeInteger(value);

    if (normalized === null) {
      continue;
    }

    total += normalized;
    count += 1n;
  }

  if (count === 0n) {
    return '0';
  }

  return (
    total / count
  ).toString();
}

function moneyRatio(
  numerator,
  denominator
) {
  const numeratorValue =
    normalizeInteger(numerator) ?? 0n;

  const denominatorValue =
    normalizeInteger(denominator) ?? 0n;

  if (denominatorValue === 0n) {
    return null;
  }

  const numeratorAbs =
    numeratorValue < 0n
      ? -numeratorValue
      : numeratorValue;

  const denominatorAbs =
    denominatorValue < 0n
      ? -denominatorValue
      : denominatorValue;

  if (denominatorAbs === 0n) {
    return null;
  }

  /*
   * Ratio returned as a safe Number because it is a dimensionless analytical
   * ratio, not monetary arithmetic.
   */
  const precisionFactor =
    1000000n;

  const scaled =
    (
      numeratorAbs *
      precisionFactor
    ) /
    denominatorAbs;

  const result =
    Number(scaled) /
    Number(precisionFactor);

  return Number.isFinite(result)
    ? result
    : null;
}

function clamp(
  value,
  min,
  max
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(
    max,
    Math.max(min, number)
  );
}

function normalizeProbability(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return clamp(
    number,
    0,
    1
  );
}

function normalizeScore(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return clamp(
    number,
    0,
    100
  );
}

function sanitizeMetadata(
  value
) {
  if (!isPlainObject(value)) {
    return {};
  }

  const output = {};

  for (const [
    rawKey,
    rawValue,
  ] of Object.entries(value).slice(
    0,
    LIMITS.MAX_METADATA_KEYS
  )) {
    const key = boundedText(
      rawKey,
      100
    );

    if (
      !key ||
      SECRET_KEY_PATTERNS.some(
        (pattern) =>
          pattern.test(key)
      )
    ) {
      continue;
    }

    if (
      rawValue === null ||
      typeof rawValue === 'boolean'
    ) {
      output[key] =
        rawValue;
      continue;
    }

    if (
      typeof rawValue === 'number' &&
      Number.isFinite(rawValue)
    ) {
      output[key] =
        rawValue;
      continue;
    }

    if (
      typeof rawValue === 'string'
    ) {
      output[key] =
        rawValue.slice(
          0,
          LIMITS.MAX_METADATA_VALUE_LENGTH
        );
    }
  }

  return output;
}

function stableStringify(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return 'null';
  }

  if (
    typeof value === 'bigint'
  ) {
    return JSON.stringify(
      value.toString()
    );
  }

  if (
    value instanceof Date
  ) {
    return JSON.stringify(
      value.toISOString()
    );
  }

  if (
    Array.isArray(value)
  ) {
    return `[${value
      .map(stableStringify)
      .join(',')}]`;
  }

  if (
    isPlainObject(value)
  ) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(
            key
          )}:${stableStringify(
            value[key]
          )}`
      )
      .join(',')}}`;
  }

  return JSON.stringify(
    value
  );
}

function fingerprint(
  value
) {
  return crypto
    .createHash(
      'sha256'
    )
    .update(
      stableStringify(
        value
      )
    )
    .digest('hex');
}

function averageNumber(
  values
) {
  const valid =
    values.filter(
      (value) =>
        Number.isFinite(value)
    );

  if (!valid.length) {
    return null;
  }

  return (
    valid.reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    ) /
    valid.length
  );
}

function standardDeviation(
  values
) {
  const valid =
    values.filter(
      (value) =>
        Number.isFinite(value)
    );

  if (
    valid.length < 2
  ) {
    return null;
  }

  const mean =
    averageNumber(
      valid
    );

  const variance =
    valid.reduce(
      (
        sum,
        value
      ) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) /
    valid.length;

  return Math.sqrt(
    variance
  );
}

function normalizeDays(
  value,
  fallback
) {
  const number =
    Number(value);

  if (
    !Number.isInteger(
      number
    ) ||
    number <= 0
  ) {
    return fallback;
  }

  return Math.min(
    number,
    LIMITS.MAX_HORIZON
  );
}

function unique(
  values
) {
  return [
    ...new Set(
      values.filter(
        (value) =>
          value !== null &&
          value !== undefined &&
          value !== ''
      )
    ),
  ];
}

function deleteUndefined(
  object
) {
  for (const key of Object.keys(object)) {
    if (
      object[key] === undefined
    ) {
      delete object[key];
    }
  }

  return object;
}

/* -------------------------------------------------------------------------- */
/* Tenant context                                                             */
/* -------------------------------------------------------------------------- */

function resolveTenantId(
  input = {},
  context = {}
) {
  const candidates = [
    context.tenantId,
    context.tenant?.tenantId,
    context.tenant?.id,
    input.tenantId,
  ];

  const tenantId =
    candidates.find(
      (value) =>
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ''
    );

  return tenantId
    ? String(tenantId)
    : null;
}

function requireTenant(
  input,
  context
) {
  const tenantId =
    resolveTenantId(
      input,
      context
    );

  if (!tenantId) {
    const error =
      new Error(
        'Tenant context is required for liquidity prediction.'
      );

    error.code =
      'TENANT_REQUIRED';

    throw error;
  }

  return tenantId;
}

function resolveCorrelationId(
  input = {},
  context = {}
) {
  return (
    normalizeId(
      input.correlationId ||
        input.requestId ||
        context.correlationId ||
        context.requestId
    ) ||
    crypto.randomUUID()
  );
}

/* -------------------------------------------------------------------------- */
/* Observation normalization                                                  */
/* -------------------------------------------------------------------------- */

function normalizeObservation(
  observation = {},
  defaults = {}
) {
  const currency =
    normalizeCurrency(
      observation.currency ||
        defaults.currency
    );

  const date =
    normalizeTimestamp(
      observation.timestamp ||
        observation.date ||
        observation.observedAt
    );

  const inflow =
    normalizeMoneyMinor(
      observation.inflowMinor ??
        observation.inflow ??
        observation.inflows
    );

  const outflow =
    normalizeMoneyMinor(
      observation.outflowMinor ??
        observation.outflow ??
        observation.outflows
    );

  const net =
    normalizeMoneyMinor(
      observation.netMinor ??
        observation.net
    );

  if (
    inflow === null &&
    outflow === null &&
    net === null
  ) {
    return null;
  }

  let normalizedInflow =
    inflow || '0';

  let normalizedOutflow =
    outflow || '0';

  let normalizedNet =
    net;

  if (
    normalizedNet === null
  ) {
    normalizedNet =
      moneySubtract(
        normalizedInflow,
        normalizedOutflow
      );
  }

  return {
    id:
      normalizeId(
        observation.id ||
          observation.reference
      ),
    tenantId:
      normalizeId(
        observation.tenantId
      ),
    currency,
    timestamp:
      date,
    inflowMinor:
      normalizedInflow,
    outflowMinor:
      normalizedOutflow,
    netMinor:
      normalizedNet,
    transactionCount:
      Number.isFinite(
        Number(
          observation.transactionCount
        )
      )
        ? Math.max(
            0,
            Number(
              observation.transactionCount
            )
          )
        : null,
    pendingCount:
      Number.isFinite(
        Number(
          observation.pendingCount
        )
      )
        ? Math.max(
            0,
            Number(
              observation.pendingCount
            )
          )
        : null,
    failedCount:
      Number.isFinite(
        Number(
          observation.failedCount
        )
      )
        ? Math.max(
            0,
            Number(
              observation.failedCount
            )
          )
        : null,
    callbackBacklog:
      Number.isFinite(
        Number(
          observation.callbackBacklog
        )
      )
        ? Math.max(
            0,
            Number(
              observation.callbackBacklog
            )
          )
        : null,
    source:
      boundedText(
        observation.source,
        50
      )?.toUpperCase() ||
      'UNKNOWN',
    metadata:
      sanitizeMetadata(
        observation.metadata
      ),
  };
}

function normalizeObservations(
  observations,
  tenantId,
  options = {}
) {
  const list =
    Array.isArray(
      observations
    )
      ? observations
      : [];

  const defaultCurrency =
    normalizeCurrency(
      options.currency
    );

  const normalized = [];

  for (const observation of list.slice(
    0,
    LIMITS.MAX_OBSERVATIONS
  )) {
    const item =
      normalizeObservation(
        observation,
        {
          currency:
            defaultCurrency,
        }
      );

    if (!item) {
      continue;
    }

    if (
      item.tenantId &&
      item.tenantId !==
        tenantId
    ) {
      continue;
    }

    if (
      defaultCurrency &&
      item.currency &&
      item.currency !==
        defaultCurrency
    ) {
      continue;
    }

    normalized.push(
      item
    );
  }

  return normalized.sort(
    (a, b) =>
      new Date(
        a.timestamp
      ).getTime() -
      new Date(
        b.timestamp
      ).getTime()
  );
}

/* -------------------------------------------------------------------------- */
/* Time-series aggregation                                                    */
/* -------------------------------------------------------------------------- */

function dayKey(
  timestamp
) {
  const date =
    new Date(timestamp);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date
    .toISOString()
    .slice(
      0,
      10
    );
}

function aggregateDaily(
  observations
) {
  const buckets =
    new Map();

  for (const item of observations) {
    const key =
      dayKey(
        item.timestamp
      );

    if (!key) {
      continue;
    }

    if (
      !buckets.has(
        key
      )
    ) {
      buckets.set(
        key,
        {
          timestamp:
            `${key}T00:00:00.000Z`,
          inflowMinor:
            '0',
          outflowMinor:
            '0',
          netMinor:
            '0',
          transactionCount:
            0,
          pendingCount:
            0,
          failedCount:
            0,
          callbackBacklog:
            0,
          transactionSamples:
            0,
          pendingSamples:
            0,
          failedSamples:
            0,
          callbackSamples:
            0,
        }
      );
    }

    const bucket =
      buckets.get(
        key
      );

    bucket.inflowMinor =
      moneyAdd(
        bucket.inflowMinor,
        item.inflowMinor
      );

    bucket.outflowMinor =
      moneyAdd(
        bucket.outflowMinor,
        item.outflowMinor
      );

    bucket.netMinor =
      moneyAdd(
        bucket.netMinor,
        item.netMinor
      );

    if (
      item.transactionCount !==
      null
    ) {
      bucket.transactionCount +=
        item.transactionCount;

      bucket.transactionSamples +=
        1;
    }

    if (
      item.pendingCount !==
      null
    ) {
      bucket.pendingCount +=
        item.pendingCount;

      bucket.pendingSamples +=
        1;
    }

    if (
      item.failedCount !==
      null
    ) {
      bucket.failedCount +=
        item.failedCount;

      bucket.failedSamples +=
        1;
    }

    if (
      item.callbackBacklog !==
      null
    ) {
      bucket.callbackBacklog +=
        item.callbackBacklog;

      bucket.callbackSamples +=
        1;
    }
  }

  return Array.from(
    buckets.values()
  ).sort(
    (a, b) =>
      new Date(
        a.timestamp
      ).getTime() -
      new Date(
        b.timestamp
      ).getTime()
  );
}

/* -------------------------------------------------------------------------- */
/* Historical statistics                                                      */
/* -------------------------------------------------------------------------- */

function movingAverage(
  values,
  window
) {
  if (
    !Array.isArray(values) ||
    !values.length
  ) {
    return null;
  }

  const boundedWindow =
    Math.min(
      Math.max(
        1,
        Number(window) ||
          1
      ),
      values.length
    );

  const slice =
    values.slice(
      -boundedWindow
    );

  return averageNumber(
    slice
  );
}

function weightedMovingAverage(
  values
) {
  if (
    !Array.isArray(values) ||
    !values.length
  ) {
    return null;
  }

  let weightedSum =
    0;

  let totalWeight =
    0;

  values.forEach(
    (
      value,
      index
    ) => {
      const weight =
        index + 1;

      weightedSum +=
        Number(value) *
        weight;

      totalWeight +=
        weight;
    }
  );

  return totalWeight
    ? weightedSum /
        totalWeight
    : null;
}

function exponentialSmoothing(
  values,
  alpha
) {
  if (
    !Array.isArray(values) ||
    !values.length
  ) {
    return null;
  }

  let result =
    Number(
      values[0]
    );

  if (
    !Number.isFinite(
      result
    )
  ) {
    return null;
  }

  const smoothing =
    clamp(
      alpha,
      0.01,
      1
    );

  for (
    let index = 1;
    index <
    values.length;
    index += 1
  ) {
    const current =
      Number(
        values[index]
      );

    if (
      !Number.isFinite(
        current
      )
    ) {
      continue;
    }

    result =
      smoothing *
        current +
      (1 -
        smoothing) *
        result;
  }

  return result;
}

function trendFromValues(
  values
) {
  if (
    !Array.isArray(
      values
    ) ||
    values.length <
      2
  ) {
    return TREND.UNKNOWN;
  }

  const numeric =
    values
      .map(Number)
      .filter(
        Number.isFinite
      );

  if (
    numeric.length <
    2
  ) {
    return TREND.UNKNOWN;
  }

  const half =
    Math.max(
      1,
      Math.floor(
        numeric.length /
          2
      )
    );

  const early =
    averageNumber(
      numeric.slice(
        0,
        half
      )
    );

  const late =
    averageNumber(
      numeric.slice(
        -half
      )
    );

  if (
    early === null ||
    late === null
  ) {
    return TREND.UNKNOWN;
  }

  const baseline =
    Math.max(
      Math.abs(
        early
      ),
      1
    );

  const relative =
    Math.abs(
      late -
        early
    ) /
    baseline;

  if (
    relative <
    0.03
  ) {
    return TREND.STABLE;
  }

  return late >
    early
    ? TREND.INCREASING
    : TREND.DECREASING;
}

function calculateVolatility(
  values
) {
  const numeric =
    values
      .map(Number)
      .filter(
        Number.isFinite
      );

  if (
    numeric.length <
    2
  ) {
    return null;
  }

  const mean =
    averageNumber(
      numeric
    );

  const deviation =
    standardDeviation(
      numeric
    );

  const denominator =
    Math.max(
      Math.abs(
        mean
      ),
      1
    );

  return deviation /
    denominator;
}

/* -------------------------------------------------------------------------- */
/* Forecast generators                                                        */
/* -------------------------------------------------------------------------- */

function forecastNumeric(
  values,
  horizon,
  options = {}
) {
  const clean =
    values
      .map(Number)
      .filter(
        Number.isFinite
      );

  const minimumObservations =
    Number(
      options.minimumObservations ||
        LIMITS.DEFAULT_MIN_OBSERVATIONS
    );

  if (
    clean.length <
    minimumObservations
  ) {
    return {
      method:
        FORECAST_METHODS.MOVING_AVERAGE,
      status:
        FORECAST_STATUS.INSUFFICIENT_DATA,
      values: [],
      baseValue:
        null,
      volatility:
        null,
    };
  }

  const lookback =
    Math.min(
      clean.length,
      normalizeDays(
        options.lookback,
        LIMITS.DEFAULT_LOOKBACK
      )
    );

  const recent =
    clean.slice(
      -lookback
    );

  const moving =
    movingAverage(
      recent,
      recent.length
    );

  const weighted =
    weightedMovingAverage(
      recent
    );

  const exponential =
    exponentialSmoothing(
      recent,
      options.smoothingAlpha ??
        LIMITS.DEFAULT_SMOOTHING_ALPHA
    );

  const candidates =
    [
      moving,
      weighted,
      exponential,
    ].filter(
      Number.isFinite
    );

  const baseValue =
    candidates.length
      ? averageNumber(
          candidates
        )
      : 0;

  const volatility =
    calculateVolatility(
      recent
    );

  const boundedVolatility =
    clamp(
      volatility || 0,
      0,
      LIMITS.MAX_VOLATILITY_RATIO
    );

  const valuesOut =
    [];

  let last =
    Number(
      baseValue
    );

  for (
    let index = 0;
    index < horizon;
    index += 1
  ) {
    /*
     * Mean-reverting projection:
     * forecast remains close to the ensemble baseline rather than creating
     * unsupported explosive growth.
     */
    const decay =
      Math.pow(
        0.90,
        index
      );

    const latest =
      clean[
        clean.length - 1
      ];

    const adjustment =
      (
        latest -
        baseValue
      ) *
      decay *
      0.15;

    last =
      Math.max(
        0,
        baseValue +
          adjustment
      );

    valuesOut.push(
      last
    );
  }

  return {
    method:
      FORECAST_METHODS.ENSEMBLE,
    status:
      FORECAST_STATUS.GENERATED,
    values:
      valuesOut,
    baseValue,
    volatility:
      boundedVolatility,
    methodInputs: {
      movingAverage:
        moving,
      weightedMovingAverage:
        weighted,
      exponentialSmoothing:
        exponential,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Forecast confidence                                                        */
/* -------------------------------------------------------------------------- */

function calculateForecastConfidence(
  observationCount,
  volatility,
  quality,
  scenarioAdjustment = 0
) {
  const sampleScore =
    clamp(
      observationCount /
        Math.max(
          1,
          DEFAULT_GOVERNANCE.minimumObservations *
            4
        ),
      0,
      1
    );

  const volatilityScore =
    clamp(
      1 -
        clamp(
          volatility || 0,
          0,
          1
        ),
      0,
      1
    );

  const qualityScore =
    clamp(
      quality,
      0,
      1
    );

  const base =
    sampleScore * 0.35 +
    volatilityScore * 0.30 +
    qualityScore * 0.35;

  return clamp(
    base +
      scenarioAdjustment,
    0,
    1
  );
}

function normalizeDataQuality(
  observations,
  daily
) {
  if (
    !observations.length
  ) {
    return {
      score: 0,
      quality:
        'LOW',
      observations: 0,
      days: 0,
      missingDays: 0,
      reasons: [
        'No observations were supplied.',
      ],
    };
  }

  const days =
    daily.length;

  let qualityScore =
    0.30;

  if (
    observations.length >=
    LIMITS.DEFAULT_MIN_OBSERVATIONS
  ) {
    qualityScore +=
      0.25;
  }

  if (
    observations.length >=
    LIMITS.DEFAULT_MIN_OBSERVATIONS *
      4
  ) {
    qualityScore +=
      0.20;
  }

  if (
    days >=
    14
  ) {
    qualityScore +=
      0.15;
  }

  const observationsWithCurrency =
    observations.filter(
      (item) =>
        Boolean(
          item.currency
        )
    ).length;

  if (
    observationsWithCurrency ===
    observations.length
  ) {
    qualityScore +=
      0.10;
  }

  let quality =
    'HIGH';

  if (
    qualityScore <
    0.50
  ) {
    quality =
      'LOW';
  } else if (
    qualityScore <
    0.75
  ) {
    quality =
      'MEDIUM';
  }

  return {
    score:
      clamp(
        qualityScore,
        0,
        1
      ),
    quality,
    observations:
      observations.length,
    days,
    missingDays:
      0,
    reasons: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Pressure analysis                                                          */
/* -------------------------------------------------------------------------- */

function pressureFromRatio(
  ratio
) {
  if (
    ratio === null ||
    ratio === undefined
  ) {
    return PRESSURE_LEVELS.UNKNOWN;
  }

  if (
    ratio <= 0
  ) {
    return PRESSURE_LEVELS.NONE;
  }

  if (
    ratio < 0.25
  ) {
    return PRESSURE_LEVELS.LOW;
  }

  if (
    ratio < 0.50
  ) {
    return PRESSURE_LEVELS.MEDIUM;
  }

  if (
    ratio < 0.75
  ) {
    return PRESSURE_LEVELS.HIGH;
  }

  return PRESSURE_LEVELS.CRITICAL;
}

function calculateProjectedPressure(
  projectedNetMinor,
  projectedOutflowMinor,
  options = {}
) {
  const net =
    normalizeInteger(
      projectedNetMinor
    ) ?? 0n;

  const outflow =
    normalizeInteger(
      projectedOutflowMinor
    ) ?? 0n;

  if (
    outflow <= 0n
  ) {
    return {
      ratio: 0,
      level:
        net < 0n
          ? PRESSURE_LEVELS.CRITICAL
          : PRESSURE_LEVELS.NONE,
    };
  }

  if (
    net >= 0n
  ) {
    return {
      ratio: 0,
      level:
        PRESSURE_LEVELS.NONE,
    };
  }

  const deficit =
    -net;

  const ratio =
    moneyRatio(
      deficit,
      outflow
    );

  return {
    ratio,
    level:
      pressureFromRatio(
        ratio
      ),
  };
}

function detectDeficitWindow(
  forecastPoints
) {
  const deficitPoints =
    forecastPoints.filter(
      (point) => {
        const net =
          normalizeInteger(
            point.netMinor
          ) ?? 0n;

        return net < 0n;
      }
    );

  if (
    !deficitPoints.length
  ) {
    return {
      detected:
        false,
      startDate:
        null,
      endDate:
        null,
      days:
        0,
      totalDeficitMinor:
        '0',
    };
  }

  let total =
    0n;

  for (const point of
    deficitPoints) {
    total +=
      -(
        normalizeInteger(
          point.netMinor
        ) ?? 0n
      );
  }

  return {
    detected:
      true,
    startDate:
      deficitPoints[0]
        .date,
    endDate:
      deficitPoints[
        deficitPoints.length -
          1
      ].date,
    days:
      deficitPoints.length,
    totalDeficitMinor:
      total.toString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Operational pressure signals                                               */
/* -------------------------------------------------------------------------- */

function summarizeOperationalSignals(
  observations
) {
  const pending =
    observations
      .map(
        (item) =>
          item.pendingCount
      )
      .filter(
        (value) =>
          Number.isFinite(
            value
          )
      );

  const failed =
    observations
      .map(
        (item) =>
          item.failedCount
      )
      .filter(
        (value) =>
          Number.isFinite(
            value
          )
      );

  const callback =
    observations
      .map(
        (item) =>
          item.callbackBacklog
      )
      .filter(
        (value) =>
          Number.isFinite(
            value
          )
      );

  const transactionCounts =
    observations
      .map(
        (item) =>
          item.transactionCount
      )
      .filter(
        (value) =>
          Number.isFinite(
            value
          )
      );

  return {
    averagePending:
      averageNumber(
        pending
      ),
    averageFailed:
      averageNumber(
        failed
      ),
    averageCallbackBacklog:
      averageNumber(
        callback
      ),
    averageTransactions:
      averageNumber(
        transactionCounts
      ),
    latestPending:
      pending.length
        ? pending[
            pending.length -
              1
          ]
        : null,
    latestFailed:
      failed.length
        ? failed[
            failed.length -
              1
          ]
        : null,
    latestCallbackBacklog:
      callback.length
        ? callback[
            callback.length -
              1
          ]
        : null,
  };
}

function operationalQualityPenalty(
  signals
) {
  let penalty =
    0;

  if (
    Number.isFinite(
      signals.averagePending
    ) &&
    signals.averagePending >
      100
  ) {
    penalty +=
      0.10;
  }

  if (
    Number.isFinite(
      signals.averageFailed
    ) &&
    signals.averageFailed >
      10
  ) {
    penalty +=
      0.10;
  }

  if (
    Number.isFinite(
      signals.averageCallbackBacklog
    ) &&
    signals.averageCallbackBacklog >
      100
  ) {
    penalty +=
      0.10;
  }

  return clamp(
    penalty,
    0,
    0.50
  );
}

/* -------------------------------------------------------------------------- */
/* Scenario generation                                                        */
/* -------------------------------------------------------------------------- */

function normalizeScenario(
  value
) {
  const normalized =
    boundedText(
      value,
      50
    )?.toUpperCase();

  return Object.values(
    SCENARIOS
  ).includes(
    normalized
  )
    ? normalized
    : SCENARIOS.BASELINE;
}

function scenarioMultipliers(
  scenario
) {
  switch (
    normalizeScenario(
      scenario
    )
  ) {
    case SCENARIOS.CONSERVATIVE:
      return {
        inflow:
          0.85,
        outflow:
          1.05,
        confidenceAdjustment:
          -0.05,
      };

    case SCENARIOS.STRESS:
      return {
        inflow:
          0.70,
        outflow:
          1.20,
        confidenceAdjustment:
          -0.10,
      };

    case SCENARIOS.UPSIDE:
      return {
        inflow:
          1.15,
        outflow:
          0.95,
        confidenceAdjustment:
          0.00,
      };

    case SCENARIOS.BASELINE:
    default:
      return {
        inflow:
          1.00,
        outflow:
          1.00,
        confidenceAdjustment:
          0.00,
      };
  }
}

/* -------------------------------------------------------------------------- */
/* Main engine                                                                */
/* -------------------------------------------------------------------------- */

class LiquidityPredictor {
  constructor(options = {}) {
    this.name =
      'AirtelLiquidityPredictor';

    this.provider =
      normalizeProvider(
        options.provider ||
          PROVIDER
      );

    this.repository =
      createRepositoryAdapter(
        options.repository ||
          options.repositories
            ?.liquidity ||
          options.repositories
            ?.liquidityPredictor ||
          null
      );

    this.featureStore =
      options.featureStore ||
      options.intelligence
        ?.featureStore ||
      null;

    this.modelAdapter =
      options.modelAdapter ||
      options.model ||
      null;

    this.eventBus =
      options.eventBus ||
      options.events ||
      options.outbox ||
      null;

    this.auditLogger =
      options.auditLogger ||
      options.audit ||
      null;

    this.logger =
      options.logger ||
      console;

    this.clock =
      typeof options.clock ===
      'function'
        ? options.clock
        : () => new Date();

    this.governance = {
      ...DEFAULT_GOVERNANCE,
      ...(isPlainObject(
        options.governance
      )
        ? options.governance
        : {}),
    };

    this.modelName =
      boundedText(
        options.modelName,
        150
      ) || null;

    this.modelVersion =
      boundedText(
        options.modelVersion,
        80
      ) || null;

    this.initialized =
      false;

    this.initializingPromise =
      null;

    this.metrics = {
      forecasts:
        0,
      successful:
        0,
      partial:
        0,
      insufficientData:
        0,
      failures:
        0,
      batchForecasts:
        0,
      scenarios:
        0,
      backtests:
        0,
      modelCalls:
        0,
      modelFailures:
        0,
      repositoryFailures:
        0,
      eventFailures:
        0,
      auditFailures:
        0,
      pressureAlerts:
        0,
    };
  }

  async initialize(
    context = {}
  ) {
    if (
      this.initialized
    ) {
      return this.getHealth();
    }

    if (
      this.initializingPromise
    ) {
      return this.initializingPromise;
    }

    this.initializingPromise =
      (async () => {
        for (const dependency of [
          this.repository,
          this.featureStore,
        ]) {
          if (
            dependency &&
            typeof dependency.initialize ===
              'function'
          ) {
            await dependency.initialize(
              context
            );
          }
        }

        this.initialized =
          true;

        return this.getHealth();
      })()
        .catch((error) => {
          this.initialized =
            false;

          throw error;
        })
        .finally(() => {
          this.initializingPromise =
            null;
        });

    return this.initializingPromise;
  }

  async destroy(
    context = {}
  ) {
    for (const dependency of [
      this.repository,
      this.featureStore,
    ]) {
      try {
        if (
          dependency &&
          typeof dependency.destroy ===
            'function'
        ) {
          await dependency.destroy(
            context
          );
        }
      } catch (error) {
        this.logger.warn?.(
          {
            err: error,
          },
          'Airtel liquidity predictor dependency shutdown failed'
        );
      }
    }

    this.initialized =
      false;
  }

  async resolveFeatures(
    input = {},
    context = {}
  ) {
    const direct =
      Array.isArray(
        input.features
      )
        ? input.features
        : Array.isArray(
            input.featureVector
          )
          ? input.featureVector
          : [];

    if (
      direct.length
    ) {
      return {
        features:
          direct.slice(
            0,
            100
          ),
        partial:
          false,
        source:
          'INPUT',
      };
    }

    if (
      !this.featureStore
    ) {
      return {
        features: [],
        partial:
          true,
        source:
          'NONE',
      };
    }

    const tenantId =
      requireTenant(
        input,
        context
      );

    const entityId =
      normalizeId(
        input.entityId ||
          input.memberId ||
          input.customerId ||
          input.subjectId
      );

    if (
      !entityId ||
      typeof this.featureStore.getLatest !==
        'function'
    ) {
      return {
        features: [],
        partial:
          true,
        source:
          'FEATURE_STORE',
      };
    }

    try {
      const record =
        await this.featureStore.getLatest(
          {
            tenantId,
            provider:
              this.provider,
            entityId,
            entityType:
              input.entityType,
            featureGroup:
              input.featureGroup ||
              'liquidity',
          },
          {
            ...context,
            tenantId,
          }
        );

      if (
        !record?.features
      ) {
        return {
          features: [],
          partial:
            true,
          source:
            'FEATURE_STORE',
        };
      }

      return {
        features:
          Array.isArray(
            record.features
          )
            ? record.features.slice(
                0,
                100
              )
            : [],
        partial:
          record.status !==
          'ACTIVE',
        source:
          'FEATURE_STORE',
        featureRecordId:
          normalizeId(
            record.featureRecordId
          ),
        featureHash:
          normalizeId(
            record.featureHash
          ),
      };
    } catch (error) {
      this.logger.warn?.(
        {
          err: error,
          tenantId,
          entityId,
        },
        'Airtel liquidity feature lookup failed'
      );

      return {
        features: [],
        partial:
          true,
        source:
          'FEATURE_STORE',
      };
    }
  }

  async invokeModel(
    input,
    dailyData,
    context = {}
  ) {
    if (
      !this.modelAdapter
    ) {
      return {
        status:
          'UNAVAILABLE',
        inflow:
          null,
        outflow:
          null,
        metadata: {},
      };
    }

    this.metrics.modelCalls +=
      1;

    const payload = {
      tenantId:
        resolveTenantId(
          input,
          context
        ),
      provider:
        this.provider,
      currency:
        normalizeCurrency(
          input.currency
        ),
      horizon:
        normalizeDays(
          input.horizon,
          DEFAULT_GOVERNANCE.horizon
        ),
      observations:
        dailyData.map(
          (item) => ({
            timestamp:
              item.timestamp,
            inflowMinor:
              item.inflowMinor,
            outflowMinor:
              item.outflowMinor,
            netMinor:
              item.netMinor,
            transactionCount:
              item.transactionCount,
            pendingCount:
              item.pendingCount,
            failedCount:
              item.failedCount,
            callbackBacklog:
              item.callbackBacklog,
          })
        ),
      modelName:
        this.modelName,
      modelVersion:
        this.modelVersion,
    };

    try {
      let result;

      if (
        typeof this.modelAdapter.predict ===
        'function'
      ) {
        result =
          await this.modelAdapter.predict(
            payload,
            context
          );
      } else if (
        typeof this.modelAdapter.forecast ===
        'function'
      ) {
        result =
          await this.modelAdapter.forecast(
            payload,
            context
          );
      } else if (
        typeof this.modelAdapter.predictLiquidity ===
        'function'
      ) {
        result =
          await this.modelAdapter.predictLiquidity(
            payload,
            context
          );
      } else {
        return {
          status:
            'UNAVAILABLE',
          inflow:
            null,
          outflow:
            null,
          metadata: {},
        };
      }

      return {
        status:
          boundedText(
            result?.status,
            30
          )?.toUpperCase() ||
          'AVAILABLE',
        inflow:
          Array.isArray(
            result?.inflow
          )
            ? result.inflow
                .map(Number)
                .filter(
                  Number.isFinite
                )
            : [],
        outflow:
          Array.isArray(
            result?.outflow
          )
            ? result.outflow
                .map(Number)
                .filter(
                  Number.isFinite
                )
            : [],
        confidence:
          normalizeProbability(
            result?.confidence
          ),
        modelName:
          boundedText(
            result?.modelName,
            150
          ),
        modelVersion:
          boundedText(
            result?.modelVersion,
            80
          ),
        metadata:
          sanitizeMetadata(
            result?.metadata
          ),
      };
    } catch (error) {
      this.metrics.modelFailures +=
        1;

      this.logger.warn?.(
        {
          err: error,
        },
        'Airtel liquidity model invocation failed'
      );

      return {
        status:
          'DEGRADED',
        inflow:
          [],
        outflow:
          [],
        confidence:
          null,
        modelName:
          this.modelName,
        modelVersion:
          this.modelVersion,
        metadata: {},
      };
    }
  }

  generateForecastPoints(
    daily,
    input = {},
    context = {},
    modelResult = null
  ) {
    const horizon =
      normalizeDays(
        input.horizon,
        this.governance.horizon
      );

    const inflowValues =
      daily.map(
        (item) =>
          Number(
            item.inflowMinor
          )
      );

    const outflowValues =
      daily.map(
        (item) =>
          Number(
            item.outflowMinor
          )
      );

    const inflowForecast =
      forecastNumeric(
        inflowValues,
        horizon,
        {
          minimumObservations:
            this.governance
              .minimumObservations,
          lookback:
            input.lookback ||
            this.governance
              .lookback,
          smoothingAlpha:
            input.smoothingAlpha ||
            this.governance
              .smoothingAlpha,
        }
      );

    const outflowForecast =
      forecastNumeric(
        outflowValues,
        horizon,
        {
          minimumObservations:
            this.governance
              .minimumObservations,
          lookback:
            input.lookback ||
            this.governance
              .lookback,
          smoothingAlpha:
            input.smoothingAlpha ||
            this.governance
              .smoothingAlpha,
        }
      );

    /*
     * The model adapter is supplementary. It may contribute to the numerical
     * forecast, but the engine does not depend on opaque model output.
     */
    const modelInflow =
      Array.isArray(
        modelResult?.inflow
      )
        ? modelResult.inflow
        : [];

    const modelOutflow =
      Array.isArray(
        modelResult?.outflow
      )
        ? modelResult.outflow
        : [];

    const points =
      [];

    for (
      let index = 0;
      index < horizon;
      index += 1
    ) {
      const movingInflow =
        inflowForecast.values[
          index
        ] ?? 0;

      const movingOutflow =
        outflowForecast.values[
          index
        ] ?? 0;

      const modelInflowValue =
        modelInflow[index];

      const modelOutflowValue =
        modelOutflow[index];

      let inflowNumber =
        movingInflow;

      let outflowNumber =
        movingOutflow;

      if (
        Number.isFinite(
          modelInflowValue
        )
      ) {
        inflowNumber =
          (
            movingInflow +
            modelInflowValue
          ) /
          2;
      }

      if (
        Number.isFinite(
          modelOutflowValue
        )
      ) {
        outflowNumber =
          (
            movingOutflow +
            modelOutflowValue
          ) /
          2;
      }

      /*
       * Monetary conversion to minor units is done only from already-bounded
       * analytical values. Rounded integer minor units are persisted.
       */
      const projectedInflowMinor =
        String(
          Math.max(
            0,
            Math.round(
              inflowNumber
            )
          )
        );

      const projectedOutflowMinor =
        String(
          Math.max(
            0,
            Math.round(
              outflowNumber
            )
          )
        );

      const netMinor =
        moneySubtract(
          projectedInflowMinor,
          projectedOutflowMinor
        );

      const pressure =
        calculateProjectedPressure(
          netMinor,
          projectedOutflowMinor,
          {
            pressureBufferRatio:
              this.governance
                .pressureBufferRatio,
          }
        );

      const date =
        new Date(
          this.clock()
        );

      date.setUTCDate(
        date.getUTCDate() +
          index +
          1
      );

      points.push({
        date:
          date
            .toISOString()
            .slice(
              0,
              10
            ),
        timestamp:
          date.toISOString(),
        dayIndex:
          index + 1,
        inflowMinor:
          projectedInflowMinor,
        outflowMinor:
          projectedOutflowMinor,
        netMinor,
        pressureRatio:
          pressure.ratio,
        pressureLevel:
          pressure.level,
      });
    }

    return {
      horizon,
      points,
      methods: {
        inflow:
          inflowForecast,
        outflow:
          outflowForecast,
      },
      modelUsed:
        Boolean(
          modelResult &&
            (
              modelInflow.length ||
              modelOutflow.length
            )
        ),
    };
  }

  buildProjectedLiquidity(
    points,
    input = {}
  ) {
    let cumulativeNet =
      normalizeInteger(
        input.openingBalanceMinor ??
          input.openingLiquidityMinor
      ) ?? 0n;

    let minimumProjected =
      cumulativeNet;

    let maximumProjected =
      cumulativeNet;

    const projected =
      points.map(
        (point) => {
          cumulativeNet +=
            normalizeInteger(
              point.netMinor
            ) ?? 0n;

          if (
            cumulativeNet <
            minimumProjected
          ) {
            minimumProjected =
              cumulativeNet;
          }

          if (
            cumulativeNet >
            maximumProjected
          ) {
            maximumProjected =
              cumulativeNet;
          }

          return {
            ...point,
            cumulativeLiquidityMinor:
              cumulativeNet.toString(),
          };
        }
      );

    return {
      points:
        projected,
      minimumProjectedLiquidityMinor:
        minimumProjected.toString(),
      maximumProjectedLiquidityMinor:
        maximumProjected.toString(),
      endingProjectedLiquidityMinor:
        cumulativeNet.toString(),
    };
  }

  buildSummary(
    daily,
    forecast,
    dataQuality,
    operationalSignals,
    input = {}
  ) {
    const observedInflows =
      daily.map(
        (item) =>
          item.inflowMinor
      );

    const observedOutflows =
      daily.map(
        (item) =>
          item.outflowMinor
      );

    const observedNet =
      daily.map(
        (item) =>
          item.netMinor
      );

    const projectedInflows =
      forecast.points.map(
        (item) =>
          item.inflowMinor
      );

    const projectedOutflows =
      forecast.points.map(
        (item) =>
          item.outflowMinor
      );

    const projectedNet =
      forecast.points.map(
        (item) =>
          item.netMinor
      );

    const totalObservedInflows =
      observedInflows.reduce(
        (
          total,
          value
        ) =>
          moneyAdd(
            total,
            value
          ),
        '0'
      );

    const totalObservedOutflows =
      observedOutflows.reduce(
        (
          total,
          value
        ) =>
          moneyAdd(
            total,
            value
          ),
        '0'
      );

    const totalObservedNet =
      moneySubtract(
        totalObservedInflows,
        totalObservedOutflows
      );

    const totalProjectedInflows =
      projectedInflows.reduce(
        (
          total,
          value
        ) =>
          moneyAdd(
            total,
            value
          ),
        '0'
      );

    const totalProjectedOutflows =
      projectedOutflows.reduce(
        (
          total,
          value
        ) =>
          moneyAdd(
            total,
            value
          ),
        '0'
      );

    const totalProjectedNet =
      moneySubtract(
        totalProjectedInflows,
        totalProjectedOutflows
      );

    const observedInflowNumbers =
      observedInflows.map(
        (value) =>
          Number(value)
      );

    const observedOutflowNumbers =
      observedOutflows.map(
        (value) =>
          Number(value)
      );

    const observedNetNumbers =
      observedNet.map(
        (value) =>
          Number(value)
      );

    const projectedNetNumbers =
      projectedNet.map(
        (value) =>
          Number(value)
      );

    const trend =
      trendFromValues(
        observedNetNumbers
      );

    const forecastTrend =
      trendFromValues(
        projectedNetNumbers
      );

    const forecastVolatility =
      calculateVolatility(
        observedNetNumbers
      );

    const pressurePoints =
      forecast.points.filter(
        (point) =>
          [
            PRESSURE_LEVELS.HIGH,
            PRESSURE_LEVELS.CRITICAL,
          ].includes(
            point.pressureLevel
          )
      );

    const deficit =
      detectDeficitWindow(
        forecast.points
      );

    return {
      openingBalanceMinor:
        normalizeMoneyMinor(
          input.openingBalanceMinor ??
            input.openingLiquidityMinor
        ) || '0',

      observed: {
        days:
          daily.length,
        inflowMinor:
          totalObservedInflows,
        outflowMinor:
          totalObservedOutflows,
        netMinor:
          totalObservedNet,
        averageDailyInflowMinor:
          moneyAverage(
            observedInflows
          ),
        averageDailyOutflowMinor:
          moneyAverage(
            observedOutflows
          ),
        averageDailyNetMinor:
          moneyAverage(
            observedNet
          ),
        trend,
        volatilityRatio:
          forecastVolatility,
      },

      projected: {
        days:
          forecast.points.length,
        inflowMinor:
          totalProjectedInflows,
        outflowMinor:
          totalProjectedOutflows,
        netMinor:
          totalProjectedNet,
        averageDailyInflowMinor:
          moneyAverage(
            projectedInflows
          ),
        averageDailyOutflowMinor:
          moneyAverage(
            projectedOutflows
          ),
        averageDailyNetMinor:
          moneyAverage(
            projectedNet
          ),
        trend:
          forecastTrend,
        highOrCriticalPressureDays:
          pressurePoints.length,
        deficitWindow:
          deficit,
      },

      operationalSignals,

      dataQuality,

      currency:
        normalizeCurrency(
          input.currency
        ),

      advisoryOnly:
        true,
    };
  }

  async forecast(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const correlationId =
      resolveCorrelationId(
        input,
        context
      );

    await this.initialize(
      {
        ...context,
        tenantId,
        correlationId,
      }
    );

    try {
      const observations =
        normalizeObservations(
          input.observations ||
            input.history ||
            input.records,
          tenantId,
          {
            currency:
              input.currency,
          }
        );

      const daily =
        aggregateDaily(
          observations
        );

      const dataQuality =
        normalizeDataQuality(
          observations,
          daily
        );

      const operationalSignals =
        summarizeOperationalSignals(
          observations
        );

      const adjustedQuality =
        clamp(
          dataQuality.score -
            operationalQualityPenalty(
              operationalSignals
            ),
          0,
          1
        );

      dataQuality.score =
        adjustedQuality;

      const modelResult =
        await this.invokeModel(
          input,
          daily,
          {
            ...context,
            tenantId,
            correlationId,
          }
        );

      const sufficientData =
        daily.length >=
        this.governance
          .minimumObservations;

      const forecast =
        sufficientData
          ? this.generateForecastPoints(
              daily,
              input,
              {
                ...context,
                tenantId,
                correlationId,
              },
              modelResult
            )
          : {
              horizon:
                normalizeDays(
                  input.horizon,
                  this.governance
                    .horizon
                ),
              points: [],
              methods: {
                inflow: {
                  status:
                    FORECAST_STATUS
                      .INSUFFICIENT_DATA,
                },
                outflow: {
                  status:
                    FORECAST_STATUS
                      .INSUFFICIENT_DATA,
                },
              },
              modelUsed:
                false,
            };

      const projected =
        this.buildProjectedLiquidity(
          forecast.points,
          input
        );

      const completeForecast = {
        ...forecast,
        ...projected,
      };

      const summary =
        this.buildSummary(
          daily,
          completeForecast,
          dataQuality,
          operationalSignals,
          input
        );

      const forecastConfidence =
        calculateForecastConfidence(
          observations.length,
          summary.observed
            .volatilityRatio,
          adjustedQuality,
          modelResult?.confidence
            ? (
                modelResult.confidence -
                0.5
              ) *
              0.10
            : 0
        );

      let status =
        FORECAST_STATUS.GENERATED;

      if (
        !sufficientData
      ) {
        status =
          FORECAST_STATUS.INSUFFICIENT_DATA;
      } else if (
        daily.length <
        observations.length ||
        modelResult.status ===
          'DEGRADED'
      ) {
        status =
          FORECAST_STATUS.PARTIAL;
      }

      if (
        forecastConfidence <
        this.governance
          .minimumConfidence
      ) {
        status =
          FORECAST_STATUS.PARTIAL;
      }

      const forecastId =
        normalizeId(
          input.forecastId
        ) ||
        `liquidity:${tenantId}:${fingerprint(
          {
            provider:
              this.provider,
            currency:
              input.currency,
            daily,
            horizon:
              completeForecast
                .horizon,
          }
        ).slice(0, 40)}`;

      const result = {
        forecastId,
        tenantId,
        provider:
          normalizeProvider(
            input.provider ||
              this.provider
          ),
        correlationId,
        currency:
          normalizeCurrency(
            input.currency
          ),
        status,
        generatedAt:
          this.clock().toISOString(),
        horizon:
          completeForecast.horizon,
        method:
          FORECAST_METHODS.ENSEMBLE,
        model: {
          used:
            completeForecast.modelUsed,
          status:
            modelResult.status,
          name:
            modelResult.modelName ||
            this.modelName,
          version:
            modelResult.modelVersion ||
            this.modelVersion,
          confidence:
            modelResult.confidence,
        },
        historical: {
          observationCount:
            observations.length,
          dailyPointCount:
            daily.length,
          dataQuality:
            {
              ...dataQuality,
            },
          trend:
            summary.observed.trend,
          volatilityRatio:
            summary.observed
              .volatilityRatio,
        },
        forecast:
          completeForecast.points,
        summary,
        pressure: {
          level:
            completeForecast.points.some(
              (point) =>
                point.pressureLevel ===
                PRESSURE_LEVELS.CRITICAL
            )
              ? PRESSURE_LEVELS.CRITICAL
              : completeForecast.points.some(
                    (point) =>
                      point.pressureLevel ===
                      PRESSURE_LEVELS.HIGH
                  )
                ? PRESSURE_LEVELS.HIGH
                : completeForecast.points.some(
                      (point) =>
                        point.pressureLevel ===
                        PRESSURE_LEVELS.MEDIUM
                    )
                  ? PRESSURE_LEVELS.MEDIUM
                  : PRESSURE_LEVELS.NONE,
          deficitWindow:
            detectDeficitWindow(
              completeForecast.points
            ),
          highOrCriticalDays:
            completeForecast.points.filter(
              (point) =>
                [
                  PRESSURE_LEVELS.HIGH,
                  PRESSURE_LEVELS.CRITICAL,
                ].includes(
                  point.pressureLevel
                )
            ).length,
        },
        confidence:
          forecastConfidence,
        recommendations:
          buildRecommendations(
            summary,
            forecastConfidence
          ),
        advisoryOnly:
          true,
        financialAuthority:
          false,
        paymentAuthority:
          false,
        treasuryAuthority:
          false,
        settlementAuthority:
          false,
        ledgerAuthority:
          false,
        metadata:
          sanitizeMetadata(
            input.metadata
          ),
      };

      if (
        result.pressure
          .highOrCriticalDays >
        0
      ) {
        this.metrics.pressureAlerts +=
          1;
      }

      this.metrics.forecasts +=
        1;

      if (
        status ===
        FORECAST_STATUS.GENERATED
      ) {
        this.metrics.successful +=
          1;
      } else if (
        status ===
        FORECAST_STATUS.PARTIAL
      ) {
        this.metrics.partial +=
          1;
      } else {
        this.metrics.insufficientData +=
          1;
      }

      const persistence =
        await this.persist(
          result,
          {
            ...context,
            tenantId,
            correlationId,
          }
        );

      const event =
        await this.emitForecastEvent(
          result,
          context
        );

      const audit =
        await this.audit(
          'AIRTEL_LIQUIDITY_FORECAST_GENERATED',
          result,
          context
        );

      return {
        forecast:
          sanitizeForecast(
            result
          ),
        persistence,
        event,
        audit,
        idempotentReplay:
          false,
        correlationId,
      };
    } catch (error) {
      this.metrics.failures +=
        1;

      this.logger.error?.(
        {
          err: error,
          tenantId,
          correlationId,
        },
        'Airtel liquidity forecast failed'
      );

      throw error;
    }
  }

  async predict(
    input = {},
    context = {}
  ) {
    return this.forecast(
      input,
      context
    );
  }

  async forecastBatch(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const records =
      Array.isArray(
        input.items
      )
        ? input.items
        : Array.isArray(
            input.records
          )
          ? input.records
          : [];

    const bounded =
      records.slice(
        0,
        LIMITS.MAX_BATCH
      );

    const results =
      [];

    const failures =
      [];

    for (
      let index = 0;
      index <
      bounded.length;
      index += 1
    ) {
      try {
        const result =
          await this.forecast(
            {
              ...bounded[index],
              tenantId,
            },
            {
              ...context,
              tenantId,
            }
          );

        results.push({
          index,
          result,
        });
      } catch (error) {
        failures.push({
          index,
          error: {
            code:
              error.code ||
              'LIQUIDITY_FORECAST_FAILED',
            message:
              boundedText(
                error.message,
                500
              ),
          },
        });
      }
    }

    this.metrics.batchForecasts +=
      1;

    return {
      tenantId,
      results,
      failures,
      count:
        results.length,
      truncated:
        records.length >
        bounded.length,
    };
  }

  async scenarioAnalysis(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const base =
      input.forecast ||
      (
        await this.forecast(
          input,
          context
        )
      ).forecast;

    const requested =
      Array.isArray(
        input.scenarios
      )
        ? input.scenarios
        : [
            SCENARIOS.BASELINE,
            SCENARIOS.CONSERVATIVE,
            SCENARIOS.STRESS,
          ];

    const scenarios =
      unique(
        requested
          .map(
            normalizeScenario
          )
      ).slice(
        0,
        LIMITS.MAX_SCENARIOS
      );

    const outputs =
      {};

    for (const scenario of
      scenarios) {
      const multipliers =
        scenarioMultipliers(
          scenario
        );

      let totalInflow =
        0n;

      let totalOutflow =
        0n;

      const points =
        (
          base.forecast ||
          []
        ).map(
          (point) => {
            const inflow =
              moneyMultiplyRatio(
                point.inflowMinor,
                multipliers.inflow
              );

            const outflow =
              moneyMultiplyRatio(
                point.outflowMinor,
                multipliers.outflow
              );

            const net =
              moneySubtract(
                inflow,
                outflow
              );

            totalInflow +=
              normalizeInteger(
                inflow
              ) ?? 0n;

            totalOutflow +=
              normalizeInteger(
                outflow
              ) ?? 0n;

            const pressure =
              calculateProjectedPressure(
                net,
                outflow
              );

            return {
              date:
                point.date,
              inflowMinor:
                inflow,
              outflowMinor:
                outflow,
              netMinor:
                net,
              pressureRatio:
                pressure.ratio,
              pressureLevel:
                pressure.level,
            };
          }
        );

      const confidence =
        clamp(
          (
            Number(
              base.confidence
            ) || 0
          ) +
            multipliers.confidenceAdjustment,
          0,
          1
        );

      outputs[
        scenario
      ] = {
        scenario,
        points,
        totalInflowMinor:
          totalInflow.toString(),
        totalOutflowMinor:
          totalOutflow.toString(),
        totalNetMinor:
          moneySubtract(
            totalInflow.toString(),
            totalOutflow.toString()
          ),
        confidence,
        assumptions: {
          inflowMultiplier:
            multipliers.inflow,
          outflowMultiplier:
            multipliers.outflow,
        },
        advisoryOnly:
          true,
      };
    }

    this.metrics.scenarios +=
      1;

    return {
      scenarioAnalysisId:
        `liquidity-scenarios:${tenantId}:${fingerprint(
          scenarios
        ).slice(0, 32)}`,
      tenantId,
      provider:
        base.provider ||
        this.provider,
      correlationId:
        resolveCorrelationId(
          input,
          context
        ),
      currency:
        base.currency ||
        normalizeCurrency(
          input.currency
        ),
      baseForecastId:
        base.forecastId ||
        null,
      scenarios:
        outputs,
      advisoryOnly:
        true,
        financialAuthority:
          false,
        treasuryAuthority:
          false,
        settlementAuthority:
          false,
    };
  }

  async backtest(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const observations =
      normalizeObservations(
        input.observations ||
          input.history,
        tenantId,
        {
          currency:
            input.currency,
        }
      );

    const daily =
      aggregateDaily(
        observations
      );

    const window =
      Math.max(
        3,
        Math.min(
          Number(
            input.window ||
              7
          ),
          Math.floor(
            daily.length /
              3
          ) ||
            3
        )
      );

    if (
      daily.length <=
      window
    ) {
      return {
        backtestId:
          crypto.randomUUID(),
        tenantId,
        provider:
          this.provider,
        status:
          FORECAST_STATUS
            .INSUFFICIENT_DATA,
        sampleCount:
          0,
        metrics: {
          meanAbsoluteErrorMinor:
            null,
          directionAccuracy:
            null,
        },
        advisoryOnly:
          true,
      };
    }

    const absoluteErrors =
      [];

    const directions =
      [];

    for (
      let index = window;
      index < daily.length;
      index += 1
    ) {
      const history =
        daily.slice(
          0,
          index
        );

      const netValues =
        history.map(
          (item) =>
            Number(
              item.netMinor
            )
        );

      const forecast =
        forecastNumeric(
          netValues,
          1,
          {
            minimumObservations:
              Math.min(
                this.governance
                  .minimumObservations,
                window
              ),
            lookback:
              window,
            smoothingAlpha:
              this.governance
                .smoothingAlpha,
          }
        );

      if (
        !forecast.values.length
      ) {
        continue;
      }

      const predicted =
        Number(
          forecast.values[0]
        );

      const actual =
        Number(
          daily[index]
            .netMinor
        );

      if (
        !Number.isFinite(
          predicted
        ) ||
        !Number.isFinite(
          actual
        )
      ) {
        continue;
      }

      absoluteErrors.push(
        Math.abs(
          predicted -
            actual
        )
      );

      const previous =
        Number(
          daily[index - 1]
            .netMinor
        );

      if (
        Number.isFinite(
          previous
        )
      ) {
        const predictedDirection =
          Math.sign(
            predicted -
              previous
          );

        const actualDirection =
          Math.sign(
            actual -
              previous
          );

        directions.push(
          predictedDirection ===
            actualDirection
            ? 1
            : 0
        );
      }
    }

    const mae =
      averageNumber(
        absoluteErrors
      );

    const directionAccuracy =
      averageNumber(
        directions
      );

    this.metrics.backtests +=
      1;

    return {
      backtestId:
        `backtest:${tenantId}:${fingerprint(
          {
            observations:
              observations.length,
            window,
          }
        ).slice(0, 32)}`,
      tenantId,
      provider:
        this.provider,
      sampleCount:
        absoluteErrors.length,
      window,
      metrics: {
        meanAbsoluteErrorMinor:
          Number.isFinite(
            mae
          )
            ? String(
                Math.round(
                  mae
                )
              )
            : null,
        directionAccuracy:
          directionAccuracy !==
          null
            ? clamp(
                directionAccuracy,
                0,
                1
              )
            : null,
      },
      advisoryOnly:
        true,
    };
  }

  async getById(
    forecastId,
    context = {}
  ) {
    const tenantId =
      requireTenant(
        {},
        context
      );

    if (
      !this.repository
    ) {
      return null;
    }

    const id =
      normalizeId(
        forecastId
      );

    if (!id) {
      const error =
        new Error(
          'forecastId is required.'
        );

      error.code =
        'FORECAST_ID_REQUIRED';

      throw error;
    }

    let result = null;

    if (
      typeof this.repository.findOne ===
      'function'
    ) {
      result =
        await this.repository.findOne(
          {
            tenantId,
            forecastId:
              id,
          },
          {
            ...context,
            tenantId,
          }
        );
    } else if (
      typeof this.repository.findById ===
      'function'
    ) {
      result =
        await this.repository.findById(
          id,
          {
            ...context,
            tenantId,
          }
        );
    }

    return sanitizeForecast(
      result
    );
  }

  async list(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    if (
      !this.repository
    ) {
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: 0,
      };
    }

    const page =
      Math.max(
        1,
        Number(
          input.page
        ) || 1
      );

    const pageSize =
      Math.min(
        LIMITS.MAX_HISTORY,
        Math.max(
          1,
          Number(
            input.pageSize ||
              input.limit
          ) || 25
        )
      );

    const query = {
      ...(isPlainObject(
        input.query
      )
        ? input.query
        : {}),
      tenantId,
    };

    query.tenantId =
      tenantId;

    delete query.tenant;
    delete query.tenantContext;

    deleteUndefined(
      query
    );

    let result =
      [];

    if (
      typeof this.repository.list ===
      'function'
    ) {
      result =
        await this.repository.list(
          {
            ...query,
            page,
            pageSize,
          },
          {
            ...context,
            tenantId,
          }
        );
    } else if (
      typeof this.repository.find ===
      'function'
    ) {
      result =
        await this.repository.find(
          {
            ...query,
            page,
            pageSize,
          },
          {
            ...context,
            tenantId,
          }
        );
    }

    return normalizeListResult(
      result,
      page,
      pageSize
    );
  }

  async persist(
    forecast,
    context = {}
  ) {
    if (
      !this.repository
    ) {
      return {
        persisted:
          false,
        reason:
          'REPOSITORY_UNAVAILABLE',
      };
    }

    const tenantId =
      requireTenant(
        forecast,
        context
      );

    try {
      let result;

      if (
        typeof this.repository.upsert ===
        'function'
      ) {
        result =
          await this.repository.upsert(
            {
              tenantId,
              forecastId:
                forecast.forecastId,
            },
            sanitizeForecast(
              forecast
            ),
            {
              ...context,
              tenantId,
            }
          );
      } else if (
        typeof this.repository.create ===
        'function'
      ) {
        result =
          await this.repository.create(
            sanitizeForecast(
              forecast
            ),
            {
              ...context,
              tenantId,
            }
          );
      } else if (
        typeof this.repository.insert ===
        'function'
      ) {
        result =
          await this.repository.insert(
            sanitizeForecast(
              forecast
            ),
            {
              ...context,
              tenantId,
            }
          );
      } else {
        return {
          persisted:
            false,
          reason:
            'UNSUPPORTED_REPOSITORY_INTERFACE',
        };
      }

      return {
        persisted:
          true,
        result:
          sanitizeRepositoryResult(
            result
          ),
      };
    } catch (error) {
      this.metrics.repositoryFailures +=
        1;

      this.logger.error?.(
        {
          err: error,
          tenantId,
          forecastId:
            forecast.forecastId,
        },
        'Airtel liquidity forecast persistence failed'
      );

      throw error;
    }
  }

  async emitForecastEvent(
    forecast,
    context = {}
  ) {
    if (
      !this.eventBus
    ) {
      return {
        emitted:
          false,
        reason:
          'EVENT_BUS_UNAVAILABLE',
      };
    }

    const event = {
      eventId:
        crypto.randomUUID(),
      type:
        'airtel.liquidity.forecast.generated',
      occurredAt:
        this.clock().toISOString(),
      tenantId:
        forecast.tenantId,
      provider:
        forecast.provider,
      correlationId:
        forecast.correlationId,
      advisoryOnly:
        true,
      payload: {
        forecastId:
          forecast.forecastId,
        currency:
          forecast.currency,
        status:
          forecast.status,
        horizon:
          forecast.horizon,
        confidence:
          forecast.confidence,
        pressureLevel:
          forecast.pressure
            ?.level,
        highOrCriticalDays:
          forecast.pressure
            ?.highOrCriticalDays,
        endingProjectedLiquidityMinor:
          forecast.forecast?.length
            ? forecast.forecast[
                forecast.forecast.length -
                  1
              ]
              .cumulativeLiquidityMinor
            : '0',
      },
      metadata:
        sanitizeMetadata(
          context.metadata
        ),
    };

    try {
      if (
        typeof this.eventBus.publish ===
        'function'
      ) {
        await this.eventBus.publish(
          event.type,
          event
        );

        return {
          emitted:
            true,
        };
      }

      if (
        typeof this.eventBus.emit ===
        'function'
      ) {
        await Promise.resolve(
          this.eventBus.emit(
            event.type,
            event
          )
        );

        return {
          emitted:
            true,
        };
      }

      return {
        emitted:
          false,
        reason:
          'UNSUPPORTED_EVENT_BUS',
      };
    } catch (error) {
      this.metrics.eventFailures +=
        1;

      this.logger.warn?.(
        {
          err: error,
          tenantId:
            forecast.tenantId,
          forecastId:
            forecast.forecastId,
        },
        'Airtel liquidity forecast event publication failed'
      );

      return {
        emitted:
          false,
        reason:
          'EVENT_PUBLICATION_FAILED',
      };
    }
  }

  async audit(
    action,
    forecast,
    context = {}
  ) {
    if (
      !this.auditLogger
    ) {
      return {
        recorded:
          false,
        reason:
          'AUDIT_UNAVAILABLE',
      };
    }

    const entry = {
      action,
      occurredAt:
        this.clock().toISOString(),
      tenantId:
        forecast.tenantId,
      provider:
        forecast.provider,
      correlationId:
        forecast.correlationId,
      forecastId:
        forecast.forecastId,
      status:
        forecast.status,
      confidence:
        forecast.confidence,
      pressureLevel:
        forecast.pressure
          ?.level,
      advisoryOnly:
        true,
      metadata:
        sanitizeMetadata(
          context.metadata
        ),
    };

    try {
      if (
        typeof this.auditLogger.record ===
        'function'
      ) {
        await this.auditLogger.record(
          entry
        );

        return {
          recorded:
            true,
        };
      }

      if (
        typeof this.auditLogger.log ===
        'function'
      ) {
        await this.auditLogger.log(
          entry
        );

        return {
          recorded:
            true,
        };
      }

      if (
        typeof this.auditLogger.write ===
        'function'
      ) {
        await this.auditLogger.write(
          entry
        );

        return {
          recorded:
            true,
        };
      }

      return {
        recorded:
          false,
        reason:
          'UNSUPPORTED_AUDIT_INTERFACE',
      };
    } catch (error) {
      this.metrics.auditFailures +=
        1;

      this.logger.warn?.(
        {
          err: error,
          tenantId:
            forecast.tenantId,
          forecastId:
            forecast.forecastId,
        },
        'Airtel liquidity forecast audit write failed'
      );

      return {
        recorded:
          false,
        reason:
          'AUDIT_WRITE_FAILED',
      };
    }
  }

  getHealth() {
    const repositoryAvailable =
      Boolean(
        this.repository
      );

    const featureStoreAvailable =
      Boolean(
        this.featureStore
      );

    const modelAvailable =
      Boolean(
        this.modelAdapter
      );

    let status =
      'UP';

    const degradedReasons =
      [];

    if (
      !repositoryAvailable
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'Liquidity forecast repository is not configured.'
      );
    }

    if (
      !featureStoreAvailable
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'Feature store is not configured.'
      );
    }

    if (
      !modelAvailable
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'No statistical liquidity model adapter is configured; deterministic forecasting remains available.'
      );
    }

    if (
      !this.initialized
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'Liquidity predictor has not been initialized.'
      );
    }

    if (
      this.metrics.failures >
      0
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'One or more liquidity forecasts have failed.'
      );
    }

    if (
      this.metrics.repositoryFailures >
      0
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'One or more liquidity forecast persistence operations have failed.'
      );
    }

    return {
      service:
        this.name,
      provider:
        this.provider,
      status,
      initialized:
        this.initialized,
      advisoryOnly:
        true,
      financialAuthority:
        false,
      paymentAuthority:
        false,
      treasuryAuthority:
        false,
      settlementAuthority:
        false,
      ledgerAuthority:
        false,
      complianceAuthority:
        false,
      dependencies: {
        repository:
          repositoryAvailable,
        featureStore:
          featureStoreAvailable,
        modelAdapter:
          modelAvailable,
        eventBus:
          Boolean(
            this.eventBus
          ),
        auditLogger:
          Boolean(
            this.auditLogger
          ),
      },
      governance: {
        ...this.governance,
      },
      metrics: {
        ...this.metrics,
      },
      checkedAt:
        this.clock().toISOString(),
    };
  }

  health() {
    return this.getHealth();
  }

  diagnostics() {
    return {
      service:
        this.name,
      provider:
        this.provider,
      module:
        'airtel.intelligence.liquidityPredictor',
      architecture: {
        tenantAware:
          true,
        exactMoney:
          true,
        bigintMoneyArithmetic:
          true,
        deterministicForecasting:
          true,
        modelAdapter:
          true,
        ensembleForecasting:
          true,
        scenarioAnalysis:
          true,
        backtesting:
          true,
        pressureDetection:
          true,
        featureStoreIntegration:
          true,
        dataQualityScoring:
          true,
        boundedInputs:
          true,
        sanitizedOutputs:
          true,
        advisoryOnly:
          true,
        paymentAuthority:
          false,
        treasuryAuthority:
          false,
        settlementAuthority:
          false,
        ledgerAuthority:
          false,
        financialAuthority:
          false,
        complianceAuthority:
          false,
      },
      governance:
        {
          ...this.governance,
        automaticTreasuryAction:
          false,
        automaticBalanceMutation:
          false,
      },
      model: {
        name:
          this.modelName,
        version:
          this.modelVersion,
      },
      metrics:
        {
          ...this.metrics,
        },
      health:
        this.getHealth(),
    };
  }

  capabilities() {
    return {
      forecasting:
        true,
      liquidityPrediction:
        true,
      ensembleForecasting:
        true,
      scenarioAnalysis:
        true,
      stressScenario:
        true,
      conservativeScenario:
        true,
      upsideScenario:
        true,
      backtesting:
        true,
      pressureDetection:
        true,
      deficitWindowDetection:
        true,
      confidenceScoring:
        true,
      featureStoreIntegration:
        true,
      modelAdapter:
        true,
      repositoryPersistence:
        Boolean(
          this.repository
        ),
      events:
        Boolean(
          this.eventBus
        ),
      audit:
        Boolean(
          this.auditLogger
        ),
      tenantIsolation:
        true,
      exactMoney:
        true,
      advisoryOnly:
        true,
      paymentExecution:
        false,
      paymentAuthorization:
        false,
      treasuryExecution:
        false,
      cashReservation:
        false,
      balanceMutation:
        false,
      ledgerMutation:
        false,
      settlement:
        false,
      reconciliationAuthority:
        false,
      complianceDecisioning:
        false,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Recommendations                                                            */
/* -------------------------------------------------------------------------- */

function buildRecommendations(
  summary,
  confidence
) {
  const recommendations =
    [];

  const pressureLevel =
    summary.projected?.deficitWindow
      ?.detected
      ? (
          summary.projected
            .deficitWindow
            .days >= 3
            ? 'HIGH'
            : 'MEDIUM'
        )
      : 'NONE';

  if (
    pressureLevel ===
    'HIGH'
  ) {
    recommendations.push({
      code:
        'REVIEW_LIQUIDITY_PRESSURE',
      priority:
        'HIGH',
      title:
        'Review projected liquidity pressure',
      rationale:
        'The forecast contains a multi-day projected deficit window.',
      action:
        'Review the forecast through the approved treasury/liquidity governance workflow.',
      advisoryOnly:
        true,
        executable:
        false,
    });
  }

  if (
    summary.projected
      ?.highOrCriticalPressureDays >
    0
  ) {
    recommendations.push({
      code:
        'MONITOR_HIGH_PRESSURE_DAYS',
      priority:
        'HIGH',
      title:
        'Monitor high-pressure forecast days',
      rationale:
        'One or more forecast periods show elevated liquidity pressure.',
      action:
        'Review projected inflow timing, outflow timing and available authoritative balances.',
      advisoryOnly:
        true,
      executable:
        false,
    });
  }

  if (
    confidence !==
      null &&
    confidence <
      0.50
  ) {
    recommendations.push({
      code:
        'IMPROVE_FORECAST_EVIDENCE',
      priority:
        'MEDIUM',
      title:
        'Improve forecast evidence',
      rationale:
        'Forecast confidence is reduced by limited history, volatility or data quality.',
      action:
        'Increase observation coverage and validate source-data quality.',
      advisoryOnly:
        true,
      executable:
        false,
    });
  }

  if (
    summary.observed
      ?.volatilityRatio !==
      null &&
    summary.observed
      .volatilityRatio >
      0.50
  ) {
    recommendations.push({
      code:
        'REVIEW_VOLATILITY',
      priority:
        'MEDIUM',
      title:
        'Review liquidity volatility',
      rationale:
        'Observed net cash-flow variability is elevated.',
      action:
        'Review transaction concentration and operational timing before relying on longer forecast horizons.',
      advisoryOnly:
        true,
      executable:
        false,
    });
  }

  if (
    !recommendations.length
  ) {
    recommendations.push({
      code:
        'CONTINUE_MONITORING',
      priority:
        'LOW',
      title:
        'Continue monitoring',
      rationale:
        'No material forecast pressure condition was identified.',
      action:
        'Continue monitoring authoritative liquidity and update forecasts as new evidence arrives.',
      advisoryOnly:
        true,
      executable:
        false,
    });
  }

  return recommendations.slice(
    0,
    20
  );
}

/* -------------------------------------------------------------------------- */
/* Repository / output helpers                                                */
/* -------------------------------------------------------------------------- */

function createRepositoryAdapter(
  repository
) {
  if (
    !repository
  ) {
    return null;
  }

  const adapter =
    {};

  for (const method of [
    'initialize',
    'destroy',
    'create',
    'insert',
    'upsert',
    'update',
    'findOne',
    'findById',
    'find',
    'list',
  ]) {
    if (
      typeof repository[
        method
      ] ===
      'function'
    ) {
      adapter[method] =
        repository[
          method
        ].bind(
          repository
        );
    }
  }

  return adapter;
}

function sanitizeForecast(
  forecast
) {
  if (
    !forecast ||
    !isPlainObject(
      forecast
    )
  ) {
    return null;
  }

  return {
    forecastId:
      normalizeId(
        forecast.forecastId
      ),
    tenantId:
      normalizeId(
        forecast.tenantId
      ),
    provider:
      normalizeProvider(
        forecast.provider
      ),
    correlationId:
      normalizeId(
        forecast.correlationId
      ),
    currency:
      normalizeCurrency(
        forecast.currency
      ),
    status:
      boundedText(
        forecast.status,
        50
      )?.toUpperCase() ||
      FORECAST_STATUS.FAILED,
    generatedAt:
      normalizeTimestamp(
        forecast.generatedAt
      ),
    horizon:
      normalizeDays(
        forecast.horizon,
        DEFAULT_GOVERNANCE.horizon
      ),
    method:
      boundedText(
        forecast.method,
        50
      )?.toUpperCase() ||
      FORECAST_METHODS.ENSEMBLE,
    model:
      isPlainObject(
        forecast.model
      )
        ? {
            used:
              Boolean(
                forecast.model
                  .used
              ),
            status:
              boundedText(
                forecast.model
                  .status,
                50
              )?.toUpperCase() ||
              'UNAVAILABLE',
            name:
              boundedText(
                forecast.model
                  .name,
                150
              ),
            version:
              boundedText(
                forecast.model
                  .version,
                80
              ),
            confidence:
              normalizeProbability(
                forecast.model
                  .confidence
              ),
          }
        : {
            used:
              false,
            status:
              'UNAVAILABLE',
            name:
              null,
            version:
              null,
            confidence:
              null,
          },
    historical:
      sanitizeHistorical(
        forecast.historical
      ),
    forecast:
      Array.isArray(
        forecast.forecast
      )
        ? forecast.forecast
            .slice(
              0,
              LIMITS.MAX_FORECAST_POINTS
            )
            .map(
              sanitizeForecastPoint
            )
        : [],
    summary:
      sanitizeSummary(
        forecast.summary
      ),
    pressure:
      sanitizePressure(
        forecast.pressure
      ),
    confidence:
      normalizeProbability(
        forecast.confidence
      ),
    recommendations:
      Array.isArray(
        forecast.recommendations
      )
        ? forecast.recommendations
            .slice(
              0,
              20
            )
            .map(
              (item) => ({
                code:
                  boundedText(
                    item.code,
                    100
                  )?.toUpperCase() ||
                  'UNKNOWN',
                priority:
                  boundedText(
                    item.priority,
                    30
                  )?.toUpperCase() ||
                  'MEDIUM',
                title:
                  boundedText(
                    item.title,
                    300
                  ),
                rationale:
                  boundedText(
                    item.rationale,
                    1000
                  ),
                action:
                  boundedText(
                    item.action,
                    1000
                  ),
                advisoryOnly:
                  true,
                executable:
                  false,
              })
            )
        : [],
    advisoryOnly:
      true,
    financialAuthority:
      false,
    paymentAuthority:
      false,
    treasuryAuthority:
      false,
    settlementAuthority:
      false,
    ledgerAuthority:
      false,
    complianceAuthority:
      false,
    metadata:
      sanitizeMetadata(
        forecast.metadata
      ),
  };
}

function sanitizeForecastPoint(
  point
) {
  return {
    date:
      boundedText(
        point?.date,
        20
      ),
    timestamp:
      normalizeTimestamp(
        point?.timestamp
      ),
    dayIndex:
      Math.max(
        1,
        Number(
          point?.dayIndex
        ) || 1
      ),
    inflowMinor:
      normalizeMoneyMinor(
        point?.inflowMinor
      ) || '0',
    outflowMinor:
      normalizeMoneyMinor(
        point?.outflowMinor
      ) || '0',
    netMinor:
      normalizeMoneyMinor(
        point?.netMinor
      ) || '0',
    cumulativeLiquidityMinor:
      normalizeMoneyMinor(
        point?.cumulativeLiquidityMinor
      ) || '0',
    pressureRatio:
      point?.pressureRatio ===
        null ||
      point?.pressureRatio ===
        undefined
        ? null
        : clamp(
            point.pressureRatio,
            0,
            LIMITS.MAX_PRESSURE_BUFFER_RATIO
          ),
    pressureLevel:
      boundedText(
        point?.pressureLevel,
        30
      )?.toUpperCase() ||
      PRESSURE_LEVELS.UNKNOWN,
  };
}

function sanitizeHistorical(
  historical
) {
  if (
    !isPlainObject(
      historical
    )
  ) {
    return {
      observationCount:
        0,
      dailyPointCount:
        0,
      dataQuality:
        null,
      trend:
        TREND.UNKNOWN,
      volatilityRatio:
        null,
    };
  }

  return {
    observationCount:
      Math.max(
        0,
        Number(
          historical
            .observationCount
        ) || 0
      ),
    dailyPointCount:
      Math.max(
        0,
        Number(
          historical
            .dailyPointCount
        ) || 0
      ),
    dataQuality:
      isPlainObject(
        historical.dataQuality
      )
        ? {
            score:
              clamp(
                historical
                  .dataQuality
                  .score,
                0,
                1
              ),
            quality:
              boundedText(
                historical
                  .dataQuality
                  .quality,
                30
              )?.toUpperCase() ||
              'UNKNOWN',
            observations:
              Math.max(
                0,
                Number(
                  historical
                    .dataQuality
                    .observations
                ) || 0
              ),
            days:
              Math.max(
                0,
                Number(
                  historical
                    .dataQuality
                    .days
                ) || 0
              ),
            missingDays:
              Math.max(
                0,
                Number(
                  historical
                    .dataQuality
                    .missingDays
                ) || 0
              ),
            reasons:
              Array.isArray(
                historical
                  .dataQuality
                  .reasons
              )
                ? historical
                    .dataQuality
                    .reasons
                    .slice(
                      0,
                      20
                    )
                    .map(
                      (reason) =>
                        boundedText(
                          reason,
                          500
                        )
                    )
                    .filter(
                      Boolean
                    )
                : [],
          }
        : null,
    trend:
      boundedText(
        historical.trend,
        30
      )?.toUpperCase() ||
      TREND.UNKNOWN,
    volatilityRatio:
      historical.volatilityRatio ===
        null ||
      historical.volatilityRatio ===
        undefined
        ? null
        : clamp(
            historical.volatilityRatio,
            0,
            LIMITS.MAX_VOLATILITY_RATIO
          ),
  };
}

function sanitizeSummary(
  summary
) {
  if (
    !isPlainObject(
      summary
    )
  ) {
    return null;
  }

  const sanitizeSection =
    (section) => {
      if (
        !isPlainObject(
          section
        )
      ) {
        return null;
      }

      return {
        days:
          Math.max(
            0,
            Number(
              section.days
            ) || 0
          ),
        inflowMinor:
          normalizeMoneyMinor(
            section.inflowMinor
          ) || '0',
        outflowMinor:
          normalizeMoneyMinor(
            section.outflowMinor
          ) || '0',
        netMinor:
          normalizeMoneyMinor(
            section.netMinor
          ) || '0',
        averageDailyInflowMinor:
          normalizeMoneyMinor(
            section
              .averageDailyInflowMinor
          ) || '0',
        averageDailyOutflowMinor:
          normalizeMoneyMinor(
            section
              .averageDailyOutflowMinor
          ) || '0',
        averageDailyNetMinor:
          normalizeMoneyMinor(
            section
              .averageDailyNetMinor
          ) || '0',
        trend:
          boundedText(
            section.trend,
            30
          )?.toUpperCase() ||
          TREND.UNKNOWN,
        volatilityRatio:
          section.volatilityRatio ===
            null ||
          section.volatilityRatio ===
            undefined
            ? null
            : clamp(
                section
                  .volatilityRatio,
                0,
                LIMITS.MAX_VOLATILITY_RATIO
              ),
        highOrCriticalPressureDays:
          Math.max(
            0,
            Number(
              section
                .highOrCriticalPressureDays
            ) || 0
          ),
        deficitWindow:
          section.deficitWindow
            ? {
                detected:
                  Boolean(
                    section
                      .deficitWindow
                      .detected
                  ),
                startDate:
                  boundedText(
                    section
                      .deficitWindow
                      .startDate,
                    20
                  ),
                endDate:
                  boundedText(
                    section
                      .deficitWindow
                      .endDate,
                    20
                  ),
                days:
                  Math.max(
                    0,
                    Number(
                      section
                        .deficitWindow
                        .days
                    ) || 0
                  ),
                totalDeficitMinor:
                  normalizeMoneyMinor(
                    section
                      .deficitWindow
                      .totalDeficitMinor
                  ) || '0',
              }
            : null,
      };
    };

  return {
    openingBalanceMinor:
      normalizeMoneyMinor(
        summary.openingBalanceMinor
      ) || '0',
    observed:
      sanitizeSection(
        summary.observed
      ),
    projected:
      sanitizeSection(
        summary.projected
      ),
    operationalSignals:
      isPlainObject(
        summary
          .operationalSignals
      )
        ? sanitizeMetadata(
            summary
              .operationalSignals
          )
        : null,
    dataQuality:
      isPlainObject(
        summary.dataQuality
      )
        ? {
            score:
              clamp(
                summary
                  .dataQuality
                  .score,
                0,
                1
              ),
            quality:
              boundedText(
                summary
                  .dataQuality
                  .quality,
                30
              )?.toUpperCase() ||
              'UNKNOWN',
            observations:
              Math.max(
                0,
                Number(
                  summary
                    .dataQuality
                    .observations
                ) || 0
              ),
            days:
              Math.max(
                0,
                Number(
                  summary
                    .dataQuality
                    .days
                ) || 0
              ),
          }
        : null,
    currency:
      normalizeCurrency(
        summary.currency
      ),
    advisoryOnly:
      true,
  };
}

function sanitizePressure(
  pressure
) {
  if (
    !isPlainObject(
      pressure
    )
  ) {
    return {
      level:
        PRESSURE_LEVELS.UNKNOWN,
      deficitWindow:
        null,
      highOrCriticalDays:
        0,
    };
  }

  return {
    level:
      boundedText(
        pressure.level,
        30
      )?.toUpperCase() ||
      PRESSURE_LEVELS.UNKNOWN,
    deficitWindow:
      pressure.deficitWindow
        ? {
            detected:
              Boolean(
                pressure
                  .deficitWindow
                  .detected
              ),
            startDate:
              boundedText(
                pressure
                  .deficitWindow
                  .startDate,
                20
              ),
            endDate:
              boundedText(
                pressure
                  .deficitWindow
                  .endDate,
                20
              ),
            days:
              Math.max(
                0,
                Number(
                  pressure
                    .deficitWindow
                    .days
                ) || 0
              ),
            totalDeficitMinor:
              normalizeMoneyMinor(
                pressure
                  .deficitWindow
                  .totalDeficitMinor
              ) || '0',
          }
        : null,
    highOrCriticalDays:
      Math.max(
        0,
        Number(
          pressure
            .highOrCriticalDays
        ) || 0
      ),
  };
}

function sanitizeRepositoryResult(
  result
) {
  if (
    result === null ||
    result === undefined
  ) {
    return null;
  }

  if (
    typeof result === 'string' ||
    typeof result === 'number' ||
    typeof result === 'boolean'
  ) {
    return result;
  }

  if (
    Array.isArray(result)
  ) {
    return {
      count:
        result.length,
    };
  }

  if (
    !isPlainObject(
      result
    )
  ) {
    return null;
  }

  const output =
    {};

  for (const [
    key,
    value,
  ] of Object.entries(
    result
  ).slice(
    0,
    30
  )) {
    if (
      SECRET_KEY_PATTERNS.some(
        (pattern) =>
          pattern.test(key)
      )
    ) {
      continue;
    }

    if (
      value === null ||
      typeof value ===
        'string' ||
      typeof value ===
        'number' ||
      typeof value ===
        'boolean'
    ) {
      output[
        boundedText(
          key,
          100
        )
      ] = value;
    }
  }

  return output;
}

function normalizeListResult(
  result,
  page,
  pageSize
) {
  if (
    Array.isArray(result)
  ) {
    return {
      items:
        result.map(
          sanitizeForecast
        ),
      total:
        result.length,
      page,
      pageSize,
    };
  }

  if (
    !isPlainObject(
      result
    )
  ) {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
    };
  }

  const items =
    Array.isArray(
      result.items
    )
      ? result.items
      : Array.isArray(
          result.rows
        )
        ? result.rows
        : Array.isArray(
            result.results
          )
          ? result.results
          : [];

  return {
    ...result,
    items:
      items.map(
        sanitizeForecast
      ),
    total:
      Number.isFinite(
        Number(
          result.total
        )
      )
        ? Math.max(
            0,
            Number(
              result.total
            )
          )
        : items.length,
    page:
      Math.max(
        1,
        Number(
          result.page ||
            page
        )
      ),
    pageSize:
      Math.max(
        1,
        Number(
          result.pageSize ||
            pageSize
        )
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Utility exports                                                            */
/* -------------------------------------------------------------------------- */

function calculateForecast(
  observations,
  horizon = LIMITS.DEFAULT_HORIZON,
  options = {}
) {
  const normalized =
    normalizeObservations(
      observations,
      options.tenantId ||
        'utility',
      options
    );

  const daily =
    aggregateDaily(
      normalized
    );

  const inflow =
    forecastNumeric(
      daily.map(
        (item) =>
          Number(
            item.inflowMinor
          )
      ),
      horizon,
      options
    );

  const outflow =
    forecastNumeric(
      daily.map(
        (item) =>
          Number(
            item.outflowMinor
          )
      ),
      horizon,
      options
    );

  return {
    inflow,
    outflow,
    observationCount:
      normalized.length,
    dailyPointCount:
      daily.length,
  };
}

function calculateLiquidityPressure(
  netMinor,
  outflowMinor
) {
  return calculateProjectedPressure(
    netMinor,
    outflowMinor
  );
}

/* -------------------------------------------------------------------------- */
/* Factory / singleton                                                        */
/* -------------------------------------------------------------------------- */

let defaultInstance =
  null;

function createLiquidityPredictor(
  options = {}
) {
  return new LiquidityPredictor(
    options
  );
}

function getLiquidityPredictor(
  options = {}
) {
  if (
    !defaultInstance
  ) {
    defaultInstance =
      new LiquidityPredictor(
        options
      );
  }

  return defaultInstance;
}

async function resetLiquidityPredictor() {
  if (
    defaultInstance &&
    typeof defaultInstance.destroy ===
      'function'
  ) {
    await defaultInstance.destroy();
  }

  defaultInstance =
    null;
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

module.exports =
  LiquidityPredictor;

module.exports.LiquidityPredictor =
  LiquidityPredictor;

module.exports.createLiquidityPredictor =
  createLiquidityPredictor;

module.exports.getLiquidityPredictor =
  getLiquidityPredictor;

module.exports.resetLiquidityPredictor =
  resetLiquidityPredictor;

module.exports.PROVIDER =
  PROVIDER;

module.exports.FLOW_TYPES =
  FLOW_TYPES;

module.exports.FORECAST_METHODS =
  FORECAST_METHODS;

module.exports.FORECAST_STATUS =
  FORECAST_STATUS;

module.exports.PRESSURE_LEVELS =
  PRESSURE_LEVELS;

module.exports.TREND =
  TREND;

module.exports.SCENARIOS =
  SCENARIOS;

module.exports.LIMITS =
  LIMITS;

module.exports.DEFAULT_GOVERNANCE =
  DEFAULT_GOVERNANCE;

module.exports.moneyAdd =
  moneyAdd;

module.exports.moneySubtract =
  moneySubtract;

module.exports.moneyAverage =
  moneyAverage;

module.exports.moneyMultiplyRatio =
  moneyMultiplyRatio;

module.exports.normalizeObservation =
  normalizeObservation;

module.exports.normalizeObservations =
  normalizeObservations;

module.exports.aggregateDaily =
  aggregateDaily;

module.exports.forecastNumeric =
  forecastNumeric;

module.exports.calculateForecast =
  calculateForecast;

module.exports.calculateLiquidityPressure =
  calculateLiquidityPressure;

module.exports.calculateForecastConfidence =
  calculateForecastConfidence;

module.exports.detectDeficitWindow =
  detectDeficitWindow;

module.exports.scenarioMultipliers =
  scenarioMultipliers;

module.exports.sanitizeForecast =
  sanitizeForecast;