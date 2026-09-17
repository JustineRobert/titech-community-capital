'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Fraud Model Engine
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/fraudModelEngine.js
 *
 * Architectural Role:
 *   Governed fraud/risk intelligence engine for Airtel payment operations.
 *
 * Responsibilities:
 *   - Normalize approved feature-store inputs.
 *   - Evaluate deterministic fraud/risk rules.
 *   - Optionally invoke an injected statistical/ML model adapter.
 *   - Combine model and rule signals into an explainable risk assessment.
 *   - Produce fraud scores, risk levels, evidence and advisory decisions.
 *   - Detect feature quality/staleness problems.
 *   - Support threshold/policy configuration.
 *   - Support model/version lineage.
 *   - Persist fraud assessments through an optional repository.
 *   - Emit sanitized intelligence events and audit records.
 *   - Support historical/batch assessment.
 *   - Provide health, diagnostics and capability information.
 *
 * Explicitly NOT Responsible For:
 *   - Final payment authorization.
 *   - Payment execution.
 *   - Provider API/HTTP communication.
 *   - Airtel OAuth/token management.
 *   - Callback authentication/signature verification.
 *   - Ledger posting.
 *   - Balance mutation.
 *   - Settlement.
 *   - Reconciliation authority.
 *   - Loan/credit approval.
 *   - AML/KYC determinations.
 *   - Regulatory compliance decisions.
 *   - Autonomous blocking of funds.
 *
 * Governance Principles:
 *   - Fraud output is advisory intelligence unless an external authoritative
 *     policy service explicitly converts it into an operational decision.
 *   - Model predictions are not treated as certainty.
 *   - Missing, stale or contradictory evidence reduces assessment quality and
 *     can force REVIEW rather than creating artificial confidence.
 *   - Protected/demographic characteristics are not used as negative fraud
 *     features by this engine.
 *   - Financial values are represented as exact strings/minor units.
 *   - Number is never used for monetary arithmetic.
 *   - Tenant context is authoritative and cannot be overridden by payload data.
 *   - Raw credentials, tokens, signatures and provider secrets are never stored.
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

const DECISIONS = Object.freeze({
  ALLOW: 'ALLOW',
  REVIEW: 'REVIEW',
  ESCALATE: 'ESCALATE',
  BLOCK_RECOMMENDATION: 'BLOCK_RECOMMENDATION',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
});

const RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
  UNKNOWN: 'UNKNOWN',
});

const SIGNAL_TYPES = Object.freeze({
  RULE: 'RULE',
  MODEL: 'MODEL',
  FEATURE_QUALITY: 'FEATURE_QUALITY',
  VELOCITY: 'VELOCITY',
  DEVICE: 'DEVICE',
  NETWORK: 'NETWORK',
  TRANSACTION: 'TRANSACTION',
  CALLBACK: 'CALLBACK',
  PROVIDER: 'PROVIDER',
  RECONCILIATION: 'RECONCILIATION',
  OPERATIONAL: 'OPERATIONAL',
  UNKNOWN: 'UNKNOWN',
});

const ASSESSMENT_STATUS = Object.freeze({
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  FAILED: 'FAILED',
});

const MODEL_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  UNAVAILABLE: 'UNAVAILABLE',
  DEGRADED: 'DEGRADED',
});

const LIMITS = Object.freeze({
  MAX_FEATURES: 500,
  MAX_SIGNALS: 150,
  MAX_RULE_RESULTS: 100,
  MAX_EVIDENCE: 200,
  MAX_HISTORY: 100,
  MAX_BATCH: 250,
  MAX_STRING_LENGTH: 1000,
  MAX_KEY_LENGTH: 150,
  MAX_METADATA_KEYS: 40,
  MAX_METADATA_VALUE_LENGTH: 500,
  MAX_ARRAY_ITEMS: 100,
  MAX_THRESHOLD_KEYS: 100,
  MAX_REASON_LENGTH: 1000,
  MAX_FEATURE_AGE_MS: 24 * 60 * 60 * 1000,
  MAX_MODEL_SCORE: 100,
  MAX_WEIGHT: 100,
});

const DEFAULT_THRESHOLDS = Object.freeze({
  review: 45,
  escalate: 70,
  blockRecommendation: 85,
  critical: 90,
  minimumEvidenceScore: 35,
});

const DEFAULT_WEIGHTS = Object.freeze({
  model: 0.55,
  rules: 0.35,
  velocity: 0.10,
});

const PROTECTED_OR_SENSITIVE_FEATURE_PATTERNS = [
  /race/i,
  /ethnicity/i,
  /religion/i,
  /gender/i,
  /sex/i,
  /sexual/i,
  /age/i,
  /disability/i,
  /nationality/i,
  /political/i,
  /health/i,
  /medical/i,
  /genetic/i,
  /biometric/i,
];

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

function boundedText(value, maxLength = LIMITS.MAX_STRING_LENGTH) {
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
    boundedText(value, 10)?.toUpperCase() ||
    null
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
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
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
  const normalized =
    normalizeInteger(value);

  return normalized === null
    ? null
    : normalized.toString();
}

function normalizeProbability(value) {
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

  return Math.min(1, Math.max(0, number));
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

  return Math.min(
    LIMITS.MAX_MODEL_SCORE,
    Math.max(0, number)
  );
}

function normalizeWeight(value, fallback = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(
    LIMITS.MAX_WEIGHT,
    Math.max(0, number)
  );
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
      LIMITS.MAX_KEY_LENGTH
    );

    if (
      !key ||
      isSecretKey(key)
    ) {
      continue;
    }

    if (
      rawValue === null ||
      typeof rawValue === 'boolean'
    ) {
      output[key] = rawValue;
      continue;
    }

    if (
      typeof rawValue === 'number' &&
      Number.isFinite(rawValue)
    ) {
      output[key] = rawValue;
      continue;
    }

    if (
      typeof rawValue === 'string'
    ) {
      output[key] = rawValue.slice(
        0,
        LIMITS.MAX_METADATA_VALUE_LENGTH
      );
    }
  }

  return output;
}

function sanitizeArray(
  values,
  mapper,
  limit = LIMITS.MAX_ARRAY_ITEMS
) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .slice(0, limit)
    .map(mapper)
    .filter(
      (value) =>
        value !== null &&
        value !== undefined
    );
}

function isSecretKey(key) {
  return SECRET_KEY_PATTERNS.some(
    (pattern) => pattern.test(String(key))
  );
}

function isProtectedFeatureKey(key) {
  return PROTECTED_OR_SENSITIVE_FEATURE_PATTERNS.some(
    (pattern) =>
      pattern.test(String(key))
  );
}

function stableStringify(value) {
  if (value === undefined) {
    return 'null';
  }

  if (value === null) {
    return 'null';
  }

  if (typeof value === 'bigint') {
    return JSON.stringify(
      value.toString()
    );
  }

  if (value instanceof Date) {
    return JSON.stringify(
      value.toISOString()
    );
  }

  if (Array.isArray(value)) {
    return `[${value
      .map(stableStringify)
      .join(',')}]`;
  }

  if (isPlainObject(value)) {
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

  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(value))
    .digest('hex');
}

function average(values) {
  const valid = values.filter(
    (value) =>
      Number.isFinite(value)
  );

  if (!valid.length) {
    return null;
  }

  return (
    valid.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / valid.length
  );
}

