'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Model Feedback Service
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/modelFeedbackService.js
 *
 * Architectural Role:
 *   Governed model-feedback orchestration boundary for the Airtel intelligence
 *   stack.
 *
 * Responsibilities:
 *   - Capture model predictions and subsequent authoritative/reviewed outcomes.
 *   - Correlate predictions, outcomes, feature versions and model versions.
 *   - Validate feedback lineage before it enters the learning pipeline.
 *   - Delegate learning/evaluation work to learningEngine.
 *   - Support corrections to previously submitted labels.
 *   - Build model performance summaries from accepted feedback.
 *   - Detect feedback quality problems and unresolved outcomes.
 *   - Detect feature/model version inconsistency.
 *   - Support batch feedback ingestion with bounded processing.
 *   - Provide model-evaluation and retraining-review inputs.
 *   - Persist sanitized feedback records through an optional repository.
 *   - Emit sanitized feedback events and audit records.
 *   - Provide tenant-safe lookup/history operations.
 *   - Expose health, diagnostics and capability information.
 *
 * Explicitly NOT Responsible For:
 *   - Payment authorization.
 *   - Payment execution.
 *   - Fraud blocking.
 *   - Fraud adjudication.
 *   - Settlement.
 *   - Reconciliation authority.
 *   - Ledger posting.
 *   - Balance mutation.
 *   - Loan approval.
 *   - Credit decisioning.
 *   - AML/KYC determinations.
 *   - Regulatory determinations.
 *   - Automatic model deployment.
 *   - Automatic model promotion.
 *   - Automatic production threshold mutation.
 *   - Direct provider HTTP/API communication.
 *
 * Governance Principles:
 *   - Feedback is evidence for learning, not a permission to act financially.
 *   - Authoritative/reviewed outcome quality is distinguished from observational
 *     or weak labels.
 *   - Existing feedback records are not silently rewritten across tenants.
 *   - Model/version/feature lineage is preserved where supplied.
 *   - Protected/sensitive demographic and health attributes are rejected from
 *     feedback features.
 *   - Corrected labels require explicit provenance and auditability.
 *   - Learning recommendations remain advisory.
 *   - No feedback event can directly authorize, block, settle or reverse money.
 *
 * Financial Safety:
 *   - Monetary amounts remain decimal/minor-unit strings.
 *   - BigInt is used for monetary normalization where arithmetic is required.
 *   - Number is not used for monetary arithmetic.
 *
 * Security:
 *   - Tenant context is mandatory.
 *   - Tenant scope cannot be overridden by request filters.
 *   - Secrets, tokens, signatures, credentials and raw provider payloads are
 *     removed from persisted/projection data.
 *   - Payload and array sizes are bounded.
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

const FEEDBACK_STATUS = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  PENDING_REVIEW: 'PENDING_REVIEW',
  CORRECTION_PENDING: 'CORRECTION_PENDING',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
});

const FEEDBACK_TYPES = Object.freeze({
  PREDICTION: 'PREDICTION',
  OUTCOME: 'OUTCOME',
  CORRECTION: 'CORRECTION',
  REVIEW: 'REVIEW',
  EVALUATION: 'EVALUATION',
});

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

const CORRECTION_REASON_CODES = Object.freeze({
  INCORRECT_LABEL: 'INCORRECT_LABEL',
  DUPLICATE_FEEDBACK: 'DUPLICATE_FEEDBACK',
  REVIEW_CHANGED: 'REVIEW_CHANGED',
  AUTHORITATIVE_SOURCE_UPDATED: 'AUTHORITATIVE_SOURCE_UPDATED',
  DATA_QUALITY_CORRECTION: 'DATA_QUALITY_CORRECTION',
  OTHER: 'OTHER',
});

const LIMITS = Object.freeze({
  MAX_BATCH: 250,
  MAX_FEATURES: 500,
  MAX_REASON_LENGTH: 1500,
  MAX_STRING_LENGTH: 1200,
  MAX_MODEL_NAME_LENGTH: 150,
  MAX_MODEL_VERSION_LENGTH: 100,
  MAX_FEATURE_KEY_LENGTH: 150,
  MAX_METADATA_KEYS: 40,
  MAX_METADATA_VALUE_LENGTH: 500,
  MAX_HISTORY: 250,
  MAX_PROVENANCE_ITEMS: 50,
  MAX_PENDING_ITEMS: 250,
  MAX_CORRECTIONS: 100,
  MAX_SCORE: 100,
  MAX_FEATURE_AGE_MS: 365 * 24 * 60 * 60 * 1000,
});

const DEFAULT_GOVERNANCE = Object.freeze({
  minimumOutcomeQuality:
    OUTCOME_QUALITY.REVIEWED,
  requirePredictionForOutcome:
    false,
  requireOutcomeForEvaluation:
    true,
  allowObservationalFeedback:
    true,
  allowCorrectionWithoutApproval:
    false,
  retainFeatureSnapshot:
    true,
});

/* -------------------------------------------------------------------------- */
/* Generic utilities                                                          */
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
  if (
    value === null ||
    value === undefined
  ) {
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
    LIMITS.MAX_SCORE,
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
  return [
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
  ].some((pattern) =>
    pattern.test(String(key))
  );
}

function isProtectedFeatureKey(key) {
  return [
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
  ].some((pattern) =>
    pattern.test(String(key))
  );
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
      (item) =>
        item !== null &&
        item !== undefined
    );
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

