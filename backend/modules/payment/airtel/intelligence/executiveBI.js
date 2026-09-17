'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Executive Business Intelligence
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/executiveBI.js
 *
 * Architectural Role:
 *   Executive BI / management intelligence projection for the Airtel payment
 *   domain.
 *
 * Responsibilities:
 *   - Build deterministic executive BI snapshots from approved intelligence
 *     and operational evidence.
 *   - Aggregate operational, payment, reconciliation, callback, fraud,
 *     failure, provider-health and service-quality indicators.
 *   - Preserve exact monetary values as decimal strings / bigint minor units.
 *   - Maintain strict tenant isolation.
 *   - Normalize heterogeneous upstream intelligence safely.
 *   - Produce executive summaries, KPIs, trends, exception summaries,
 *     provider health views and operational recommendations.
 *   - Support repository-backed persistence and retrieval.
 *   - Support idempotent snapshot generation.
 *   - Emit sanitized audit / intelligence events.
 *   - Expose bounded health and diagnostics information.
 *
 * Explicitly NOT Responsible For:
 *   - Payment authorization.
 *   - Payment execution.
 *   - Airtel HTTP/API calls.
 *   - OAuth / token acquisition.
 *   - Callback authentication or signature verification.
 *   - Settlement authorization.
 *   - Reconciliation authority.
 *   - Ledger posting.
 *   - Balance mutation.
 *   - Loan approval or credit decisioning.
 *   - Fraud blocking.
 *   - AML/KYC compliance decisions.
 *   - Autonomous financial operations.
 *
 * Financial Safety Principles:
 *   - Monetary arithmetic MUST use bigint minor units.
 *   - Number MUST NOT be used for monetary arithmetic.
 *   - Executive BI is a projection of evidence, not an accounting source.
 *   - Missing evidence is represented explicitly rather than fabricated.
 *   - Intelligence outputs are advisory and non-authoritative.
 *   - Tenant identity is authoritative and cannot be overridden by payload data.
 *   - Idempotency is evaluated before persistence side effects.
 *   - Raw provider payloads and secrets are never exposed in reports.
 *
 * Module Format:
 *   CommonJS
 *
 * =============================================================================
 */

const crypto = require('node:crypto');

const DEFAULT_PROVIDER = 'AIRTEL';
const DEFAULT_CURRENCY = 'UGX';

const STATUS = Object.freeze({
  GENERATED: 'GENERATED',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
});

const HEALTH = Object.freeze({
  UP: 'UP',
  DEGRADED: 'DEGRADED',
  DOWN: 'DOWN',
});

const TREND = Object.freeze({
  UP: 'UP',
  DOWN: 'DOWN',
  FLAT: 'FLAT',
  UNKNOWN: 'UNKNOWN',
});

const REPORT_TYPES = Object.freeze({
  EXECUTIVE: 'EXECUTIVE',
  OPERATIONS: 'OPERATIONS',
  FINANCIAL: 'FINANCIAL',
  RISK: 'RISK',
  PROVIDER: 'PROVIDER',
  RECONCILIATION: 'RECONCILIATION',
});

const DECISION_BOUNDARY = Object.freeze({
  ADVISORY_ONLY: true,
  FINANCIAL_AUTHORITY: false,
  LEDGER_AUTHORITY: false,
  SETTLEMENT_AUTHORITY: false,
  PAYMENT_AUTHORITY: false,
  COMPLIANCE_AUTHORITY: false,
});

const LIMITS = Object.freeze({
  MAX_ROWS: 5000,
  MAX_KPI_COUNT: 200,
  MAX_EXCEPTION_COUNT: 500,
  MAX_RECOMMENDATION_COUNT: 100,
  MAX_TREND_POINTS: 366,
  MAX_TEXT_LENGTH: 2000,
  MAX_METADATA_KEYS: 40,
  MAX_ARRAY_ITEMS: 500,
});

/* -------------------------------------------------------------------------- */
/* Utility helpers                                                            */
/* -------------------------------------------------------------------------- */

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
  );
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function safeInteger(value, fallback = 0) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return parsed;
}

function safePositiveInteger(value, fallback = 1) {
  const parsed = safeInteger(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function boundedText(value, maxLength = LIMITS.MAX_TEXT_LENGTH) {
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
  if (value === null || value === undefined) {
    return null;
  }

  return boundedText(value, 200);
}

function normalizeStatus(value, fallback = STATUS.GENERATED) {
  const normalized = boundedText(value, 50);

  if (
    normalized === STATUS.GENERATED ||
    normalized === STATUS.PARTIAL ||
    normalized === STATUS.FAILED
  ) {
    return normalized;
  }

  return fallback;
}

function normalizeProvider(value) {
  return (
    boundedText(value, 50)?.toUpperCase() ||
    DEFAULT_PROVIDER
  );
}

function normalizeCurrency(value) {
  return (
    boundedText(value, 10)?.toUpperCase() ||
    DEFAULT_CURRENCY
  );
}

function normalizeTimestamp(value, fallback = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (value !== null && value !== undefined) {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return fallback.toISOString();
}

function toBigIntInteger(value, fallback = 0n) {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      return fallback;
    }

    return BigInt(value);
  }

  if (typeof value === 'string') {
    const normalized = value.trim();

    if (!/^-?\d+$/.test(normalized)) {
      return fallback;
    }

    try {
      return BigInt(normalized);
    } catch {
      return fallback;
    }
  }

  return fallback;
}

function normalizeMinorUnits(value) {
  return toBigIntInteger(value, 0n);
}

function bigintToString(value) {
  return normalizeMinorUnits(value).toString();
}

function addBigInt(a, b) {
  return normalizeMinorUnits(a) + normalizeMinorUnits(b);
}

function percentage(numerator, denominator, precision = 2) {
  const numeratorValue = safePositiveInteger(numerator, 0);
  const denominatorValue = safePositiveInteger(denominator, 0);

  if (denominatorValue === 0) {
    return null;
  }

  const scaled = Math.round(
    (numeratorValue / denominatorValue) * 100 * 10 ** precision
  );

  return scaled / 10 ** precision;
}

function bigIntPercentage(numerator, denominator, precision = 2) {
  const n = normalizeMinorUnits(numerator);
  const d = normalizeMinorUnits(denominator);

  if (d === 0n) {
    return null;
  }

  const factor = 10n ** BigInt(precision);
  const scaled = ((n * 100n * factor) + d / 2n) / d;

  const integerPart = scaled / factor;
  const fractionPart = scaled % factor;

  return Number(`${integerPart}.${fractionPart.toString().padStart(precision, '0')}`);
}

function hashObject(value) {
  const canonical = stableStringify(value);

  return crypto
    .createHash('sha256')
    .update(canonical)
    .digest('hex');
}

function stableStringify(value) {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'bigint') {
    return JSON.stringify(value.toString());
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();

    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function sanitizeMetadata(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  const result = {};
  const entries = Object.entries(value).slice(0, LIMITS.MAX_METADATA_KEYS);

  for (const [key, rawValue] of entries) {
    const normalizedKey = boundedText(key, 100);

    if (!normalizedKey) {
      continue;
    }

    if (
      rawValue === null ||
      typeof rawValue === 'string' ||
      typeof rawValue === 'boolean'
    ) {
      result[normalizedKey] =
        typeof rawValue === 'string'
          ? boundedText(rawValue, 500)
          : rawValue;
      continue;
    }

    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      result[normalizedKey] = rawValue;
      continue;
    }

    if (rawValue instanceof Date) {
      result[normalizedKey] = rawValue.toISOString();
    }
  }

  return result;
}

function sanitizeArray(values, mapper, limit = LIMITS.MAX_ARRAY_ITEMS) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .slice(0, limit)
    .map(mapper)
    .filter((value) => value !== null && value !== undefined);
}

function firstDefined(...values) {
  return values.find(
    (value) => value !== undefined && value !== null
  );
}

function average(values) {
  const valid = values.filter(
    (value) => Number.isFinite(value)
  );

  if (!valid.length) {
    return null;
  }

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function trendFromValues(values, epsilon = 0.000001) {
  if (!Array.isArray(values) || values.length < 2) {
    return TREND.UNKNOWN;
  }

  const current = Number(values[values.length - 1]);
  const previous = Number(values[values.length - 2]);

  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return TREND.UNKNOWN;
  }

  const difference = current - previous;

  if (Math.abs(difference) <= epsilon) {
    return TREND.FLAT;
  }

  return difference > 0 ? TREND.UP : TREND.DOWN;
}

function normalizeScore(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return clamp(number, 0, 100);
}

function normalizeRiskLevel(value) {
  const normalized = boundedText(value, 30)?.toUpperCase();

  if (!normalized) {
    return 'UNKNOWN';
  }

  if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(normalized)) {
    return normalized;
  }

  return 'UNKNOWN';
}

function compareTimes(a, b) {
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();

  if (!Number.isFinite(left) && !Number.isFinite(right)) {
    return 0;
  }

  if (!Number.isFinite(left)) {
    return -1;
  }

  if (!Number.isFinite(right)) {
    return 1;
  }

  return left - right;
}