function unique(values) {
  return [
    ...new Set(
      values.filter(
        (value) =>
          value !== null &&
          value !== undefined
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
/* Tenant / correlation helpers                                               */
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
    const error = new Error(
      'Tenant context is required for fraud assessment.'
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
/* Feature normalization                                                      */
/* -------------------------------------------------------------------------- */

function normalizeFeature(
  raw = {}
) {
  const key =
    boundedText(
      raw.key ||
        raw.name ||
        raw.featureName,
      LIMITS.MAX_KEY_LENGTH
    );

  if (
    !key ||
    isSecretKey(key) ||
    isProtectedFeatureKey(key)
  ) {
    return null;
  }

  const type =
    boundedText(
      raw.type,
      40
    )?.toUpperCase() ||
    inferFeatureType(
      raw.value
    );

  let value = null;

  switch (type) {
    case 'BOOLEAN':
      if (
        typeof raw.value ===
        'boolean'
      ) {
        value = raw.value;
      } else if (
        raw.value ===
        'true'
      ) {
        value = true;
      } else if (
        raw.value ===
        'false'
      ) {
        value = false;
      }
      break;

    case 'INTEGER': {
      const integer =
        normalizeInteger(
          raw.value
        );

      value =
        integer === null
          ? null
          : integer.toString();
      break;
    }

    case 'MONEY_MINOR':
      value =
        normalizeMoneyMinor(
          raw.value
        );
      break;

    case 'PROBABILITY':
      value =
        normalizeProbability(
          raw.value
        );
      break;

    case 'NUMBER':
    case 'SCORE':
      value =
        Number.isFinite(
          Number(raw.value)
        )
          ? Number(raw.value)
          : null;
      break;

    default:
      value =
        boundedText(
          raw.value,
          LIMITS.MAX_STRING_LENGTH
        );
  }

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return {
    key,
    type,
    value,
    source:
      boundedText(
        raw.source,
        50
      )?.toUpperCase() ||
      'UNKNOWN',
    quality:
      boundedText(
        raw.quality,
        30
      )?.toUpperCase() ||
      'UNKNOWN',
    confidence:
      raw.confidence !==
        undefined &&
      raw.confidence !==
        null
        ? normalizeProbability(
            raw.confidence
          )
        : null,
    observedAt:
      normalizeTimestamp(
        raw.observedAt
      ),
    expiresAt:
      raw.expiresAt
        ? normalizeTimestamp(
            raw.expiresAt
          )
        : null,
    currency:
      normalizeCurrency(
        raw.currency
      ),
    metadata:
      sanitizeMetadata(
        raw.metadata
      ),
  };
}

function inferFeatureType(
  value
) {
  if (
    typeof value ===
    'boolean'
  ) {
    return 'BOOLEAN';
  }

  if (
    typeof value ===
    'bigint'
  ) {
    return 'INTEGER';
  }

  if (
    typeof value ===
      'number' &&
    Number.isInteger(
      value
    )
  ) {
    return 'INTEGER';
  }

  if (
    typeof value ===
      'number' &&
    Number.isFinite(
      value
    )
  ) {
    return 'NUMBER';
  }

  return 'STRING';
}

function normalizeFeatureInput(
  input = {}
) {
  const source =
    Array.isArray(
      input.features
    )
      ? input.features
      : Array.isArray(
          input.featureVector
        )
        ? input.featureVector
        : [];

  const features = [];
  const seen = new Set();

  for (const raw of source.slice(
    0,
    LIMITS.MAX_FEATURES
  )) {
    const feature =
      normalizeFeature(
        raw
      );

    if (!feature) {
      continue;
    }

    if (
      seen.has(feature.key)
    ) {
      continue;
    }

    seen.add(
      feature.key
    );

    features.push(
      feature
    );
  }

  return features;
}

/* -------------------------------------------------------------------------- */
/* Feature lookup                                                             */
/* -------------------------------------------------------------------------- */

function createFeatureMap(
  features
) {
  const map = new Map();

  for (const feature of features) {
    if (
      !feature?.key
    ) {
      continue;
    }

    map.set(
      feature.key,
      feature.value
    );
  }

  return map;
}

function featureNumber(
  featureMap,
  keys
) {
  for (const key of keys) {
    if (
      featureMap.has(key)
    ) {
      const value =
        Number(
          featureMap.get(key)
        );

      if (
        Number.isFinite(value)
      ) {
        return value;
      }
    }
  }

  return null;
}

function featureBoolean(
  featureMap,
  keys
) {
  for (const key of keys) {
    if (
      featureMap.has(key)
    ) {
      const value =
        featureMap.get(key);

      if (
        typeof value ===
        'boolean'
      ) {
        return value;
      }
    }
  }

  return null;
}

function featureString(
  featureMap,
  keys
) {
  for (const key of keys) {
    if (
      featureMap.has(key)
    ) {
      const value =
        boundedText(
          featureMap.get(
            key
          ),
          500
        );

      if (value) {
        return value;
      }
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Rule engine                                                                */
/* -------------------------------------------------------------------------- */

function createRule(
  code,
  title,
  signalType,
  score,
  severity,
  reason,
  evidence = {}
) {
  return {
    code,
    title,
    signalType,
    score: clamp(
      score,
      0,
      100
    ),
    severity,
    reason:
      boundedText(
        reason,
        LIMITS.MAX_REASON_LENGTH
      ),
    evidence:
      sanitizeMetadata(
        evidence
      ),
  };
}

function evaluateVelocityRules(
  features
) {
  const rules = [];
  const map =
    createFeatureMap(
      features
    );

  const count24h =
    featureNumber(
      map,
      [
        'transactions_24h',
        'txn_count_24h',
        'transaction_count_24h',
      ]
    );

  const amount24h =
    featureNumber(
      map,
      [
        'amount_24h',
        'transaction_amount_24h',
      ]
    );

  const failedCount24h =
    featureNumber(
      map,
      [
        'failed_transactions_24h',
        'failed_txn_count_24h',
      ]
    );

  if (
    count24h !== null &&
    count24h >= 20
  ) {
    rules.push(
      createRule(
        'VELOCITY_TXN_SPIKE',
        'High transaction velocity',
        SIGNAL_TYPES.VELOCITY,
        Math.min(
          90,
          40 +
            Math.min(
              50,
              count24h
            )
        ),
        count24h >= 50
          ? 'HIGH'
          : 'MEDIUM',
        'Transaction activity exceeds the configured velocity baseline.',
        {
          count24h,
        }
      )
    );
  }

  if (
    amount24h !== null &&
    amount24h > 0
  ) {
    const large =
      amount24h >=
      50000000;

    if (large) {
      rules.push(
        createRule(
          'VELOCITY_VALUE_SPIKE',
          'Elevated transaction value velocity',
          SIGNAL_TYPES.VELOCITY,
          60,
          'HIGH',
          'Aggregate recent transaction value is materially elevated.',
          {
            amount24h: String(
              amount24h
            ),
          }
        )
      );
    }
  }

  if (
    failedCount24h !== null &&
    count24h !== null &&
    count24h > 0
  ) {
    const failureRatio =
      failedCount24h /
      count24h;

    if (
      failureRatio >=
      0.5
    ) {
      rules.push(
        createRule(
          'VELOCITY_FAILURE_CLUSTER',
          'Failure concentration',
          SIGNAL_TYPES.VELOCITY,
          55,
          'MEDIUM',
          'A high proportion of recent transactions are failing.',
          {
            failedCount24h,
            count24h,
            failureRatio,
          }
        )
      );
    }
  }

  return rules;
}

function evaluateDeviceRules(
  features
) {
  const rules = [];
  const map =
    createFeatureMap(
      features
    );

  const newDevice =
    featureBoolean(
      map,
      [
        'new_device',
        'device_new',
        'is_new_device',
      ]
    );

  const deviceChanges =
    featureNumber(
      map,
      [
        'device_changes_7d',
        'device_change_count_7d',
      ]
    );

  const emulator =
    featureBoolean(
      map,
      [
        'emulator_detected',
        'device_emulator',
      ]
    );

  const rooted =
    featureBoolean(
      map,
      [
        'root_detected',
        'device_rooted',
      ]
    );

  if (
    newDevice === true
  ) {
    rules.push(
      createRule(
        'DEVICE_NEW',
        'New device signal',
        SIGNAL_TYPES.DEVICE,
        35,
        'MEDIUM',
        'The transaction is associated with a newly observed device.',
        {
          newDevice: true,
        }
      )
    );
  }

  if (
    deviceChanges !== null &&
    deviceChanges >= 3
  ) {
    rules.push(
      createRule(
        'DEVICE_CHURN',
        'Frequent device changes',
        SIGNAL_TYPES.DEVICE,
        Math.min(
          85,
          35 +
            deviceChanges *
              10
        ),
        deviceChanges >= 5
          ? 'HIGH'
          : 'MEDIUM',
        'The entity has changed devices repeatedly within the observation window.',
        {
          deviceChanges,
        }
      )
    );
  }

  if (
    emulator === true
  ) {
    rules.push(
      createRule(
        'DEVICE_EMULATOR',
        'Emulator environment signal',
        SIGNAL_TYPES.DEVICE,
        70,
        'HIGH',
        'The observed environment is classified as an emulator.',
        {
          emulatorDetected: true,
        }
      )
    );
  }

  if (
    rooted === true
  ) {
    rules.push(
      createRule(
        'DEVICE_ROOTED',
        'Compromised-device signal',
        SIGNAL_TYPES.DEVICE,
        65,
        'HIGH',
        'The observed device environment presents a rooted or compromised signal.',
        {
          rootDetected: true,
        }
      )
    );
  }

  return rules;
}

function evaluateNetworkRules(
  features
) {
  const rules = [];
  const map =
    createFeatureMap(
      features
    );

  const vpn =
    featureBoolean(
      map,
      [
        'vpn_detected',
        'network_vpn',
      ]
    );

  const proxy =
    featureBoolean(
      map,
      [
        'proxy_detected',
        'network_proxy',
      ]
    );

  const tor =
    featureBoolean(
      map,
      [
        'tor_detected',
        'network_tor',
      ]
    );

  const unusualIp =
    featureBoolean(
      map,
      [
        'unusual_ip',
        'ip_unusual',
      ]
    );

  if (
    vpn === true
  ) {
    rules.push(
      createRule(
        'NETWORK_VPN',
        'VPN network signal',
        SIGNAL_TYPES.NETWORK,
        25,
        'LOW',
        'The transaction originates through a VPN-related signal.',
        {
          vpnDetected: true,
        }
      )
    );
  }

  if (
    proxy === true
  ) {
    rules.push(
      createRule(
        'NETWORK_PROXY',
        'Proxy network signal',
        SIGNAL_TYPES.NETWORK,
        40,
        'MEDIUM',
        'The transaction originates through a proxy-related signal.',
        {
          proxyDetected: true,
        }
      )
    );
  }

  if (
    tor === true
  ) {
    rules.push(
      createRule(
        'NETWORK_ANONYMIZER',
        'Anonymized network signal',
        SIGNAL_TYPES.NETWORK,
        75,
        'HIGH',
        'The observed network path is associated with an anonymizing network signal.',
        {
          torDetected: true,
        }
      )
    );
  }

  if (
    unusualIp === true
  ) {
    rules.push(
      createRule(
        'NETWORK_IP_ANOMALY',
        'IP anomaly',
        SIGNAL_TYPES.NETWORK,
        50,
        'MEDIUM',
        'The network identity differs materially from expected behavioral patterns.',
        {
          unusualIp: true,
        }
      )
    );
  }

  return rules;
}

function evaluateTransactionRules(
  features
) {
  const rules = [];
  const map =
    createFeatureMap(
      features
    );

  const amount =
    featureNumber(
      map,
      [
        'amount',
        'transaction_amount',
        'amount_minor',
      ]
    );

  const usualAmount =
    featureNumber(
      map,
      [
        'usual_amount',
        'average_amount',
        'median_amount',
      ]
    );

  const countryMismatch =
    featureBoolean(
      map,
      [
        'location_mismatch',
        'country_mismatch',
      ]
    );

  const rapidReversals =
    featureNumber(
      map,
      [
        'reversal_count_24h',
        'reversals_24h',
      ]
    );

  if (
    amount !== null &&
    usualAmount !== null &&
    usualAmount > 0
  ) {
    const ratio =
      amount /
      usualAmount;

    if (
      ratio >= 10
    ) {
      rules.push(
        createRule(
          'TRANSACTION_AMOUNT_ANOMALY',
          'Transaction amount anomaly',
          SIGNAL_TYPES.TRANSACTION,
          65,
          'HIGH',
          'The current amount materially exceeds the observed historical amount pattern.',
          {
            ratio,
          }
        )
      );
    } else if (
      ratio >= 5
    ) {
      rules.push(
        createRule(
          'TRANSACTION_AMOUNT_DEVIATION',
          'Transaction amount deviation',
          SIGNAL_TYPES.TRANSACTION,
          40,
          'MEDIUM',
          'The current amount is materially above the observed historical range.',
          {
            ratio,
          }
        )
      );
    }
  }

  if (
    countryMismatch === true
  ) {
    rules.push(
      createRule(
        'TRANSACTION_LOCATION_MISMATCH',
        'Location mismatch',
        SIGNAL_TYPES.TRANSACTION,
        50,
        'MEDIUM',
        'Transaction location differs from the expected behavioral pattern.',
        {
          countryMismatch: true,
        }
      )
    );
  }

  if (
    rapidReversals !== null &&
    rapidReversals >= 3
  ) {
    rules.push(
      createRule(
        'TRANSACTION_REVERSAL_CLUSTER',
        'Reversal concentration',
        SIGNAL_TYPES.TRANSACTION,
        60,
        'HIGH',
        'Multiple reversals were observed within a short period.',
        {
          rapidReversals,
        }
      )
    );
  }

  return rules;
}

function evaluateCallbackRules(
  features
) {
  const rules = [];
  const map =
    createFeatureMap(
      features
    );

  const replayDetected =
    featureBoolean(
      map,
      [
        'callback_replay_detected',
        'replay_detected',
      ]
    );

  const verified =
    featureBoolean(
      map,
      [
        'signature_verified',
        'callback_signature_verified',
      ]
    );

  const callbackFailures =
    featureNumber(
      map,
      [
        'callback_failure_count',
        'callback_failures_24h',
      ]
    );

  if (
    replayDetected === true
  ) {
    rules.push(
      createRule(
        'CALLBACK_REPLAY',
        'Callback replay signal',
        SIGNAL_TYPES.CALLBACK,
        90,
        'CRITICAL',
        'Callback replay behavior was detected by the callback security/intelligence boundary.',
        {
          replayDetected: true,
        }
      )
    );
  }

  if (
    verified === false
  ) {
    rules.push(
      createRule(
        'CALLBACK_UNVERIFIED',
        'Unverified callback',
        SIGNAL_TYPES.CALLBACK,
        70,
        'HIGH',
        'A callback associated with this assessment was not cryptographically verified.',
        {
          signatureVerified: false,
        }
      )
    );
  }

  if (
    callbackFailures !== null &&
    callbackFailures >= 5
  ) {
    rules.push(
      createRule(
        'CALLBACK_FAILURE_CLUSTER',
        'Callback failure cluster',
        SIGNAL_TYPES.CALLBACK,
        45,
        'MEDIUM',
        'Repeated callback processing failures were observed.',
        {
          callbackFailures,
        }
      )
    );
  }

  return rules;
}

function evaluateOperationalRules(
  features
) {
  const rules = [];
  const map =
    createFeatureMap(
      features
    );

  const providerDegraded =
    featureBoolean(
      map,
      [
        'provider_degraded',
        'provider_health_degraded',
      ]
    );

  const highLatency =
    featureBoolean(
      map,
      [
        'high_latency',
        'provider_latency_high',
      ]
    );

  if (
    providerDegraded === true
  ) {
    rules.push(
      createRule(
        'PROVIDER_DEGRADED',
        'Provider degraded signal',
        SIGNAL_TYPES.PROVIDER,
        30,
        'MEDIUM',
        'Provider health is degraded, reducing the reliability of transaction evidence.',
        {
          providerDegraded: true,
        }
      )
    );
  }

  if (
    highLatency === true
  ) {
    rules.push(
      createRule(
        'PROVIDER_LATENCY',
        'Provider latency anomaly',
        SIGNAL_TYPES.OPERATIONAL,
        25,
        'LOW',
        'Provider latency is elevated for the observed processing period.',
        {
          highLatency: true,
        }
      )
    );
  }

  return rules;
}

function evaluateRules(
  features
) {
  return [
    ...evaluateVelocityRules(
      features
    ),
    ...evaluateDeviceRules(
      features
    ),
    ...evaluateNetworkRules(
      features
    ),
    ...evaluateTransactionRules(
      features
    ),
    ...evaluateCallbackRules(
      features
    ),
    ...evaluateOperationalRules(
      features
    ),
  ].slice(
    0,
    LIMITS.MAX_RULE_RESULTS
  );
}

/* -------------------------------------------------------------------------- */
/* Feature quality                                                            */
/* -------------------------------------------------------------------------- */

function evaluateFeatureQuality(
  features,
  now = new Date(),
  options = {}
) {
  const maxAge =
    Number.isFinite(
      Number(options.maxFeatureAgeMs)
    )
      ? Math.max(
          1,
          Number(
            options.maxFeatureAgeMs
          )
        )
      : LIMITS.MAX_FEATURE_AGE_MS;

  if (
    !features.length
  ) {
    return {
      quality: 'LOW',
      score: 0,
      staleCount: 0,
      invalidCount: 0,
      missingCount: 1,
      reasons: [
        'No approved fraud features were supplied.',
      ],
    };
  }

  let staleCount = 0;
  let invalidCount = 0;
  let freshCount = 0;

  const reasons = [];

  for (const feature of features) {
    const observed =
      new Date(
        feature.observedAt
      ).getTime();

    if (
      !Number.isFinite(observed)
    ) {
      invalidCount += 1;
      continue;
    }

    const age =
      Math.max(
        0,
        now.getTime() -
          observed
      );

    if (
      age > maxAge
    ) {
      staleCount += 1;
    } else {
      freshCount += 1;
    }

    if (
      feature.expiresAt
    ) {
      const expiry =
        new Date(
          feature.expiresAt
        ).getTime();

      if (
        Number.isFinite(
          expiry
        ) &&
        now.getTime() >=
          expiry
      ) {
        staleCount += 1;
      }
    }
  }

  const total =
    features.length;

  const freshRatio =
    total > 0
      ? freshCount / total
      : 0;

  const validityRatio =
    total > 0
      ? (total -
          invalidCount) /
        total
      : 0;

  const freshnessScore =
    freshRatio * 100;

  const validityScore =
    validityRatio * 100;

  const score =
    freshnessScore * 0.6 +
    validityScore * 0.4;

  if (
    staleCount > 0
  ) {
    reasons.push(
      `${staleCount} feature(s) are stale or expired.`
    );
  }

  if (
    invalidCount > 0
  ) {
    reasons.push(
      `${invalidCount} feature(s) have invalid timestamps.`
    );
  }

  let quality = 'HIGH';

  if (
    score < 50
  ) {
    quality = 'LOW';
  } else if (
    score < 80
  ) {
    quality = 'MEDIUM';
  }

  return {
    quality,
    score: clamp(
      score,
      0,
      100
    ),
    staleCount,
    invalidCount,
    missingCount: 0,
    reasons,
  };
}

/* -------------------------------------------------------------------------- */
/* Model adapter normalization                                                */
/* -------------------------------------------------------------------------- */

function normalizeModelResult(
  result
) {
  if (
    !result ||
    !isPlainObject(result)
  ) {
    return {
      status:
        MODEL_STATUS.UNAVAILABLE,
      score: null,
      probability: null,
      modelVersion: null,
      modelName: null,
      reasons: [
        'Model adapter returned no usable result.',
      ],
      signals: [],
    };
  }

  const score =
    normalizeScore(
      result.score
    );

  const probability =
    normalizeProbability(
      result.probability ??
        result.fraudProbability ??
        result.riskProbability
    );

  const modelSignals =
    sanitizeArray(
      result.signals,
      (signal) =>
        normalizeSignal(
          {
            ...signal,
            signalType:
              signal?.signalType ||
              SIGNAL_TYPES.MODEL,
          }
        ),
      LIMITS.MAX_SIGNALS
    );

  return {
    status:
      boundedText(
        result.status,
        30
      )?.toUpperCase() ||
      (
        score !== null ||
        probability !== null
          ? MODEL_STATUS.AVAILABLE
          : MODEL_STATUS.UNAVAILABLE
      ),
    score,
    probability,
    modelVersion:
      boundedText(
        result.modelVersion,
        LIMITS.MAX_VERSION_LENGTH
      ),
    modelName:
      boundedText(
        result.modelName,
        150
      ),
    reasons:
      sanitizeArray(
        result.reasons,
        (reason) =>
          boundedText(
            reason,
            LIMITS.MAX_REASON_LENGTH
          ),
        50
      ),
    signals: modelSignals,
    metadata:
      sanitizeMetadata(
        result.metadata
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Signals / evidence                                                         */
/* -------------------------------------------------------------------------- */

function normalizeSeverity(
  value
) {
  const normalized =
    boundedText(
      value,
      30
    )?.toUpperCase();

  return [
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL',
  ].includes(
    normalized
  )
    ? normalized
    : 'UNKNOWN';
}

function normalizeSignal(
  signal = {}
) {
  const name =
    boundedText(
      signal.name ||
        signal.code ||
        signal.reason,
      200
    );

  if (!name) {
    return null;
  }

  return {
    id:
      normalizeId(
        signal.id
      ) ||
      `signal:${fingerprint(
        {
          name,
          type:
            signal.signalType,
          score:
            signal.score,
        }
      ).slice(0, 24)}`,
    name,
    code:
      boundedText(
        signal.code,
        100
      )?.toUpperCase() ||
      null,
    signalType:
      boundedText(
        signal.signalType ||
          signal.type,
        50
      )?.toUpperCase() ||
      SIGNAL_TYPES.UNKNOWN,
    score:
      normalizeScore(
        signal.score
      ),
    severity:
      normalizeSeverity(
        signal.severity
      ),
    reason:
      boundedText(
        signal.reason ||
          signal.description,
        LIMITS.MAX_REASON_LENGTH
      ),
    source:
      boundedText(
        signal.source,
        100
      ),
    evidence:
      sanitizeMetadata(
        signal.evidence
      ),
    advisoryOnly: true,
  };
}

function signalsFromRules(
  rules
) {
  return rules.map(
    (rule) =>
      normalizeSignal({
        id:
          `rule:${rule.code}`,
        name:
          rule.title,
        code:
          rule.code,
        signalType:
          rule.signalType,
        score:
          rule.score,
        severity:
          rule.severity,
        reason:
          rule.reason,
        source:
          'fraud.rules',
        evidence:
          rule.evidence,
      })
  );
}

/* -------------------------------------------------------------------------- */
/* Score aggregation                                                          */
/* -------------------------------------------------------------------------- */

function aggregateRuleScore(
  rules
) {
  if (!rules.length) {
    return 0;
  }

  const sorted = [...rules]
    .sort(
      (a, b) =>
        b.score -
        a.score
    );

  const top = sorted.slice(
    0,
    5
  );

  const weights = [
    1,
    0.65,
    0.45,
    0.30,
    0.20,
  ];

  let weightedScore = 0;
  let weightTotal = 0;

  top.forEach(
    (
      rule,
      index
    ) => {
      const weight =
        weights[index] ||
        0.1;

      weightedScore +=
        rule.score *
        weight;

      weightTotal +=
        weight;
    }
  );

  return weightTotal > 0
    ? weightedScore /
        weightTotal
    : 0;
}

function aggregateVelocityScore(
  rules
) {
  const velocity =
    rules.filter(
      (rule) =>
        rule.signalType ===
        SIGNAL_TYPES.VELOCITY
    );

  return velocity.length
    ? Math.max(
        ...velocity.map(
          (rule) =>
            rule.score
        )
      )
    : 0;
}

function combineScores(
  modelScore,
  ruleScore,
  velocityScore,
  qualityScore,
  options = {}
) {
  const modelWeight =
    normalizeWeight(
      options.weights?.model,
      DEFAULT_WEIGHTS.model
    );

  const ruleWeight =
    normalizeWeight(
      options.weights?.rules,
      DEFAULT_WEIGHTS.rules
    );

  const velocityWeight =
    normalizeWeight(
      options.weights?.velocity,
      DEFAULT_WEIGHTS.velocity
    );

  const usableParts = [];

  if (
    modelScore !== null
  ) {
    usableParts.push({
      score:
        modelScore,
      weight:
        modelWeight,
    });
  }

  if (
    ruleScore !== null
  ) {
    usableParts.push({
      score:
        ruleScore,
      weight:
        ruleWeight,
    });
  }

  if (
    velocityScore !== null
  ) {
    usableParts.push({
      score:
        velocityScore,
      weight:
        velocityWeight,
    });
  }

  if (!usableParts.length) {
    return null;
  }

  let weighted = 0;
  let weights = 0;

  for (const part of usableParts) {
    weighted +=
      part.score *
      part.weight;

    weights +=
      part.weight;
  }

  const raw =
    weights > 0
      ? weighted / weights
      : 0;

  /*
   * Poor feature quality must not mathematically manufacture a precise score.
   * It reduces confidence in the usable score and may later force REVIEW.
   */
  if (
    Number.isFinite(
      qualityScore
    )
  ) {
    const qualityFactor =
      clamp(
        qualityScore / 100,
        0.5,
        1
      );

    return clamp(
      raw *
        qualityFactor,
      0,
      100
    );
  }

  return clamp(
    raw,
    0,
    100
  );
}

/* -------------------------------------------------------------------------- */
/* Decision policy                                                            */
/* -------------------------------------------------------------------------- */

function resolveThresholds(
  options = {}
) {
  const source =
    isPlainObject(
      options.thresholds
    )
      ? options.thresholds
      : {};

  return {
    review:
      clamp(
        source.review ??
          DEFAULT_THRESHOLDS.review,
        0,
        100
      ),
    escalate:
      clamp(
        source.escalate ??
          DEFAULT_THRESHOLDS.escalate,
        0,
        100
      ),
    blockRecommendation:
      clamp(
        source.blockRecommendation ??
          DEFAULT_THRESHOLDS.blockRecommendation,
        0,
        100
      ),
    critical:
      clamp(
        source.critical ??
          DEFAULT_THRESHOLDS.critical,
        0,
        100
      ),
    minimumEvidenceScore:
      clamp(
        source.minimumEvidenceScore ??
          DEFAULT_THRESHOLDS.minimumEvidenceScore,
        0,
        100
      ),
  };
}

function deriveRiskLevel(
  score,
  evidenceScore,
  thresholds
) {
  if (
    score === null
  ) {
    return RISK_LEVELS.UNKNOWN;
  }

  if (
    evidenceScore <
    thresholds.minimumEvidenceScore
  ) {
    return RISK_LEVELS.UNKNOWN;
  }

  if (
    score >=
    thresholds.critical
  ) {
    return RISK_LEVELS.CRITICAL;
  }

  if (
    score >=
    thresholds.escalate
  ) {
    return RISK_LEVELS.HIGH;
  }

  if (
    score >=
    thresholds.review
  ) {
    return RISK_LEVELS.MEDIUM;
  }

  return RISK_LEVELS.LOW;
}

function deriveDecision(
  score,
  riskLevel,
  evidenceQuality,
  modelAvailable,
  rules,
  thresholds,
  options = {}
) {
  const contradictions =
    Array.isArray(
      options.contradictions
    )
      ? options.contradictions
      : [];

  if (
    evidenceQuality <
    thresholds.minimumEvidenceScore ||
    score === null
  ) {
    return DECISIONS.INSUFFICIENT_EVIDENCE;
  }

  if (
    contradictions.length
  ) {
    return DECISIONS.REVIEW;
  }

  const hasCriticalRule =
    rules.some(
      (rule) =>
        rule.severity ===
        'CRITICAL'
    );

  if (
    hasCriticalRule
  ) {
    return DECISIONS.ESCALATE;
  }

  if (
    riskLevel ===
    RISK_LEVELS.CRITICAL
  ) {
    return DECISIONS.ESCALATE;
  }

  if (
    score >=
    thresholds.blockRecommendation
  ) {
    return DECISIONS.BLOCK_RECOMMENDATION;
  }

  if (
    score >=
    thresholds.escalate ||
    riskLevel ===
      RISK_LEVELS.HIGH
  ) {
    return DECISIONS.ESCALATE;
  }

  if (
    score >=
    thresholds.review ||
    riskLevel ===
      RISK_LEVELS.MEDIUM
  ) {
    return DECISIONS.REVIEW;
  }

  if (
    !modelAvailable &&
    rules.length === 0
  ) {
    return DECISIONS.INSUFFICIENT_EVIDENCE;
  }

  return DECISIONS.ALLOW;
}

/* -------------------------------------------------------------------------- */
/* Evidence quality                                                           */
/* -------------------------------------------------------------------------- */

function calculateEvidenceQuality(
  features,
  rules,
  model,
  input = {}
) {
  let score = 0;

  if (
    features.length >= 5
  ) {
    score += 30;
  } else if (
    features.length >= 2
  ) {
    score += 20;
  } else if (
    features.length === 1
  ) {
    score += 10;
  }

  if (
    rules.length >= 1
  ) {
    score += 25;
  }

  if (
    model?.score !== null &&
    model?.score !== undefined
  ) {
    score += 30;
  }

  if (
    model?.probability !== null &&
    model?.probability !== undefined
  ) {
    score += 5;
  }

  if (
    input.transactionId ||
    input.eventId
  ) {
    score += 5;
  }

  if (
    input.providerReference ||
    input.reference
  ) {
    score += 5;
  }

  const quality =
    evaluateFeatureQuality(
      features,
      new Date()
    );

  score *=
    quality.score / 100;

  if (
    quality.quality ===
    'LOW'
  ) {
    score *= 0.7;
  }

  return clamp(
    score,
    0,
    100
  );
}

/* -------------------------------------------------------------------------- */
/* Assessment identity                                                        */
/* -------------------------------------------------------------------------- */

function buildAssessmentId(
  tenantId,
  input,
  features
) {
  const supplied =
    normalizeId(
      input.assessmentId ||
        input.fraudAssessmentId
    );

  if (supplied) {
    return supplied;
  }

  const identity =
    {
      tenantId,
      provider:
        normalizeProvider(
          input.provider
        ),
      transactionId:
        normalizeId(
          input.transactionId
        ),
      eventId:
        normalizeId(
          input.eventId
        ),
      reference:
        normalizeId(
          input.reference
        ),
      featureFingerprint:
        fingerprint(
          features
        ),
    };

  return (
    `fraud:${tenantId}:` +
    fingerprint(
      identity
    ).slice(0, 40)
  );
}

/* -------------------------------------------------------------------------- */
/* Main engine                                                                */
/* -------------------------------------------------------------------------- */

class FraudModelEngine {
  constructor(options = {}) {
    this.name =
      'AirtelFraudModelEngine';

    this.provider =
      normalizeProvider(
        options.provider ||
          PROVIDER
      );

    this.featureStore =
      options.featureStore ||
      options.intelligence
        ?.featureStore ||
      null;

    this.modelAdapter =
      options.modelAdapter ||
      options.model ||
      options.fraudModel ||
      null;

    this.repository =
      createRepositoryAdapter(
        options.repository ||
          options.repositories
            ?.fraudAssessment ||
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

    this.decisionExplainer =
      options.decisionExplainer ||
      options.intelligence
        ?.decisionExplainer ||
      null;

    this.logger =
      options.logger ||
      console;

    this.clock =
      typeof options.clock ===
      'function'
        ? options.clock
        : () => new Date();

    this.thresholds =
      resolveThresholds(
        options
      );

    this.weights = {
      model:
        normalizeWeight(
          options.weights?.model,
          DEFAULT_WEIGHTS.model
        ),
      rules:
        normalizeWeight(
          options.weights?.rules,
          DEFAULT_WEIGHTS.rules
        ),
      velocity:
        normalizeWeight(
          options.weights?.velocity,
          DEFAULT_WEIGHTS.velocity
        ),
    };

    this.modelName =
      boundedText(
        options.modelName,
        150
      ) || null;

    this.modelVersion =
      boundedText(
        options.modelVersion,
        50
      ) || null;

    this.initialized = false;
    this.initializingPromise =
      null;

    this.metrics = {
      assessments:
        0,
      successful:
        0,
      partial:
        0,
      insufficientEvidence:
        0,
      failures:
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
      blockedRecommendations:
        0,
      escalations:
        0,
      reviews:
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
        if (
          this.featureStore &&
          typeof this
            .featureStore
            .initialize ===
            'function'
        ) {
          await this.featureStore.initialize(
            context
          );
        }

        if (
          this.decisionExplainer &&
          typeof this
            .decisionExplainer
            .initialize ===
            'function'
        ) {
          await this.decisionExplainer.initialize(
            context
          );
        }

        if (
          this.repository &&
          typeof this.repository.initialize ===
            'function'
        ) {
          await this.repository.initialize(
            context
          );
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

    return this
      .initializingPromise;
  }

  async destroy(
    context = {}
  ) {
    const dependencies = [
      this.repository,
      this.decisionExplainer,
      this.featureStore,
    ];

    for (const dependency of dependencies) {
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
          'Airtel fraud model dependency shutdown failed'
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
      normalizeFeatureInput(
        input
      );

    if (
      direct.length
    ) {
      return {
        features: direct,
        source:
          'INPUT',
        partial: false,
      };
    }

    if (
      !this.featureStore
    ) {
      return {
        features: [],
        source:
          'NONE',
        partial: true,
        missingEvidence: [
          'featureStore',
        ],
      };
    }

    try {
      const entityId =
        normalizeId(
          input.entityId ||
            input.memberId ||
            input.customerId ||
            input.subjectId
        );

      let record = null;

      if (
        entityId &&
        typeof this
          .featureStore
          .getLatest ===
          'function'
      ) {
        record =
          await this.featureStore.getLatest(
            {
              tenantId:
                resolveTenantId(
                  input,
                  context
                ),
              provider:
                this.provider,
              entityId,
              entityType:
                input.entityType,
              featureGroup:
                input.featureGroup ||
                'fraud',
              includeMetadata:
                false,
            },
            {
              ...context,
              tenantId:
                resolveTenantId(
                  input,
                  context
                ),
            }
          );
      }

      if (
        !record &&
        input.featureRecordId &&
        typeof this
          .featureStore
          .get ===
          'function'
      ) {
        record =
          await this.featureStore.get(
            {
              tenantId:
                resolveTenantId(
                  input,
                  context
                ),
              featureRecordId:
                input.featureRecordId,
            },
            {
              ...context,
              tenantId:
                resolveTenantId(
                  input,
                  context
                ),
            }
          );
      }

      if (
        !record
      ) {
        return {
          features: [],
          source:
            'FEATURE_STORE',
          partial: true,
          missingEvidence: [
            'fraud_features',
          ],
        };
      }

      return {
        features:
          normalizeFeatureInput(
            {
              features:
                record.features,
            }
          ),
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
        partial:
          record.status !==
          'ACTIVE',
        missingEvidence:
          record.status ===
          'ACTIVE'
            ? []
            : [
                'fresh_feature_state',
              ],
      };
    } catch (error) {
      this.logger.warn?.(
        {
          err: error,
        },
        'Airtel fraud feature-store lookup failed'
      );

      return {
        features: [],
        source:
          'FEATURE_STORE',
        partial: true,
        missingEvidence: [
          'featureStoreUnavailable',
        ],
      };
    }
  }

  async invokeModel(
    input,
    features,
    context = {}
  ) {
    if (
      !this.modelAdapter
    ) {
      return normalizeModelResult(
        null
      );
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
      transactionId:
        normalizeId(
          input.transactionId
        ),
      eventId:
        normalizeId(
          input.eventId
        ),
      entityId:
        normalizeId(
          input.entityId ||
            input.memberId ||
            input.customerId ||
            input.subjectId
        ),
      features:
        features.map(
          (feature) => ({
            key:
              feature.key,
            type:
              feature.type,
            value:
              feature.value,
            source:
              feature.source,
            quality:
              feature.quality,
            confidence:
              feature.confidence,
            observedAt:
              feature.observedAt,
            currency:
              feature.currency,
          })
        ),
      modelName:
        this.modelName,
      modelVersion:
        this.modelVersion,
      metadata:
        sanitizeMetadata(
          input.metadata
        ),
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
        typeof this.modelAdapter.score ===
        'function'
      ) {
        result =
          await this.modelAdapter.score(
            payload,
            context
          );
      } else if (
        typeof this.modelAdapter.assess ===
        'function'
      ) {
        result =
          await this.modelAdapter.assess(
            payload,
            context
          );
      } else if (
        typeof this.modelAdapter.evaluate ===
        'function'
      ) {
        result =
          await this.modelAdapter.evaluate(
            payload,
            context
          );
      } else {
        return normalizeModelResult(
          null
        );
      }

      return normalizeModelResult(
        result
      );
    } catch (error) {
      this.metrics.modelFailures +=
        1;

      this.logger.warn?.(
        {
          err: error,
          provider:
            this.provider,
        },
        'Airtel fraud model invocation failed'
      );

      return {
        status:
          MODEL_STATUS.DEGRADED,
        score: null,
        probability:
          null,
        modelVersion:
          this.modelVersion,
        modelName:
          this.modelName,
        reasons: [
          'Fraud model invocation failed.',
        ],
        signals: [],
        metadata: {},
      };
    }
  }

  buildAssessment(
    input = {},
    context = {},
    resolved = {}
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

    const features =
      resolved.features ||
      [];

    const featureQuality =
      evaluateFeatureQuality(
        features,
        this.clock(),
        {
          maxFeatureAgeMs:
            input.maxFeatureAgeMs ||
            LIMITS.MAX_FEATURE_AGE_MS,
        }
      );

    const rules =
      evaluateRules(
        features
      );

    const ruleSignals =
      signalsFromRules(
        rules
      );

    const model =
      resolved.model ||
      normalizeModelResult(
        null
      );

    const modelScore =
      model.score !== null
        ? model.score
        : model.probability !==
              null
          ? model.probability *
            100
          : null;

    const ruleScore =
      aggregateRuleScore(
        rules
      );

    const velocityScore =
      aggregateVelocityScore(
        rules
      );

    const evidenceScore =
      calculateEvidenceQuality(
        features,
        rules,
        model,
        input
      );

    const score =
      combineScores(
        modelScore,
        ruleScore,
        velocityScore,
        featureQuality.score,
        {
          weights:
            this.weights,
        }
      );

    const thresholds =
      resolveThresholds(
        {
          thresholds:
            {
              ...this.thresholds,
              ...(input.thresholds ||
                {}),
            },
        }
      );

    const contradictions =
      sanitizeArray(
        input.contradictions,
        (item) =>
          boundedText(
            item,
            500
          ),
        50
      );

    const riskLevel =
      deriveRiskLevel(
        score,
        evidenceScore,
        thresholds
      );

    const modelAvailable =
      model.status ===
      MODEL_STATUS.AVAILABLE;

    const decision =
      deriveDecision(
        score,
        riskLevel,
        evidenceScore,
        modelAvailable,
        rules,
        thresholds,
        {
          contradictions,
        }
      );

    const assessmentStatus =
      score === null
        ? ASSESSMENT_STATUS.INSUFFICIENT_EVIDENCE
        : (
              featureQuality.quality ===
                'LOW' ||
              model.status ===
                MODEL_STATUS.DEGRADED ||
              resolved.partial ||
              contradictions.length > 0
            )
          ? ASSESSMENT_STATUS.PARTIAL
          : ASSESSMENT_STATUS.COMPLETED;

    const assessmentId =
      buildAssessmentId(
        tenantId,
        input,
        features
      );

    const featureHash =
      fingerprint(
        features.map(
          (feature) => ({
            key:
              feature.key,
            type:
              feature.type,
            value:
              feature.value,
            observedAt:
              feature.observedAt,
          })
        )
      );

    const signals = [
      ...ruleSignals,
      ...model.signals,
    ]
      .filter(Boolean)
      .slice(
        0,
        LIMITS.MAX_SIGNALS
      );

    const reasons =
      unique([
        ...model.reasons,
        ...rules.map(
          (rule) =>
            rule.reason
        ),
        ...featureQuality.reasons,
        ...(
          resolved.missingEvidence ||
          []
        ),
      ]).slice(
        0,
        LIMITS.MAX_EVIDENCE
      );

    return {
      assessmentId,
      tenantId,
      provider:
        normalizeProvider(
          input.provider ||
            this.provider
        ),
      correlationId,
      transactionId:
        normalizeId(
          input.transactionId
        ),
      eventId:
        normalizeId(
          input.eventId
        ),
      entityType:
        boundedText(
          input.entityType,
          50
        )?.toUpperCase() ||
        null,
      entityId:
        normalizeId(
          input.entityId ||
            input.memberId ||
            input.customerId ||
            input.subjectId
        ),
      reference:
        normalizeId(
          input.reference ||
            input.providerReference
        ),
      currency:
        normalizeCurrency(
          input.currency
        ),
      amountMinor:
        normalizeMoneyMinor(
          input.amountMinor ??
            input.amount
        ),
      score,
      probability:
        score !== null
          ? clamp(
              score / 100,
              0,
              1
            )
          : null,
      riskLevel,
      decision,
      status:
        assessmentStatus,
      model: {
        status:
          model.status,
        modelName:
          model.modelName ||
          this.modelName,
        modelVersion:
          model.modelVersion ||
          this.modelVersion,
        score:
          model.score,
        probability:
          model.probability,
        reasons:
          model.reasons,
      },
      rules: rules.map(
        (rule) => ({
          code:
            rule.code,
          title:
            rule.title,
          score:
            rule.score,
          severity:
            rule.severity,
          reason:
            rule.reason,
          signalType:
            rule.signalType,
          evidence:
            rule.evidence,
        })
      ),
      signals,
      evidenceQuality: {
        score:
          evidenceScore,
        featureQuality:
          featureQuality.quality,
        staleCount:
          featureQuality.staleCount,
        invalidCount:
          featureQuality.invalidCount,
        featureCount:
          features.length,
      },
      featureContext: {
        featureRecordId:
          normalizeId(
            resolved.featureRecordId
          ),
        featureHash:
          normalizeId(
            resolved.featureHash
          ) ||
          featureHash,
        source:
          resolved.source ||
          'INPUT',
      },
      reasons,
      contradictions,
      missingEvidence:
        unique([
          ...(resolved.missingEvidence ||
            []),
          ...(score === null
            ? [
                'fraud_score',
              ]
            : []),
        ]).slice(
          0,
          100
        ),
      thresholds,
      weights:
        this.weights,
      advisoryOnly: true,
      financialAuthority:
        false,
      paymentAuthority:
        false,
      settlementAuthority:
        false,
      ledgerAuthority:
        false,
      complianceAuthority:
        false,
      assessedAt:
        this.clock().toISOString(),
      modelLineage: {
        engine:
          this.name,
        engineVersion:
          '1.0',
        modelName:
          model.modelName ||
          this.modelName ||
          null,
        modelVersion:
          model.modelVersion ||
          this.modelVersion ||
          null,
        featureHash,
      },
      metadata:
        sanitizeMetadata(
          input.metadata
        ),
    };
  }

  async assess(
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
      const idempotencyKey =
        normalizeId(
          input.idempotencyKey ||
            context.idempotencyKey
        );

      if (
        idempotencyKey &&
        this.repository &&
        typeof this.repository.findOne ===
          'function'
      ) {
        const existing =
          await this.repository.findOne(
            {
              tenantId,
              idempotencyKey,
            },
            {
              ...context,
              tenantId,
              correlationId,
            }
          );

        if (existing) {
          return {
            assessment:
              sanitizeAssessment(
                existing
              ),
            persisted:
              true,
            idempotentReplay:
              true,
            correlationId,
          };
        }
      }

      const resolved =
        await this.resolveFeatures(
          input,
          {
            ...context,
            tenantId,
            correlationId,
          }
        );

      const model =
        await this.invokeModel(
          input,
          resolved.features,
          {
            ...context,
            tenantId,
            correlationId,
          }
        );

      const assessment =
        this.buildAssessment(
          {
            ...input,
            idempotencyKey,
          },
          {
            ...context,
            tenantId,
            correlationId,
          },
          {
            ...resolved,
            model,
          }
        );

      if (
        idempotencyKey
      ) {
        assessment.idempotencyKey =
          idempotencyKey;
      }

      const explanation =
        await this.generateExplanation(
          assessment,
          context
        );

      if (
        explanation
      ) {
        assessment.explanation =
          explanation;
      }

      let persistence = {
        persisted:
          false,
        reason:
          'REPOSITORY_UNAVAILABLE',
      };

      if (
        this.repository
      ) {
        persistence =
          await this.persist(
            assessment,
            {
              ...context,
              tenantId,
              correlationId,
            }
          );
      }

      const event =
        await this.emitAssessmentEvent(
          assessment,
          {
            ...context,
            tenantId,
            correlationId,
          }
        );

      const audit =
        await this.audit(
          'AIRTEL_FRAUD_ASSESSMENT',
          assessment,
          {
            ...context,
            tenantId,
            correlationId,
          }
        );

      this.metrics.assessments +=
        1;

      if (
        assessment.status ===
        ASSESSMENT_STATUS.COMPLETED
      ) {
        this.metrics.successful +=
          1;
      } else if (
        assessment.status ===
        ASSESSMENT_STATUS.PARTIAL
      ) {
        this.metrics.partial +=
          1;
      } else {
        this.metrics.insufficientEvidence +=
          1;
      }

      switch (
        assessment.decision
      ) {
        case DECISIONS.BLOCK_RECOMMENDATION:
          this.metrics
            .blockedRecommendations +=
            1;
          break;

        case DECISIONS.ESCALATE:
          this.metrics.escalations +=
            1;
          break;

        case DECISIONS.REVIEW:
          this.metrics.reviews +=
            1;
          break;

        default:
          break;
      }

      return {
        assessment:
          sanitizeAssessment(
            assessment
          ),
        persisted:
          persistence.persisted,
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
        'Airtel fraud assessment failed'
      );

      throw error;
    }
  }

  async assessTransaction(
    input = {},
    context = {}
  ) {
    return this.assess(
      {
        ...input,
        transactionId:
          input.transactionId ||
          input.id,
      },
      context
    );
  }

  async assessCallback(
    input = {},
    context = {}
  ) {
    return this.assess(
      {
        ...input,
        eventId:
          input.eventId ||
          input.callbackId,
      },
      context
    );
  }

  async assessBatch(
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
        input.records
      )
        ? input.records
        : Array.isArray(
            input.items
          )
          ? input.items
          : [];

    const bounded =
      records.slice(
        0,
        LIMITS.MAX_BATCH
      );

    const results = [];
    const failures = [];

    for (const [
      index,
      record,
    ] of bounded.entries()) {
      try {
        const result =
          await this.assess(
            {
              ...record,
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
              'FRAUD_ASSESSMENT_FAILED',
            message:
              boundedText(
                error.message,
                500
              ),
          },
        });
      }
    }

    return {
      tenantId,
      count:
        results.length,
      results,
      failures,
      truncated:
        records.length >
        bounded.length,
    };
  }

  async generateExplanation(
    assessment,
    context = {}
  ) {
    if (
      !this.decisionExplainer
    ) {
      return null;
    }

    try {
      if (
        typeof this
          .decisionExplainer
          .explainRisk ===
        'function'
      ) {
        return await this
          .decisionExplainer
          .explainRisk(
            {
              tenantId:
                assessment.tenantId,
              correlationId:
                assessment.correlationId,
              decisionId:
                assessment.assessmentId,
              decision:
                assessment.decision,
              advisoryOnly: true,
              amount:
                assessment.amountMinor,
              amountMinor:
                assessment.amountMinor,
              currency:
                assessment.currency,
              riskLevel:
                assessment.riskLevel,
              confidence:
                assessment.evidenceQuality
                  ?.score !==
                null
                  ? assessment
                      .evidenceQuality
                      .score /
                    100
                  : null,
              reason:
                assessment.reasons
                  ?.slice(
                    0,
                    5
                  )
                  .join(
                    ' '
                  ),
              evidence:
                assessment.signals.map(
                  (signal) => ({
                    type:
                      signal.signalType,
                    name:
                      signal.name,
                    score:
                      signal.score,
                    severity:
                      signal.severity,
                    reason:
                      signal.reason,
                  })
                ),
              contradictions:
                assessment.contradictions,
              missingEvidence:
                assessment.missingEvidence,
              fraud: {
                score:
                  assessment.score,
                probability:
                  assessment.probability,
                model:
                  assessment.model,
              },
              model:
                assessment.model,
              policy: {
                thresholds:
                  assessment.thresholds,
              },
              metadata: {
                source:
                  'airtel.fraudModelEngine',
                assessmentId:
                  assessment.assessmentId,
              },
            },
            context
          );
      }

      if (
        typeof this
          .decisionExplainer
          .explainDecision ===
        'function'
      ) {
        return await this
          .decisionExplainer
          .explainDecision(
            {
              tenantId:
                assessment.tenantId,
              correlationId:
                assessment.correlationId,
              decisionId:
                assessment.assessmentId,
              decision:
                assessment.decision,
              explanationType:
                'FRAUD',
              advisoryOnly: true,
              riskLevel:
                assessment.riskLevel,
              confidence:
                assessment
                  .evidenceQuality
                  .score / 100,
              evidence:
                assessment.signals,
              contradictions:
                assessment.contradictions,
              missingEvidence:
                assessment.missingEvidence,
              facts: {
                score:
                  assessment.score,
                riskLevel:
                  assessment.riskLevel,
              },
              model:
                assessment.model,
              policy: {
                thresholds:
                  assessment.thresholds,
              },
              metadata: {
                source:
                  'airtel.fraudModelEngine',
              },
            },
            context
          );
      }
    } catch (error) {
      this.logger.warn?.(
        {
          err: error,
          assessmentId:
            assessment.assessmentId,
        },
        'Airtel fraud explanation generation failed'
      );
    }

    return null;
  }

  async persist(
    assessment,
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
        assessment,
        context
      );

    const record = {
      ...sanitizeAssessment(
        assessment
      ),
      tenantId,
      provider:
        assessment.provider,
      advisoryOnly: true,
    };

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
              assessmentId:
                assessment.assessmentId,
            },
            record,
            {
              ...context,
              tenantId,
            }
          );

        return {
          persisted:
            true,
          mode:
            'upsert',
          result:
            sanitizeRepositoryResult(
              result
            ),
        };
      }

      if (
        typeof this.repository.create ===
        'function'
      ) {
        result =
          await this.repository.create(
            record,
            {
              ...context,
              tenantId,
            }
          );

        return {
          persisted:
            true,
          mode:
            'create',
          result:
            sanitizeRepositoryResult(
              result
            ),
        };
      }

      if (
        typeof this.repository.insert ===
        'function'
      ) {
        result =
          await this.repository.insert(
            record,
            {
              ...context,
              tenantId,
            }
          );

        return {
          persisted:
            true,
          mode:
            'insert',
          result:
            sanitizeRepositoryResult(
              result
            ),
        };
      }

      return {
        persisted:
          false,
        reason:
          'UNSUPPORTED_REPOSITORY_INTERFACE',
      };
    } catch (error) {
      this.metrics.repositoryFailures +=
        1;

      this.logger.error?.(
        {
          err: error,
          tenantId,
          assessmentId:
            assessment.assessmentId,
        },
        'Airtel fraud assessment persistence failed'
      );

      throw error;
    }
  }

  async getById(
    assessmentId,
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
        assessmentId
      );

    if (!id) {
      const error = new Error(
        'assessmentId is required.'
      );

      error.code =
        'ASSESSMENT_ID_REQUIRED';

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
            assessmentId:
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

    return sanitizeAssessment(
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
        Number.isInteger(
          Number(
            input.page
          )
        )
          ? Number(
              input.page
            )
          : 1
      );

    const pageSize =
      Math.min(
        LIMITS.MAX_HISTORY,
        Math.max(
          1,
          Number.isInteger(
            Number(
              input.pageSize ||
                input.limit
            )
          )
            ? Number(
                input.pageSize ||
                  input.limit
              )
            : 25
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

    let result = [];

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

  async emitAssessmentEvent(
    assessment,
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
        'airtel.fraud.assessment.completed',
      occurredAt:
        this.clock().toISOString(),
      tenantId:
        assessment.tenantId,
      provider:
        assessment.provider,
      correlationId:
        assessment.correlationId,
      advisoryOnly:
        true,
      payload: {
        assessmentId:
          assessment.assessmentId,
        transactionId:
          assessment.transactionId,
        eventId:
          assessment.eventId,
        entityId:
          assessment.entityId,
        score:
          assessment.score,
        probability:
          assessment.probability,
        riskLevel:
          assessment.riskLevel,
        decision:
          assessment.decision,
        status:
          assessment.status,
        modelName:
          assessment.model
            ?.modelName ||
          null,
        modelVersion:
          assessment.model
            ?.modelVersion ||
          null,
        signalCount:
          assessment.signals
            .length,
        ruleCount:
          assessment.rules
            .length,
        evidenceQuality:
          assessment.evidenceQuality
            ?.score ??
          null,
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
            assessment.tenantId,
          assessmentId:
            assessment.assessmentId,
        },
        'Airtel fraud assessment event publication failed'
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
    assessment,
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
        assessment.tenantId,
      provider:
        assessment.provider,
      correlationId:
        assessment.correlationId,
      assessmentId:
        assessment.assessmentId,
      transactionId:
        assessment.transactionId,
      eventId:
        assessment.eventId,
      score:
        assessment.score,
      riskLevel:
        assessment.riskLevel,
      decision:
        assessment.decision,
      status:
        assessment.status,
      modelName:
        assessment.model
          ?.modelName ||
        null,
      modelVersion:
        assessment.model
          ?.modelVersion ||
        null,
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
          action,
          assessmentId:
            assessment.assessmentId,
        },
        'Airtel fraud assessment audit write failed'
      );

      return {
        recorded:
          false,
        reason:
          'AUDIT_WRITE_FAILED',
      };
    }
  }

  explainDecision(
    assessment
  ) {
    if (
      !assessment
    ) {
      return null;
    }

    const topSignals =
      [...(
        assessment.signals ||
        []
      )]
        .filter(
          (signal) =>
            signal &&
            Number.isFinite(
              signal.score
            )
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        )
        .slice(
          0,
          5
        );

    let narrative;

    switch (
      assessment.decision
    ) {
      case DECISIONS.BLOCK_RECOMMENDATION:
        narrative =
          'Fraud intelligence produced a high-risk advisory requiring review by the authoritative payment/policy workflow.';
        break;

      case DECISIONS.ESCALATE:
        narrative =
          'Fraud intelligence identified elevated or critical risk indicators requiring escalation.';
        break;

      case DECISIONS.REVIEW:
        narrative =
          'Fraud intelligence identified signals requiring additional review before an operational decision.';
        break;

      case DECISIONS.ALLOW:
        narrative =
          'Available intelligence did not exceed the configured review thresholds.';
        break;

      default:
        narrative =
          'Available fraud evidence was insufficient for a confident advisory assessment.';
        break;
    }

    return {
      assessmentId:
        assessment.assessmentId,
      decision:
        assessment.decision,
      riskLevel:
        assessment.riskLevel,
      score:
        assessment.score,
      probability:
        assessment.probability,
      evidenceQuality:
        assessment
          .evidenceQuality,
      narrative,
      topSignals,
      model:
        assessment.model,
      rules:
        assessment.rules
          ?.slice(
            0,
            10
          ),
      contradictions:
        assessment.contradictions ||
        [],
      missingEvidence:
        assessment.missingEvidence ||
        [],
      advisoryOnly:
        true,
      financialAuthority:
        false,
      paymentAuthority:
        false,
      settlementAuthority:
        false,
      ledgerAuthority:
        false,
    };
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
        'Fraud assessment repository is not configured.'
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
        'No statistical/ML fraud model adapter is configured; deterministic rules remain available.'
      );
    }

    if (
      !this.initialized
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'Fraud model engine has not been initialized.'
      );
    }

    if (
      this.metrics.failures > 0
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'One or more fraud assessments have failed.'
      );
    }

    if (
      this.metrics.modelFailures > 0
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'One or more model invocations have failed.'
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
      modelStatus:
        modelAvailable
          ? MODEL_STATUS.AVAILABLE
          : MODEL_STATUS.UNAVAILABLE,
      advisoryOnly:
        true,
      financialAuthority:
        false,
      paymentAuthority:
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
        decisionExplainer:
          Boolean(
            this.decisionExplainer
          ),
      },
      degradedReasons,
      metrics: {
        ...this.metrics,
      },
      thresholds: {
        ...this.thresholds,
      },
      weights: {
        ...this.weights,
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
        'airtel.intelligence.fraudModelEngine',
      architecture: {
        governedRiskScoring:
          true,
        deterministicRules:
          true,
        modelAdapter:
          true,
        featureStore:
          true,
        explainability:
          true,
        tenantAware:
          true,
        boundedInputs:
          true,
        sanitizedOutputs:
          true,
        exactMoneyRepresentation:
          true,
        bigintMoneyRepresentation:
          true,
        protectedAttributeExclusion:
          true,
        advisoryOnly:
          true,
        paymentAuthority:
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
      model: {
        name:
          this.modelName,
        version:
          this.modelVersion,
      },
      thresholds: {
        ...this.thresholds,
      },
      weights: {
        ...this.weights,
      },
      metrics: {
        ...this.metrics,
      },
      health:
        this.getHealth(),
    };
  }

  capabilities() {
    return {
      fraudAssessment:
        true,
      transactionAssessment:
        true,
      callbackAssessment:
        true,
      batchAssessment:
        true,
      deterministicRules:
        true,
      mlModelAdapter:
        true,
      featureStoreIntegration:
        true,
      explainability:
        Boolean(
          this.decisionExplainer
        ),
      persistence:
        Boolean(
          this.repository
        ),
      audit:
        Boolean(
          this.auditLogger
        ),
      events:
        Boolean(
          this.eventBus
        ),
      tenantIsolation:
        true,
      exactMoneyRepresentation:
        true,
      protectedAttributeExclusion:
        true,
      advisoryOnly:
        true,
      paymentAuthorization:
        false,
      paymentExecution:
        false,
      balanceMutation:
        false,
      ledgerMutation:
        false,
      settlement:
        false,
      reconciliationAuthority:
        false,
      autonomousBlocking:
        false,
      complianceDecisioning:
        false,
      providerHttp:
        false,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Repository adapter                                                         */
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

/* -------------------------------------------------------------------------- */
/* Output sanitization                                                        */
/* -------------------------------------------------------------------------- */

function sanitizeAssessment(
  assessment
) {
  if (
    !assessment ||
    !isPlainObject(
      assessment
    )
  ) {
    return null;
  }

  return {
    assessmentId:
      normalizeId(
        assessment.assessmentId
      ),
    tenantId:
      normalizeId(
        assessment.tenantId
      ),
    provider:
      normalizeProvider(
        assessment.provider
      ),
    correlationId:
      normalizeId(
        assessment.correlationId
      ),
    transactionId:
      normalizeId(
        assessment.transactionId
      ),
    eventId:
      normalizeId(
        assessment.eventId
      ),
    entityType:
      boundedText(
        assessment.entityType,
        50
      ),
    entityId:
      normalizeId(
        assessment.entityId
      ),
    reference:
      normalizeId(
        assessment.reference
      ),
    currency:
      normalizeCurrency(
        assessment.currency
      ),
    amountMinor:
      normalizeMoneyMinor(
        assessment.amountMinor
      ),
    score:
      normalizeScore(
        assessment.score
      ),
    probability:
      normalizeProbability(
        assessment.probability
      ),
    riskLevel:
      boundedText(
        assessment.riskLevel,
        30
      )?.toUpperCase() ||
      RISK_LEVELS.UNKNOWN,
    decision:
      boundedText(
        assessment.decision,
        50
      )?.toUpperCase() ||
      DECISIONS.INSUFFICIENT_EVIDENCE,
    status:
      boundedText(
        assessment.status,
        50
      )?.toUpperCase() ||
      ASSESSMENT_STATUS.FAILED,
    model:
      isPlainObject(
        assessment.model
      )
        ? {
            status:
              boundedText(
                assessment
                  .model
                  .status,
                30
              )?.toUpperCase() ||
              MODEL_STATUS.UNAVAILABLE,
            modelName:
              boundedText(
                assessment
                  .model
                  .modelName,
                150
              ),
            modelVersion:
              boundedText(
                assessment
                  .model
                  .modelVersion,
                50
              ),
            score:
              normalizeScore(
                assessment
                  .model
                  .score
              ),
            probability:
              normalizeProbability(
                assessment
                  .model
                  .probability
              ),
            reasons:
              sanitizeArray(
                assessment
                  .model
                  .reasons,
                (reason) =>
                  boundedText(
                    reason,
                    LIMITS.MAX_REASON_LENGTH
                  ),
                50
              ),
          }
        : {
            status:
              MODEL_STATUS.UNAVAILABLE,
            modelName:
              null,
            modelVersion:
              null,
            score:
              null,
            probability:
              null,
            reasons: [],
          },
    rules:
      sanitizeArray(
        assessment.rules,
        (rule) => ({
          code:
            boundedText(
              rule.code,
              100
            )?.toUpperCase() ||
            'UNKNOWN',
          title:
            boundedText(
              rule.title,
              250
            ),
          score:
            normalizeScore(
              rule.score
            ),
          severity:
            normalizeSeverity(
              rule.severity
            ),
          reason:
            boundedText(
              rule.reason,
              LIMITS.MAX_REASON_LENGTH
            ),
          signalType:
            boundedText(
              rule.signalType,
              50
            )?.toUpperCase() ||
            SIGNAL_TYPES.UNKNOWN,
          evidence:
            sanitizeMetadata(
              rule.evidence
            ),
        }),
        LIMITS.MAX_RULE_RESULTS
      ),
    signals:
      sanitizeArray(
        assessment.signals,
        normalizeSignal,
        LIMITS.MAX_SIGNALS
      ),
    evidenceQuality:
      isPlainObject(
        assessment.evidenceQuality
      )
        ? {
            score:
              clamp(
                assessment
                  .evidenceQuality
                  .score,
                0,
                100
              ),
            featureQuality:
              boundedText(
                assessment
                  .evidenceQuality
                  .featureQuality,
                30
              )?.toUpperCase() ||
              'UNKNOWN',
            staleCount:
              Math.max(
                0,
                Number(
                  assessment
                    .evidenceQuality
                    .staleCount
                ) || 0
              ),
            invalidCount:
              Math.max(
                0,
                Number(
                  assessment
                    .evidenceQuality
                    .invalidCount
                ) || 0
              ),
            featureCount:
              Math.max(
                0,
                Number(
                  assessment
                    .evidenceQuality
                    .featureCount
                ) || 0
              ),
          }
        : {
            score: 0,
            featureQuality:
              'UNKNOWN',
            staleCount: 0,
            invalidCount: 0,
            featureCount: 0,
          },
    featureContext:
      isPlainObject(
        assessment.featureContext
      )
        ? {
            featureRecordId:
              normalizeId(
                assessment
                  .featureContext
                  .featureRecordId
              ),
            featureHash:
              normalizeId(
                assessment
                  .featureContext
                  .featureHash
              ),
            source:
              boundedText(
                assessment
                  .featureContext
                  .source,
                50
              )?.toUpperCase() ||
              'UNKNOWN',
          }
        : null,
    reasons:
      sanitizeArray(
        assessment.reasons,
        (reason) =>
          boundedText(
            reason,
            LIMITS.MAX_REASON_LENGTH
          ),
        LIMITS.MAX_EVIDENCE
      ),
    contradictions:
      sanitizeArray(
        assessment.contradictions,
        (item) =>
          boundedText(
            item,
            500
          ),
        50
      ),
    missingEvidence:
      sanitizeArray(
        assessment.missingEvidence,
        (item) =>
          boundedText(
            item,
            300
          ),
        100
      ),
    thresholds:
      isPlainObject(
        assessment.thresholds
      )
        ? {
            review:
              clamp(
                assessment
                  .thresholds
                  .review,
                0,
                100
              ),
            escalate:
              clamp(
                assessment
                  .thresholds
                  .escalate,
                0,
                100
              ),
            blockRecommendation:
              clamp(
                assessment
                  .thresholds
                  .blockRecommendation,
                0,
                100
              ),
            critical:
              clamp(
                assessment
                  .thresholds
                  .critical,
                0,
                100
              ),
            minimumEvidenceScore:
              clamp(
                assessment
                  .thresholds
                  .minimumEvidenceScore,
                0,
                100
              ),
          }
        : null,
    advisoryOnly:
      true,
    financialAuthority:
      false,
    paymentAuthority:
      false,
    settlementAuthority:
      false,
    ledgerAuthority:
      false,
    complianceAuthority:
      false,
    explanation:
      assessment.explanation
        ? sanitizeExplanation(
            assessment.explanation
          )
        : null,
    modelLineage:
      isPlainObject(
        assessment.modelLineage
      )
        ? sanitizeMetadata(
            assessment.modelLineage
          )
        : null,
    idempotencyKey:
      normalizeId(
        assessment.idempotencyKey
      ),
    assessedAt:
      normalizeTimestamp(
        assessment.assessedAt
      ),
    metadata:
      sanitizeMetadata(
        assessment.metadata
      ),
  };
}

function sanitizeExplanation(
  explanation
) {
  if (
    !isPlainObject(
      explanation
    )
  ) {
    return null;
  }

  return {
    explanationId:
      normalizeId(
        explanation.explanationId
      ),
    decision:
      boundedText(
        explanation.decision,
        50
      )?.toUpperCase() ||
      null,
    riskLevel:
      boundedText(
        explanation.riskLevel,
        30
      )?.toUpperCase() ||
      null,
    narrative:
      boundedText(
        explanation.narrative,
        2000
      ),
    advisoryOnly:
      true,
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
    typeof result ===
      'string' ||
    typeof result ===
      'number' ||
    typeof result ===
      'boolean'
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
      isSecretKey(
        key
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
          sanitizeAssessment
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
        sanitizeAssessment
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
/* Factory / singleton                                                        */
/* -------------------------------------------------------------------------- */

let defaultInstance =
  null;

function createFraudModelEngine(
  options = {}
) {
  return new FraudModelEngine(
    options
  );
}

function getFraudModelEngine(
  options = {}
) {
  if (
    !defaultInstance
  ) {
    defaultInstance =
      new FraudModelEngine(
        options
      );
  }

  return defaultInstance;
}

async function resetFraudModelEngine() {
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
/* Public helper exports                                                      */
/* -------------------------------------------------------------------------- */

function scoreFeatureRules(
  features
) {
  const normalized =
    normalizeFeatureInput(
      {
        features,
      }
    );

  const rules =
    evaluateRules(
      normalized
    );

  return {
    score:
      aggregateRuleScore(
        rules
      ),
    rules,
    signals:
      signalsFromRules(
        rules
      ),
  };
}

function calculateFraudScore(
  input = {},
  options = {}
) {
  const features =
    normalizeFeatureInput(
      input
    );

  const rules =
    evaluateRules(
      features
    );

  const featureQuality =
    evaluateFeatureQuality(
      features,
      new Date(),
      options
    );

  const modelScore =
    normalizeScore(
      input.modelScore
    );

  const ruleScore =
    aggregateRuleScore(
      rules
    );

  const velocityScore =
    aggregateVelocityScore(
      rules
    );

  const score =
    combineScores(
      modelScore,
      ruleScore,
      velocityScore,
      featureQuality.score,
      {
        weights:
          {
            ...DEFAULT_WEIGHTS,
            ...(options.weights ||
              {}),
          },
      }
    );

  const thresholds =
    resolveThresholds(
      options
    );

  const evidenceScore =
    calculateEvidenceQuality(
      features,
      rules,
      {
        score:
          modelScore,
          probability:
            input.modelProbability,
          status:
            modelScore === null
              ? MODEL_STATUS.UNAVAILABLE
              : MODEL_STATUS.AVAILABLE,
      },
      input
    );

  const riskLevel =
    deriveRiskLevel(
      score,
      evidenceScore,
      thresholds
    );

  return {
    score,
    probability:
      score !== null
        ? score / 100
        : null,
    riskLevel,
    evidenceScore,
    ruleScore,
    velocityScore,
    modelScore,
    featureQuality,
    advisoryOnly:
      true,
  };
}

/* -------------------------------------------------------------------------- */
/* Module exports                                                             */
/* -------------------------------------------------------------------------- */

module.exports =
  FraudModelEngine;

module.exports.FraudModelEngine =
  FraudModelEngine;

module.exports.createFraudModelEngine =
  createFraudModelEngine;

module.exports.getFraudModelEngine =
  getFraudModelEngine;

module.exports.resetFraudModelEngine =
  resetFraudModelEngine;

module.exports.PROVIDER =
  PROVIDER;

module.exports.DECISIONS =
  DECISIONS;

module.exports.RISK_LEVELS =
  RISK_LEVELS;

module.exports.SIGNAL_TYPES =
  SIGNAL_TYPES;

module.exports.ASSESSMENT_STATUS =
  ASSESSMENT_STATUS;

module.exports.MODEL_STATUS =
  MODEL_STATUS;

module.exports.LIMITS =
  LIMITS;

module.exports.DEFAULT_THRESHOLDS =
  DEFAULT_THRESHOLDS;

module.exports.DEFAULT_WEIGHTS =
  DEFAULT_WEIGHTS;

module.exports.normalizeFeature =
  normalizeFeature;

module.exports.normalizeFeatureInput =
  normalizeFeatureInput;

module.exports.evaluateFeatureQuality =
  evaluateFeatureQuality;

module.exports.evaluateRules =
  evaluateRules;

module.exports.scoreFeatureRules =
  scoreFeatureRules;

module.exports.calculateFraudScore =
  calculateFraudScore;

module.exports.normalizeModelResult =
  normalizeModelResult;

module.exports.normalizeSignal =
  normalizeSignal;

module.exports.sanitizeAssessment =
  sanitizeAssessment;