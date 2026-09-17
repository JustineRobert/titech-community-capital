'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Intelligence Learning Engine
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/learningEngine.js
 *
 * Architectural Role:
 *   Governed learning, feedback, model-evaluation and intelligence-improvement
 *   boundary for the Airtel payment intelligence stack.
 *
 * Responsibilities:
 *   - Record model/intelligence recommendations and observed outcomes.
 *   - Correlate predictions with later authoritative outcomes where available.
 *   - Measure model performance using bounded, explainable metrics.
 *   - Track false-positive / false-negative style outcome patterns when the
 *     required ground truth exists.
 *   - Track feature and score distribution drift.
 *   - Maintain model/version lineage.
 *   - Produce retraining candidates and learning recommendations.
 *   - Store model feedback and evaluation summaries through repositories.
 *   - Integrate with featureStore and optional model adapters.
 *   - Provide batch evaluation and feedback ingestion.
 *   - Support replay-safe/idempotent feedback processing.
 *   - Emit sanitized learning events and audit records.
 *   - Expose health, diagnostics and governance capabilities.
 *
 * Explicitly NOT Responsible For:
 *   - Payment authorization.
 *   - Payment execution.
 *   - Fraud blocking.
 *   - Settlement.
 *   - Reconciliation authority.
 *   - Ledger posting.
 *   - Balance mutation.
 *   - Loan approval.
 *   - AML/KYC decisions.
 *   - Regulatory determinations.
 *   - Direct provider API communication.
 *   - Automatic production model replacement.
 *   - Automatic production threshold replacement.
 *   - Autonomous financial operations.
 *
 * Governance Principles:
 *   - Learning from an outcome requires identifiable ground truth or an
 *     explicitly marked weak/observational outcome.
 *   - Model output is evidence, not certainty.
 *   - Training/evaluation artifacts are tenant-aware.
 *   - Protected or sensitive demographic/health attributes are not accepted as
 *     learning features.
 *   - Learning feedback cannot silently modify production fraud thresholds.
 *   - Production model promotion requires an external approval/governance
 *     boundary.
 *   - Drift detection creates an alert/recommendation, not an automatic model
 *     deployment.
 *   - Monetary values are preserved as exact strings/minor units.
 *   - Number is not used for monetary arithmetic.
 *   - Sensitive credentials, secrets, tokens, signatures and raw provider
 *     payloads are never stored.
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

const OUTCOME_TYPES = Object.freeze({
  FRAUD_CONFIRMED: 'FRAUD_CONFIRMED',
  FRAUD_NOT_CONFIRMED: 'FRAUD_NOT_CONFIRMED',
  CUSTOMER_DISPUTED: 'CUSTOMER_DISPUTED',
  TRANSACTION_REVERSED: 'TRANSACTION_REVERSED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
  MANUAL_REVIEW_CONFIRMED: 'MANUAL_REVIEW_CONFIRMED',
  MANUAL_REVIEW_CLEARED: 'MANUAL_REVIEW_CLEARED',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  FALSE_NEGATIVE: 'FALSE_NEGATIVE',
  UNKNOWN: 'UNKNOWN',
});

const OUTCOME_QUALITY = Object.freeze({
  VERIFIED: 'VERIFIED',
  AUTHORITATIVE: 'AUTHORITATIVE',
  REVIEWED: 'REVIEWED',
  OBSERVATIONAL: 'OBSERVATIONAL',
  WEAK: 'WEAK',
  UNKNOWN: 'UNKNOWN',
});

const FEEDBACK_TYPES = Object.freeze({
  PREDICTION: 'PREDICTION',
  OUTCOME: 'OUTCOME',
  LABEL_CORRECTION: 'LABEL_CORRECTION',
  MODEL_EVALUATION: 'MODEL_EVALUATION',
  DRIFT: 'DRIFT',
  THRESHOLD_REVIEW: 'THRESHOLD_REVIEW',
});

const LEARNING_STATUS = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  PARTIAL: 'PARTIAL',
  REJECTED: 'REJECTED',
  PENDING_REVIEW: 'PENDING_REVIEW',
});

const DRIFT_STATUS = Object.freeze({
  STABLE: 'STABLE',
  WATCH: 'WATCH',
  DRIFT: 'DRIFT',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
});

const PROMOTION_STATUS = Object.freeze({
  NOT_EVALUATED: 'NOT_EVALUATED',
  CANDIDATE: 'CANDIDATE',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  APPROVED_EXTERNALLY: 'APPROVED_EXTERNALLY',
});

const LIMITS = Object.freeze({
  MAX_FEATURES: 500,
  MAX_FEEDBACK_BATCH: 250,
  MAX_OUTCOMES: 250,
  MAX_SIGNALS: 200,
  MAX_HISTORY: 250,
  MAX_METRIC_KEYS: 100,
  MAX_STRING_LENGTH: 1000,
  MAX_REASON_LENGTH: 1500,
  MAX_METADATA_KEYS: 40,
  MAX_METADATA_VALUE_LENGTH: 500,
  MAX_CATEGORY_LENGTH: 100,
  MAX_FEATURE_KEY_LENGTH: 150,
  MAX_MODEL_NAME_LENGTH: 150,
  MAX_MODEL_VERSION_LENGTH: 80,
  MAX_WINDOW_POINTS: 366,
  MAX_RETRAIN_SAMPLES: 100000,
  MAX_AGE_MS: 365 * 24 * 60 * 60 * 1000,
  DEFAULT_DRIFT_THRESHOLD: 0.20,
  DEFAULT_MIN_EVALUATION_SAMPLES: 25,
  DEFAULT_MIN_DRIFT_SAMPLES: 50,
});

const DEFAULT_GOVERNANCE = Object.freeze({
  minEvaluationSamples:
    LIMITS.DEFAULT_MIN_EVALUATION_SAMPLES,
  minDriftSamples:
    LIMITS.DEFAULT_MIN_DRIFT_SAMPLES,
  driftThreshold:
    LIMITS.DEFAULT_DRIFT_THRESHOLD,
  maxTrainingSampleCount:
    LIMITS.MAX_RETRAIN_SAMPLES,
  minimumGroundTruthQuality:
    OUTCOME_QUALITY.REVIEWED,
  automaticPromotion:
    false,
  automaticThresholdMutation:
    false,
});

/* Never permit these classes into model-learning features. */
const PROTECTED_FEATURE_PATTERNS = [
  /race/i,
  /ethnicity/i,
  /religion/i,
  /gender/i,
  /sex/i,
  /sexual/i,
  /age/i,
  /disability/i,
  /health/i,
  /medical/i,
  /genetic/i,
  /biometric/i,
  /nationality/i,
  /political/i,
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

function normalizeScore(value) {
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
    100,
    Math.max(0, number)
  );
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

  return Math.min(
    1,
    Math.max(0, number)
  );
}

function normalizeConfidence(value) {
  return normalizeProbability(value);
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

function isSecretKey(key) {
  return SECRET_KEY_PATTERNS.some(
    (pattern) =>
      pattern.test(String(key))
  );
}

function isProtectedFeatureKey(key) {
  return PROTECTED_FEATURE_PATTERNS.some(
    (pattern) =>
      pattern.test(String(key))
  );
}

function stableStringify(value) {
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

  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(value))
    .digest('hex');
}

function unique(values) {
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

function average(values) {
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
      (sum, value) =>
        sum + value,
      0
    ) /
    valid.length
  );
}

function percentage(
  numerator,
  denominator
) {
  const n = Number(numerator);
  const d = Number(denominator);

  if (
    !Number.isFinite(n) ||
    !Number.isFinite(d) ||
    d <= 0
  ) {
    return null;
  }

  return (
    Math.round(
      (n / d) * 10000
    ) / 100
  );
}

function deleteUndefined(object) {
  for (const key of Object.keys(object)) {
    if (
      object[key] === undefined
    ) {
      delete object[key];
    }
  }

  return object;
}