function sortByTimestamp(rows, descending = false) {
  return [...rows].sort((a, b) => {
    const result = compareTimes(
      a.timestamp || a.createdAt,
      b.timestamp || b.createdAt
    );

    return descending ? -result : result;
  });
}

/* -------------------------------------------------------------------------- */
/* Input normalization                                                        */
/* -------------------------------------------------------------------------- */

function resolveTenantId(input, context = {}) {
  const candidates = [
    context.tenantId,
    context.tenant?.tenantId,
    context.tenant?.id,
    input?.tenantId,
  ];

  const tenantId = candidates.find(
    (candidate) =>
      candidate !== undefined &&
      candidate !== null &&
      String(candidate).trim() !== ''
  );

  return tenantId ? String(tenantId) : null;
}

function resolveCorrelationId(input, context = {}) {
  return (
    normalizeId(
      firstDefined(
        input?.correlationId,
        input?.requestId,
        context?.correlationId,
        context?.requestId
      )
    ) || crypto.randomUUID()
  );
}

function resolvePeriod(input = {}) {
  const start = firstDefined(
    input.periodStart,
    input.startDate,
    input.from,
    input.window?.start
  );

  const end = firstDefined(
    input.periodEnd,
    input.endDate,
    input.to,
    input.window?.end
  );

  return {
    start: normalizeTimestamp(start, new Date(0)),
    end: normalizeTimestamp(end, new Date()),
  };
}

function normalizeRecord(record = {}) {
  const amountMinor = normalizeMinorUnits(
    firstDefined(
      record.amountMinor,
      record.amountMinorUnits,
      record.valueMinor,
      record.amount
    )
  );

  return {
    id: normalizeId(
      firstDefined(record.id, record._id, record.reference)
    ),
    tenantId: normalizeId(record.tenantId),
    provider: normalizeProvider(
      firstDefined(record.provider, record.providerName)
    ),
    currency: normalizeCurrency(
      firstDefined(record.currency, record.currencyCode)
    ),
    amountMinor: amountMinor.toString(),
    status: boundedText(
      firstDefined(record.status, record.state),
      50
    )?.toUpperCase() || 'UNKNOWN',
    type: boundedText(
      firstDefined(record.type, record.transactionType, record.eventType),
      80
    )?.toUpperCase() || 'UNKNOWN',
    riskScore: normalizeScore(
      firstDefined(record.riskScore, record.risk?.score)
    ),
    riskLevel: normalizeRiskLevel(
      firstDefined(record.riskLevel, record.risk?.level)
    ),
    failureProbability:
      record.failureProbability !== undefined &&
      record.failureProbability !== null
        ? clamp(Number(record.failureProbability), 0, 1)
        : null,
    signatureVerified:
      typeof record.signatureVerified === 'boolean'
        ? record.signatureVerified
        : null,
    reconciliationStatus: boundedText(
      firstDefined(
        record.reconciliationStatus,
        record.reconciliation?.status
      ),
      50
    )?.toUpperCase() || 'UNKNOWN',
    latencyMs:
      Number.isFinite(Number(record.latencyMs))
        ? Math.max(0, Number(record.latencyMs))
        : null,
    timestamp: normalizeTimestamp(
      firstDefined(record.timestamp, record.createdAt)
    ),
  };
}

function normalizeDataset(records, tenantId) {
  const source = Array.isArray(records) ? records : [];
  const normalized = [];

  for (const record of source.slice(0, LIMITS.MAX_ROWS)) {
    const row = normalizeRecord(record);

    if (tenantId && row.tenantId && row.tenantId !== tenantId) {
      continue;
    }

    normalized.push(row);
  }

  return normalized;
}

/* -------------------------------------------------------------------------- */
/* KPI computation                                                            */
/* -------------------------------------------------------------------------- */

function countBy(rows, selector) {
  const counts = {};

  for (const row of rows) {
    const key =
      boundedText(selector(row), 100)?.toUpperCase() ||
      'UNKNOWN';

    counts[key] = (counts[key] || 0) + 1;
  }

  return counts;
}

function sumAmountsByCurrency(rows) {
  const totals = {};

  for (const row of rows) {
    const currency = normalizeCurrency(row.currency);
    totals[currency] = addBigInt(
      totals[currency] || 0n,
      row.amountMinor
    );
  }

  return Object.fromEntries(
    Object.entries(totals).map(([currency, total]) => [
      currency,
      total.toString(),
    ])
  );
}

function computeTransactionMetrics(rows) {
  const total = rows.length;

  const successfulRows = rows.filter((row) =>
    ['SUCCESS', 'COMPLETED', 'SETTLED'].includes(row.status)
  );

  const failedRows = rows.filter((row) =>
    ['FAILED', 'ERROR', 'REJECTED'].includes(row.status)
  );

  const pendingRows = rows.filter((row) =>
    ['PENDING', 'PROCESSING', 'QUEUED'].includes(row.status)
  );

  const reversedRows = rows.filter((row) =>
    ['REVERSED', 'CANCELLED'].includes(row.status)
  );

  const successRate = percentage(
    successfulRows.length,
    total
  );

  const failureRate = percentage(
    failedRows.length,
    total
  );

  const pendingRate = percentage(
    pendingRows.length,
    total
  );

  const reversalRate = percentage(
    reversedRows.length,
    total
  );

  return {
    total,
    successful: successfulRows.length,
    failed: failedRows.length,
    pending: pendingRows.length,
    reversedOrCancelled: reversedRows.length,
    successRate,
    failureRate,
    pendingRate,
    reversalRate,
    volumeByCurrency: sumAmountsByCurrency(rows),
  };
}

function computeRiskMetrics(rows) {
  const scored = rows.filter(
    (row) => Number.isFinite(row.riskScore)
  );

  const highRisk = rows.filter((row) =>
    ['HIGH', 'CRITICAL'].includes(row.riskLevel)
  );

  const criticalRisk = rows.filter(
    (row) => row.riskLevel === 'CRITICAL'
  );

  return {
    assessed: scored.length,
    averageRiskScore: average(
      scored.map((row) => row.riskScore)
    ),
    highOrCritical: highRisk.length,
    critical: criticalRisk.length,
    highOrCriticalRate: percentage(
      highRisk.length,
      rows.length
    ),
  };
}

function computeFraudMetrics(rows) {
  const fraudSignals = rows.filter(
    (row) =>
      Number.isFinite(row.riskScore) &&
      row.riskScore >= 80
  );

  const blockedOrEscalated = rows.filter((row) =>
    ['BLOCKED', 'ESCALATED', 'MANUAL_REVIEW'].includes(row.status)
  );

  return {
    highRiskSignals: fraudSignals.length,
    escalatedOrBlocked: blockedOrEscalated.length,
    highRiskSignalRate: percentage(
      fraudSignals.length,
      rows.length
    ),
  };
}

function computeFailureMetrics(rows) {
  const failurePredictions = rows.filter(
    (row) =>
      Number.isFinite(row.failureProbability)
  );

  const highFailure = failurePredictions.filter(
    (row) => row.failureProbability >= 0.7
  );

  return {
    assessed: failurePredictions.length,
    averageFailureProbability: average(
      failurePredictions.map(
        (row) => row.failureProbability
      )
    ),
    highRiskFailurePredictions: highFailure.length,
    highRiskFailureRate: percentage(
      highFailure.length,
      rows.length
    ),
  };
}

function computeProviderMetrics(rows) {
  const byProvider = {};

  for (const row of rows) {
    const provider = normalizeProvider(row.provider);

    if (!byProvider[provider]) {
      byProvider[provider] = {
        transactions: 0,
        successful: 0,
        failed: 0,
        pending: 0,
        totalLatencyMs: 0,
        latencySamples: 0,
        totalAmountMinorByCurrency: {},
      };
    }

    const bucket = byProvider[provider];

    bucket.transactions += 1;

    if (['SUCCESS', 'COMPLETED', 'SETTLED'].includes(row.status)) {
      bucket.successful += 1;
    }

    if (['FAILED', 'ERROR', 'REJECTED'].includes(row.status)) {
      bucket.failed += 1;
    }

    if (['PENDING', 'PROCESSING', 'QUEUED'].includes(row.status)) {
      bucket.pending += 1;
    }

    if (Number.isFinite(row.latencyMs)) {
      bucket.totalLatencyMs += row.latencyMs;
      bucket.latencySamples += 1;
    }

    const currency = normalizeCurrency(row.currency);

    bucket.totalAmountMinorByCurrency[currency] = addBigInt(
      bucket.totalAmountMinorByCurrency[currency] || 0n,
      row.amountMinor
    );
  }

  return Object.fromEntries(
    Object.entries(byProvider).map(([provider, value]) => [
      provider,
      {
        transactions: value.transactions,
        successful: value.successful,
        failed: value.failed,
        pending: value.pending,
        successRate: percentage(
          value.successful,
          value.transactions
        ),
        failureRate: percentage(
          value.failed,
          value.transactions
        ),
        pendingRate: percentage(
          value.pending,
          value.transactions
        ),
        averageLatencyMs:
          value.latencySamples > 0
            ? value.totalLatencyMs / value.latencySamples
            : null,
        totalAmountMinorByCurrency: Object.fromEntries(
          Object.entries(
            value.totalAmountMinorByCurrency
          ).map(([currency, total]) => [
            currency,
            total.toString(),
          ])
        ),
      },
    ])
  );
}