function stableStringify(value) {
  if (
    value === null ||
    value === undefined
  ) {
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

/* -------------------------------------------------------------------------- */
/* Tenant helpers                                                             */
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
        'Tenant context is required for model feedback.'
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
/* Prediction normalization                                                   */
/* -------------------------------------------------------------------------- */

function normalizePrediction(
  input = {}
) {
  const score =
    normalizeScore(
      input.score ??
        input.riskScore
    );

  const probability =
    normalizeProbability(
      input.probability ??
        input.fraudProbability ??
        input.riskProbability
    );

  return {
    predictionId:
      normalizeId(
        input.predictionId ||
          input.assessmentId ||
          input.decisionId
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
    score,
    probability,
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
    featureRecordId:
      normalizeId(
        input.featureRecordId
      ),
    assessedAt:
      normalizeTimestamp(
        input.assessedAt ||
          input.createdAt
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Outcome normalization                                                      */
/* -------------------------------------------------------------------------- */

function inferOutcomeTruth(
  type
) {
  switch (
    type
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

function normalizeOutcome(
  input = {}
) {
  const rawType =
    boundedText(
      input.type ||
        input.outcomeType,
      80
    )?.toUpperCase() ||
    OUTCOME_TYPES.UNKNOWN;

  const type =
    Object.values(
      OUTCOME_TYPES
    ).includes(
      rawType
    )
      ? rawType
      : OUTCOME_TYPES.UNKNOWN;

  const inferred =
    inferOutcomeTruth(
      type
    );

  return {
    outcomeId:
      normalizeId(
        input.outcomeId ||
          input.id
      ) ||
      crypto.randomUUID(),
    type,
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
        : inferred,
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
        150
      ),
    reference:
      normalizeId(
        input.reference ||
          input.transactionId ||
          input.eventId
      ),
    reason:
      boundedText(
        input.reason ||
          input.notes,
        LIMITS.REASON_LENGTH
      ),
    observedAt:
      normalizeTimestamp(
        input.observedAt ||
          input.createdAt
      ),
    metadata:
      sanitizeMetadata(
        input.metadata
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Feature normalization                                                      */
/* -------------------------------------------------------------------------- */

function normalizeFeatures(
  values
) {
  const source =
    Array.isArray(values)
      ? values
      : [];

  const result = [];
  const seen = new Set();

  for (const raw of source.slice(
    0,
    LIMITS.MAX_FEATURES
  )) {
    if (
      !isPlainObject(raw)
    ) {
      continue;
    }

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
      isProtectedFeatureKey(key) ||
      seen.has(key)
    ) {
      continue;
    }

    const type =
      boundedText(
        raw.type,
        50
      )?.toUpperCase() ||
      inferFeatureType(
        raw.value
      );

    const value =
      normalizeFeatureValue(
        raw.value,
        type
      );

    if (
      value === null ||
      value === undefined
    ) {
      continue;
    }

    seen.add(key);

    result.push({
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
        normalizeProbability(
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
    });
  }

  return result;
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

function normalizeFeatureValue(
  value,
  type
) {
  switch (
    type
  ) {
    case 'BOOLEAN':
      return typeof value ===
        'boolean'
        ? value
        : null;

    case 'INTEGER': {
      const integer =
        normalizeInteger(
          value
        );

      return integer ===
        null
        ? null
        : integer.toString();
    }

    case 'MONEY_MINOR':
      return normalizeMoneyMinor(
        value
      );

    case 'PROBABILITY':
      return normalizeProbability(
        value
      );

    case 'NUMBER':
    case 'SCORE': {
      const number =
        Number(value);

      return Number.isFinite(
        number
      )
        ? number
        : null;
    }

    default:
      return boundedText(
        value,
        LIMITS.STRING_LENGTH
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Quality governance                                                         */
/* -------------------------------------------------------------------------- */

function qualityRank(
  quality
) {
  const ranks = {
    [OUTCOME_QUALITY.UNKNOWN]:
      0,
    [OUTCOME_QUALITY.WEAK]:
      1,
    [OUTCOME_QUALITY.OBSERVATIONAL]:
      2,
    [OUTCOME_QUALITY.REVIEWED]:
      3,
    [OUTCOME_QUALITY.AUTHORITATIVE]:
      4,
    [OUTCOME_QUALITY.VERIFIED]:
      5,
  };

  return (
    ranks[
      quality
    ] ?? 0
  );
}

function evaluateOutcomeQuality(
  outcome,
  governance
) {
  if (
    !outcome
  ) {
    return {
      usable:
        false,
      status:
        FEEDBACK_STATUS.PENDING_REVIEW,
      reason:
        'No outcome was supplied.',
    };
  }

  if (
    outcome.confirmed ===
    null
  ) {
    return {
      usable:
        false,
      status:
        FEEDBACK_STATUS.PENDING_REVIEW,
      reason:
        'Outcome does not contain a usable truth value.',
    };
  }

  const minimum =
    qualityRank(
      governance
        .minimumOutcomeQuality
    );

  const actual =
    qualityRank(
      outcome.quality
    );

  if (
    actual <
    minimum
  ) {
    if (
      governance
        .allowObservationalFeedback
    ) {
      return {
        usable:
          false,
        status:
          FEEDBACK_STATUS.PENDING_REVIEW,
        reason:
          'Outcome quality is below the configured learning threshold.',
      };
    }

    return {
      usable:
        false,
      status:
        FEEDBACK_STATUS.REJECTED,
      reason:
        'Outcome quality is not accepted for learning.',
    };
  }

  return {
    usable:
      true,
    status:
      FEEDBACK_STATUS.ACCEPTED,
    reason:
      null,
  };
}

/* -------------------------------------------------------------------------- */
/* Prediction/outcome reconciliation                                          */
/* -------------------------------------------------------------------------- */

function predictionBinary(
  prediction
) {
  if (
    !prediction
  ) {
    return null;
  }

  if (
    prediction.decision ===
      'BLOCK_RECOMMENDATION' ||
    prediction.decision ===
      'ESCALATE' ||
    prediction.decision ===
      'REVIEW' ||
    prediction.riskLevel ===
      'HIGH' ||
    prediction.riskLevel ===
      'CRITICAL'
  ) {
    return 1;
  }

  if (
    prediction.decision ===
      'ALLOW' ||
    prediction.riskLevel ===
      'LOW'
  ) {
    return 0;
  }

  if (
    prediction.probability !==
      null &&
    prediction.probability !==
      undefined
  ) {
    return prediction.probability >=
      0.5
      ? 1
      : 0;
  }

  if (
    prediction.score !==
      null &&
    prediction.score !==
      undefined
  ) {
    return prediction.score >=
      50
      ? 1
      : 0;
  }

  return null;
}

function outcomeBinary(
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

function comparePredictionToOutcome(
  prediction,
  outcome
) {
  const predicted =
    predictionBinary(
      prediction
    );

  const actual =
    outcomeBinary(
      outcome
    );

  if (
    predicted === null ||
    actual === null
  ) {
    return {
      evaluable:
        false,
      classification:
        'UNRESOLVED',
      correct:
        null,
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
    evaluable:
      true,
    predicted,
    actual,
    classification,
    correct:
      predicted ===
      actual,
  };
}

/* -------------------------------------------------------------------------- */
/* Feedback record normalization                                              */
/* -------------------------------------------------------------------------- */

function normalizeFeedbackInput(
  input,
  context
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

  const feedbackType =
    boundedText(
      input.feedbackType ||
        input.type,
      50
    )?.toUpperCase() ||
    FEEDBACK_TYPES.OUTCOME;

  const normalizedType =
    Object.values(
      FEEDBACK_TYPES
    ).includes(
      feedbackType
    )
      ? feedbackType
      : FEEDBACK_TYPES.OUTCOME;

  const assessmentReference =
    normalizeId(
      input.assessmentId ||
        prediction.predictionId
    );

  return {
    feedbackId:
      normalizeId(
        input.feedbackId
      ) ||
      crypto.randomUUID(),
    feedbackType:
      normalizedType,
    tenantId,
    provider:
      normalizeProvider(
        input.provider ||
          thisProvider(context)
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
    assessmentReference,
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
    featureRecordId:
      normalizeId(
        input.featureRecordId ||
          prediction.featureRecordId
      ),
    modelName:
      boundedText(
        input.modelName ||
          prediction.modelName,
        LIMITS.MAX_MODEL_NAME_LENGTH
      ),
    modelVersion:
      boundedText(
        input.modelVersion ||
          prediction.modelVersion,
        LIMITS.MAX_MODEL_VERSION_LENGTH
      ),
    reason:
      boundedText(
        input.reason ||
          input.notes,
        LIMITS.REASON_LENGTH
      ),
    source:
      boundedText(
        input.source,
        100
      ),
    authority:
      boundedText(
        input.authority,
        150
      ),
    submittedAt:
      normalizeTimestamp(
        input.submittedAt
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

function thisProvider(
  context = {}
) {
  return (
    context.provider ||
    PROVIDER
  );
}

/* -------------------------------------------------------------------------- */
/* Main service                                                               */
/* -------------------------------------------------------------------------- */

class ModelFeedbackService {
  constructor(options = {}) {
    this.name =
      'AirtelModelFeedbackService';

    this.provider =
      normalizeProvider(
        options.provider ||
          PROVIDER
      );

    this.learningEngine =
      options.learningEngine ||
      options.intelligence
        ?.learningEngine ||
      null;

    this.featureStore =
      options.featureStore ||
      options.intelligence
        ?.featureStore ||
      null;

    this.repository =
      createRepositoryAdapter(
        options.repository ||
          options.repositories
            ?.modelFeedback ||
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

    this.governance = {
      ...DEFAULT_GOVERNANCE,
      ...(isPlainObject(
        options.governance
      )
        ? options.governance
        : {}),
    };

    this.initialized =
      false;

    this.initializingPromise =
      null;

    this.metrics = {
      feedbackReceived:
        0,
      feedbackAccepted:
        0,
      feedbackPending:
        0,
      feedbackRejected:
        0,
      feedbackFailed:
        0,
      predictionsRecorded:
        0,
      outcomesRecorded:
        0,
      correctionsRecorded:
        0,
      evaluationsRequested:
        0,
      unresolvedOutcomes:
        0,
      lineageMismatches:
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
        for (const dependency of [
          this.featureStore,
          this.learningEngine,
          this.repository,
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
      this.learningEngine,
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
          'Airtel model feedback dependency shutdown failed'
        );
      }
    }

    this.initialized =
      false;
  }

  async resolveFeatureLineage(
    feedback,
    context = {}
  ) {
    if (
      feedback.features.length
    ) {
      return {
        features:
          feedback.features,
        featureHash:
          feedback.featureHash ||
          fingerprint(
            feedback.features
          ),
        featureRecordId:
          feedback.featureRecordId,
        source:
          'INPUT',
      };
    }

    if (
      !this.featureStore
    ) {
      return {
        features: [],
        featureHash:
          feedback.featureHash ||
          null,
        featureRecordId:
          feedback.featureRecordId ||
          null,
        source:
          'NONE',
      };
    }

    const tenantId =
      feedback.tenantId;

    try {
      let record =
        null;

      const entityId =
        feedback.entityId;

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
                feedback.provider,
              entityId,
              entityType:
                feedback.entityType,
              featureGroup:
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
        feedback.featureRecordId &&
        typeof this.featureStore
          .get ===
          'function'
      ) {
        record =
          await this.featureStore.get(
            {
              tenantId,
              featureRecordId:
                feedback.featureRecordId,
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
          featureHash:
            feedback.featureHash ||
            null,
          featureRecordId:
            feedback.featureRecordId ||
            null,
          source:
            'FEATURE_STORE',
          missing:
            true,
        };
      }

      const features =
        normalizeFeatures(
          record.features
        );

      const featureHash =
        normalizeId(
          record.featureHash
        ) ||
        (
          features.length
            ? fingerprint(
                features
              )
            : null
        );

      return {
        features,
        featureHash,
        featureRecordId:
          normalizeId(
            record.featureRecordId
          ),
        source:
          'FEATURE_STORE',
        stale:
          record.status !==
          'ACTIVE',
      };
    } catch (error) {
      this.logger.warn?.(
        {
          err: error,
          tenantId,
          featureRecordId:
            feedback.featureRecordId,
        },
        'Airtel feature lineage lookup failed'
      );

      return {
        features: [],
        featureHash:
          feedback.featureHash ||
          null,
        featureRecordId:
          feedback.featureRecordId ||
          null,
        source:
          'FEATURE_STORE',
        missing:
          true,
      };
    }
  }

  validateLineage(
    feedback,
    lineage
  ) {
    const mismatches =
      [];

    if (
      feedback.featureHash &&
      lineage.featureHash &&
      feedback.featureHash !==
        lineage.featureHash
    ) {
      mismatches.push(
        'Feature hash differs from supplied feature lineage.'
      );
    }

    if (
      feedback.modelName &&
      feedback.prediction
        ?.modelName &&
      feedback.modelName !==
        feedback.prediction
          .modelName
    ) {
      mismatches.push(
        'Model name differs from prediction lineage.'
      );
    }

    if (
      feedback.modelVersion &&
      feedback.prediction
        ?.modelVersion &&
      feedback.modelVersion !==
        feedback.prediction
          .modelVersion
    ) {
      mismatches.push(
        'Model version differs from prediction lineage.'
      );
    }

    if (
      mismatches.length
    ) {
      this.metrics.lineageMismatches +=
        1;
    }

    return {
      valid:
        mismatches.length ===
        0,
      mismatches,
    };
  }

  buildFeedbackRecord(
    feedback,
    lineage,
    context = {}
  ) {
    const outcomeQuality =
      evaluateOutcomeQuality(
        feedback.outcome,
        this.governance
      );

    let status =
      outcomeQuality.status;

    if (
      feedback.feedbackType ===
        FEEDBACK_TYPES.PREDICTION &&
      feedback.prediction
        ?.predictionId
    ) {
      status =
        FEEDBACK_STATUS.ACCEPTED;
    }

    if (
      feedback.feedbackType ===
        FEEDBACK_TYPES.OUTCOME &&
      !feedback.outcome
    ) {
      status =
        FEEDBACK_STATUS.REJECTED;
    }

    if (
      feedback.feedbackType ===
      FEEDBACK_TYPES.CORRECTION
    ) {
      status =
        this.governance
          .allowCorrectionWithoutApproval
          ? FEEDBACK_STATUS.ACCEPTED
          : FEEDBACK_STATUS.CORRECTION_PENDING;
    }

    const evaluation =
      feedback.prediction &&
      feedback.outcome
        ? comparePredictionToOutcome(
            feedback.prediction,
            feedback.outcome
          )
        : null;

    const featureHash =
      lineage.featureHash ||
      feedback.featureHash ||
      null;

    const feedbackIdentity =
      {
        tenantId:
          feedback.tenantId,
        provider:
          feedback.provider,
        feedbackType:
          feedback.feedbackType,
        transactionId:
          feedback.transactionId,
        eventId:
          feedback.eventId,
        entityId:
          feedback.entityId,
        assessmentReference:
          feedback.assessmentReference,
        predictionId:
          feedback.prediction
            ?.predictionId,
        outcomeId:
          feedback.outcome
            ?.outcomeId,
        featureHash,
        modelName:
          feedback.modelName,
        modelVersion:
          feedback.modelVersion,
      };

    return {
      feedbackId:
        feedback.feedbackId,
      tenantId:
        feedback.tenantId,
      provider:
        feedback.provider,
      feedbackType:
        feedback.feedbackType,
      status,
      correlationId:
        feedback.correlationId,
      transactionId:
        feedback.transactionId,
      eventId:
        feedback.eventId,
      entityType:
        feedback.entityType,
      entityId:
        feedback.entityId,
      reference:
        feedback.reference,
      assessmentReference:
        feedback.assessmentReference,

      prediction:
        sanitizePrediction(
          feedback.prediction
        ),

      outcome:
        sanitizeOutcome(
          feedback.outcome
        ),

      evaluation,

      model: {
        name:
          feedback.modelName ||
          feedback.prediction
            ?.modelName ||
          null,
        version:
          feedback.modelVersion ||
          feedback.prediction
            ?.modelVersion ||
          null,
      },

      featureLineage: {
        featureRecordId:
          lineage.featureRecordId ||
          feedback.featureRecordId ||
          null,
        featureHash,
        source:
          lineage.source ||
          'UNKNOWN',
        stale:
          Boolean(
            lineage.stale
          ),
      },

      featureSnapshot:
        this.governance
          .retainFeatureSnapshot
          ? sanitizeFeatureSnapshot(
              lineage.features
            )
          : [],

      outcomeGovernance: {
        usable:
          outcomeQuality.usable,
        status:
          outcomeQuality.status,
        reason:
          outcomeQuality.reason,
      },

      submittedAt:
        feedback.submittedAt,
      reason:
        feedback.reason,
      source:
        feedback.source,
      authority:
        feedback.authority,
      idempotencyKey:
        feedback.idempotencyKey,

      identityHash:
        fingerprint(
          feedbackIdentity
        ),

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

      createdAt:
        this.clock().toISOString(),
      updatedAt:
        this.clock().toISOString(),

      metadata:
        sanitizeMetadata(
          feedback.metadata
        ),

      governance: {
        automaticModelPromotion:
          false,
        automaticThresholdMutation:
          false,
        automaticDeployment:
          false,
      },
    };
  }

  async record(
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

    this.metrics.feedbackReceived +=
      1;

    try {
      const feedback =
        normalizeFeedbackInput.call(
          this,
          {
            ...input,
            tenantId,
            correlationId,
          },
          {
            ...context,
            tenantId,
            correlationId,
          }
        );

      const lineage =
        await this.resolveFeatureLineage(
          feedback,
          {
            ...context,
            tenantId,
            correlationId,
          }
        );

      const lineageValidation =
        this.validateLineage(
          feedback,
          lineage
        );

      if (
        !lineageValidation.valid
      ) {
        feedback.metadata = {
          ...feedback.metadata,
          lineageMismatch:
            true,
        };
      }

      const record =
        this.buildFeedbackRecord(
          feedback,
          lineage,
          context
        );

      const existing =
        await this.findExistingByIdempotency(
          record,
          context
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
          correlationId,
        };
      }

      const persistence =
        await this.persist(
          record,
          {
            ...context,
            tenantId,
            correlationId,
          }
        );

      await this.forwardToLearningEngine(
        record,
        {
          ...context,
          tenantId,
          correlationId,
        }
      );

      await this.emitFeedbackEvent(
        record,
        context
      );

      await this.audit(
        'AIRTEL_MODEL_FEEDBACK_RECORDED',
        record,
        context
      );

      this.updateCounters(
        record.status
      );

      return {
        feedback:
          sanitizeFeedback(
            record
          ),
        persisted:
          persistence.persisted,
        persistence,
        idempotentReplay:
          false,
        correlationId,
      };
    } catch (error) {
      this.metrics.feedbackFailed +=
        1;

      this.logger.error?.(
        {
          err: error,
          tenantId,
          correlationId,
        },
        'Airtel model feedback recording failed'
      );

      throw error;
    }
  }

  async recordPrediction(
    input = {},
    context = {}
  ) {
    const result =
      await this.record(
        {
          ...input,
          feedbackType:
            FEEDBACK_TYPES.PREDICTION,
        },
        context
      );

    this.metrics.predictionsRecorded +=
      1;

    return result;
  }

  async recordOutcome(
    input = {},
    context = {}
  ) {
    const result =
      await this.record(
        {
          ...input,
          feedbackType:
            FEEDBACK_TYPES.OUTCOME,
        },
        context
      );

    this.metrics.outcomesRecorded +=
      1;

    if (
      !result.feedback
        ?.outcomeGovernance
        ?.usable
    ) {
      this.metrics.unresolvedOutcomes +=
        1;
    }

    return result;
  }

  async submitCorrection(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const correctionReason =
      normalizeCorrectionReason(
        input.reasonCode ||
          input.correctionReason
      );

    const correction = {
      ...input,
      tenantId,
      feedbackType:
        FEEDBACK_TYPES.CORRECTION,
      correction: {
        reasonCode:
          correctionReason,
        targetFeedbackId:
          normalizeId(
            input.targetFeedbackId ||
              input.feedbackId
          ),
        previousOutcome:
          input.previousOutcome
            ? normalizeOutcome(
                input.previousOutcome
              )
            : null,
        correctedOutcome:
          input.correctedOutcome
            ? normalizeOutcome(
                input.correctedOutcome
              )
            : normalizeOutcome(
                input.outcome ||
                  input
              ),
        requestedBy:
          normalizeId(
            input.requestedBy ||
              context.userId ||
              context.actorId
          ),
        requestedAt:
          this.clock().toISOString(),
      },
    };

    const result =
      await this.record(
        correction,
        context
      );

    this.metrics.correctionsRecorded +=
      1;

    return result;
  }

  async evaluateFeedback(
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

    if (
      !this.learningEngine
    ) {
      const error =
        new Error(
          'Learning engine is not configured.'
        );

      error.code =
        'LEARNING_ENGINE_UNAVAILABLE';

      throw error;
    }

    const feedback =
      Array.isArray(
        input.feedback
      )
        ? input.feedback
        : [];

    this.metrics.evaluationsRequested +=
      1;

    try {
      if (
        typeof this.learningEngine
          .evaluate ===
        'function'
      ) {
        const result =
          await this.learningEngine.evaluate(
            {
              ...input,
              tenantId,
              correlationId,
              feedback:
                feedback.slice(
                  0,
                  LIMITS.MAX_BATCH
                ),
            },
            {
              ...context,
              tenantId,
              correlationId,
            }
          );

        return {
          evaluation:
            sanitizeEvaluation(
              result?.evaluation
            ),
          persisted:
            Boolean(
              result?.persisted
            ),
          correlationId,
        };
      }

      if (
        typeof this.learningEngine
          .evaluateModel ===
        'function'
      ) {
        const result =
          await this.learningEngine.evaluateModel(
            {
              ...input,
              tenantId,
              correlationId,
              feedback:
                feedback.slice(
                  0,
                  LIMITS.MAX_BATCH
                ),
            },
            {
              ...context,
              tenantId,
              correlationId,
            }
          );

        return {
          evaluation:
            sanitizeEvaluation(
              result?.evaluation
            ),
          persisted:
            Boolean(
              result?.persisted
            ),
          correlationId,
        };
      }

      const error =
        new Error(
          'Learning engine evaluation interface is unavailable.'
        );

      error.code =
        'LEARNING_EVALUATION_UNAVAILABLE';

      throw error;
    } catch (error) {
      this.logger.error?.(
        {
          err: error,
          tenantId,
          correlationId,
        },
        'Airtel model feedback evaluation failed'
      );

      throw error;
    }
  }

  async evaluateCurrentModel(
    input = {},
    context = {}
  ) {
    return this.evaluateFeedback(
      input,
      context
    );
  }

  async getLearningPlan(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    if (
      !this.learningEngine
    ) {
      const error =
        new Error(
          'Learning engine is not configured.'
        );

      error.code =
        'LEARNING_ENGINE_UNAVAILABLE';

      throw error;
    }

    if (
      typeof this.learningEngine
        .generateLearningPlan !==
      'function'
    ) {
      const error =
        new Error(
          'Learning engine learning-plan interface is unavailable.'
        );

      error.code =
        'LEARNING_PLAN_UNAVAILABLE';

      throw error;
    }

    const result =
      await this.learningEngine.generateLearningPlan(
        {
          ...input,
          tenantId,
        },
        {
          ...context,
          tenantId,
        }
      );

    return sanitizeLearningPlan(
      result
    );
  }

  async getFeedbackById(
    feedbackId,
    context = {}
  ) {
    const tenantId =
      requireTenant(
        {},
        context
      );

    const id =
      normalizeId(
        feedbackId
      );

    if (
      !id
    ) {
      const error =
        new Error(
          'feedbackId is required.'
        );

      error.code =
        'FEEDBACK_ID_REQUIRED';

      throw error;
    }

    if (
      !this.repository
    ) {
      return null;
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

  async findExistingByIdempotency(
    record,
    context = {}
  ) {
    if (
      !record.idempotencyKey ||
      !this.repository ||
      typeof this.repository.findOne !==
        'function'
    ) {
      return null;
    }

    return this.repository.findOne(
      {
        tenantId:
          record.tenantId,
        idempotencyKey:
          record.idempotencyKey,
      },
      {
        ...context,
        tenantId:
          record.tenantId,
      }
    );
  }

  async persist(
    record,
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

    try {
      let result;

      if (
        typeof this.repository.upsert ===
        'function'
      ) {
        result =
          await this.repository.upsert(
            {
              tenantId:
                record.tenantId,
              feedbackId:
                record.feedbackId,
            },
            record,
            {
              ...context,
              tenantId:
                record.tenantId,
            }
          );
      } else if (
        typeof this.repository.create ===
        'function'
      ) {
        result =
          await this.repository.create(
            record,
            {
              ...context,
              tenantId:
                record.tenantId,
            }
          );
      } else if (
        typeof this.repository.insert ===
        'function'
      ) {
        result =
          await this.repository.insert(
            record,
            {
              ...context,
              tenantId:
                record.tenantId,
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
          tenantId:
            record.tenantId,
          feedbackId:
            record.feedbackId,
        },
        'Airtel model feedback persistence failed'
      );

      throw error;
    }
  }

  async forwardToLearningEngine(
    record,
    context = {}
  ) {
    if (
      !this.learningEngine
    ) {
      return {
        forwarded:
          false,
        reason:
          'LEARNING_ENGINE_UNAVAILABLE',
      };
    }

    try {
      const payload = {
        tenantId:
          record.tenantId,
        provider:
          record.provider,
        correlationId:
          record.correlationId,
        feedbackId:
          record.feedbackId,
        transactionId:
          record.transactionId,
        eventId:
          record.eventId,
        entityId:
          record.entityId,
        prediction:
          record.prediction,
        outcome:
          record.outcome,
        features:
          record.featureSnapshot,
        featureHash:
          record.featureLineage
            ?.featureHash,
        featureRecordId:
          record.featureLineage
            ?.featureRecordId,
        modelName:
          record.model
            ?.name,
        modelVersion:
          record.model
            ?.version,
        feedbackType:
          record.feedbackType,
        idempotencyKey:
          record.idempotencyKey,
      };

      let result;

      if (
        typeof this.learningEngine
          .ingestFeedback ===
        'function'
      ) {
        result =
          await this.learningEngine.ingestFeedback(
            payload,
            {
              ...context,
              tenantId:
                record.tenantId,
            }
          );
      } else if (
        typeof this.learningEngine
          .recordOutcome ===
        'function' &&
        record.outcome
      ) {
        result =
          await this.learningEngine.recordOutcome(
            payload,
            {
              ...context,
              tenantId:
                record.tenantId,
            }
          );
      } else if (
        typeof this.learningEngine
          .recordPrediction ===
        'function' &&
        record.prediction
      ) {
        result =
          await this.learningEngine.recordPrediction(
            payload,
            {
              ...context,
              tenantId:
                record.tenantId,
            }
          );
      } else {
        return {
          forwarded:
            false,
          reason:
            'UNSUPPORTED_LEARNING_INTERFACE',
        };
      }

      return {
        forwarded:
          true,
        result:
          sanitizeLearningResult(
            result
          ),
      };
    } catch (error) {
      /*
       * The authoritative feedback record remains available for replay. Failure
       * to forward into learning must not manufacture a different outcome.
       */
      this.logger.warn?.(
        {
          err: error,
          tenantId:
            record.tenantId,
          feedbackId:
            record.feedbackId,
        },
        'Airtel model feedback forwarding to learning engine failed'
      );

      return {
        forwarded:
          false,
        reason:
          'LEARNING_FORWARD_FAILED',
      };
    }
  }

  async buildPerformanceSummary(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const feedback =
      Array.isArray(
        input.feedback
      )
        ? input.feedback
        : [];

    const normalized =
      feedback
        .slice(
          0,
          LIMITS.MAX_BATCH
        )
        .map(
          (item) =>
            normalizeFeedbackInput.call(
              this,
              {
                ...item,
                tenantId,
              },
              {
                ...context,
                tenantId,
              }
            )
        );

    const evaluations =
      normalized
        .filter(
          (item) =>
            item.prediction &&
            item.outcome
        )
        .map(
          (item) => {
            const quality =
              evaluateOutcomeQuality(
                item.outcome,
                this.governance
              );

            return {
              feedbackId:
                item.feedbackId,
              modelName:
                item.modelName ||
                item.prediction
                  ?.modelName,
              modelVersion:
                item.modelVersion ||
                item.prediction
                  ?.modelVersion,
              evaluation:
                quality.usable
                  ? comparePredictionToOutcome(
                      item.prediction,
                      item.outcome
                    )
                  : {
                      evaluable:
                        false,
                      classification:
                        'UNRESOLVED',
                      correct:
                        null,
                    },
            };
          }
        );

    const evaluable =
      evaluations.filter(
        (item) =>
          item.evaluation
            ?.evaluable ===
          true
      );

    let truePositive =
      0;
    let trueNegative =
      0;
    let falsePositive =
      0;
    let falseNegative =
      0;

    for (const item of
      evaluable) {
      switch (
        item.evaluation
          .classification
      ) {
        case 'TRUE_POSITIVE':
          truePositive +=
            1;
          break;

        case 'TRUE_NEGATIVE':
          trueNegative +=
            1;
          break;

        case 'FALSE_POSITIVE':
          falsePositive +=
            1;
          break;

        case 'FALSE_NEGATIVE':
          falseNegative +=
            1;
          break;

        default:
          break;
      }
    }

    const count =
      evaluable.length;

    const accuracy =
      count > 0
        ? (
            (
              truePositive +
              trueNegative
            ) /
            count
          ) *
          100
        : null;

    const precision =
      truePositive +
        falsePositive >
      0
        ? (
            truePositive /
            (
              truePositive +
              falsePositive
            )
          ) *
          100
        : null;

    const recall =
      truePositive +
        falseNegative >
      0
        ? (
            truePositive /
            (
              truePositive +
              falseNegative
            )
          ) *
          100
        : null;

    return {
      tenantId,
      provider:
        this.provider,
      sampleCount:
        normalized.length,
      evaluatedCount:
        count,
      unresolvedCount:
        normalized.length -
        count,
      metrics: {
        accuracy:
          accuracy ===
            null
            ? null
            : clamp(
                accuracy,
                0,
                100
              ),
        precision:
          precision ===
            null
            ? null
            : clamp(
                precision,
                0,
                100
              ),
        recall:
          recall ===
            null
            ? null
            : clamp(
                recall,
                0,
                100
              ),
        falsePositiveRate:
          falsePositive +
            trueNegative >
          0
            ? (
                falsePositive /
                (
                  falsePositive +
                  trueNegative
                )
              ) *
              100
            : null,
        falseNegativeRate:
          falseNegative +
            truePositive >
          0
            ? (
                falseNegative /
                (
                  falseNegative +
                  truePositive
                )
              ) *
              100
            : null,
      },
      confusionMatrix: {
        truePositive,
        trueNegative,
        falsePositive,
        falseNegative,
      },
      modelVersions:
        unique(
          normalized.map(
            (item) =>
              item.modelVersion
          )
        ),
      modelNames:
        unique(
          normalized.map(
            (item) =>
              item.modelName
          )
        ),
      advisoryOnly:
        true,
    };
  }

  async listPendingFeedback(
    input = {},
    context = {}
  ) {
    return this.listFeedback(
      {
        ...input,
        query: {
          ...(isPlainObject(
            input.query
          )
            ? input.query
            : {}),
          status:
            FEEDBACK_STATUS.PENDING_REVIEW,
        },
      },
      context
    );
  }

  updateCounters(
    status
  ) {
    switch (
      status
    ) {
      case FEEDBACK_STATUS.ACCEPTED:
        this.metrics
          .feedbackAccepted +=
          1;
        break;

      case FEEDBACK_STATUS.PENDING_REVIEW:
      case FEEDBACK_STATUS.CORRECTION_PENDING:
        this.metrics
          .feedbackPending +=
          1;
        break;

      case FEEDBACK_STATUS.REJECTED:
        this.metrics
          .feedbackRejected +=
          1;
        break;

      default:
        break;
    }
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
        'airtel.model.feedback.recorded',
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
          record.model
            ?.name ||
          null,
        modelVersion:
          record.model
            ?.version ||
          null,
        featureHash:
          record.featureLineage
            ?.featureHash ||
          null,
        outcomeQuality:
          record.outcomeGovernance
            ?.usable
            ? record.outcome
                ?.quality
            : null,
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
        'Airtel model feedback event publication failed'
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
      feedbackType:
        record.feedbackType ||
        null,
      status:
        record.status ||
        null,
      predictionId:
        record.prediction
          ?.predictionId ||
        null,
      outcomeId:
        record.outcome
          ?.outcomeId ||
        null,
      modelName:
        record.model
          ?.name ||
        null,
      modelVersion:
        record.model
          ?.version ||
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
          feedbackId:
            record.feedbackId,
        },
        'Airtel model feedback audit write failed'
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

    const learningEngineAvailable =
      Boolean(
        this.learningEngine
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
        'Model feedback repository is not configured.'
      );
    }

    if (
      !learningEngineAvailable
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'Learning engine is not configured.'
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
        'Model feedback service has not been initialized.'
      );
    }

    if (
      this.metrics.feedbackFailed >
      0
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'One or more feedback operations have failed.'
      );
    }

    if (
      this.metrics.repositoryFailures >
      0
    ) {
      status =
        'DEGRADED';

      degradedReasons.push(
        'One or more feedback persistence operations have failed.'
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
      authoritative:
        false,
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
        allowAutomaticModelPromotion:
          false,
        allowAutomaticDeployment:
          false,
        allowAutomaticThresholdMutation:
          false,
      },
      dependencies: {
        repository:
          repositoryAvailable,
        learningEngine:
          learningEngineAvailable,
        featureStore:
          featureStoreAvailable,
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
        'airtel.intelligence.modelFeedbackService',
      architecture: {
        predictionFeedback:
          true,
        outcomeCapture:
          true,
        labelCorrection:
          true,
        groundTruthGovernance:
          true,
        modelLineage:
          true,
        featureLineage:
          true,
        performanceEvaluation:
          true,
        batchProcessing:
          true,
        tenantAware:
          true,
        exactMoneyRepresentation:
          true,
        bigintMoneySupport:
          true,
        protectedFeatureExclusion:
          true,
        boundedInputs:
          true,
        sanitizedOutputs:
          true,
        idempotencySupport:
          true,
        advisoryOnly:
          true,
        paymentAuthority:
          false,
        fraudBlockingAuthority:
          false,
        settlementAuthority:
          false,
        ledgerAuthority:
          false,
        financialAuthority:
          false,
        complianceAuthority:
          false,
        automaticModelPromotion:
          false,
        automaticDeployment:
          false,
        automaticThresholdMutation:
          false,
      },
      modelGovernance: {
        minimumOutcomeQuality:
          this.governance
            .minimumOutcomeQuality,
        allowObservationalFeedback:
          this.governance
            .allowObservationalFeedback,
        allowCorrectionWithoutApproval:
          this.governance
            .allowCorrectionWithoutApproval,
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
      recordPrediction:
        true,
      recordOutcome:
        true,
      submitCorrection:
        true,
      evaluateFeedback:
        true,
      currentModelEvaluation:
        true,
      performanceSummary:
        true,
      learningPlan:
        Boolean(
          this.learningEngine
        ),
      pendingFeedback:
        true,
      feedbackHistory:
        true,
      modelLineage:
        true,
      featureLineage:
        true,
      groundTruthGovernance:
        true,
      repositoryPersistence:
        Boolean(
          this.repository
        ),
      featureStoreIntegration:
        Boolean(
          this.featureStore
        ),
      learningEngineIntegration:
        Boolean(
          this.learningEngine
        ),
      audit:
        Boolean(
          this.auditLogger
        ),
      events:
        Boolean(
          this.eventBus
        ),
      explainability:
        Boolean(
          this.decisionExplainer
        ),
      tenantIsolation:
        true,
      protectedFeatureExclusion:
        true,
      exactMoneyRepresentation:
        true,
      advisoryOnly:
        true,
      fraudBlocking:
        false,
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
      automaticModelPromotion:
        false,
      automaticDeployment:
        false,
      automaticThresholdMutation:
        false,
      complianceDecisioning:
        false,
      providerHttp:
        false,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Sanitizers                                                                 */
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
    featureRecordId:
      normalizeId(
        prediction.featureRecordId
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
        150
      ),
    reference:
      normalizeId(
        outcome.reference
      ),
    reason:
      boundedText(
        outcome.reason,
        LIMITS.REASON_LENGTH
      ),
    observedAt:
      normalizeTimestamp(
        outcome.observedAt
      ),
    metadata:
      sanitizeMetadata(
        outcome.metadata
      ),
  };
}

function sanitizeFeatureSnapshot(
  features
) {
  return sanitizeArray(
    features,
    (feature) => {
      const key =
        boundedText(
          feature?.key,
          LIMITS.MAX_FEATURE_KEY_LENGTH
        );

      if (
        !key ||
        isSecretKey(key) ||
        isProtectedFeatureKey(key)
      ) {
        return null;
      }

      return {
        key,
        type:
          boundedText(
            feature.type,
            50
          )?.toUpperCase() ||
          'UNKNOWN',
        value:
          normalizeFeatureValue(
            feature.value,
            boundedText(
              feature.type,
              50
            )?.toUpperCase() ||
            'STRING'
          ),
        source:
          boundedText(
            feature.source,
            50
          )?.toUpperCase() ||
          'UNKNOWN',
        quality:
          boundedText(
            feature.quality,
            30
          )?.toUpperCase() ||
          'UNKNOWN',
        confidence:
          normalizeProbability(
            feature.confidence
          ),
        observedAt:
          normalizeTimestamp(
            feature.observedAt
          ),
        currency:
          normalizeCurrency(
            feature.currency
          ),
      };
    },
    LIMITS.MAX_FEATURES
  );
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
    tenantId:
      normalizeId(
        feedback.tenantId
      ),
    provider:
      normalizeProvider(
        feedback.provider
      ),
    feedbackType:
      boundedText(
        feedback.feedbackType,
        50
      )?.toUpperCase() ||
      FEEDBACK_TYPES.OUTCOME,
    status:
      boundedText(
        feedback.status,
        50
      )?.toUpperCase() ||
      FEEDBACK_STATUS.FAILED,
    correlationId:
      normalizeId(
        feedback.correlationId
      ),
    transactionId:
      normalizeId(
        feedback.transactionId
      ),
    eventId:
      normalizeId(
        feedback.eventId
      ),
    entityType:
      boundedText(
        feedback.entityType,
        50
      )?.toUpperCase() ||
      null,
    entityId:
      normalizeId(
        feedback.entityId
      ),
    reference:
      normalizeId(
        feedback.reference
      ),
    assessmentReference:
      normalizeId(
        feedback.assessmentReference
      ),
    prediction:
      sanitizePrediction(
        feedback.prediction
      ),
    outcome:
      sanitizeOutcome(
        feedback.outcome
      ),
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
            classification:
              boundedText(
                feedback.evaluation
                  .classification,
                50
              )?.toUpperCase() ||
              'UNRESOLVED',
            correct:
              typeof feedback.evaluation
                .correct ===
              'boolean'
                ? feedback
                    .evaluation
                    .correct
                : null,
          }
        : null,
    model:
      isPlainObject(
        feedback.model
      )
        ? {
            name:
              boundedText(
                feedback.model
                  .name,
                LIMITS.MAX_MODEL_NAME_LENGTH
              ),
            version:
              boundedText(
                feedback.model
                  .version,
                LIMITS.MAX_MODEL_VERSION_LENGTH
              ),
          }
        : null,
    featureLineage:
      isPlainObject(
        feedback.featureLineage
      )
        ? {
            featureRecordId:
              normalizeId(
                feedback
                  .featureLineage
                  .featureRecordId
              ),
            featureHash:
              normalizeId(
                feedback
                  .featureLineage
                  .featureHash
              ),
            source:
              boundedText(
                feedback
                  .featureLineage
                  .source,
                50
              )?.toUpperCase() ||
              'UNKNOWN',
            stale:
              Boolean(
                feedback
                  .featureLineage
                  .stale
              ),
          }
        : null,
    featureSnapshot:
      sanitizeFeatureSnapshot(
        feedback.featureSnapshot
      ),
    outcomeGovernance:
      isPlainObject(
        feedback.outcomeGovernance
      )
        ? {
            usable:
              Boolean(
                feedback
                  .outcomeGovernance
                  .usable
              ),
            status:
              boundedText(
                feedback
                  .outcomeGovernance
                  .status,
                50
              )?.toUpperCase() ||
              FEEDBACK_STATUS.PENDING_REVIEW,
            reason:
              boundedText(
                feedback
                  .outcomeGovernance
                  .reason,
                LIMITS.REASON_LENGTH
              ),
          }
        : null,
    submittedAt:
      normalizeTimestamp(
        feedback.submittedAt
      ),
    reason:
      boundedText(
        feedback.reason,
        LIMITS.REASON_LENGTH
      ),
    source:
      boundedText(
        feedback.source,
        100
      ),
    authority:
      boundedText(
        feedback.authority,
        150
      ),
    idempotencyKey:
      normalizeId(
        feedback.idempotencyKey
      ),
    identityHash:
      normalizeId(
        feedback.identityHash
      ),
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
    createdAt:
      normalizeTimestamp(
        feedback.createdAt
      ),
    updatedAt:
      normalizeTimestamp(
        feedback.updatedAt ||
          feedback.createdAt
      ),
    metadata:
      sanitizeMetadata(
        feedback.metadata
      ),
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
                evaluation.model
                  .modelName,
                LIMITS.MAX_MODEL_NAME_LENGTH
              ),
            modelVersion:
              boundedText(
                evaluation.model
                  .modelVersion,
                LIMITS.MAX_MODEL_VERSION_LENGTH
              ),
          }
        : null,
    summary:
      sanitizeMetadata(
        evaluation.summary
      ),
    sampleQuality:
      sanitizeMetadata(
        evaluation.sampleQuality
      ),
    evaluatedAt:
      normalizeTimestamp(
        evaluation.evaluatedAt
      ),
    advisoryOnly:
      true,
  };
}

function sanitizeLearningPlan(
  plan
) {
  if (
    !plan ||
    !isPlainObject(plan)
  ) {
    return null;
  }

  return {
    planId:
      normalizeId(
        plan.planId
      ),
    tenantId:
      normalizeId(
        plan.tenantId
      ),
    provider:
      normalizeProvider(
        plan.provider
      ),
    recommendation:
      plan.recommendation
        ? sanitizeMetadata(
            plan.recommendation
          )
        : null,
    actions:
      sanitizeArray(
        plan.actions,
        (action) => ({
          code:
            boundedText(
              action.code,
              100
            )?.toUpperCase() ||
            'UNKNOWN',
          enabled:
            Boolean(
              action.enabled
            ),
          autonomous:
            false,
        }),
        50
      ),
    approvalRequired:
      true,
    automaticDeployment:
      false,
    advisoryOnly:
      true,
  };
}

function sanitizeLearningResult(
  result
) {
  if (
    !result
  ) {
    return null;
  }

  if (
    !isPlainObject(
      result
    )
  ) {
    return null;
  }

  return {
    persisted:
      Boolean(
        result.persisted
      ),
    idempotentReplay:
      Boolean(
        result.idempotentReplay
      ),
    status:
      boundedText(
        result.status,
        50
      )?.toUpperCase() ||
      null,
    feedbackId:
      normalizeId(
        result.feedback
          ?.feedbackId
      ),
    evaluationId:
      normalizeId(
        result.evaluation
          ?.evaluationId
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

function deleteUndefined(
  object
) {
  for (const key of Object.keys(object)) {
    if (
      object[key] ===
      undefined
    ) {
      delete object[key];
    }
  }

  return object;
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
          sanitizeFeedback
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
        sanitizeFeedback
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
/* Correction helpers                                                         */
/* -------------------------------------------------------------------------- */

function normalizeCorrectionReason(
  value
) {
  const normalized =
    boundedText(
      value,
      60
    )?.toUpperCase();

  return Object.values(
    CORRECTION_REASON_CODES
  ).includes(
    normalized
  )
    ? normalized
    : CORRECTION_REASON_CODES.OTHER;
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
/* Factory / singleton                                                        */
/* -------------------------------------------------------------------------- */

let defaultInstance =
  null;

function createModelFeedbackService(
  options = {}
) {
  return new ModelFeedbackService(
    options
  );
}

function getModelFeedbackService(
  options = {}
) {
  if (
    !defaultInstance
  ) {
    defaultInstance =
      new ModelFeedbackService(
        options
      );
  }

  return defaultInstance;
}

async function resetModelFeedbackService() {
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
/* Utility exports                                                            */
/* -------------------------------------------------------------------------- */

function comparePredictionOutcome(
  prediction,
  outcome
) {
  return comparePredictionToOutcome(
    normalizePrediction(
      prediction
    ),
    normalizeOutcome(
      outcome
    )
  );
}

function evaluateOutcomeQualityStandalone(
  outcome,
  governance = DEFAULT_GOVERNANCE
) {
  return evaluateOutcomeQuality(
    normalizeOutcome(
      outcome
    ),
    {
      ...DEFAULT_GOVERNANCE,
      ...(isPlainObject(
        governance
      )
        ? governance
        : {}),
    }
  );
}

function calculateFeedbackIdentity(
  input = {}
) {
  return fingerprint({
    tenantId:
      normalizeId(
        input.tenantId
      ),
    provider:
      normalizeProvider(
        input.provider
      ),
    feedbackType:
      boundedText(
        input.feedbackType ||
          input.type,
        50
      )?.toUpperCase(),
    predictionId:
      normalizeId(
        input.predictionId ||
          input.assessmentId
      ),
    outcomeId:
      normalizeId(
        input.outcomeId
      ),
    featureHash:
      normalizeId(
        input.featureHash
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
  });
}

/* -------------------------------------------------------------------------- */
/* Module exports                                                             */
/* -------------------------------------------------------------------------- */

module.exports =
  ModelFeedbackService;

module.exports.ModelFeedbackService =
  ModelFeedbackService;

module.exports.createModelFeedbackService =
  createModelFeedbackService;

module.exports.getModelFeedbackService =
  getModelFeedbackService;

module.exports.resetModelFeedbackService =
  resetModelFeedbackService;

module.exports.PROVIDER =
  PROVIDER;

module.exports.FEEDBACK_STATUS =
  FEEDBACK_STATUS;

module.exports.FEEDBACK_TYPES =
  FEEDBACK_TYPES;

module.exports.OUTCOME_TYPES =
  OUTCOME_TYPES;

module.exports.OUTCOME_QUALITY =
  OUTCOME_QUALITY;

module.exports.CORRECTION_REASON_CODES =
  CORRECTION_REASON_CODES;

module.exports.LIMITS =
  LIMITS;

module.exports.DEFAULT_GOVERNANCE =
  DEFAULT_GOVERNANCE;

module.exports.normalizePrediction =
  normalizePrediction;

module.exports.normalizeOutcome =
  normalizeOutcome;

module.exports.normalizeFeatures =
  normalizeFeatures;

module.exports.normalizeFeedbackInput =
  normalizeFeedbackInput;

module.exports.comparePredictionOutcome =
  comparePredictionOutcome;

module.exports.evaluateOutcomeQuality =
  evaluateOutcomeQualityStandalone;

module.exports.calculateFeedbackIdentity =
  calculateFeedbackIdentity;

module.exports.sanitizePrediction =
  sanitizePrediction;

module.exports.sanitizeOutcome =
  sanitizeOutcome;

module.exports.sanitizeFeedback =
  sanitizeFeedback;