function sanitizeMetadata(value) {
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
      output[key] =
        rawValue.slice(
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
  limit = LIMITS.MAX_HISTORY
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

/* -------------------------------------------------------------------------- */
/* Tenant / request context                                                   */
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

  const candidate =
    candidates.find(
      (value) =>
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ''
    );

  return candidate
    ? String(candidate)
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
        'Tenant context is required for learning operations.'
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
      LIMITS.MAX_FEATURE_KEY_LENGTH
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

  let value;

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
      } else {
        return null;
      }
      break;

    case 'INTEGER': {
      const integer =
        normalizeInteger(
          raw.value
        );

      if (
        integer === null
      ) {
        return null;
      }

      value =
        integer.toString();
      break;
    }

    case 'MONEY_MINOR': {
      const money =
        normalizeMoneyMinor(
          raw.value
        );

      if (
        money === null
      ) {
        return null;
      }

      value = money;
      break;
    }

    case 'PROBABILITY': {
      const probability =
        normalizeProbability(
          raw.value
        );

      if (
        probability === null
      ) {
        return null;
      }

      value = probability;
      break;
    }

    case 'NUMBER':
    case 'SCORE': {
      const number =
        Number(raw.value);

      if (
        !Number.isFinite(
          number
        )
      ) {
        return null;
      }

      value = number;
      break;
    }

    default:
      value =
        boundedText(
          raw.value,
          LIMITS.MAX_STRING_LENGTH
        );

      if (
        value === null
      ) {
        return null;
      }
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
      normalizeConfidence(
        raw.confidence
      ),
    observedAt:
      normalizeTimestamp(
        raw.observedAt
      ),
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

function normalizeFeatures(
  values
) {
  const normalized = [];
  const seen = new Set();

  for (const raw of (
    Array.isArray(values)
      ? values
      : []
  ).slice(
    0,
    LIMITS.MAX_FEATURES
  )) {
    const feature =
      normalizeFeature(
        raw
      );

    if (
      !feature ||
      seen.has(feature.key)
    ) {
      continue;
    }

    seen.add(
      feature.key
    );
    normalized.push(
      feature
    );
  }

  return normalized;
}

/* -------------------------------------------------------------------------- */
/* Prediction / outcome normalization                                         */
/* -------------------------------------------------------------------------- */

function normalizePrediction(
  input = {}
) {
  return {
    predictionId:
      normalizeId(
        input.predictionId ||
          input.assessmentId
      ),
    decision:
      boundedText(
        input.decision,
        80
      )?.toUpperCase() ||
      null,
    riskLevel:
      boundedText(
        input.riskLevel,
        30
      )?.toUpperCase() ||
      null,
    score:
      normalizeScore(
        input.score
      ),
    probability:
      normalizeProbability(
        input.probability
      ),
    modelName:
      boundedText(
        input.modelName,
        LIMITS.MAX_MODEL_NAME_LENGTH
      ),
    modelVersion:
      boundedText(
        input.modelVersion,
        LIMITS.MAX_MODEL_VERSION_LENGTH
      ),
    featureHash:
      normalizeId(
        input.featureHash
      ),
    assessedAt:
      normalizeTimestamp(
        input.assessedAt ||
          input.createdAt
      ),
  };
}

function normalizeOutcome(
  input = {}
) {
  const type =
    boundedText(
      input.type ||
        input.outcomeType,
      80
    )?.toUpperCase() ||
    OUTCOME_TYPES.UNKNOWN;

  const validTypes =
    Object.values(
      OUTCOME_TYPES
    );

  return {
    outcomeId:
      normalizeId(
        input.outcomeId ||
          input.id
      ) ||
      crypto.randomUUID(),
    type:
      validTypes.includes(
        type
      )
        ? type
        : OUTCOME_TYPES.UNKNOWN,
    quality:
      boundedText(
        input.quality ||
          input.outcomeQuality,
        40
      )?.toUpperCase() ||
      OUTCOME_QUALITY.UNKNOWN,
    confirmed:
      typeof input.confirmed ===
      'boolean'
        ? input.confirmed
        : inferOutcomeTruth(
            type
          ),
    label:
      boundedText(
        input.label,
        100
      )?.toUpperCase() ||
      null,
    source:
      boundedText(
        input.source,
        100
      ),
    authority:
      boundedText(
        input.authority,
        100
      ),
    observedAt:
      normalizeTimestamp(
        input.observedAt ||
          input.createdAt
      ),
    reason:
      boundedText(
        input.reason ||
          input.notes,
        LIMITS.MAX_REASON_LENGTH
      ),
    reference:
      normalizeId(
        input.reference ||
          input.transactionId ||
          input.eventId
      ),
    metadata:
      sanitizeMetadata(
        input.metadata
      ),
  };
}

function inferOutcomeTruth(
  outcomeType
) {
  switch (
    outcomeType
  ) {
    case OUTCOME_TYPES.FRAUD_CONFIRMED:
    case OUTCOME_TYPES.FALSE_NEGATIVE:
      return true;

    case OUTCOME_TYPES.FRAUD_NOT_CONFIRMED:
    case OUTCOME_TYPES.FALSE_POSITIVE:
    case OUTCOME_TYPES.MANUAL_REVIEW_CLEARED:
      return false;

    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Feature / prediction quality                                                */
/* -------------------------------------------------------------------------- */

function assessFeatureQuality(
  features,
  now = new Date(),
  options = {}
) {
  if (
    !features.length
  ) {
    return {
      score: 0,
      quality: 'LOW',
      freshCount: 0,
      staleCount: 0,
      invalidCount: 0,
      reasons: [
        'No usable learning features were supplied.',
      ],
    };
  }

  const maxAge =
    Number.isFinite(
      Number(
        options.maxFeatureAgeMs
      )
    )
      ? Math.max(
          1,
          Number(
            options.maxFeatureAgeMs
          )
        )
      : LIMITS.MAX_AGE_MS;

  let freshCount = 0;
  let staleCount = 0;
  let invalidCount = 0;

  for (const feature of features) {
    const observed =
      new Date(
        feature.observedAt
      ).getTime();

    if (
      !Number.isFinite(
        observed
      )
    ) {
      invalidCount += 1;
      continue;
    }

    if (
      now.getTime() -
        observed <=
      maxAge
    ) {
      freshCount += 1;
    } else {
      staleCount += 1;
    }
  }

  const total =
    features.length;

  const validRatio =
    (total -
      invalidCount) /
    total;

  const freshRatio =
    freshCount /
    total;

  const score =
    clamp(
      validRatio *
        60 +
        freshRatio *
          40,
      0,
      100
    );

  let quality =
    'HIGH';

  if (
    score <
    50
  ) {
    quality =
      'LOW';
  } else if (
    score <
    80
  ) {
    quality =
      'MEDIUM';
  }

  const reasons = [];

  if (
    staleCount
  ) {
    reasons.push(
      `${staleCount} feature(s) are stale.`
    );
  }

  if (
    invalidCount
  ) {
    reasons.push(
      `${invalidCount} feature(s) are invalid.`
    );
  }

  return {
    score,
    quality,
    freshCount,
    staleCount,
    invalidCount,
    reasons,
  };
}

/* -------------------------------------------------------------------------- */
/* Ground-truth governance                                                    */
/* -------------------------------------------------------------------------- */

function qualityRank(
  quality
) {
  const ranks = {
    [OUTCOME_QUALITY.UNKNOWN]: 0,
    [OUTCOME_QUALITY.WEAK]: 1,
    [OUTCOME_QUALITY.OBSERVATIONAL]: 2,
    [OUTCOME_QUALITY.REVIEWED]: 3,
    [OUTCOME_QUALITY.AUTHORITATIVE]: 4,
    [OUTCOME_QUALITY.VERIFIED]: 5,
  };

  return (
    ranks[
      quality
    ] ?? 0
  );
}

function isUsableGroundTruth(
  outcome,
  governance
) {
  const minimumRank =
    qualityRank(
      governance.minimumGroundTruthQuality
    );

  return (
    Boolean(outcome) &&
    outcome.confirmed !==
      null &&
    qualityRank(
      outcome.quality
    ) >= minimumRank
  );
}

function groundTruthStatus(
  outcome,
  governance
) {
  if (
    !outcome ||
    outcome.confirmed ===
      null
  ) {
    return {
      usable: false,
      status:
        LEARNING_STATUS.PENDING_REVIEW,
      reason:
        'No explicit ground truth is available.',
    };
  }

  if (
    !isUsableGroundTruth(
      outcome,
      governance
    )
  ) {
    return {
      usable: false,
      status:
        LEARNING_STATUS.PENDING_REVIEW,
      reason:
        'Outcome quality does not meet the configured learning threshold.',
    };
  }

  return {
    usable: true,
    status:
      LEARNING_STATUS.ACCEPTED,
    reason: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Performance evaluation                                                     */
/* -------------------------------------------------------------------------- */

function predictionToBinary(
  prediction
) {
  if (
    prediction?.decision ===
      'BLOCK_RECOMMENDATION' ||
    prediction?.decision ===
      'ESCALATE' ||
    prediction?.decision ===
      'REVIEW' ||
    prediction?.riskLevel ===
      'HIGH' ||
    prediction?.riskLevel ===
      'CRITICAL'
  ) {
    return 1;
  }

  if (
    prediction?.decision ===
      'ALLOW' ||
    prediction?.riskLevel ===
      'LOW'
  ) {
    return 0;
  }

  if (
    prediction?.probability !==
      null &&
    prediction?.probability !==
      undefined
  ) {
    return prediction.probability >=
      0.5
      ? 1
      : 0;
  }

  if (
    prediction?.score !==
      null &&
    prediction?.score !==
      undefined
  ) {
    return prediction.score >=
      50
      ? 1
      : 0;
  }

  return null;
}

function outcomeToBinary(
  outcome
) {
  if (
    !outcome ||
    outcome.confirmed ===
      null
  ) {
    return null;
  }

  switch (
    outcome.type
  ) {
    case OUTCOME_TYPES.FRAUD_CONFIRMED:
    case OUTCOME_TYPES.FALSE_NEGATIVE:
      return 1;

    case OUTCOME_TYPES.FRAUD_NOT_CONFIRMED:
    case OUTCOME_TYPES.FALSE_POSITIVE:
    case OUTCOME_TYPES.MANUAL_REVIEW_CLEARED:
      return 0;

    default:
      return outcome.confirmed
        ? 1
        : 0;
  }
}

function evaluatePredictionOutcome(
  prediction,
  outcome
) {
  const predicted =
    predictionToBinary(
      prediction
    );

  const actual =
    outcomeToBinary(
      outcome
    );

  if (
    predicted === null ||
    actual === null
  ) {
    return {
      evaluable: false,
      correct: null,
      classification:
        'UNRESOLVED',
    };
  }

  let classification;

  if (
    predicted === 1 &&
    actual === 1
  ) {
    classification =
      'TRUE_POSITIVE';
  } else if (
    predicted === 0 &&
    actual === 0
  ) {
    classification =
      'TRUE_NEGATIVE';
  } else if (
    predicted === 1 &&
    actual === 0
  ) {
    classification =
      'FALSE_POSITIVE';
  } else {
    classification =
      'FALSE_NEGATIVE';
  }

  return {
    evaluable: true,
    correct:
      predicted ===
      actual,
    classification,
    predicted,
    actual,
  };
}

function summarizeEvaluations(
  evaluations
) {
  const evaluated =
    evaluations.filter(
      (item) =>
        item?.evaluation
          ?.evaluable ===
        true
    );

  if (
    !evaluated.length
  ) {
    return {
      sampleCount: 0,
      accuracy: null,
      precision: null,
      recall: null,
      falsePositiveRate: null,
      falseNegativeRate: null,
      truePositive: 0,
      trueNegative: 0,
      falsePositive: 0,
      falseNegative: 0,
    };
  }

  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;

  for (const item of
    evaluated) {
    switch (
      item.evaluation
        .classification
    ) {
      case 'TRUE_POSITIVE':
        tp += 1;
        break;

      case 'TRUE_NEGATIVE':
        tn += 1;
        break;

      case 'FALSE_POSITIVE':
        fp += 1;
        break;

      case 'FALSE_NEGATIVE':
        fn += 1;
        break;

      default:
        break;
    }
  }

  return {
    sampleCount:
      evaluated.length,

    accuracy:
      percentage(
        tp + tn,
        evaluated.length
      ),

    precision:
      percentage(
        tp,
        tp + fp
      ),

    recall:
      percentage(
        tp,
        tp + fn
      ),

    falsePositiveRate:
      percentage(
        fp,
        fp + tn
      ),

    falseNegativeRate:
      percentage(
        fn,
        fn + tp
      ),

    truePositive:
      tp,

    trueNegative:
      tn,

    falsePositive:
      fp,

    falseNegative:
      fn,
  };
}

/* -------------------------------------------------------------------------- */
/* Score calibration / error analysis                                         */
/* -------------------------------------------------------------------------- */

function bucketScore(
  score
) {
  if (
    score === null ||
    score === undefined
  ) {
    return 'UNKNOWN';
  }

  if (
    score < 20
  ) {
    return '0_19';
  }

  if (
    score < 40
  ) {
    return '20_39';
  }

  if (
    score < 60
  ) {
    return '40_59';
  }

  if (
    score < 80
  ) {
    return '60_79';
  }

  return '80_100';
}

function buildScoreBuckets(
  evaluations
) {
  const buckets =
    {};

  for (const item of
    evaluations) {
    const score =
      item.prediction
        ?.score;

    const bucket =
      bucketScore(
        score
      );

    if (
      !buckets[bucket]
    ) {
      buckets[bucket] = {
        count: 0,
        correct: 0,
        falsePositive: 0,
        falseNegative: 0,
      };
    }

    buckets[bucket].count +=
      1;

    if (
      item.evaluation
        ?.correct ===
      true
    ) {
      buckets[bucket]
        .correct +=
        1;
    }

    if (
      item.evaluation
        ?.classification ===
      'FALSE_POSITIVE'
    ) {
      buckets[bucket]
        .falsePositive +=
        1;
    }

    if (
      item.evaluation
        ?.classification ===
      'FALSE_NEGATIVE'
    ) {
      buckets[bucket]
        .falseNegative +=
        1;
    }
  }

  return buckets;
}

/* -------------------------------------------------------------------------- */
/* Drift detection                                                            */
/* -------------------------------------------------------------------------- */

function numericValues(
  features,
  featureKey
) {
  return features
    .filter(
      (feature) =>
        feature?.key ===
        featureKey
    )
    .map(
      (feature) =>
        Number(
          feature.value
        )
    )
    .filter(
      (value) =>
        Number.isFinite(value)
    );
}

function calculateMean(
  values
) {
  return average(
    values
  );
}

function calculateDistributionDifference(
  baseline,
  current
) {
  if (
    !baseline.length ||
    !current.length
  ) {
    return null;
  }

  const baselineMean =
    calculateMean(
      baseline
    );

  const currentMean =
    calculateMean(
      current
    );

  if (
    baselineMean ===
      null ||
    currentMean ===
      null
  ) {
    return null;
  }

  const denominator =
    Math.max(
      Math.abs(
        baselineMean
      ),
      1
    );

  return Math.abs(
    currentMean -
      baselineMean
  ) / denominator;
}

function evaluateFeatureDrift(
  baselineFeatures,
  currentFeatures,
  options = {}
) {
  const baseline =
    normalizeFeatures(
      baselineFeatures
    );

  const current =
    normalizeFeatures(
      currentFeatures
    );

  if (
    baseline.length <
      Number(
        options.minDriftSamples ||
          LIMITS.DEFAULT_MIN_DRIFT_SAMPLES
      ) ||
    current.length <
      Number(
        options.minDriftSamples ||
          LIMITS.DEFAULT_MIN_DRIFT_SAMPLES
      )
  ) {
    return {
      status:
        DRIFT_STATUS.INSUFFICIENT_DATA,
      score: null,
      features: [],
      reason:
        'Insufficient feature observations for drift analysis.',
    };
  }

  const keys =
    unique([
      ...baseline.map(
        (feature) =>
          feature.key
      ),
      ...current.map(
        (feature) =>
          feature.key
      ),
    ]).slice(
      0,
      LIMITS.MAX_FEATURES
    );

  const threshold =
    clamp(
      options.driftThreshold ??
        LIMITS.DEFAULT_DRIFT_THRESHOLD,
      0.01,
      10
    );

  const results = [];

  for (const key of
    keys) {
    const baselineNumeric =
      numericValues(
        baseline,
        key
      );

    const currentNumeric =
      numericValues(
        current,
        key
      );

    if (
      baselineNumeric.length <
        5 ||
      currentNumeric.length <
        5
    ) {
      continue;
    }

    const difference =
      calculateDistributionDifference(
        baselineNumeric,
        currentNumeric
      );

    if (
      difference ===
      null
    ) {
      continue;
    }

    results.push({
      featureKey:
        key,
      baselineCount:
        baselineNumeric.length,
      currentCount:
        currentNumeric.length,
      baselineMean:
        calculateMean(
          baselineNumeric
        ),
      currentMean:
        calculateMean(
          currentNumeric
        ),
      relativeDifference:
        difference,
      drifted:
        difference >=
        threshold,
    });
  }

  const driftedCount =
    results.filter(
      (item) =>
        item.drifted
    ).length;

  const score =
    results.length
      ? clamp(
          (driftedCount /
            results.length) *
            100,
          0,
          100
        )
      : null;

  let status =
    DRIFT_STATUS.STABLE;

  if (
    !results.length
  ) {
    status =
      DRIFT_STATUS.INSUFFICIENT_DATA;
  } else if (
    driftedCount >=
    Math.ceil(
      results.length *
        0.5
    )
  ) {
    status =
      DRIFT_STATUS.DRIFT;
  } else if (
    driftedCount > 0
  ) {
    status =
      DRIFT_STATUS.WATCH;
  }

  return {
    status,
    score,
    featureCount:
      results.length,
    driftedCount,
    features:
      results.slice(
        0,
        LIMITS.MAX_FEATURES
      ),
    reason:
      driftedCount > 0
        ? `${driftedCount} feature(s) exceeded the configured drift threshold.`
        : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Retraining candidate analysis                                              */
/* -------------------------------------------------------------------------- */

function buildRetrainingCandidate(
  evaluation,
  drift,
  governance,
  model
) {
  const sampleCount =
    evaluation.sampleCount;

  const sufficientEvaluation =
    sampleCount >=
    governance.minEvaluationSamples;

  const driftDetected =
    drift.status ===
      DRIFT_STATUS.DRIFT ||
    drift.status ===
      DRIFT_STATUS.WATCH;

  const errorRate =
    evaluation.accuracy !==
      null
      ? 100 -
        evaluation.accuracy
      : null;

  const materialError =
    errorRate !== null &&
    errorRate >= 15;

  let status =
    PROMOTION_STATUS.NOT_EVALUATED;

  const reasons = [];

  if (
    !sufficientEvaluation
  ) {
    status =
      PROMOTION_STATUS.REQUIRES_REVIEW;

    reasons.push(
      'Evaluation sample size is below the configured minimum.'
    );
  }

  if (
    materialError
  ) {
    reasons.push(
      'Observed evaluation error rate is materially elevated.'
    );
  }

  if (
    driftDetected
  ) {
    reasons.push(
      'Feature distribution drift requires review.'
    );
  }

  if (
    sufficientEvaluation &&
    (
      materialError ||
      driftDetected
    )
  ) {
    status =
      PROMOTION_STATUS.CANDIDATE;
  }

  if (
    !reasons.length &&
    sufficientEvaluation
  ) {
    status =
      PROMOTION_STATUS.REQUIRES_REVIEW;
  }

  return {
    status,
    candidate:
      status ===
      PROMOTION_STATUS.CANDIDATE,
    modelName:
      model?.modelName ||
      null,
    modelVersion:
      model?.modelVersion ||
      null,
    evaluationSamples:
      sampleCount,
    accuracy:
      evaluation.accuracy,
    errorRate,
    driftStatus:
      drift.status,
    reasons:
      reasons.slice(
        0,
        20
      ),
    automaticPromotion:
      false,
    automaticDeployment:
      false,
  };
}

/* -------------------------------------------------------------------------- */
/* Feedback normalization                                                     */
/* -------------------------------------------------------------------------- */

function normalizeFeedback(
  input = {}
) {
  const prediction =
    normalizePrediction(
      input.prediction ||
        input
    );

  const outcome =
    input.outcome
      ? normalizeOutcome(
          input.outcome
        )
      : null;

  const features =
    normalizeFeatures(
      input.features ||
        input.featureVector
    );

  return {
    feedbackId:
      normalizeId(
        input.feedbackId
      ) ||
      crypto.randomUUID(),
    feedbackType:
      boundedText(
        input.feedbackType ||
          FEEDBACK_TYPES.OUTCOME,
        50
      )?.toUpperCase() ||
      FEEDBACK_TYPES.OUTCOME,
    tenantId:
      normalizeId(
        input.tenantId
      ),
    provider:
      normalizeProvider(
        input.provider ||
          PROVIDER
      ),
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
    prediction,
    outcome,
    features,
    featureHash:
      normalizeId(
        input.featureHash
      ) ||
      (
        features.length
          ? fingerprint(
              features
            )
          : null
      ),
    observedAt:
      normalizeTimestamp(
        input.observedAt
      ),
    correlationId:
      normalizeId(
        input.correlationId
      ),
    idempotencyKey:
      normalizeId(
        input.idempotencyKey
      ),
    metadata:
      sanitizeMetadata(
        input.metadata
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Main engine                                                                */
/* -------------------------------------------------------------------------- */

class LearningEngine {
  constructor(options = {}) {
    this.name =
      'AirtelIntelligenceLearningEngine';

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
            ?.learning ||
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
        LIMITS.MAX_MODEL_NAME_LENGTH
      ) || null;

    this.modelVersion =
      boundedText(
        options.modelVersion,
        LIMITS.MAX_MODEL_VERSION_LENGTH
      ) || null;

    this.initialized =
      false;

    this.initializingPromise =
      null;

    this.metrics = {
      feedbackAccepted:
        0,
      feedbackPending:
        0,
      feedbackRejected:
        0,
      evaluations:
        0,
      evaluationFailures:
        0,
      driftChecks:
        0,
      driftDetections:
        0,
      retrainingCandidates:
        0,
      repositoryFailures:
        0,
      eventFailures:
        0,
      auditFailures:
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
        const dependencies = [
          this.featureStore,
          this.repository,
        ];

        for (const dependency of
          dependencies) {
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
          'Airtel learning dependency shutdown failed'
        );
      }
    }

    this.initialized =
      false;
  }

  async ingestFeedback(
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

    const feedback =
      normalizeFeedback(
        {
          ...input,
          tenantId,
          correlationId,
          provider:
            input.provider ||
            this.provider,
        }
      );

    const groundTruth =
      feedback.outcome
        ? groundTruthStatus(
            feedback.outcome,
            this.governance
          )
        : {
            usable: false,
            status:
              LEARNING_STATUS.PENDING_REVIEW,
            reason:
              'Outcome not supplied.',
          };

    let status =
      groundTruth.status;

    if (
      !feedback.prediction
        .predictionId &&
      !feedback.outcome
    ) {
      status =
        LEARNING_STATUS.REJECTED;
    }

    const evaluation =
      feedback.outcome &&
      feedback.prediction
        ? evaluatePredictionOutcome(
            feedback.prediction,
            feedback.outcome
          )
        : null;

    const record = {
      ...feedback,
      status,
      groundTruth,
      evaluation,
      advisoryOnly:
        true,
      createdAt:
        this.clock().toISOString(),
    };

    if (
      !groundTruth.usable &&
      feedback.outcome
    ) {
      this.metrics.feedbackPending +=
        1;
    } else if (
      status ===
      LEARNING_STATUS.ACCEPTED
    ) {
      this.metrics.feedbackAccepted +=
        1;
    } else {
      this.metrics.feedbackRejected +=
        1;
    }

    if (
      !this.repository
    ) {
      return {
        feedback:
          sanitizeFeedback(
            record
          ),
        persisted:
          false,
        status,
      };
    }

    try {
      let persisted;

      if (
        feedback.idempotencyKey &&
        typeof this.repository.findOne ===
          'function'
      ) {
        const existing =
          await this.repository.findOne(
            {
              tenantId,
              idempotencyKey:
                feedback.idempotencyKey,
            },
            {
              ...context,
              tenantId,
              correlationId,
            }
          );

        if (
          existing
        ) {
          return {
            feedback:
              sanitizeFeedback(
                existing
              ),
            persisted:
              true,
            idempotentReplay:
              true,
            status:
              existing.status ||
              status,
          };
        }
      }

      if (
        typeof this.repository.upsert ===
        'function'
      ) {
        persisted =
          await this.repository.upsert(
            {
              tenantId,
              feedbackId:
                feedback.feedbackId,
            },
            record,
            {
              ...context,
              tenantId,
              correlationId,
            }
          );
      } else if (
        typeof this.repository.create ===
        'function'
      ) {
        persisted =
          await this.repository.create(
            record,
            {
              ...context,
              tenantId,
              correlationId,
            }
          );
      } else if (
        typeof this.repository.insert ===
        'function'
      ) {
        persisted =
          await this.repository.insert(
            record,
            {
              ...context,
              tenantId,
              correlationId,
            }
          );
      } else {
        const error =
          new Error(
            'Learning repository does not support persistence.'
          );

        error.code =
          'UNSUPPORTED_REPOSITORY_INTERFACE';

        throw error;
      }

      await this.emitFeedbackEvent(
        persisted || record,
        context
      );

      await this.audit(
        'AIRTEL_LEARNING_FEEDBACK_INGESTED',
        persisted || record,
        context
      );

      return {
        feedback:
          sanitizeFeedback(
            persisted || record
          ),
        persisted:
          true,
        idempotentReplay:
          false,
        status,
      };
    } catch (error) {
      this.metrics.repositoryFailures +=
        1;

      this.logger.error?.(
        {
          err: error,
          tenantId,
          correlationId,
          feedbackId:
            feedback.feedbackId,
        },
        'Airtel learning feedback persistence failed'
      );

      throw error;
    }
  }

  async recordPrediction(
    input = {},
    context = {}
  ) {
    return this.ingestFeedback(
      {
        ...input,
        feedbackType:
          FEEDBACK_TYPES.PREDICTION,
      },
      context
    );
  }

  async recordOutcome(
    input = {},
    context = {}
  ) {
    return this.ingestFeedback(
      {
        ...input,
        feedbackType:
          FEEDBACK_TYPES.OUTCOME,
      },
      context
    );
  }

  async recordLabelCorrection(
    input = {},
    context = {}
  ) {
    const outcome =
      normalizeOutcome(
        input.outcome ||
          input
      );

    return this.ingestFeedback(
      {
        ...input,
        feedbackType:
          FEEDBACK_TYPES.LABEL_CORRECTION,
        outcome,
      },
      context
    );
  }

  async resolveFeatures(
    input = {},
    context = {}
  ) {
    const direct =
      normalizeFeatures(
        input.features ||
          input.featureVector
      );

    if (
      direct.length
    ) {
      return {
        features:
          direct,
        source:
          'INPUT',
        featureHash:
          fingerprint(
            direct
          ),
      };
    }

    if (
      !this.featureStore
    ) {
      return {
        features: [],
        source:
          'NONE',
        featureHash:
          null,
        partial:
          true,
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

    try {
      let record = null;

      if (
        entityId &&
        typeof this.featureStore
          .getLatest ===
          'function'
      ) {
        record =
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
                'fraud',
            },
            {
              ...context,
              tenantId,
            }
          );
      }

      if (
        !record &&
        input.featureRecordId &&
        typeof this.featureStore
          .get ===
          'function'
      ) {
        record =
          await this.featureStore.get(
            {
              tenantId,
              featureRecordId:
                input.featureRecordId,
            },
            {
              ...context,
              tenantId,
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
          featureHash:
            null,
          partial:
            true,
        };
      }

      const features =
        normalizeFeatures(
          record.features
        );

      return {
        features,
        source:
          'FEATURE_STORE',
        featureHash:
          normalizeId(
            record.featureHash
          ) ||
          fingerprint(
            features
          ),
        featureRecordId:
          normalizeId(
            record.featureRecordId
          ),
        partial:
          record.status !==
          'ACTIVE',
      };
    } catch (error) {
      this.logger.warn?.(
        {
          err: error,
          tenantId,
        },
        'Airtel learning feature-store lookup failed'
      );

      return {
        features: [],
        source:
          'FEATURE_STORE',
        featureHash:
          null,
        partial:
          true,
      };
    }
  }

  async evaluate(
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

    const feedback =
      Array.isArray(
        input.feedback
      )
        ? sanitizeArray(
            input.feedback,
            (item) =>
              normalizeFeedback(
                {
                  ...item,
                  tenantId,
                  correlationId,
                }
              ),
            LIMITS.MAX_FEEDBACK_BATCH
          )
        : [
            normalizeFeedback(
              {
                ...input,
                tenantId,
                correlationId,
              }
            ),
          ];

    const evaluations =
      [];

    for (const item of
      feedback) {
      if (
        !item.prediction ||
        !item.outcome
      ) {
        continue;
      }

      const truth =
        groundTruthStatus(
          item.outcome,
          this.governance
        );

      if (
        !truth.usable
      ) {
        continue;
      }

      const evaluation =
        evaluatePredictionOutcome(
          item.prediction,
          item.outcome
        );

      evaluations.push({
        feedbackId:
          item.feedbackId,
        prediction:
          item.prediction,
        outcome:
          item.outcome,
        evaluation,
      });
    }

    const summary =
      summarizeEvaluations(
        evaluations
      );

    const scoreBuckets =
      buildScoreBuckets(
        evaluations
      );

    const model = {
      modelName:
        boundedText(
          input.modelName ||
            this.modelName,
          LIMITS.MAX_MODEL_NAME_LENGTH
        ),
      modelVersion:
        boundedText(
          input.modelVersion ||
            this.modelVersion,
          LIMITS.MAX_MODEL_VERSION_LENGTH
        ),
    };

    const result = {
      evaluationId:
        normalizeId(
          input.evaluationId
        ) ||
        `evaluation:${tenantId}:${fingerprint(
          {
            model,
            summary,
            scoreBuckets,
          }
        ).slice(0, 32)}`,
      tenantId,
      provider:
        normalizeProvider(
          input.provider ||
            this.provider
        ),
      correlationId,
      model,
      summary,
      scoreBuckets,
      sampleQuality: {
        totalFeedback:
          feedback.length,
        evaluated:
          evaluations.length,
        excluded:
          Math.max(
            0,
            feedback.length -
              evaluations.length
          ),
        minimumRequired:
          this.governance
            .minEvaluationSamples,
        sufficient:
          evaluations.length >=
          this.governance
            .minEvaluationSamples,
      },
      advisoryOnly:
        true,
      evaluatedAt:
        this.clock().toISOString(),
    };

    this.metrics.evaluations +=
      1;

    if (
      !this.repository
    ) {
      return {
        evaluation:
          result,
        persisted:
          false,
      };
    }

    try {
      let persisted;

      if (
        typeof this.repository.upsert ===
        'function'
      ) {
        persisted =
          await this.repository.upsert(
            {
              tenantId,
              evaluationId:
                result.evaluationId,
            },
            result,
            {
              ...context,
              tenantId,
              correlationId,
            }
          );
      } else if (
        typeof this.repository.create ===
        'function'
      ) {
        persisted =
          await this.repository.create(
            result,
            {
              ...context,
              tenantId,
              correlationId,
            }
          );
      }

      return {
        evaluation:
          sanitizeEvaluation(
            persisted ||
              result
          ),
        persisted:
          Boolean(persisted),
      };
    } catch (error) {
      this.metrics.evaluationFailures +=
        1;

      this.logger.error?.(
        {
          err: error,
          tenantId,
          correlationId,
        },
        'Airtel learning evaluation persistence failed'
      );

      throw error;
    }
  }

  async evaluateModel(
    input = {},
    context = {}
  ) {
    return this.evaluate(
      input,
      context
    );
  }

  async detectDrift(
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

    const baseline =
      normalizeFeatures(
        input.baselineFeatures ||
          input.baseline
      );

    const current =
      normalizeFeatures(
        input.currentFeatures ||
          input.current
      );

    const drift =
      evaluateFeatureDrift(
        baseline,
        current,
        {
          driftThreshold:
            input.driftThreshold ??
            this.governance
              .driftThreshold,
          minDriftSamples:
            input.minDriftSamples ??
            this.governance
              .minDriftSamples,
        }
      );

    const result = {
      driftId:
        normalizeId(
          input.driftId
        ) ||
        `drift:${tenantId}:${fingerprint(
          {
            baseline,
            current,
          }
        ).slice(0, 32)}`,
      tenantId,
      provider:
        normalizeProvider(
          input.provider ||
            this.provider
        ),
      correlationId,
      modelName:
        boundedText(
          input.modelName ||
            this.modelName,
          LIMITS.MAX_MODEL_NAME_LENGTH
        ),
      modelVersion:
        boundedText(
          input.modelVersion ||
            this.modelVersion,
          LIMITS.MAX_MODEL_VERSION_LENGTH
        ),
      ...drift,
      baselineFeatureHash:
        baseline.length
          ? fingerprint(
              baseline
            )
          : null,
      currentFeatureHash:
        current.length
          ? fingerprint(
              current
            )
          : null,
      advisoryOnly:
        true,
      checkedAt:
        this.clock().toISOString(),
    };

    this.metrics.driftChecks +=
      1;

    if (
      drift.status ===
      DRIFT_STATUS.DRIFT
    ) {
      this.metrics.driftDetections +=
        1;
    }

    if (
      this.repository
    ) {
      try {
        if (
          typeof this.repository.upsert ===
          'function'
        ) {
          await this.repository.upsert(
            {
              tenantId,
              driftId:
                result.driftId,
            },
            result,
            {
              ...context,
              tenantId,
              correlationId,
            }
          );
        } else if (
          typeof this.repository.create ===
          'function'
        ) {
          await this.repository.create(
            result,
            {
              ...context,
              tenantId,
              correlationId,
            }
          );
        }
      } catch (error) {
        this.metrics.repositoryFailures +=
          1;

        this.logger.warn?.(
          {
            err: error,
            tenantId,
          },
          'Airtel learning drift persistence failed'
        );
      }
    }

    if (
      drift.status ===
      DRIFT_STATUS.DRIFT ||
      drift.status ===
      DRIFT_STATUS.WATCH
    ) {
      await this.emitDriftEvent(
        result,
        context
      );

      await this.audit(
        'AIRTEL_LEARNING_DRIFT_DETECTED',
        result,
        context
      );
    }

    return {
      drift:
        sanitizeDrift(
          result
        ),
      persisted:
        Boolean(
          this.repository
        ),
    };
  }

  async compareModels(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const baseline =
      sanitizeEvaluation(
        input.baseline
      );

    const candidate =
      sanitizeEvaluation(
        input.candidate
      );

    if (
      !baseline ||
      !candidate
    ) {
      const error =
        new Error(
          'Both baseline and candidate evaluations are required.'
        );

      error.code =
        'MODEL_COMPARISON_INPUT_REQUIRED';

      throw error;
    }

    const metricDelta =
      buildMetricDelta(
        baseline.summary,
        candidate.summary
      );

    const sufficient =
      Number(
        candidate.summary
          ?.sampleCount || 0
      ) >=
      this.governance
        .minEvaluationSamples;

    const improved =
      metricDelta.accuracyDelta !==
        null &&
      metricDelta.accuracyDelta >
        0;

    const regressed =
      metricDelta.accuracyDelta !==
        null &&
      metricDelta.accuracyDelta <
        0;

    const status =
      !sufficient
        ? PROMOTION_STATUS.REQUIRES_REVIEW
        : improved &&
            !regressed
          ? PROMOTION_STATUS.CANDIDATE
          : PROMOTION_STATUS.REQUIRES_REVIEW;

    return {
      comparisonId:
        `model-comparison:${tenantId}:${fingerprint(
          {
            baseline:
              baseline.model,
            candidate:
              candidate.model,
          }
        ).slice(0, 32)}`,
      tenantId,
      provider:
        this.provider,
      baselineModel:
        baseline.model,
      candidateModel:
        candidate.model,
      metricDelta,
      sufficientSample:
        sufficient,
      status,
      promotion:
        {
          automatic:
            false,
          requiresExternalApproval:
            true,
          status,
        },
      advisoryOnly:
        true,
      comparedAt:
        this.clock().toISOString(),
    };
  }

  buildLearningRecommendation(
    evaluation,
    drift,
    context = {}
  ) {
    const reasons = [];

    if (
      evaluation?.summary
        ?.falseNegativeRate !==
        null &&
      evaluation?.summary
        ?.falseNegativeRate >=
        10
    ) {
      reasons.push(
        'Observed false-negative rate warrants investigation.'
      );
    }

    if (
      evaluation?.summary
        ?.falsePositiveRate !==
        null &&
      evaluation?.summary
        ?.falsePositiveRate >=
        10
    ) {
      reasons.push(
        'Observed false-positive rate warrants investigation.'
      );
    }

    if (
      drift?.status ===
      DRIFT_STATUS.DRIFT
    ) {
      reasons.push(
        'Feature drift warrants feature and model review.'
      );
    }

    if (
      drift?.status ===
      DRIFT_STATUS.WATCH
    ) {
      reasons.push(
        'Feature drift should remain under observation.'
      );
    }

    const candidate =
      buildRetrainingCandidate(
        evaluation?.summary || {
          sampleCount: 0,
        },
        drift || {
          status:
            DRIFT_STATUS.INSUFFICIENT_DATA,
        },
        this.governance,
        evaluation?.model
      );

    if (
      candidate.candidate
    ) {
      this.metrics
        .retrainingCandidates +=
        1;
    }

    return {
      tenantId:
        resolveTenantId(
          context,
          context
        ),
      provider:
        this.provider,
      recommendationId:
        `learning-recommendation:${fingerprint(
          {
            evaluation:
              evaluation?.evaluationId,
            drift:
              drift?.driftId,
          }
        ).slice(0, 32)}`,
      candidate,
      reasons,
      advisoryOnly:
        true,
      executable:
        false,
      automaticPromotion:
        false,
      automaticDeployment:
        false,
      generatedAt:
        this.clock().toISOString(),
    };
  }

  async generateLearningPlan(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const evaluation =
      input.evaluation ||
      null;

    const drift =
      input.drift ||
      null;

    const recommendation =
      this.buildLearningRecommendation(
        evaluation,
        drift,
        {
          ...context,
          tenantId,
        }
      );

    return {
      planId:
        `learning-plan:${tenantId}:${fingerprint(
          {
            evaluation:
              evaluation?.evaluationId,
            drift:
              drift?.driftId,
          }
        ).slice(0, 32)}`,
      tenantId,
      provider:
        this.provider,
      evaluation:
        sanitizeEvaluation(
          evaluation
        ),
      drift:
        sanitizeDrift(
          drift
        ),
      recommendation,
      actions: [
        {
          code:
            'REVIEW_LABEL_QUALITY',
          enabled:
            Boolean(
              evaluation
            ),
          autonomous:
            false,
        },
        {
          code:
            'REVIEW_FEATURE_DRIFT',
          enabled:
            Boolean(
              drift
            ),
          autonomous:
            false,
        },
        {
          code:
            'RETRAIN_OFFLINE',
          enabled:
            recommendation
              .candidate
              ?.candidate ===
            true,
          autonomous:
            false,
        },
        {
          code:
            'VALIDATE_CANDIDATE_MODEL',
          enabled:
            recommendation
              .candidate
              ?.candidate ===
            true,
          autonomous:
            false,
        },
        {
          code:
            'EXTERNAL_APPROVAL_BEFORE_PROMOTION',
          enabled:
            true,
          autonomous:
            false,
        },
      ],
      approvalRequired:
        true,
      automaticDeployment:
        false,
      advisoryOnly:
        true,
      generatedAt:
        this.clock().toISOString(),
    };
  }

  async listFeedback(
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
          Number(input.page)
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

  async getFeedback(
    feedbackId,
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
        feedbackId
      );

    if (!id) {
      const error =
        new Error(
          'feedbackId is required.'
        );

      error.code =
        'FEEDBACK_ID_REQUIRED';

      throw error;
    }

    let result =
      null;

    if (
      typeof this.repository.findOne ===
      'function'
    ) {
      result =
        await this.repository.findOne(
          {
            tenantId,
            feedbackId:
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

    return sanitizeFeedback(
      result
    );
  }

  async emitFeedbackEvent(
    record,
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
        'airtel.learning.feedback.received',
      occurredAt:
        this.clock().toISOString(),
      tenantId:
        record.tenantId,
      provider:
        record.provider,
      correlationId:
        record.correlationId,
      advisoryOnly:
        true,
      payload: {
        feedbackId:
          record.feedbackId,
        feedbackType:
          record.feedbackType,
        status:
          record.status,
        predictionId:
          record.prediction
            ?.predictionId ||
          null,
        outcomeId:
          record.outcome
            ?.outcomeId ||
          null,
        modelName:
          record.prediction
            ?.modelName ||
          null,
        modelVersion:
          record.prediction
            ?.modelVersion ||
          null,
        groundTruthUsable:
          Boolean(
            record.groundTruth
              ?.usable
          ),
        evaluation:
          record.evaluation
            ?.classification ||
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
            record.tenantId,
          feedbackId:
            record.feedbackId,
        },
        'Airtel learning feedback event publication failed'
      );

      return {
        emitted:
          false,
        reason:
          'EVENT_PUBLICATION_FAILED',
      };
    }
  }

  async emitDriftEvent(
    record,
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
        'airtel.learning.feature.drift',
      occurredAt:
        this.clock().toISOString(),
      tenantId:
        record.tenantId,
      provider:
        record.provider,
      correlationId:
        record.correlationId,
      advisoryOnly:
        true,
      payload: {
        driftId:
          record.driftId,
        modelName:
          record.modelName,
        modelVersion:
          record.modelVersion,
        status:
          record.status,
        score:
          record.score,
        driftedCount:
          record.driftedCount,
        featureCount:
          record.featureCount,
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
            record.tenantId,
          driftId:
            record.driftId,
        },
        'Airtel learning drift event publication failed'
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
    record,
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
        record.tenantId,
      provider:
        record.provider ||
        this.provider,
      correlationId:
        record.correlationId ||
        null,
      feedbackId:
        record.feedbackId ||
        null,
      evaluationId:
        record.evaluationId ||
        null,
      driftId:
        record.driftId ||
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
          tenantId:
            record.tenantId,
        },
        'Airtel learning audit write failed'
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
        'Learning repository is not configured.'
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
      !this.initialized
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'Learning engine has not been initialized.'
      );
    }

    if (
      this.metrics.evaluationFailures >
      0
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'One or more model evaluations have failed.'
      );
    }

    if (
      this.metrics.repositoryFailures >
      0
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'One or more learning persistence operations have failed.'
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
      settlementAuthority:
        false,
      ledgerAuthority:
        false,
      complianceAuthority:
        false,
      governance: {
        ...this.governance,
        automaticPromotion:
          false,
        automaticThresholdMutation:
          false,
      },
      dependencies: {
        repository:
          repositoryAvailable,
        featureStore:
          featureStoreAvailable,
        modelAdapter:
          Boolean(
            this.modelAdapter
          ),
        eventBus:
          Boolean(
            this.eventBus
          ),
        auditLogger:
          Boolean(
            this.auditLogger
          ),
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
        'airtel.intelligence.learningEngine',
      model: {
        name:
          this.modelName,
        version:
          this.modelVersion,
      },
      architecture: {
        tenantAware:
          true,
        feedbackCapture:
          true,
        groundTruthGovernance:
          true,
        performanceEvaluation:
          true,
        scoreBucketAnalysis:
          true,
        driftDetection:
          true,
        retrainingCandidates:
          true,
        modelComparison:
          true,
        featureStoreIntegration:
          true,
        exactMoneyRepresentation:
          true,
        bigintMoneyRepresentation:
          true,
        protectedFeatureExclusion:
          true,
        boundedInputs:
          true,
        sanitizedOutputs:
          true,
        advisoryOnly:
          true,
        automaticModelPromotion:
          false,
        automaticThresholdMutation:
          false,
        automaticDeployment:
          false,
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
      governance: {
        ...this.governance,
        automaticPromotion:
          false,
        automaticThresholdMutation:
          false,
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
      feedback:
        true,
      outcomes:
        true,
      labelCorrection:
        true,
      modelEvaluation:
        true,
      driftDetection:
        true,
      modelComparison:
        true,
      learningPlan:
        true,
      retrainingCandidate:
        true,
      featureStoreIntegration:
        true,
      persistence:
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
      protectedFeatureExclusion:
        true,
      exactMoneyRepresentation:
        true,
      advisoryOnly:
        true,
      automaticRetraining:
        false,
      automaticModelPromotion:
        false,
      automaticThresholdMutation:
        false,
      automaticDeployment:
        false,
      paymentExecution:
        false,
      paymentAuthorization:
        false,
      fraudBlocking:
        false,
      balanceMutation:
        false,
      ledgerMutation:
        false,
      settlement:
        false,
      complianceDecisioning:
        false,
      providerHttp:
        false,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Comparison helpers                                                         */
/* -------------------------------------------------------------------------- */

function buildMetricDelta(
  baseline = {},
  candidate = {}
) {
  function delta(
    candidateValue,
    baselineValue
  ) {
    if (
      candidateValue ===
        null ||
      candidateValue ===
        undefined ||
      baselineValue ===
        null ||
      baselineValue ===
        undefined
    ) {
      return null;
    }

    return (
      Number(candidateValue) -
      Number(baselineValue)
    );
  }

  return {
    accuracyDelta:
      delta(
        candidate.accuracy,
        baseline.accuracy
      ),
    precisionDelta:
      delta(
        candidate.precision,
        baseline.precision
      ),
    recallDelta:
      delta(
        candidate.recall,
        baseline.recall
      ),
    falsePositiveRateDelta:
      delta(
        candidate.falsePositiveRate,
        baseline.falsePositiveRate
      ),
    falseNegativeRateDelta:
      delta(
        candidate.falseNegativeRate,
        baseline.falseNegativeRate
      ),
  };
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

function sanitizePrediction(
  prediction
) {
  if (
    !prediction ||
    !isPlainObject(
      prediction
    )
  ) {
    return null;
  }

  return {
    predictionId:
      normalizeId(
        prediction.predictionId
      ),
    decision:
      boundedText(
        prediction.decision,
        80
      )?.toUpperCase() ||
      null,
    riskLevel:
      boundedText(
        prediction.riskLevel,
        30
      )?.toUpperCase() ||
      null,
    score:
      normalizeScore(
        prediction.score
      ),
    probability:
      normalizeProbability(
        prediction.probability
      ),
    modelName:
      boundedText(
        prediction.modelName,
        LIMITS.MAX_MODEL_NAME_LENGTH
      ),
    modelVersion:
      boundedText(
        prediction.modelVersion,
        LIMITS.MAX_MODEL_VERSION_LENGTH
      ),
    featureHash:
      normalizeId(
        prediction.featureHash
      ),
    assessedAt:
      normalizeTimestamp(
        prediction.assessedAt
      ),
  };
}

function sanitizeOutcome(
  outcome
) {
  if (
    !outcome ||
    !isPlainObject(
      outcome
    )
  ) {
    return null;
  }

  return {
    outcomeId:
      normalizeId(
        outcome.outcomeId
      ),
    type:
      boundedText(
        outcome.type,
        80
      )?.toUpperCase() ||
      OUTCOME_TYPES.UNKNOWN,
    quality:
      boundedText(
        outcome.quality,
        40
      )?.toUpperCase() ||
      OUTCOME_QUALITY.UNKNOWN,
    confirmed:
      typeof outcome.confirmed ===
      'boolean'
        ? outcome.confirmed
        : null,
    label:
      boundedText(
        outcome.label,
        100
      )?.toUpperCase() ||
      null,
    source:
      boundedText(
        outcome.source,
        100
      ),
    authority:
      boundedText(
        outcome.authority,
        100
      ),
    observedAt:
      normalizeTimestamp(
        outcome.observedAt
      ),
    reason:
      boundedText(
        outcome.reason,
        LIMITS.MAX_REASON_LENGTH
      ),
    reference:
      normalizeId(
        outcome.reference
      ),
    metadata:
      sanitizeMetadata(
        outcome.metadata
      ),
  };
}

function sanitizeFeedback(
  feedback
) {
  if (
    !feedback ||
    !isPlainObject(
      feedback
    )
  ) {
    return null;
  }

  return {
    feedbackId:
      normalizeId(
        feedback.feedbackId
      ),
    feedbackType:
      boundedText(
        feedback.feedbackType,
        50
      )?.toUpperCase() ||
      FEEDBACK_TYPES.OUTCOME,
    tenantId:
      normalizeId(
        feedback.tenantId
      ),
    provider:
      normalizeProvider(
        feedback.provider
      ),
    transactionId:
      normalizeId(
        feedback.transactionId
      ),
    eventId:
      normalizeId(
        feedback.eventId
      ),
    entityId:
      normalizeId(
        feedback.entityId
      ),
    prediction:
      sanitizePrediction(
        feedback.prediction
      ),
    outcome:
      sanitizeOutcome(
        feedback.outcome
      ),
    featureHash:
      normalizeId(
        feedback.featureHash
      ),
    status:
      boundedText(
        feedback.status,
        50
      )?.toUpperCase() ||
      LEARNING_STATUS.PENDING_REVIEW,
    groundTruth:
      isPlainObject(
        feedback.groundTruth
      )
        ? {
            usable:
              Boolean(
                feedback.groundTruth
                  .usable
              ),
            status:
              boundedText(
                feedback.groundTruth
                  .status,
                50
              )?.toUpperCase() ||
              LEARNING_STATUS.PENDING_REVIEW,
            reason:
              boundedText(
                feedback.groundTruth
                  .reason,
                LIMITS.MAX_REASON_LENGTH
              ),
          }
        : null,
    evaluation:
      isPlainObject(
        feedback.evaluation
      )
        ? {
            evaluable:
              Boolean(
                feedback.evaluation
                  .evaluable
              ),
            correct:
              typeof feedback
                .evaluation
                .correct ===
              'boolean'
                ? feedback
                    .evaluation
                    .correct
                : null,
            classification:
              boundedText(
                feedback
                  .evaluation
                  .classification,
                50
              )?.toUpperCase() ||
              'UNRESOLVED',
          }
        : null,
    correlationId:
      normalizeId(
        feedback.correlationId
      ),
    idempotencyKey:
      normalizeId(
        feedback.idempotencyKey
      ),
    createdAt:
      normalizeTimestamp(
        feedback.createdAt
      ),
    metadata:
      sanitizeMetadata(
        feedback.metadata
      ),
    advisoryOnly:
      true,
  };
}

function sanitizeEvaluation(
  evaluation
) {
  if (
    !evaluation ||
    !isPlainObject(
      evaluation
    )
  ) {
    return null;
  }

  return {
    evaluationId:
      normalizeId(
        evaluation.evaluationId
      ),
    tenantId:
      normalizeId(
        evaluation.tenantId
      ),
    provider:
      normalizeProvider(
        evaluation.provider
      ),
    model:
      isPlainObject(
        evaluation.model
      )
        ? {
            modelName:
              boundedText(
                evaluation
                  .model
                  .modelName,
                LIMITS.MAX_MODEL_NAME_LENGTH
              ),
            modelVersion:
              boundedText(
                evaluation
                  .model
                  .modelVersion,
                LIMITS.MAX_MODEL_VERSION_LENGTH
              ),
          }
        : null,
    summary:
      sanitizeMetricSummary(
        evaluation.summary
      ),
    scoreBuckets:
      sanitizeMetadata(
        evaluation.scoreBuckets
      ),
    sampleQuality:
      isPlainObject(
        evaluation.sampleQuality
      )
        ? sanitizeMetadata(
            evaluation.sampleQuality
          )
        : null,
    evaluatedAt:
      normalizeTimestamp(
        evaluation.evaluatedAt
      ),
    advisoryOnly:
      true,
  };
}

function sanitizeMetricSummary(
  summary
) {
  if (
    !isPlainObject(summary)
  ) {
    return {
      sampleCount: 0,
      accuracy: null,
      precision: null,
      recall: null,
      falsePositiveRate:
        null,
      falseNegativeRate:
        null,
      truePositive: 0,
      trueNegative: 0,
      falsePositive: 0,
      falseNegative: 0,
    };
  }

  return {
    sampleCount:
      Math.max(
        0,
        Number(
          summary.sampleCount
        ) || 0
      ),
    accuracy:
      summary.accuracy ===
        null ||
      summary.accuracy ===
        undefined
        ? null
        : clamp(
            summary.accuracy,
            0,
            100
          ),
    precision:
      summary.precision ===
        null ||
      summary.precision ===
        undefined
        ? null
        : clamp(
            summary.precision,
            0,
            100
          ),
    recall:
      summary.recall ===
        null ||
      summary.recall ===
        undefined
        ? null
        : clamp(
            summary.recall,
            0,
            100
          ),
    falsePositiveRate:
      summary.falsePositiveRate ===
        null ||
      summary.falsePositiveRate ===
        undefined
        ? null
        : clamp(
            summary.falsePositiveRate,
            0,
            100
          ),
    falseNegativeRate:
      summary.falseNegativeRate ===
        null ||
      summary.falseNegativeRate ===
        undefined
        ? null
        : clamp(
            summary.falseNegativeRate,
            0,
            100
          ),
    truePositive:
      Math.max(
        0,
        Number(
          summary.truePositive
        ) || 0
      ),
    trueNegative:
      Math.max(
        0,
        Number(
          summary.trueNegative
        ) || 0
      ),
    falsePositive:
      Math.max(
        0,
        Number(
          summary.falsePositive
        ) || 0
      ),
    falseNegative:
      Math.max(
        0,
        Number(
          summary.falseNegative
        ) || 0
      ),
  };
}

function sanitizeDrift(
  drift
) {
  if (
    !drift ||
    !isPlainObject(
      drift
    )
  ) {
    return null;
  }

  return {
    driftId:
      normalizeId(
        drift.driftId
      ),
    tenantId:
      normalizeId(
        drift.tenantId
      ),
    provider:
      normalizeProvider(
        drift.provider
      ),
    modelName:
      boundedText(
        drift.modelName,
        LIMITS.MAX_MODEL_NAME_LENGTH
      ),
    modelVersion:
      boundedText(
        drift.modelVersion,
        LIMITS.MAX_MODEL_VERSION_LENGTH
      ),
    status:
      boundedText(
        drift.status,
        50
      )?.toUpperCase() ||
      DRIFT_STATUS.INSUFFICIENT_DATA,
    score:
      drift.score ===
        null ||
      drift.score ===
        undefined
        ? null
        : clamp(
            drift.score,
            0,
            100
          ),
    featureCount:
      Math.max(
        0,
        Number(
          drift.featureCount
        ) || 0
      ),
    driftedCount:
      Math.max(
        0,
        Number(
          drift.driftedCount
        ) || 0
      ),
    features:
      sanitizeArray(
        drift.features,
        (feature) => ({
          featureKey:
            boundedText(
              feature.featureKey,
              LIMITS.MAX_FEATURE_KEY_LENGTH
            ),
          baselineCount:
            Number(
              feature.baselineCount
            ) || 0,
          currentCount:
            Number(
              feature.currentCount
            ) || 0,
          baselineMean:
            Number.isFinite(
              Number(
                feature.baselineMean
              )
            )
              ? Number(
                  feature.baselineMean
                )
              : null,
          currentMean:
            Number.isFinite(
              Number(
                feature.currentMean
              )
            )
              ? Number(
                  feature.currentMean
                )
              : null,
          relativeDifference:
            Number.isFinite(
              Number(
                feature.relativeDifference
              )
            )
              ? Number(
                  feature.relativeDifference
                )
              : null,
          drifted:
            Boolean(
              feature.drifted
            ),
        }),
        LIMITS.MAX_FEATURES
      ),
    reason:
      boundedText(
        drift.reason,
        LIMITS.MAX_REASON_LENGTH
      ),
    advisoryOnly:
      true,
  };
}

function sanitizeListItem(
  item
) {
  if (
    item?.feedbackId
  ) {
    return sanitizeFeedback(
      item
    );
  }

  if (
    item?.evaluationId
  ) {
    return sanitizeEvaluation(
      item
    );
  }

  if (
    item?.driftId
  ) {
    return sanitizeDrift(
      item
    );
  }

  return sanitizeMetadata(
    item
  );
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
          sanitizeListItem
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
        sanitizeListItem
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

function createLearningEngine(
  options = {}
) {
  return new LearningEngine(
    options
  );
}

function getLearningEngine(
  options = {}
) {
  if (
    !defaultInstance
  ) {
    defaultInstance =
      new LearningEngine(
        options
      );
  }

  return defaultInstance;
}

async function resetLearningEngine() {
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
/* Public utility exports                                                     */
/* -------------------------------------------------------------------------- */

function evaluateOutcome(
  prediction,
  outcome
) {
  return evaluatePredictionOutcome(
    normalizePrediction(
      prediction
    ),
    normalizeOutcome(
      outcome
    )
  );
}

function summarizeModelPerformance(
  evaluations
) {
  return summarizeEvaluations(
    Array.isArray(
      evaluations
    )
      ? evaluations
      : []
  );
}

function detectFeatureDrift(
  baseline,
  current,
  options = {}
) {
  return evaluateFeatureDrift(
    baseline,
    current,
    options
  );
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

module.exports =
  LearningEngine;

module.exports.LearningEngine =
  LearningEngine;

module.exports.createLearningEngine =
  createLearningEngine;

module.exports.getLearningEngine =
  getLearningEngine;

module.exports.resetLearningEngine =
  resetLearningEngine;

module.exports.PROVIDER =
  PROVIDER;

module.exports.OUTCOME_TYPES =
  OUTCOME_TYPES;

module.exports.OUTCOME_QUALITY =
  OUTCOME_QUALITY;

module.exports.FEEDBACK_TYPES =
  FEEDBACK_TYPES;

module.exports.LEARNING_STATUS =
  LEARNING_STATUS;

module.exports.DRIFT_STATUS =
  DRIFT_STATUS;

module.exports.PROMOTION_STATUS =
  PROMOTION_STATUS;

module.exports.LIMITS =
  LIMITS;

module.exports.DEFAULT_GOVERNANCE =
  DEFAULT_GOVERNANCE;

module.exports.normalizeFeature =
  normalizeFeature;

module.exports.normalizeFeatures =
  normalizeFeatures;

module.exports.normalizePrediction =
  normalizePrediction;

module.exports.normalizeOutcome =
  normalizeOutcome;

module.exports.normalizeFeedback =
  normalizeFeedback;

module.exports.evaluateOutcome =
  evaluateOutcome;

module.exports.summarizeModelPerformance =
  summarizeModelPerformance;

module.exports.detectFeatureDrift =
  detectFeatureDrift;

module.exports.evaluateFeatureDrift =
  evaluateFeatureDrift;

module.exports.sanitizeFeedback =
  sanitizeFeedback;

module.exports.sanitizeEvaluation =
  sanitizeEvaluation;

module.exports.sanitizeDrift =
  sanitizeDrift;