function computeReconciliationMetrics(rows) {
  const known = rows.filter(
    (row) => row.reconciliationStatus !== 'UNKNOWN'
  );

  const reconciled = known.filter((row) =>
    ['MATCHED', 'RECONCILED', 'SETTLED'].includes(
      row.reconciliationStatus
    )
  );

  const exceptions = known.filter((row) =>
    [
      'MISMATCH',
      'EXCEPTION',
      'MISSING_PROVIDER',
      'MISSING_LEDGER',
      'DUPLICATE',
      'REQUIRES_REVIEW',
    ].includes(row.reconciliationStatus)
  );

  return {
    assessed: known.length,
    reconciled: reconciled.length,
    exceptions: exceptions.length,
    reconciliationRate: percentage(
      reconciled.length,
      known.length
    ),
    exceptionRate: percentage(
      exceptions.length,
      known.length
    ),
  };
}

function computeCallbackSecurityMetrics(rows) {
  const verified = rows.filter(
    (row) => row.signatureVerified === true
  );

  const unverified = rows.filter(
    (row) => row.signatureVerified === false
  );

  return {
    verified: verified.length,
    unverified: unverified.length,
    verifiedRate: percentage(
      verified.length,
      rows.length
    ),
    unverifiedRate: percentage(
      unverified.length,
      rows.length
    ),
  };
}

function buildKpis(metrics) {
  const kpis = [];

  function add(id, label, value, unit, metadata = {}) {
    if (kpis.length >= LIMITS.MAX_KPI_COUNT) {
      return;
    }

    kpis.push({
      id,
      label,
      value,
      unit,
      ...metadata,
    });
  }

  add(
    'transactions.total',
    'Total transactions',
    metrics.transactions.total,
    'COUNT'
  );

  add(
    'transactions.successRate',
    'Transaction success rate',
    metrics.transactions.successRate,
    'PERCENT'
  );

  add(
    'transactions.failureRate',
    'Transaction failure rate',
    metrics.transactions.failureRate,
    'PERCENT'
  );

  add(
    'transactions.pendingRate',
    'Pending transaction rate',
    metrics.transactions.pendingRate,
    'PERCENT'
  );

  add(
    'transactions.reversalRate',
    'Reversal/cancellation rate',
    metrics.transactions.reversalRate,
    'PERCENT'
  );

  add(
    'risk.averageScore',
    'Average risk score',
    metrics.risk.averageRiskScore,
    'SCORE'
  );

  add(
    'risk.highOrCritical',
    'High/critical-risk records',
    metrics.risk.highOrCritical,
    'COUNT'
  );

  add(
    'fraud.highRiskSignals',
    'High-risk fraud signals',
    metrics.fraud.highRiskSignals,
    'COUNT'
  );

  add(
    'failure.averageProbability',
    'Average failure probability',
    metrics.failure.averageFailureProbability,
    'PROBABILITY'
  );

  add(
    'reconciliation.rate',
    'Reconciliation rate',
    metrics.reconciliation.reconciliationRate,
    'PERCENT'
  );

  add(
    'reconciliation.exceptions',
    'Reconciliation exceptions',
    metrics.reconciliation.exceptions,
    'COUNT'
  );

  add(
    'callbacks.verifiedRate',
    'Verified callback rate',
    metrics.callbacks.verifiedRate,
    'PERCENT'
  );

  return kpis;
}

/* -------------------------------------------------------------------------- */
/* Exceptions and recommendations                                             */
/* -------------------------------------------------------------------------- */

function normalizeException(exception = {}) {
  return {
    id: normalizeId(
      firstDefined(
        exception.id,
        exception.exceptionId,
        exception.reference
      )
    ),
    category:
      boundedText(
        firstDefined(
          exception.category,
          exception.type,
          exception.exceptionType
        ),
        80
      )?.toUpperCase() || 'UNKNOWN',
    severity:
      normalizeRiskLevel(
        firstDefined(
          exception.severity,
          exception.riskLevel
        )
      ),
    status:
      boundedText(
        firstDefined(exception.status, exception.state),
        50
      )?.toUpperCase() || 'OPEN',
    title: boundedText(
      firstDefined(
        exception.title,
        exception.message,
        exception.reason
      ),
      300
    ),
    description: boundedText(
      firstDefined(
        exception.description,
        exception.details,
        exception.reason
      ),
      1000
    ),
    reference: normalizeId(
      firstDefined(
        exception.reference,
        exception.transactionId,
        exception.eventId
      )
    ),
    createdAt: normalizeTimestamp(
      firstDefined(
        exception.createdAt,
        exception.timestamp
      )
    ),
  };
}

function buildExceptions(input = {}, rows = []) {
  const supplied = sanitizeArray(
    input.exceptions,
    normalizeException,
    LIMITS.MAX_EXCEPTION_COUNT
  );

  const derived = [];

  for (const row of rows) {
    if (
      ['FAILED', 'ERROR', 'REJECTED'].includes(row.status)
    ) {
      derived.push(
        normalizeException({
          id: `failure:${row.id || hashObject(row)}`,
          category: 'PAYMENT_FAILURE',
          severity: 'HIGH',
          status: 'OPEN',
          title: 'Payment processing failure',
          description:
            'A payment record is in a failed or rejected state.',
          reference: row.id,
          createdAt: row.timestamp,
        })
      );
    }

    if (
      [
        'MISMATCH',
        'EXCEPTION',
        'MISSING_PROVIDER',
        'MISSING_LEDGER',
        'DUPLICATE',
        'REQUIRES_REVIEW',
      ].includes(row.reconciliationStatus)
    ) {
      derived.push(
        normalizeException({
          id: `reconciliation:${row.id || hashObject(row)}`,
          category: 'RECONCILIATION',
          severity: 'HIGH',
          status: 'OPEN',
          title: 'Reconciliation exception',
          description:
            'A transaction requires reconciliation review.',
          reference: row.id,
          createdAt: row.timestamp,
        })
      );
    }

    if (row.riskLevel === 'CRITICAL') {
      derived.push(
        normalizeException({
          id: `risk:${row.id || hashObject(row)}`,
          category: 'CRITICAL_RISK',
          severity: 'CRITICAL',
          status: 'OPEN',
          title: 'Critical risk signal',
          description:
            'The intelligence layer identified a critical risk signal.',
          reference: row.id,
          createdAt: row.timestamp,
        })
      );
    }
  }

  const deduped = new Map();

  for (const exception of [...supplied, ...derived]) {
    const key =
      exception.id ||
      hashObject(exception);

    if (!deduped.has(key)) {
      deduped.set(key, exception);
    }
  }

  return Array.from(deduped.values()).slice(
    0,
    LIMITS.MAX_EXCEPTION_COUNT
  );
}

function buildRecommendations(metrics, exceptions, input = {}) {
  const recommendations = [];

  function add(code, priority, title, rationale, action) {
    if (recommendations.length >= LIMITS.MAX_RECOMMENDATION_COUNT) {
      return;
    }

    recommendations.push({
      id: `recommendation:${code}`,
      code,
      priority,
      title,
      rationale,
      action,
      advisoryOnly: true,
      executable: false,
    });
  }

  if (
    metrics.transactions.failureRate !== null &&
    metrics.transactions.failureRate >= 10
  ) {
    add(
      'HIGH_FAILURE_RATE',
      'HIGH',
      'Review payment failure concentration',
      'Observed failure rate is elevated in the reporting window.',
      'Inspect provider, network, callback and validation failure evidence before any operational intervention.'
    );
  }

  if (
    metrics.transactions.pendingRate !== null &&
    metrics.transactions.pendingRate >= 10
  ) {
    add(
      'PENDING_BACKLOG',
      'MEDIUM',
      'Review pending transaction backlog',
      'A material proportion of transactions remain pending or processing.',
      'Inspect queue, callback and provider processing states.'
    );
  }

  if (
    metrics.reconciliation.exceptionRate !== null &&
    metrics.reconciliation.exceptionRate >= 5
  ) {
    add(
      'RECONCILIATION_EXCEPTIONS',
      'HIGH',
      'Review reconciliation exceptions',
      'Reconciliation exceptions are material relative to assessed records.',
      'Route exceptions through the authoritative reconciliation workflow.'
    );
  }

  if (
    metrics.risk.highOrCritical > 0 ||
    metrics.fraud.highRiskSignals > 0
  ) {
    add(
      'RISK_REVIEW',
      'HIGH',
      'Review elevated risk signals',
      'The intelligence projection contains high or critical risk indicators.',
      'Review evidence through the approved fraud/risk governance workflow.'
    );
  }

  if (
    metrics.callbacks.unverifiedRate !== null &&
    metrics.callbacks.unverifiedRate > 0
  ) {
    add(
      'CALLBACK_SECURITY',
      'HIGH',
      'Review unverified callback traffic',
      'Some callback records were not verified by the callback security boundary.',
      'Investigate signature verification, routing and provider configuration.'
    );
  }

  const supplied = sanitizeArray(
    input.recommendations,
    (item) => ({
      id:
        normalizeId(item.id) ||
        `supplied:${hashObject(item)}`,
      code:
        boundedText(item.code, 80)?.toUpperCase() ||
        'SUPPLIED',
      priority:
        boundedText(item.priority, 30)?.toUpperCase() ||
        'MEDIUM',
      title:
        boundedText(item.title, 300) ||
        'Operational recommendation',
      rationale:
        boundedText(item.rationale, 1000),
      action:
        boundedText(item.action, 1000),
      advisoryOnly: true,
      executable: false,
    }),
    LIMITS.MAX_RECOMMENDATION_COUNT
  );

  const deduped = new Map();

  for (const item of [...recommendations, ...supplied]) {
    if (!deduped.has(item.id)) {
      deduped.set(item.id, item);
    }
  }

  return Array.from(deduped.values()).slice(
    0,
    LIMITS.MAX_RECOMMENDATION_COUNT
  );
}

/* -------------------------------------------------------------------------- */
/* Trends                                                                     */
/* -------------------------------------------------------------------------- */

function normalizeTrendPoint(point = {}) {
  return {
    timestamp: normalizeTimestamp(
      firstDefined(
        point.timestamp,
        point.date,
        point.period
      )
    ),
    transactions: safePositiveInteger(
      point.transactions,
      0
    ),
    successful: safePositiveInteger(
      point.successful,
      0
    ),
    failed: safePositiveInteger(
      point.failed,
      0
    ),
    successRate:
      point.successRate !== undefined
        ? clamp(Number(point.successRate), 0, 100)
        : null,
    failureRate:
      point.failureRate !== undefined
        ? clamp(Number(point.failureRate), 0, 100)
        : null,
  };
}

function buildTrend(rows, inputTrend = []) {
  if (Array.isArray(inputTrend) && inputTrend.length) {
    return sanitizeArray(
      sortByTimestamp(inputTrend)
        .map(normalizeTrendPoint),
      (point) => point,
      LIMITS.MAX_TREND_POINTS
    );
  }

  const buckets = new Map();

  for (const row of rows) {
    const date = new Date(row.timestamp);

    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const day = date.toISOString().slice(0, 10);

    if (!buckets.has(day)) {
      buckets.set(day, {
        timestamp: `${day}T00:00:00.000Z`,
        transactions: 0,
        successful: 0,
        failed: 0,
      });
    }

    const bucket = buckets.get(day);

    bucket.transactions += 1;

    if (
      ['SUCCESS', 'COMPLETED', 'SETTLED'].includes(
        row.status
      )
    ) {
      bucket.successful += 1;
    }

    if (
      ['FAILED', 'ERROR', 'REJECTED'].includes(
        row.status
      )
    ) {
      bucket.failed += 1;
    }
  }

  return Array.from(buckets.values())
    .sort(compareTimes)
    .slice(-LIMITS.MAX_TREND_POINTS)
    .map((point) => ({
      ...point,
      successRate: percentage(
        point.successful,
        point.transactions
      ),
      failureRate: percentage(
        point.failed,
        point.transactions
      ),
    }));
}

/* -------------------------------------------------------------------------- */
/* Provider health                                                            */
/* -------------------------------------------------------------------------- */

function normalizeProviderHealth(input = {}, provider = DEFAULT_PROVIDER) {
  const raw =
    isPlainObject(input.providerHealth)
      ? input.providerHealth
      : isPlainObject(input.health)
        ? input.health
        : {};

  const status =
    boundedText(
      firstDefined(raw.status, raw.state),
      30
    )?.toUpperCase() || HEALTH.DEGRADED;

  const normalizedStatus = Object.values(HEALTH).includes(status)
    ? status
    : HEALTH.DEGRADED;

  return {
    provider,
    status: normalizedStatus,
    score: normalizeScore(
      firstDefined(
        raw.score,
        raw.healthScore,
        raw.availabilityScore
      )
    ),
    latencyMs: Number.isFinite(Number(raw.latencyMs))
      ? Math.max(0, Number(raw.latencyMs))
      : null,
    failureRate:
      raw.failureRate !== undefined
        ? clamp(Number(raw.failureRate), 0, 100)
        : null,
    checkedAt: normalizeTimestamp(
      firstDefined(
        raw.checkedAt,
        raw.timestamp
      )
    ),
    degradedReasons: sanitizeArray(
      raw.degradedReasons,
      (reason) => boundedText(reason, 500),
      50
    ),
    dependencies: sanitizeArray(
      raw.dependencies,
      (dependency) => ({
        name: boundedText(
          firstDefined(
            dependency.name,
            dependency.id
          ),
          100
        ),
        status:
          boundedText(
            firstDefined(
              dependency.status,
              dependency.state
            ),
            30
          )?.toUpperCase() || HEALTH.DEGRADED,
      }),
      100
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Snapshot / report construction                                             */
/* -------------------------------------------------------------------------- */

function buildSnapshot(input = {}, context = {}) {
  const tenantId = resolveTenantId(input, context);

  if (!tenantId) {
    const error = new Error(
      'Executive BI generation requires an authoritative tenantId.'
    );

    error.code = 'TENANT_REQUIRED';
    throw error;
  }

  const correlationId = resolveCorrelationId(input, context);
  const provider = normalizeProvider(
    firstDefined(
      input.provider,
      context.provider
    )
  );
  const period = resolvePeriod(input);
  const currency = normalizeCurrency(
    firstDefined(
      input.currency,
      context.currency
    )
  );

  const rows = normalizeDataset(
    firstDefined(
      input.records,
      input.transactions,
      input.events,
      []
    ),
    tenantId
  );

  const transactions = computeTransactionMetrics(rows);
  const risk = computeRiskMetrics(rows);
  const fraud = computeFraudMetrics(rows);
  const failure = computeFailureMetrics(rows);
  const providerMetrics = computeProviderMetrics(rows);
  const reconciliation = computeReconciliationMetrics(rows);
  const callbacks = computeCallbackSecurityMetrics(rows);

  const metrics = {
    transactions,
    risk,
    fraud,
    failure,
    provider: providerMetrics,
    reconciliation,
    callbacks,
  };

  const exceptions = buildExceptions(input, rows);
  const recommendations = buildRecommendations(
    metrics,
    exceptions,
    input
  );

  const trend = buildTrend(
    rows,
    input.trend
  );

  const providerHealth = normalizeProviderHealth(
    input,
    provider
  );

  const dataQuality = {
    sourceRecordCount: rows.length,
    recordsIgnored:
      Array.isArray(
        firstDefined(
          input.records,
          input.transactions,
          input.events
        )
      )
        ? Math.max(
            0,
            firstDefined(
              input.records,
              input.transactions,
              input.events
            ).length - rows.length
          )
        : 0,
    tenantScoped: true,
    bounded: true,
    partial:
      Boolean(input.partial) ||
      rows.length === 0,
    missingEvidence: sanitizeArray(
      input.missingEvidence,
      (item) => boundedText(item, 500),
      100
    ),
  };

  const status =
    dataQuality.partial ||
    dataQuality.missingEvidence.length > 0 ||
    providerHealth.status !== HEALTH.UP
      ? STATUS.PARTIAL
      : STATUS.GENERATED;

  const executiveSummary = {
    headline:
      boundedText(
        firstDefined(
          input.headline,
          input.summary?.headline
        ),
        500
      ) ||
      `${provider} executive intelligence snapshot`,
    narrative:
      boundedText(
        firstDefined(
          input.narrative,
          input.summary?.narrative
        ),
        2000
      ) ||
      buildDefaultNarrative(
        provider,
        transactions,
        reconciliation,
        risk
      ),
  };

  const snapshotCore = {
    tenantId,
    provider,
    currency,
    correlationId,
    period,
    status,
    metrics,
    kpis: buildKpis(metrics),
    trend,
    exceptions,
    recommendations,
    providerHealth,
    executiveSummary,
    dataQuality,
    decisionBoundary: DECISION_BOUNDARY,
  };

  const snapshotId =
    normalizeId(input.snapshotId) ||
    `airtel-executive-bi:${tenantId}:${period.start}:${period.end}:${hashObject(
      {
        provider,
        currency,
        metrics,
        trend,
        exceptions,
      }
    ).slice(0, 32)}`;

  return {
    snapshotId,
    generatedAt: new Date().toISOString(),
    ...snapshotCore,
    metadata: sanitizeMetadata(input.metadata),
  };
}

function buildDefaultNarrative(
  provider,
  transactions,
  reconciliation,
  risk
) {
  const parts = [
    `${provider} processed ${transactions.total} transaction records in the reporting window.`,
  ];

  if (transactions.successRate !== null) {
    parts.push(
      `The observed success rate was ${transactions.successRate}%.`
    );
  }

  if (reconciliation.reconciliationRate !== null) {
    parts.push(
      `The observed reconciliation rate was ${reconciliation.reconciliationRate}%.`
    );
  }

  if (risk.highOrCritical > 0) {
    parts.push(
      `${risk.highOrCritical} records carried high or critical risk classifications.`
    );
  }

  parts.push(
    'These indicators are management intelligence projections and are not authoritative accounting or transaction decisions.'
  );

  return parts.join(' ');
}

/* -------------------------------------------------------------------------- */
/* Repository adapter                                                         */
/* -------------------------------------------------------------------------- */

function createRepositoryAdapter(repository) {
  if (!repository) {
    return null;
  }

  const adapter = {};

  if (typeof repository.create === 'function') {
    adapter.create = repository.create.bind(repository);
  }

  if (typeof repository.insert === 'function') {
    adapter.insert = repository.insert.bind(repository);
  }

  if (typeof repository.upsert === 'function') {
    adapter.upsert = repository.upsert.bind(repository);
  }

  if (typeof repository.findById === 'function') {
    adapter.findById = repository.findById.bind(repository);
  }

  if (typeof repository.findOne === 'function') {
    adapter.findOne = repository.findOne.bind(repository);
  }

  if (typeof repository.list === 'function') {
    adapter.list = repository.list.bind(repository);
  }

  if (typeof repository.find === 'function') {
    adapter.find = repository.find.bind(repository);
  }

  return adapter;
}

/* -------------------------------------------------------------------------- */
/* Audit / event adapter                                                      */
/* -------------------------------------------------------------------------- */

function createEventEnvelope(
  type,
  snapshot,
  context = {}
) {
  return {
    eventId: crypto.randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    tenantId: snapshot.tenantId,
    provider: snapshot.provider,
    correlationId: snapshot.correlationId,
    advisoryOnly: true,
    snapshotId: snapshot.snapshotId,
    payload: {
      status: snapshot.status,
      transactionCount:
        snapshot.metrics.transactions.total,
      exceptionCount:
        snapshot.exceptions.length,
      recommendationCount:
        snapshot.recommendations.length,
    },
    metadata: sanitizeMetadata({
      source: 'airtel.executiveBI',
      ...context.metadata,
    }),
  };
}

async function emitSafeEvent(eventBus, envelope, logger) {
  if (!eventBus) {
    return {
      emitted: false,
      reason: 'EVENT_BUS_UNAVAILABLE',
    };
  }

  try {
    if (typeof eventBus.publish === 'function') {
      await eventBus.publish(envelope.type, envelope);
      return { emitted: true };
    }

    if (typeof eventBus.emit === 'function') {
      await Promise.resolve(
        eventBus.emit(
          envelope.type,
          envelope
        )
      );
      return { emitted: true };
    }

    return {
      emitted: false,
      reason: 'UNSUPPORTED_EVENT_BUS',
    };
  } catch (error) {
    logger?.warn?.(
      {
        err: error,
        eventType: envelope.type,
        tenantId: envelope.tenantId,
        snapshotId: envelope.snapshotId,
      },
      'Airtel executive BI event publication failed'
    );

    return {
      emitted: false,
      reason: 'EVENT_PUBLICATION_FAILED',
    };
  }
}

async function writeSafeAudit(
  auditLogger,
  action,
  snapshot,
  logger
) {
  if (!auditLogger) {
    return {
      recorded: false,
      reason: 'AUDIT_UNAVAILABLE',
    };
  }

  const entry = {
    action,
    timestamp: new Date().toISOString(),
    tenantId: snapshot.tenantId,
    provider: snapshot.provider,
    correlationId: snapshot.correlationId,
    snapshotId: snapshot.snapshotId,
    status: snapshot.status,
    advisoryOnly: true,
    metadata: {
      transactionCount:
        snapshot.metrics.transactions.total,
      exceptionCount:
        snapshot.exceptions.length,
      recommendationCount:
        snapshot.recommendations.length,
    },
  };

  try {
    if (typeof auditLogger.record === 'function') {
      await auditLogger.record(entry);
      return { recorded: true };
    }

    if (typeof auditLogger.log === 'function') {
      await auditLogger.log(entry);
      return { recorded: true };
    }

    if (typeof auditLogger.write === 'function') {
      await auditLogger.write(entry);
      return { recorded: true };
    }

    return {
      recorded: false,
      reason: 'UNSUPPORTED_AUDIT_INTERFACE',
    };
  } catch (error) {
    logger?.warn?.(
      {
        err: error,
        action,
        tenantId: snapshot.tenantId,
        snapshotId: snapshot.snapshotId,
      },
      'Airtel executive BI audit write failed'
    );

    return {
      recorded: false,
      reason: 'AUDIT_WRITE_FAILED',
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Main service                                                               */
/* -------------------------------------------------------------------------- */

class ExecutiveBI {
  constructor(options = {}) {
    this.name = 'AirtelExecutiveBI';

    this.provider = normalizeProvider(
      options.provider || DEFAULT_PROVIDER
    );

    this.repository = createRepositoryAdapter(
      options.repository ||
        options.repositories?.executiveBI ||
        null
    );

    this.eventBus =
      options.eventBus ||
      options.events ||
      options.outbox ||
      null;

    this.auditLogger =
      options.auditLogger ||
      options.audit ||
      null;

    this.analyticsPipeline =
      options.analyticsPipeline ||
      options.intelligence?.analyticsPipeline ||
      null;

    this.callbackIntelligenceService =
      options.callbackIntelligenceService ||
      options.intelligence?.callbackIntelligenceService ||
      null;

    this.decisionExplainer =
      options.decisionExplainer ||
      options.intelligence?.decisionExplainer ||
      null;

    this.providerHealthService =
      options.providerHealthService ||
      options.providerHealth ||
      null;

    this.logger =
      options.logger ||
      console;

    this.clock =
      typeof options.clock === 'function'
        ? options.clock
        : () => new Date();

    this.initialized = false;
    this.initializingPromise = null;

    this.metrics = {
      snapshotsGenerated: 0,
      snapshotsFailed: 0,
      persistenceFailures: 0,
      eventFailures: 0,
      auditFailures: 0,
    };
  }

  async initialize(context = {}) {
    if (this.initialized) {
      return this.getHealth();
    }

    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    this.initializingPromise = (async () => {
      if (
        this.analyticsPipeline &&
        typeof this.analyticsPipeline.initialize === 'function'
      ) {
        await this.analyticsPipeline.initialize(context);
      }

      if (
        this.callbackIntelligenceService &&
        typeof this.callbackIntelligenceService.initialize === 'function'
      ) {
        await this.callbackIntelligenceService.initialize(context);
      }

      if (
        this.decisionExplainer &&
        typeof this.decisionExplainer.initialize === 'function'
      ) {
        await this.decisionExplainer.initialize(context);
      }

      if (
        this.providerHealthService &&
        typeof this.providerHealthService.initialize === 'function'
      ) {
        await this.providerHealthService.initialize(context);
      }

      this.initialized = true;

      return this.getHealth();
    })()
      .catch((error) => {
        this.initialized = false;
        throw error;
      })
      .finally(() => {
        this.initializingPromise = null;
      });

    return this.initializingPromise;
  }

  async destroy(context = {}) {
    const dependencies = [
      this.providerHealthService,
      this.decisionExplainer,
      this.callbackIntelligenceService,
      this.analyticsPipeline,
    ];

    for (const dependency of dependencies) {
      try {
        if (
          dependency &&
          typeof dependency.destroy === 'function'
        ) {
          await dependency.destroy(context);
        }
      } catch (error) {
        this.logger.warn?.(
          {
            err: error,
            dependency: dependency?.constructor?.name,
          },
          'Airtel executive BI dependency shutdown failed'
        );
      }
    }

    this.initialized = false;
  }

  async getProviderHealth(context = {}) {
    if (
      !this.providerHealthService
    ) {
      return normalizeProviderHealth(
        {
          status: HEALTH.DEGRADED,
          degradedReasons: [
            'Provider health service is not configured.',
          ],
        },
        this.provider
      );
    }

    try {
      let result;

      if (
        typeof this.providerHealthService.getHealth ===
        'function'
      ) {
        result =
          await this.providerHealthService.getHealth(
            context
          );
      } else if (
        typeof this.providerHealthService.health ===
        'function'
      ) {
        result =
          await this.providerHealthService.health(
            context
          );
      }

      return normalizeProviderHealth(
        {
          providerHealth: result,
        },
        this.provider
      );
    } catch (error) {
      this.logger.warn?.(
        {
          err: error,
          provider: this.provider,
        },
        'Airtel provider health lookup failed'
      );

      return normalizeProviderHealth(
        {
          providerHealth: {
            status: HEALTH.DEGRADED,
            degradedReasons: [
              'Provider health lookup failed.',
            ],
          },
        },
        this.provider
      );
    }
  }

  async collectIntelligence(input = {}, context = {}) {
    const collected = {
      ...input,
    };

    if (
      !collected.records &&
      this.analyticsPipeline
    ) {
      try {
        if (
          typeof this.analyticsPipeline.analyze ===
          'function'
        ) {
          const analytics =
            await this.analyticsPipeline.analyze(
              input,
              context
            );

          if (Array.isArray(analytics?.records)) {
            collected.records = analytics.records;
          }

          if (
            analytics?.metrics &&
            isPlainObject(analytics.metrics)
          ) {
            collected.analytics = analytics.metrics;
          }
        } else if (
          typeof this.analyticsPipeline.run ===
          'function'
        ) {
          const analytics =
            await this.analyticsPipeline.run(
              input,
              context
            );

          if (Array.isArray(analytics?.records)) {
            collected.records = analytics.records;
          }
        }
      } catch (error) {
        this.logger.warn?.(
          {
            err: error,
            tenantId: resolveTenantId(
              input,
              context
            ),
          },
          'Airtel analytics collection failed'
        );

        collected.partial = true;

        collected.missingEvidence = [
          ...(Array.isArray(
            collected.missingEvidence
          )
            ? collected.missingEvidence
            : []),
          'analyticsPipeline',
        ];
      }
    }

    if (
      !collected.exceptions &&
      this.callbackIntelligenceService
    ) {
      try {
        if (
          typeof this.callbackIntelligenceService.getExceptions ===
          'function'
        ) {
          const exceptions =
            await this.callbackIntelligenceService.getExceptions(
              input,
              context
            );

          if (Array.isArray(exceptions)) {
            collected.exceptions = exceptions;
          }
        }
      } catch (error) {
        this.logger.warn?.(
          {
            err: error,
          },
          'Airtel callback exception collection failed'
        );

        collected.partial = true;

        collected.missingEvidence = [
          ...(Array.isArray(
            collected.missingEvidence
          )
            ? collected.missingEvidence
            : []),
          'callbackIntelligenceService.exceptions',
        ];
      }
    }

    collected.providerHealth =
      await this.getProviderHealth(context);

    return collected;
  }

  async build(input = {}, context = {}) {
    const enriched = await this.collectIntelligence(
      input,
      context
    );

    return buildSnapshot(
      enriched,
      context
    );
  }

  async explain(snapshot, context = {}) {
    if (
      !this.decisionExplainer ||
      typeof this.decisionExplainer.explainDecision !==
        'function'
    ) {
      return null;
    }

    try {
      return await this.decisionExplainer.explainDecision(
        {
          tenantId: snapshot.tenantId,
          correlationId:
            snapshot.correlationId,
          decisionId:
            snapshot.snapshotId,
          decision: 'INFORMATIONAL',
          explanationType: 'EXECUTIVE_BI',
          advisoryOnly: true,
          currency: snapshot.currency,
          evidence: [
            {
              type: 'OPERATIONAL',
              name: 'Transaction metrics',
              score: snapshot.metrics.transactions.successRate,
            },
            {
              type: 'RECONCILIATION',
              name: 'Reconciliation rate',
              score:
                snapshot.metrics.reconciliation
                  .reconciliationRate,
            },
            {
              type: 'MODEL',
              name: 'Risk signals',
              score:
                snapshot.metrics.risk.averageRiskScore,
            },
          ],
          contradictions:
            snapshot.dataQuality?.missingEvidence || [],
          facts: {
            transactionCount:
              snapshot.metrics.transactions.total,
            exceptionCount:
              snapshot.exceptions.length,
          },
          metadata: {
            source: 'airtel.executiveBI',
            snapshotId: snapshot.snapshotId,
          },
        },
        context
      );
    } catch (error) {
      this.logger.warn?.(
        {
          err: error,
          snapshotId: snapshot.snapshotId,
        },
        'Airtel executive BI explanation generation failed'
      );

      return null;
    }
  }

  async persist(snapshot, context = {}) {
    if (!this.repository) {
      return {
        persisted: false,
        reason: 'REPOSITORY_UNAVAILABLE',
        snapshot,
      };
    }

    const tenantId = resolveTenantId(
      snapshot,
      context
    );

    if (!tenantId) {
      const error = new Error(
        'Tenant context is required for executive BI persistence.'
      );

      error.code = 'TENANT_REQUIRED';
      throw error;
    }

    const record = {
      ...snapshot,
      tenantId,
      tenantScoped: true,
      generatedAt:
        snapshot.generatedAt ||
        this.clock().toISOString(),
    };

    try {
      if (
        typeof this.repository.upsert ===
        'function'
      ) {
        const result =
          await this.repository.upsert(
            {
              tenantId,
              snapshotId: snapshot.snapshotId,
            },
            record,
            context
          );

        return {
          persisted: true,
          mode: 'upsert',
          result,
        };
      }

      if (
        typeof this.repository.create ===
        'function'
      ) {
        const result =
          await this.repository.create(
            record,
            context
          );

        return {
          persisted: true,
          mode: 'create',
          result,
        };
      }

      if (
        typeof this.repository.insert ===
        'function'
      ) {
        const result =
          await this.repository.insert(
            record,
            context
          );

        return {
          persisted: true,
          mode: 'insert',
          result,
        };
      }

      return {
        persisted: false,
        reason: 'UNSUPPORTED_REPOSITORY_INTERFACE',
      };
    } catch (error) {
      this.metrics.persistenceFailures += 1;

      this.logger.error?.(
        {
          err: error,
          tenantId,
          snapshotId: snapshot.snapshotId,
        },
        'Airtel executive BI persistence failed'
      );

      throw error;
    }
  }

  async generate(input = {}, context = {}) {
    const tenantId = resolveTenantId(
      input,
      context
    );

    if (!tenantId) {
      const error = new Error(
        'Executive BI generation requires tenant context.'
      );

      error.code = 'TENANT_REQUIRED';
      throw error;
    }

    const correlationId = resolveCorrelationId(
      input,
      context
    );

    const requestContext = {
      ...context,
      tenantId,
      correlationId,
    };

    try {
      await this.initialize(
        requestContext
      );

      const idempotencyKey =
        normalizeId(
          firstDefined(
            input.idempotencyKey,
            context.idempotencyKey
          )
        );

      let existing = null;

      if (
        idempotencyKey &&
        this.repository?.findOne
      ) {
        existing =
          await this.repository.findOne(
            {
              tenantId,
              idempotencyKey,
            },
            requestContext
          );

        if (existing) {
          return {
            snapshot: existing,
            persisted: true,
            idempotentReplay: true,
            correlationId,
          };
        }
      }

      const snapshot = await this.build(
        {
          ...input,
          idempotencyKey,
        },
        requestContext
      );

      if (idempotencyKey) {
        snapshot.idempotencyKey = idempotencyKey;
      }

      const explanation =
        await this.explain(
          snapshot,
          requestContext
        );

      if (explanation) {
        snapshot.explanation = explanation;
      }

      const persistence =
        await this.persist(
          snapshot,
          requestContext
        );

      const event = createEventEnvelope(
        'airtel.executiveBi.generated',
        snapshot,
        requestContext
      );

      const eventResult =
        await emitSafeEvent(
          this.eventBus,
          event,
          this.logger
        );

      if (!eventResult.emitted) {
        this.metrics.eventFailures += 1;
      }

      const auditResult =
        await writeSafeAudit(
          this.auditLogger,
          'AIRTel_EXECUTIVE_BI_GENERATED',
          snapshot,
          this.logger
        );

      if (!auditResult.recorded) {
        this.metrics.auditFailures += 1;
      }

      this.metrics.snapshotsGenerated += 1;

      return {
        snapshot,
        persisted: persistence.persisted,
        persistence,
        event: eventResult,
        audit: auditResult,
        idempotentReplay: false,
        correlationId,
      };
    } catch (error) {
      this.metrics.snapshotsFailed += 1;

      this.logger.error?.(
        {
          err: error,
          tenantId,
          correlationId,
        },
        'Airtel executive BI generation failed'
      );

      throw error;
    }
  }

  async getById(snapshotId, context = {}) {
    const tenantId = resolveTenantId(
      {},
      context
    );

    if (!tenantId) {
      const error = new Error(
        'Tenant context is required for executive BI lookup.'
      );

      error.code = 'TENANT_REQUIRED';
      throw error;
    }

    const normalizedId =
      normalizeId(snapshotId);

    if (!normalizedId) {
      const error = new Error(
        'A valid snapshotId is required.'
      );

      error.code = 'SNAPSHOT_ID_REQUIRED';
      throw error;
    }

    if (!this.repository) {
      return null;
    }

    if (
      typeof this.repository.findById ===
      'function'
    ) {
      return this.repository.findById(
        normalizedId,
        {
          ...context,
          tenantId,
        }
      );
    }

    if (
      typeof this.repository.findOne ===
      'function'
    ) {
      return this.repository.findOne(
        {
          tenantId,
          snapshotId: normalizedId,
        },
        {
          ...context,
          tenantId,
        }
      );
    }

    return null;
  }

  async list(options = {}, context = {}) {
    const tenantId = resolveTenantId(
      options,
      context
    );

    if (!tenantId) {
      const error = new Error(
        'Tenant context is required for executive BI listing.'
      );

      error.code = 'TENANT_REQUIRED';
      throw error;
    }

    if (!this.repository) {
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: 0,
      };
    }

    const page = safePositiveInteger(
      options.page,
      1
    );

    const pageSize = Math.min(
      safePositiveInteger(
        options.pageSize,
        25
      ),
      100
    );

    const query = {
      ...options,
      tenantId,
      page,
      pageSize,
    };

    delete query.tenant;
    delete query.tenantContext;

    if (
      typeof this.repository.list ===
      'function'
    ) {
      const result =
        await this.repository.list(
          query,
          {
            ...context,
            tenantId,
          }
        );

      return normalizeListResult(
        result,
        page,
        pageSize
      );
    }

    if (
      typeof this.repository.find ===
      'function'
    ) {
      const result =
        await this.repository.find(
          query,
          {
            ...context,
            tenantId,
          }
        );

      return normalizeListResult(
        result,
        page,
        pageSize
      );
    }

    return {
      items: [],
      total: 0,
      page,
      pageSize,
    };
  }

  async buildExecutiveReport(input = {}, context = {}) {
    const generated =
      await this.generate(
        {
          ...input,
          reportType:
            REPORT_TYPES.EXECUTIVE,
        },
        context
      );

    const snapshot = generated.snapshot;

    return {
      reportType: REPORT_TYPES.EXECUTIVE,
      reportId: `report:${snapshot.snapshotId}`,
      generatedAt: snapshot.generatedAt,
      tenantId: snapshot.tenantId,
      provider: snapshot.provider,
      period: snapshot.period,
      status: snapshot.status,
      title:
        `${snapshot.provider} Executive Business Intelligence`,
      summary: snapshot.executiveSummary,
      kpis: snapshot.kpis,
      financial: {
        volumeByCurrency:
          snapshot.metrics.transactions
            .volumeByCurrency,
        note:
          'Amounts are represented as minor-unit strings and are analytical projections, not authoritative accounting balances.',
      },
      operations: {
        transactions:
          snapshot.metrics.transactions,
        provider:
          snapshot.metrics.provider,
        callbacks:
          snapshot.metrics.callbacks,
      },
      risk: {
        risk:
          snapshot.metrics.risk,
        fraud:
          snapshot.metrics.fraud,
        failure:
          snapshot.metrics.failure,
      },
      reconciliation:
        snapshot.metrics.reconciliation,
      trend: snapshot.trend,
      exceptions: snapshot.exceptions,
      recommendations:
        snapshot.recommendations,
      providerHealth:
        snapshot.providerHealth,
      dataQuality:
        snapshot.dataQuality,
      decisionBoundary:
        snapshot.decisionBoundary,
    };
  }

  async buildOperationalReport(
    input = {},
    context = {}
  ) {
    const generated =
      await this.generate(
        {
          ...input,
          reportType:
            REPORT_TYPES.OPERATIONS,
        },
        context
      );

    const snapshot = generated.snapshot;

    return {
      reportType: REPORT_TYPES.OPERATIONS,
      reportId: `report:${snapshot.snapshotId}`,
      generatedAt: snapshot.generatedAt,
      tenantId: snapshot.tenantId,
      provider: snapshot.provider,
      period: snapshot.period,
      status: snapshot.status,
      kpis: snapshot.kpis.filter(
        (kpi) =>
          kpi.id.startsWith('transactions.') ||
          kpi.id.startsWith('callbacks.')
      ),
      provider:
        snapshot.metrics.provider,
      providerHealth:
        snapshot.providerHealth,
      trend:
        snapshot.trend,
      exceptions:
        snapshot.exceptions.filter(
          (item) =>
            item.category ===
              'PAYMENT_FAILURE' ||
            item.category ===
              'CALLBACK_SECURITY'
        ),
      recommendations:
        snapshot.recommendations,
      decisionBoundary:
        snapshot.decisionBoundary,
    };
  }

  async buildFinancialReport(
    input = {},
    context = {}
  ) {
    const generated =
      await this.generate(
        {
          ...input,
          reportType:
            REPORT_TYPES.FINANCIAL,
        },
        context
      );

    const snapshot = generated.snapshot;

    return {
      reportType: REPORT_TYPES.FINANCIAL,
      reportId: `report:${snapshot.snapshotId}`,
      generatedAt: snapshot.generatedAt,
      tenantId: snapshot.tenantId,
      provider: snapshot.provider,
      period: snapshot.period,
      status: snapshot.status,
      volumeByCurrency:
        snapshot.metrics.transactions
          .volumeByCurrency,
      transactionMetrics:
        snapshot.metrics.transactions,
      reconciliation:
        snapshot.metrics.reconciliation,
      exceptions:
        snapshot.exceptions.filter(
          (item) =>
            item.category ===
            'RECONCILIATION'
        ),
      dataQuality:
        snapshot.dataQuality,
      decisionBoundary:
        snapshot.decisionBoundary,
    };
  }

  async buildRiskReport(
    input = {},
    context = {}
  ) {
    const generated =
      await this.generate(
        {
          ...input,
          reportType:
            REPORT_TYPES.RISK,
        },
        context
      );

    const snapshot = generated.snapshot;

    return {
      reportType: REPORT_TYPES.RISK,
      reportId: `report:${snapshot.snapshotId}`,
      generatedAt: snapshot.generatedAt,
      tenantId: snapshot.tenantId,
      provider: snapshot.provider,
      period: snapshot.period,
      status: snapshot.status,
      risk:
        snapshot.metrics.risk,
      fraud:
        snapshot.metrics.fraud,
      failure:
        snapshot.metrics.failure,
      exceptions:
        snapshot.exceptions.filter(
          (item) =>
            item.category ===
              'CRITICAL_RISK' ||
            item.category ===
              'PAYMENT_FAILURE'
        ),
      recommendations:
        snapshot.recommendations,
      decisionBoundary:
        snapshot.decisionBoundary,
    };
  }

  async buildProviderReport(
    input = {},
    context = {}
  ) {
    const generated =
      await this.generate(
        {
          ...input,
          reportType:
            REPORT_TYPES.PROVIDER,
        },
        context
      );

    const snapshot = generated.snapshot;

    return {
      reportType: REPORT_TYPES.PROVIDER,
      reportId: `report:${snapshot.snapshotId}`,
      generatedAt: snapshot.generatedAt,
      tenantId: snapshot.tenantId,
      provider: snapshot.provider,
      period: snapshot.period,
      status: snapshot.status,
      providerHealth:
        snapshot.providerHealth,
      providerMetrics:
        snapshot.metrics.provider,
      transactionMetrics:
        snapshot.metrics.transactions,
      callbacks:
        snapshot.metrics.callbacks,
      exceptions:
        snapshot.exceptions,
      recommendations:
        snapshot.recommendations,
      decisionBoundary:
        snapshot.decisionBoundary,
    };
  }

  async buildReconciliationReport(
    input = {},
    context = {}
  ) {
    const generated =
      await this.generate(
        {
          ...input,
          reportType:
            REPORT_TYPES.RECONCILIATION,
        },
        context
      );

    const snapshot = generated.snapshot;

    return {
      reportType:
        REPORT_TYPES.RECONCILIATION,
      reportId: `report:${snapshot.snapshotId}`,
      generatedAt: snapshot.generatedAt,
      tenantId: snapshot.tenantId,
      provider: snapshot.provider,
      period: snapshot.period,
      status: snapshot.status,
      reconciliation:
        snapshot.metrics.reconciliation,
      exceptions:
        snapshot.exceptions.filter(
          (item) =>
            item.category ===
            'RECONCILIATION'
        ),
      dataQuality:
        snapshot.dataQuality,
      decisionBoundary:
        snapshot.decisionBoundary,
    };
  }

  async compareSnapshots(
    current,
    previous,
    context = {}
  ) {
    const tenantId = resolveTenantId(
      current,
      context
    );

    if (!tenantId) {
      const error = new Error(
        'Tenant context is required for snapshot comparison.'
      );

      error.code = 'TENANT_REQUIRED';
      throw error;
    }

    const currentSnapshot =
      buildSnapshot(
        {
          ...current,
          tenantId,
        },
        {
          ...context,
          tenantId,
        }
      );

    const previousSnapshot =
      buildSnapshot(
        {
          ...previous,
          tenantId,
        },
        {
          ...context,
          tenantId,
        }
      );

    const currentSuccess =
      currentSnapshot.metrics.transactions
        .successRate;

    const previousSuccess =
      previousSnapshot.metrics.transactions
        .successRate;

    const currentFailure =
      currentSnapshot.metrics.transactions
        .failureRate;

    const previousFailure =
      previousSnapshot.metrics.transactions
        .failureRate;

    return {
      tenantId,
      provider:
        currentSnapshot.provider,
      comparedAt:
        new Date().toISOString(),
      currentSnapshotId:
        currentSnapshot.snapshotId,
      previousSnapshotId:
        previousSnapshot.snapshotId,
      changes: {
        transactions:
          currentSnapshot.metrics.transactions.total -
          previousSnapshot.metrics.transactions.total,
        successRate:
          currentSuccess !== null &&
          previousSuccess !== null
            ? currentSuccess -
              previousSuccess
            : null,
        failureRate:
          currentFailure !== null &&
          previousFailure !== null
            ? currentFailure -
              previousFailure
            : null,
        reconciliationRate:
          currentSnapshot.metrics
            .reconciliation
            .reconciliationRate !== null &&
          previousSnapshot.metrics
            .reconciliation
            .reconciliationRate !== null
            ? currentSnapshot.metrics
                .reconciliation
                .reconciliationRate -
              previousSnapshot.metrics
                .reconciliation
                .reconciliationRate
            : null,
      },
      trends: {
        successRate: trendFromValues([
          previousSuccess,
          currentSuccess,
        ]),
        failureRate: trendFromValues([
          previousFailure,
          currentFailure,
        ]),
        reconciliationRate:
          trendFromValues([
            previousSnapshot.metrics
              .reconciliation
              .reconciliationRate,
            currentSnapshot.metrics
              .reconciliation
              .reconciliationRate,
          ]),
      },
      advisoryOnly: true,
    };
  }

  async refresh(input = {}, context = {}) {
    return this.generate(
      {
        ...input,
        forceRefresh: true,
      },
      context
    );
  }

  getHealth() {
    const dependencyStates = {
      repository: Boolean(this.repository),
      analyticsPipeline: Boolean(
        this.analyticsPipeline
      ),
      callbackIntelligenceService: Boolean(
        this.callbackIntelligenceService
      ),
      decisionExplainer: Boolean(
        this.decisionExplainer
      ),
      providerHealthService: Boolean(
        this.providerHealthService
      ),
    };

    const essentialAvailable =
      dependencyStates.repository;

    const intelligenceAvailable =
      dependencyStates.analyticsPipeline ||
      dependencyStates.callbackIntelligenceService;

    let status = HEALTH.UP;

    const degradedReasons = [];

    if (!essentialAvailable) {
      status = HEALTH.DEGRADED;
      degradedReasons.push(
        'Executive BI repository is not configured.'
      );
    }

    if (!intelligenceAvailable) {
      status = HEALTH.DEGRADED;
      degradedReasons.push(
        'No upstream intelligence pipeline is configured.'
      );
    }

    if (!this.initialized) {
      status = HEALTH.DEGRADED;
      degradedReasons.push(
        'Service has not been initialized.'
      );
    }

    if (this.metrics.snapshotsFailed > 0) {
      status = HEALTH.DEGRADED;
      degradedReasons.push(
        'One or more snapshot generations have failed.'
      );
    }

    return {
      service: this.name,
      provider: this.provider,
      status,
      initialized: this.initialized,
      authoritative: false,
      advisoryOnly: true,
      financialAuthority:
        DECISION_BOUNDARY.FINANCIAL_AUTHORITY,
      ledgerAuthority:
        DECISION_BOUNDARY.LEDGER_AUTHORITY,
      settlementAuthority:
        DECISION_BOUNDARY.SETTLEMENT_AUTHORITY,
      paymentAuthority:
        DECISION_BOUNDARY.PAYMENT_AUTHORITY,
      complianceAuthority:
        DECISION_BOUNDARY.COMPLIANCE_AUTHORITY,
      dependencies: dependencyStates,
      degradedReasons,
      metrics: {
        ...this.metrics,
      },
      checkedAt: this.clock().toISOString(),
    };
  }

  async health(context = {}) {
    const base = this.getHealth();

    if (
      this.providerHealthService
    ) {
      const providerHealth =
        await this.getProviderHealth(
          context
        );

      if (
        providerHealth.status !==
        HEALTH.UP
      ) {
        base.status = HEALTH.DEGRADED;
        base.degradedReasons.push(
          `Provider health is ${providerHealth.status}.`
        );
      }

      base.providerHealth =
        providerHealth;
    }

    return base;
  }

  diagnostics() {
    return {
      service: this.name,
      provider: this.provider,
      module: 'airtel.executiveBI',
      architecture: {
        advisoryOnly: true,
        financialAuthority: false,
        paymentAuthority: false,
        settlementAuthority: false,
        ledgerAuthority: false,
        complianceAuthority: false,
        exactMoney: true,
        bigintMoneyArithmetic: true,
        tenantAware: true,
        idempotencySupported: true,
        boundedInputs: true,
        sanitizedOutputs: true,
      },
      dependencies: {
        repository: Boolean(this.repository),
        eventBus: Boolean(this.eventBus),
        auditLogger: Boolean(
          this.auditLogger
        ),
        analyticsPipeline: Boolean(
          this.analyticsPipeline
        ),
        callbackIntelligenceService:
          Boolean(
            this.callbackIntelligenceService
          ),
        decisionExplainer: Boolean(
          this.decisionExplainer
        ),
        providerHealthService:
          Boolean(
            this.providerHealthService
          ),
      },
      metrics: {
        ...this.metrics,
      },
      health: this.getHealth(),
    };
  }

  capabilities() {
    return {
      snapshotGeneration: true,
      executiveReporting: true,
      operationalReporting: true,
      financialProjection: true,
      riskReporting: true,
      providerReporting: true,
      reconciliationReporting: true,
      trendAnalysis: true,
      snapshotComparison: true,
      recommendations: true,
      persistence: Boolean(this.repository),
      explanations: Boolean(
        this.decisionExplainer
      ),
      advisoryOnly: true,
      paymentExecution: false,
      ledgerMutation: false,
      balanceMutation: false,
      settlementAuthority: false,
      complianceDecisioning: false,
      providerHttp: false,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Result normalization                                                       */
/* -------------------------------------------------------------------------- */

function normalizeListResult(
  result,
  page,
  pageSize
) {
  if (Array.isArray(result)) {
    return {
      items: result,
      total: result.length,
      page,
      pageSize,
    };
  }

  if (!isPlainObject(result)) {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
    };
  }

  const items =
    Array.isArray(result.items)
      ? result.items
      : Array.isArray(result.rows)
        ? result.rows
        : Array.isArray(result.results)
          ? result.results
          : [];

  const total = Number.isFinite(
    Number(result.total)
  )
    ? Math.max(0, Number(result.total))
    : items.length;

  return {
    ...result,
    items,
    total,
    page:
      safePositiveInteger(
        result.page,
        page
      ),
    pageSize:
      safePositiveInteger(
        result.pageSize,
        pageSize
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Factory / singleton                                                        */
/* -------------------------------------------------------------------------- */

let defaultInstance = null;

function createExecutiveBI(options = {}) {
  return new ExecutiveBI(options);
}

function getExecutiveBI(options = {}) {
  if (!defaultInstance) {
    defaultInstance =
      new ExecutiveBI(options);
  }

  return defaultInstance;
}

function resetExecutiveBI() {
  defaultInstance = null;
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

module.exports = ExecutiveBI;

module.exports.ExecutiveBI =
  ExecutiveBI;

module.exports.createExecutiveBI =
  createExecutiveBI;

module.exports.getExecutiveBI =
  getExecutiveBI;

module.exports.resetExecutiveBI =
  resetExecutiveBI;

module.exports.STATUS = STATUS;
module.exports.HEALTH = HEALTH;
module.exports.TREND = TREND;
module.exports.REPORT_TYPES = REPORT_TYPES;
module.exports.DECISION_BOUNDARY =
  DECISION_BOUNDARY;

module.exports.buildSnapshot =
  buildSnapshot;

module.exports.computeTransactionMetrics =
  computeTransactionMetrics;

module.exports.computeRiskMetrics =
  computeRiskMetrics;

module.exports.computeFraudMetrics =
  computeFraudMetrics;

module.exports.computeFailureMetrics =
  computeFailureMetrics;

module.exports.computeProviderMetrics =
  computeProviderMetrics;

module.exports.computeReconciliationMetrics =
  computeReconciliationMetrics;

module.exports.computeCallbackSecurityMetrics =
  computeCallbackSecurityMetrics;

module.exports.normalizeRecord =
  normalizeRecord;

module.exports.normalizeDataset =
  normalizeDataset;

module.exports.normalizeProviderHealth =
  normalizeProviderHealth;

module.exports.bigintToString =
  bigintToString;

module.exports.normalizeMinorUnits =
  normalizeMinorUnits;