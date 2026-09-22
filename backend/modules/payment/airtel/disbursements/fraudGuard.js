'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursement Fraud Guard
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/disbursements/fraudGuard.js
 *
 * Architectural role
 * ------------------
 * Pre-execution fraud-control boundary for Airtel outbound disbursements.
 *
 * The service combines deterministic transaction/beneficiary/velocity/device /
 * behaviour controls with optional injected fraud, risk, model and prediction
 * engines. It emits a normalized decision envelope consumed by the canonical
 * Airtel DisbursementService.
 *
 *   Disbursement request
 *          |
 *          v
 *   +-------------------+
 *   |    Fraud Guard    |
 *   +-------------------+
 *      |   |   |   |
 *      v   v   v   v
 *    rules risk model intelligence
 *      \    |    |    /
 *       \   |    |   /
 *        v  v    v v
 *        normalized evidence
 *               |
 *        +------+------+
 *        |             |
 *       BLOCK        REVIEW/ALLOW
 *        |             |
 *        +------v------+
 *        DisbursementService
 *               |
 *         Approval / Execute
 *               |
 *         Financial Core
 *
 * Responsibilities
 * ----------------
 * - Enforce tenant/provider/operation scope.
 * - Enforce financial identity and unresolved-offline-state safety.
 * - Apply deterministic fraud rules before provider execution.
 * - Consume injected fraud/risk/model/prediction evidence.
 * - Normalize risk scores and evidence quality.
 * - Produce ALLOW / REVIEW / BLOCK decisions.
 * - Preserve the original transaction and idempotency identity.
 * - Produce privacy-preserving fingerprints and bounded audit evidence.
 * - Provide safe health/capability diagnostics.
 *
 * Non-responsibilities
 * --------------------
 * - No Airtel API calls.
 * - No wallet/balance/ledger/journal mutation.
 * - No settlement or reconciliation finality.
 * - No KYC/AML/sanctions source-of-truth implementation.
 * - No payment approval or maker-checker state transition.
 * - No account blocking persistence.
 * - No raw provider payload, token, secret, PIN, OTP or credential storage.
 * - No autonomous model training or policy modification.
 *
 * Financial safety principles
 * ---------------------------
 * 1. Fraud BLOCK is an execution gate, not a ledger mutation.
 * 2. Ambiguous provider outcomes are not fraud failures; provider status /
 *    reconciliation logic remains responsible for payment uncertainty.
 * 3. Original financial transaction identity and idempotency identity are kept
 *    intact and are never replaced by this component.
 * 4. Intelligence/model outputs are evidence unless explicitly marked as an
 *    authoritative decision by an injected governed engine contract.
 * 5. Missing or failed authoritative fraud infrastructure never becomes an
 *    accidental ALLOW when failClosed is enabled.
 * 6. Protected/demographic attributes are excluded from direct adverse fraud
 *    features.
 * 7. Money comparisons use exact integer minor-unit strings rather than binary
 *    floating-point arithmetic.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins plus the canonical local disbursement constants.
 * =============================================================================
 */

import { createHash, randomUUID } from 'node:crypto';

import {
  PROVIDER,
  OPERATION,
  SCHEMA_VERSION,
  RISK_LEVELS,
  ERROR_CODES,
  MONEY_POLICY,
  LIMITS,
  FINANCIAL_SAFETY_BOUNDARY,
  maxRiskLevel,
  normalizeMinorUnitAmount,
  isPositiveMinorUnitAmount,
  compareMinorUnitAmounts,
  isUnsafeOfflineState,
} from './constants.js';

export const ENGINE_NAME =
  'airtel-disbursement-fraud-guard';

export const ENGINE_VERSION =
  '3.0.0';

export const COMPONENT =
  ENGINE_NAME;

export const FRAUD_DECISIONS =
  Object.freeze({
    ALLOW:
      'ALLOW',

    REVIEW:
      'REVIEW',

    BLOCK:
      'BLOCK',

    ERROR:
      'ERROR',
  });

export const FRAUD_OUTCOMES =
  Object.freeze({
    CLEAR:
      'CLEAR',

    REVIEW:
      'REVIEW',

    BLOCKED:
      'BLOCKED',

    FAILED:
      'FAILED',
  });

export const SIGNAL_TYPES =
  Object.freeze({
    HARD_RULE:
      'HARD_RULE',

    VELOCITY:
      'VELOCITY',

    AMOUNT:
      'AMOUNT',

    BENEFICIARY:
      'BENEFICIARY',

    DEVICE:
      'DEVICE',

    NETWORK:
      'NETWORK',

    GEOLOCATION:
      'GEOLOCATION',

    BEHAVIOUR:
      'BEHAVIOUR',

    ACCOUNT:
      'ACCOUNT',

    TRANSACTION_PATTERN:
      'TRANSACTION_PATTERN',

    BLACKLIST:
      'BLACKLIST',

    SANCTIONS:
      'SANCTIONS',

    COMPLIANCE:
      'COMPLIANCE',

    MODEL:
      'MODEL',

    PREDICTION:
      'PREDICTION',

    RISK_ENGINE:
      'RISK_ENGINE',

    LEGACY_FRAUD_ENGINE:
      'LEGACY_FRAUD_ENGINE',

    RULE:
      'RULE',

    EVIDENCE_QUALITY:
      'EVIDENCE_QUALITY',

    UNKNOWN:
      'UNKNOWN',
  });

export const FRAUD_REASON_CODES =
  Object.freeze({
    TENANT_REQUIRED:
      'FRAUD_TENANT_REQUIRED',

    TENANT_SCOPE_MISMATCH:
      'FRAUD_TENANT_SCOPE_MISMATCH',

    PROVIDER_SCOPE_VIOLATION:
      'FRAUD_PROVIDER_SCOPE_VIOLATION',

    FINANCIAL_IDENTITY_REQUIRED:
      'FRAUD_FINANCIAL_IDENTITY_REQUIRED',

    IDEMPOTENCY_REQUIRED:
      'FRAUD_ORIGINAL_IDEMPOTENCY_REQUIRED',

    OFFLINE_UNSAFE:
      'FRAUD_OFFLINE_UNSAFE',

    BENEFICIARY_REQUIRED:
      'FRAUD_BENEFICIARY_REQUIRED',

    AMOUNT_INVALID:
      'FRAUD_AMOUNT_INVALID',

    CURRENCY_INVALID:
      'FRAUD_CURRENCY_INVALID',

    BLACKLISTED:
      'FRAUD_BENEFICIARY_BLACKLISTED',

    SANCTIONS_MATCH:
      'FRAUD_SANCTIONS_MATCH',

    COMPLIANCE_BLOCK:
      'FRAUD_COMPLIANCE_BLOCK',

    VELOCITY_HIGH:
      'FRAUD_VELOCITY_HIGH',

    VELOCITY_CRITICAL:
      'FRAUD_VELOCITY_CRITICAL',

    HIGH_VALUE:
      'FRAUD_HIGH_VALUE',

    CRITICAL_VALUE:
      'FRAUD_CRITICAL_VALUE',

    NEW_BENEFICIARY:
      'FRAUD_NEW_BENEFICIARY',

    UNVERIFIED_BENEFICIARY:
      'FRAUD_UNVERIFIED_BENEFICIARY',

    BENEFICIARY_MISMATCH:
      'FRAUD_BENEFICIARY_MISMATCH',

    DEVICE_MISMATCH:
      'FRAUD_DEVICE_MISMATCH',

    NEW_DEVICE:
      'FRAUD_NEW_DEVICE',

    NETWORK_RISK:
      'FRAUD_NETWORK_RISK',

    GEO_MISMATCH:
      'FRAUD_GEO_MISMATCH',

    TRAVEL_ANOMALY:
      'FRAUD_TRAVEL_ANOMALY',

    ACCOUNT_TAKEOVER:
      'FRAUD_ACCOUNT_TAKEOVER',

    BEHAVIOUR_ANOMALY:
      'FRAUD_BEHAVIOUR_ANOMALY',

    ROUND_AMOUNT:
      'FRAUD_ROUND_AMOUNT',

    ODD_HOUR:
      'FRAUD_ODD_HOUR',

    EXTERNAL_RISK_BLOCK:
      'FRAUD_EXTERNAL_RISK_BLOCK',

    CRITICAL_RISK:
      'FRAUD_CRITICAL_RISK',

    HIGH_RISK:
      'FRAUD_HIGH_RISK',

    REVIEW_RISK:
      'FRAUD_REVIEW_RISK',

    EVIDENCE_UNAVAILABLE:
      'FRAUD_EVIDENCE_UNAVAILABLE',

    ENGINE_FAILURE:
      'FRAUD_ENGINE_FAILURE',

    RULE_FAILURE:
      'FRAUD_RULE_FAILURE',
  });

const DEFAULT_CONFIG =
  Object.freeze({
    version:
      '3.0.0',

    thresholds:
      Object.freeze({
        reviewScore:
          45,

        highRiskScore:
          70,

        blockScore:
          85,

        criticalScore:
          90,

        minimumEvidenceScore:
          25,
      }),

    weights:
      Object.freeze({
        velocity:
          0.16,

        amount:
          0.10,

        beneficiary:
          0.12,

        device:
          0.10,

        network:
          0.07,

        geography:
          0.07,

        behaviour:
          0.10,

        account:
          0.08,

        transactionPattern:
          0.08,

        externalRisk:
          0.07,

        model:
          0.03,

        prediction:
          0.02,
      }),

    amountThresholdsMinor:
      Object.freeze({
        high:
          '10000000',

        critical:
          '50000000',
      }),

    velocity:
      Object.freeze({
        hourlyReviewCount:
          5,

        hourlyBlockCount:
          15,

        dailyReviewCount:
          20,

        dailyBlockCount:
          75,

        highScore:
          65,

        criticalScore:
          90,
      }),

    beneficiary:
      Object.freeze({
        newBeneficiaryScore:
          45,

        unverifiedBeneficiaryScore:
          35,

        mismatchScore:
          80,
      }),

    device:
      Object.freeze({
        mismatchScore:
          80,

        newDeviceScore:
          45,
      }),

    network:
      Object.freeze({
        vpnScore:
          35,

        torScore:
          90,

        proxyScore:
          55,

        riskyAsnScore:
          65,

        missingNetworkScore:
          15,
      }),

    geography:
      Object.freeze({
        mismatchScore:
          70,

        travelScore:
          90,

        missingScore:
          10,
      }),

    behaviour:
      Object.freeze({
        unusualScore:
          55,

        extremeScore:
          90,

        defaultScore:
          5,
      }),

    account:
      Object.freeze({
        passwordResetScore:
          30,

        newDeviceScore:
          25,

        newIpScore:
          20,

        failedLoginThreshold:
          3,

        failedLoginScore:
          45,
      }),

    transactionPattern:
      Object.freeze({
        roundAmountScore:
          25,

        oddHourScore:
          20,

        repeatedBeneficiaryScore:
          25,
      }),

    evidence:
      Object.freeze({
        staleMaxAgeMs:
          24 * 60 * 60 * 1000,

        externalTimeoutMs:
          5000,
      }),

    security:
      Object.freeze({
        requireTenantId:
          true,

        requireOriginalIdempotencyKey:
          true,

        rejectUnsafeOffline:
          true,

        failClosed:
          true,

        requireExternalEngine:
          false,

        failClosedOnExternalEngineFailure:
          true,

        protectSensitiveFeatures:
          true,

        recordRawBeneficiaryInAudit:
          false,

        recordRawProviderEvidence:
          false,
      }),

    metadata:
      Object.freeze({
        maxSignals:
          120,

        maxReasons:
          30,

        maxEvidenceItems:
          80,
      }),
  });

const SENSITIVE_KEY_PATTERNS =
  Object.freeze([
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
    /otp/i,
    /pin/i,
    /cvv/i,
    /cvc/i,
    /pan/i,
  ]);

const PROTECTED_FEATURE_PATTERNS =
  Object.freeze([
    /race/i,
    /ethnicity/i,
    /religion/i,
    /gender/i,
    /sexual/i,
    /political/i,
    /health/i,
    /medical/i,
    /genetic/i,
    /disability/i,
    /biometric/i,
  ]);

const isPlainObject = (
  value,
) =>
  Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) ===
        Object.prototype,
  );

const isFunction = (
  value,
) =>
  typeof value ===
  'function';

const boundedText = (
  value,
  maxLength =
    LIMITS.metadataStringLength,
) => {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.slice(
    0,
    maxLength,
  );
};

const upper = (
  value,
) =>
  boundedText(
    value,
    120,
  )?.toUpperCase();

const finiteNumber = (
  value,
  fallback = 0,
) => {
  const numeric =
    typeof value ===
    'number'
      ? value
      : Number(value);

  return Number.isFinite(
    numeric,
  )
    ? numeric
    : fallback;
};

const clamp = (
  value,
  min = 0,
  max = 100,
) =>
  Math.min(
    max,
    Math.max(
      min,
      finiteNumber(
        value,
        min,
      ),
    ),
  );

const round = (
  value,
  decimals = 2,
) => {
  const factor =
    10 ** decimals;

  return (
    Math.round(
      finiteNumber(value) *
        factor,
    ) / factor
  );
};

const clone = (
  value,
) => {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  return JSON.parse(
    JSON.stringify(value),
  );
};

const deepFreeze = (
  value,
  seen = new WeakSet(),
) => {
  if (
    !value ||
    typeof value !==
      'object' ||
    seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (
    const child of
      Object.values(value)
  ) {
    deepFreeze(
      child,
      seen,
    );
  }

  return Object.freeze(
    value,
  );
};

const nowMs = (
  clock,
) => {
  try {
    if (
      isFunction(clock)
    ) {
      const result =
        clock();

      const timestamp =
        result instanceof Date
          ? result.getTime()
          : Number(result);

      if (
        Number.isFinite(
          timestamp,
        )
      ) {
        return timestamp;
      }
    }

    return Date.now();
  } catch {
    return Date.now();
  }
};

const nowIso = (
  clock,
) =>
  new Date(
    nowMs(clock),
  ).toISOString();

const sha256 = (
  value,
) =>
  createHash('sha256')
    .update(
      typeof value ===
        'string'
        ? value
        : JSON.stringify(
            stable(value),
          ),
    )
    .digest('hex');

const stable = (
  value,
) => {
  if (
    value === null
  ) {
    return null;
  }

  if (
    value === undefined
  ) {
    return '[undefined]';
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      stable,
    );
  }

  if (
    isPlainObject(value)
  ) {
    return Object.keys(
      value,
    )
      .sort()
      .reduce(
        (
          accumulator,
          key,
        ) => {
          accumulator[key] =
            stable(
              value[key],
            );

          return accumulator;
        },
        {},
      );
  }

  if (
    typeof value ===
    'bigint'
  ) {
    return `${value}`;
  }

  return value;
};

const isSensitiveKey = (
  key,
) =>
  SENSITIVE_KEY_PATTERNS.some(
    (pattern) =>
      pattern.test(
        String(key),
      ),
  );

const isProtectedFeature = (
  key,
) =>
  PROTECTED_FEATURE_PATTERNS.some(
    (pattern) =>
      pattern.test(
        String(key),
      ),
  );

const sanitize = (
  value,
  config,
  depth = 0,
) => {
  if (
    depth >
    LIMITS.metadataDepth
  ) {
    return '[TRUNCATED]';
  }

  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  if (
    typeof value === 'string'
  ) {
    return value.slice(
      0,
      config.metadata.maxSignals >
        0
        ? LIMITS.metadataStringLength
        : 0,
    );
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
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    Array.isArray(value)
  ) {
    return value
      .slice(
        0,
        LIMITS.metadataArrayLength,
      )
      .map(
        (item) =>
          sanitize(
            item,
            config,
            depth + 1,
          ),
      );
  }

  if (
    !isPlainObject(value)
  ) {
    return undefined;
  }

  const result = {};

  for (
    const key of
      Object.keys(
        value,
      ).slice(
        0,
        LIMITS.metadataKeys,
      )
  ) {
    if (
      key ===
        '__proto__' ||
      key ===
        'prototype' ||
      key ===
        'constructor'
    ) {
      continue;
    }

    if (
      isSensitiveKey(key)
    ) {
      result[key] =
        '[REDACTED]';

      continue;
    }

    if (
      config.security
        .protectSensitiveFeatures &&
      isProtectedFeature(
        key,
      )
    ) {
      result[key] =
        '[EXCLUDED_FEATURE]';

      continue;
    }

    result[key] =
      sanitize(
        value[key],
        config,
        depth + 1,
      );
  }

  return result;
};

const riskLevelForScore = (
  score,
  config,
) => {
  const numeric =
    clamp(score);

  if (
    numeric >=
    config.thresholds
      .criticalScore
  ) {
    return RISK_LEVELS.CRITICAL;
  }

  if (
    numeric >=
    config.thresholds
      .highRiskScore
  ) {
    return RISK_LEVELS.HIGH;
  }

  if (
    numeric >=
    config.thresholds
      .reviewScore
  ) {
    return RISK_LEVELS.MEDIUM;
  }

  return RISK_LEVELS.LOW;
};

const decisionForScore = (
  score,
  config,
) => {
  const numeric =
    clamp(score);

  if (
    numeric >=
    config.thresholds.blockScore
  ) {
    return FRAUD_DECISIONS.BLOCK;
  }

  if (
    numeric >=
    config.thresholds.reviewScore
  ) {
    return FRAUD_DECISIONS.REVIEW;
  }

  return FRAUD_DECISIONS.ALLOW;
};

const readBoolean = (
  object,
  ...keys
) =>
  keys.some(
    (key) =>
      object?.[key] ===
      true,
  );

const readScore = (
  result,
) => {
  const candidates = [
    result?.riskScore,
    result?.fraudScore,
    result?.score,
    result?.probability,
    result?.risk,
  ];

  for (
    const candidate of
      candidates
  ) {
    const numeric =
      finiteNumber(
        candidate,
        NaN,
      );

    if (
      Number.isFinite(
        numeric,
      )
    ) {
      return clamp(
        numeric <= 1
          ? numeric * 100
          : numeric,
      );
    }
  }

  return null;
};

const readDecision = (
  result,
) =>
  upper(
    result?.decision
      ?.action ??
      result?.decision
        ?.status ??
      result?.decision ??
      result?.action ??
      result?.status ??
      result?.outcome,
  );

const readEvidenceQuality = (
  result,
) => {
  const state =
    upper(
      result?.evidenceQuality ??
        result?.assessmentStatus ??
        result?.status,
    );

  if (
    [
      'FAILED',
      'UNAVAILABLE',
    ].includes(
      state,
    )
  ) {
    return 0;
  }

  if (
    [
      'PARTIAL',
      'INSUFFICIENT_EVIDENCE',
    ].includes(
      state,
    )
  ) {
    return 35;
  }

  if (
    [
      'COMPLETED',
      'AVAILABLE',
      'HEALTHY',
    ].includes(
      state,
    )
  ) {
    return 100;
  }

  return 70;
};

const isAuthoritativeBlock = (
  result,
) =>
  result?.authoritative ===
    true &&
  (
    result?.blocked ===
      true ||
    [
      'BLOCK',
      'DENY',
      'REJECT',
    ].includes(
      readDecision(
        result,
      ),
    )
  );

const isReviewSignal = (
  result,
) =>
  readBoolean(
    result,
    'requiresReview',
    'reviewRequired',
  ) ||
  [
    'REVIEW',
    'ESCALATE',
    'BLOCK_RECOMMENDATION',
    'INSUFFICIENT_EVIDENCE',
  ].includes(
    readDecision(
      result,
    ),
  );

const countFrom = (
  value,
) => {
  const numeric =
    finiteNumber(
      value,
      0,
    );

  return Math.max(
    0,
    Math.floor(
      numeric,
    ),
  );
};

const asMinor = (
  value,
) =>
  normalizeMinorUnitAmount(
    value,
  );

const isRoundAmount = (
  value,
) => {
  const amount =
    asMinor(value);

  if (!amount) {
    return false;
  }

  return (
    amount.length >= 5 &&
    /^0+$/.test(
      amount.slice(
        Math.max(
          0,
          amount.length - 3,
        ),
      ),
    )
  );
};

const localHourFrom = (
  input,
) => {
  if (
    input?.occurredAt
  ) {
    const date =
      new Date(
        input.occurredAt,
      );

    if (
      !Number.isNaN(
        date.getTime(),
      )
    ) {
      return date.getHours();
    }
  }

  return undefined;
};

const scoreFromCount = (
  count,
  reviewCount,
  blockCount,
) => {
  if (
    count >=
    blockCount
  ) {
    return 100;
  }

  if (
    count >=
    reviewCount
  ) {
    return 70;
  }

  if (
    reviewCount <=
    0
  ) {
    return 0;
  }

  return clamp(
    (count /
      reviewCount) *
      45,
  );
};

export class FraudGuardError
  extends Error
{
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'FraudGuardError';

    this.code =
      options.code ??
      ERROR_CODES.INTERNAL_ERROR;

    this.statusCode =
      options.statusCode ??
      500;

    this.retryable =
      Boolean(
        options.retryable,
      );

    this.details =
      sanitize(
        options.details ?? {},
        options.config ??
          DEFAULT_CONFIG,
      );
  }

  toJSON() {
    return {
      name:
        this.name,

      code:
        this.code,

      message:
        this.message,

      statusCode:
        this.statusCode,

      retryable:
        this.retryable,

      details:
        this.details,
    };
  }
}

export class FraudGuard {
  constructor(
    options = {},
  ) {
    this.config =
      Object.freeze({
        ...DEFAULT_CONFIG,

        ...(options.configuration ??
          options.config ??
          {}),

        thresholds: {
          ...DEFAULT_CONFIG.thresholds,

          ...(options.configuration
            ?.thresholds ??
            options.config
              ?.thresholds ??
            {}),
        },

        weights: {
          ...DEFAULT_CONFIG.weights,

          ...(options.configuration
            ?.weights ??
            options.config
              ?.weights ??
            {}),
        },

        amountThresholdsMinor: {
          ...DEFAULT_CONFIG.amountThresholdsMinor,

          ...(options.configuration
            ?.amountThresholdsMinor ??
            options.config
              ?.amountThresholdsMinor ??
            {}),
        },

        security: {
          ...DEFAULT_CONFIG.security,

          ...(options.configuration
            ?.security ??
            options.config
              ?.security ??
            {}),
        },

        evidence: {
          ...DEFAULT_CONFIG.evidence,

          ...(options.configuration
            ?.evidence ??
            options.config
              ?.evidence ??
            {}),
        },

        metadata: {
          ...DEFAULT_CONFIG.metadata,

          ...(options.configuration
            ?.metadata ??
            options.config
              ?.metadata ??
            {}),
        },

        velocity: {
          ...DEFAULT_CONFIG.velocity,

          ...(options.configuration
            ?.velocity ??
            options.config
              ?.velocity ??
            {}),
        },

        beneficiary: {
          ...DEFAULT_CONFIG.beneficiary,

          ...(options.configuration
            ?.beneficiary ??
            options.config
              ?.beneficiary ??
            {}),
        },

        device: {
          ...DEFAULT_CONFIG.device,

          ...(options.configuration
            ?.device ??
            options.config
              ?.device ??
            {}),
        },

        network: {
          ...DEFAULT_CONFIG.network,

          ...(options.configuration
            ?.network ??
            options.config
              ?.network ??
            {}),
        },

        geography: {
          ...DEFAULT_CONFIG.geography,

          ...(options.configuration
            ?.geography ??
            options.config
              ?.geography ??
            {}),
        },

        behaviour: {
          ...DEFAULT_CONFIG.behaviour,

          ...(options.configuration
            ?.behaviour ??
            options.config
              ?.behaviour ??
            {}),
        },

        account: {
          ...DEFAULT_CONFIG.account,

          ...(options.configuration
            ?.account ??
            options.config
              ?.account ??
            {}),
        },

        transactionPattern: {
          ...DEFAULT_CONFIG.transactionPattern,

          ...(options.configuration
            ?.transactionPattern ??
            options.config
              ?.transactionPattern ??
            {}),
        },
      });

    this.rules =
      Array.isArray(
        options.rules,
      )
        ? [
            ...options.rules,
          ]
        : [];

    this.riskEngine =
      options.riskEngine ??
      null;

    this.fraudDetectionService =
      options.fraudDetectionService ??
      options.fraudService ??
      null;

    this.fraudModelEngine =
      options.fraudModelEngine ??
      null;

    this.predictionEngine =
      options.predictionEngine ??
      null;

    this.blacklist =
      options.blacklist ??
      options.blacklistService ??
      null;

    this.sanctionsService =
      options.sanctionsService ??
      null;

    this.complianceService =
      options.complianceService ??
      null;

    this.deviceRiskService =
      options.deviceRiskService ??
      null;

    this.velocityService =
      options.velocityService ??
      null;

    this.behavioralService =
      options.behavioralService ??
      options.behaviouralService ??
      null;

    this.auditService =
      options.auditService ??
      options.audit ??
      null;

    this.eventBus =
      options.eventBus ??
      options.eventPublisher ??
      options.outbox ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.logger =
      options.logger ??
      console;

    this.clock =
      options.clock ??
      (() => Date.now());

    this.idFactory =
      options.idFactory ??
      (() =>
        `fraud_${randomUUID()}`);

    this.statistics = {
      evaluations:
        0,

      allowed:
        0,

      reviews:
        0,

      blocked:
        0,

      failed:
        0,

      externalFailures:
        0,
    };
  }

  #throw(
    code,
    message,
    details = {},
    options = {},
  ) {
    throw new FraudGuardError(
      message,
      {
        code,
        details,
        config:
          this.config,
        ...options,
      },
    );
  }

  #log(
    level,
    message,
    context = {},
  ) {
    try {
      const method =
        this.logger?.[
          level
        ] ??
        this.logger?.log ??
        this.logger?.info;

      if (
        !isFunction(
          method,
        )
      ) {
        return;
      }

      method.call(
        this.logger,
        {
          component:
            COMPONENT,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          ...sanitize(
            context,
            this.config,
          ),
        },
        message,
      );
    } catch {
      // Logging is non-authoritative.
    }
  }

  #metric(
    method,
    name,
    value,
  ) {
    try {
      const fn =
        this.metrics?.[
          method
        ];

      if (
        !isFunction(fn)
      ) {
        return;
      }

      fn.call(
        this.metrics,
        name,
        value,
      );
    } catch {
      // Metrics are non-authoritative.
    }
  }

  async #audit(
    result,
    action,
  ) {
    const fn =
      this.auditService?.record ??
      this.auditService?.append ??
      this.auditService?.log ??
      this.auditService?.write;

    if (
      !isFunction(fn)
    ) {
      return null;
    }

    const auditRecord = {
      schemaVersion:
        SCHEMA_VERSION,

      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      action,

      tenantId:
        result.tenantId,

      disbursementId:
        result.disbursementId,

      transactionId:
        result.transactionId,

      decision:
        result.decision,

      outcome:
        result.outcome,

      riskScore:
        result.riskScore,

      riskLevel:
        result.riskLevel,

      reasons:
        result.reasons,

      signalCount:
        result.signals
          ?.length ??
        0,

      beneficiaryFingerprint:
        result.beneficiaryFingerprint,

      originalIdempotencyKeyHash:
        result.originalIdempotencyKey
          ? sha256(
              result.originalIdempotencyKey,
            )
          : undefined,

      inputFingerprint:
        result.inputFingerprint,

      occurredAt:
        nowIso(
          this.clock,
        ),
    };

    const envelope = {
      ...auditRecord,

      auditFingerprint:
        sha256(
          auditRecord,
        ),
    };

    try {
      return await fn.call(
        this.auditService,
        envelope,
      );
    } catch (error) {
      this.#log(
        'error',
        'Fraud guard audit write failed.',
        {
          action,

          message:
            error?.message,
        },
      );

      if (
        this.config.security
          .failClosed &&
        this.config.security
          .failClosedOnAuditError
      ) {
        this.#throw(
          'FRAUD_AUDIT_UNAVAILABLE',
          'Fraud audit boundary is unavailable.',
          {},
          {
            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      return null;
    }
  }

  async #emit(
    result,
    type,
    payload = {},
  ) {
    const fn =
      this.eventBus?.publish ??
      this.eventBus?.emit ??
      this.eventBus?.enqueue;

    if (
      !isFunction(fn)
    ) {
      return null;
    }

    const event = {
      eventId:
        this.idFactory(),

      type,

      occurredAt:
        nowIso(
          this.clock,
        ),

      tenantId:
        result.tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      disbursementId:
        result.disbursementId,

      transactionId:
        result.transactionId,

      decision:
        result.decision,

      riskLevel:
        result.riskLevel,

      riskScore:
        result.riskScore,

      inputFingerprint:
        result.inputFingerprint,

      payload:
        sanitize(
          payload,
          this.config,
        ),
    };

    try {
      return await fn.call(
        this.eventBus,
        event,
      );
    } catch (error) {
      this.#log(
        'error',
        'Fraud guard event publication failed.',
        {
          type,

          message:
            error?.message,
        },
      );

      if (
        this.config.security
          .failClosed &&
        this.config.security
          .failClosedOnEventError
      ) {
        this.#throw(
          'FRAUD_EVENT_UNAVAILABLE',
          'Fraud event boundary is unavailable.',
          {},
          {
            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      return null;
    }
  }

  #normalizeContext(
    input = {},
  ) {
    if (
      !isPlainObject(input)
    ) {
      this.#throw(
        ERROR_CODES.REQUEST_REQUIRED,
        'Fraud evaluation context must be a plain object.',
        {},
        {
          statusCode:
            422,
        },
      );
    }

    const tenantId =
      boundedText(
        input.tenantId,
        LIMITS.tenantIdLength,
      );

    if (
      this.config.security
        .requireTenantId &&
      !tenantId
    ) {
      this.#throw(
        FRAUD_REASON_CODES.TENANT_REQUIRED,
        'tenantId is required for fraud evaluation.',
        {},
        {
          statusCode:
            422,
        },
      );
    }

    const provider =
      upper(
        input.provider ??
          PROVIDER,
      );

    if (
      provider !==
      PROVIDER
    ) {
      this.#throw(
        FRAUD_REASON_CODES.PROVIDER_SCOPE_VIOLATION,
        'Fraud guard is scoped to Airtel disbursements.',
        {
          provider,
        },
        {
          statusCode:
            409,
        },
      );
    }

    const operation =
      upper(
        input.operation ??
          OPERATION,
      );

    if (
      operation !==
      OPERATION
    ) {
      this.#throw(
        ERROR_CODES.OPERATION_NOT_SUPPORTED,
        'Fraud guard only supports Airtel disbursement operations.',
        {
          operation,
        },
        {
          statusCode:
            409,
        },
      );
    }

    const transactionId =
      boundedText(
        input.transactionId ??
          input.paymentId ??
          input.disbursementId,
        LIMITS.transactionIdLength,
      );

    if (
      !transactionId
    ) {
      this.#throw(
        FRAUD_REASON_CODES.FINANCIAL_IDENTITY_REQUIRED,
        'transactionId, paymentId or disbursementId is required.',
        {},
        {
          statusCode:
            422,
        },
      );
    }

    const originalIdempotencyKey =
      boundedText(
        input.originalIdempotencyKey ??
          input.idempotencyKey,
        LIMITS.idempotencyKeyLength,
      );

    if (
      this.config.security
        .requireOriginalIdempotencyKey &&
      !originalIdempotencyKey
    ) {
      this.#throw(
        FRAUD_REASON_CODES.IDEMPOTENCY_REQUIRED,
        'Original financial idempotency key is required.',
        {},
        {
          statusCode:
            422,
        },
      );
    }

    const beneficiary =
      input.beneficiary ??
      input.beneficiaryIdentity ??
      null;

    if (
      !beneficiary
    ) {
      this.#throw(
        FRAUD_REASON_CODES.BENEFICIARY_REQUIRED,
        'Beneficiary is required for Airtel disbursement fraud evaluation.',
        {},
        {
          statusCode:
            422,
        },
      );
    }

    const amountMinor =
      asMinor(
        input.amountMinor ??
          input.amountInMinorUnits,
      );

    if (
      !amountMinor ||
      !isPositiveMinorUnitAmount(
        amountMinor,
      )
    ) {
      this.#throw(
        FRAUD_REASON_CODES.AMOUNT_INVALID,
        'A positive minor-unit amount is required.',
        {},
        {
          statusCode:
            422,
        },
      );
    }

    const currency =
      upper(
        input.currency ??
          'UGX',
      );

    if (
      currency !==
      'UGX'
    ) {
      this.#throw(
        FRAUD_REASON_CODES.CURRENCY_INVALID,
        'Airtel Uganda disbursement fraud guard expects UGX.',
        {
          currency,
        },
        {
          statusCode:
            422,
        },
      );
    }

    const offlineState =
      upper(
        input.offlineState ??
          input.syncState,
      );

    if (
      this.config.security
        .rejectUnsafeOffline &&
      isUnsafeOfflineState(
        offlineState,
      )
    ) {
      this.#throw(
        FRAUD_REASON_CODES.OFFLINE_UNSAFE,
        'Unresolved offline state cannot enter financial execution.',
        {
          offlineState,
        },
        {
          statusCode:
            409,
        },
      );
    }

    const actor =
      isPlainObject(
        input.actor,
      )
        ? {
            actorId:
              boundedText(
                input.actor
                  .actorId ??
                  input.actor
                    .userId ??
                  input.actor.id,
                LIMITS.actorIdLength,
              ),

            role:
              upper(
                input.actor
                  .role ??
                  input.actor
                    .actorRole,
              ),

            tenantId:
              boundedText(
                input.actor
                  .tenantId,
                LIMITS.tenantIdLength,
              ),
          }
        : undefined;

    if (
      actor?.tenantId &&
      actor.tenantId !==
        tenantId
    ) {
      this.#throw(
        FRAUD_REASON_CODES.TENANT_SCOPE_MISMATCH,
        'Actor tenant does not match fraud evaluation tenant.',
        {},
        {
          statusCode:
            403,
        },
      );
    }

    return {
      ...clone(input),

      tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      transactionId,

      disbursementId:
        boundedText(
          input.disbursementId ??
            input.paymentId ??
            input.transactionId,
          LIMITS.paymentIdLength,
        ),

      originalIdempotencyKey,

      amountMinor,

      currency,

      beneficiary,

      beneficiaryFingerprint:
        sha256(
          stable(
            beneficiary,
          ),
        ),

      customerId:
        boundedText(
          input.customerId ??
            input.memberId ??
            input.userId,
          LIMITS.paymentIdLength,
        ),

      reference:
        boundedText(
          input.reference,
          LIMITS.referenceLength,
        ),

      country:
        upper(
          input.country ??
            'UG',
        ),

      channel:
        upper(
          input.channel ??
            'AIRTEL',
        ),

      offlineState,

      actor,

      requestId:
        boundedText(
          input.requestId,
          LIMITS.requestIdLength,
        ),

      correlationId:
        boundedText(
          input.correlationId,
          LIMITS.correlationIdLength,
        ),

      traceId:
        boundedText(
          input.traceId,
          LIMITS.traceIdLength,
        ),

      metadata:
        sanitize(
          input.metadata ?? {},
          this.config,
        ),
    };
  }

  #baseSignal(
    type,
    code,
    score,
    options = {},
  ) {
    return {
      type,

      code,

      score:
        clamp(
          score,
        ),

      severity:
        options.severity ??
        riskLevelForScore(
          score,
          this.config,
        ),

      hardBlock:
        options.hardBlock ===
        true,

      reviewRequired:
        options.reviewRequired ===
        true,

      reason:
        boundedText(
          options.reason,
          500,
        ),

      evidence:
        sanitize(
          options.evidence ?? {},
          this.config,
        ),

      source:
        boundedText(
          options.source,
          160,
        ),
    };
  }

  #builtInSignals(
    context,
  ) {
    const signals = [];

    const amountHigh =
      compareMinorUnitAmounts(
        context.amountMinor,
        this.config
          .amountThresholdsMinor
          .high,
      ) >= 0;

    const amountCritical =
      compareMinorUnitAmounts(
        context.amountMinor,
        this.config
          .amountThresholdsMinor
          .critical,
      ) >= 0;

    if (
      amountCritical
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.AMOUNT,
          FRAUD_REASON_CODES.CRITICAL_VALUE,
          75,
          {
            reviewRequired:
              true,

            reason:
              'Disbursement amount is above the configured critical-value threshold.',

            evidence: {
              thresholdClass:
                'CRITICAL',
            },
          },
        ),
      );
    } else if (
      amountHigh
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.AMOUNT,
          FRAUD_REASON_CODES.HIGH_VALUE,
          45,
          {
            reviewRequired:
              true,

            reason:
              'Disbursement amount is above the configured high-value threshold.',

            evidence: {
              thresholdClass:
                'HIGH',
            },
          },
        ),
      );
    }

    const hourlyCount =
      countFrom(
        context.velocity
          ?.hourlyCount ??
          context.velocityHourlyCount ??
          context.history
            ?.hourlyCount,
      );

    const dailyCount =
      countFrom(
        context.velocity
          ?.dailyCount ??
          context.velocityDailyCount ??
          context.history
            ?.dailyCount,
      );

    const hourlyScore =
      scoreFromCount(
        hourlyCount,
        this.config.velocity
          .hourlyReviewCount,
        this.config.velocity
          .hourlyBlockCount,
      );

    const dailyScore =
      scoreFromCount(
        dailyCount,
        this.config.velocity
          .dailyReviewCount,
        this.config.velocity
          .dailyBlockCount,
      );

    const velocityScore =
      Math.max(
        hourlyScore,
        dailyScore,
      );

    if (
      velocityScore >=
      this.config.velocity
        .criticalScore
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.VELOCITY,
          FRAUD_REASON_CODES.VELOCITY_CRITICAL,
          velocityScore,
          {
            reviewRequired:
              true,

            reason:
              'Transaction velocity exceeded the configured critical threshold.',

            evidence: {
              hourlyCount,
              dailyCount,
            },
          },
        ),
      );
    } else if (
      velocityScore >=
      this.config.velocity
        .highScore
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.VELOCITY,
          FRAUD_REASON_CODES.VELOCITY_HIGH,
          velocityScore,
          {
            reviewRequired:
              true,

            reason:
              'Transaction velocity is elevated.',

            evidence: {
              hourlyCount,
              dailyCount,
            },
          },
        ),
      );
    }

    const beneficiaryContext =
      isPlainObject(
        context.beneficiary,
      )
        ? context.beneficiary
        : {};

    if (
      beneficiaryContext
        .blacklisted ===
        true ||
      beneficiaryContext
        .blocked ===
        true
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.BLACKLIST,
          FRAUD_REASON_CODES.BLACKLISTED,
          100,
          {
            hardBlock:
              true,

            reviewRequired:
              true,

            reason:
              'Beneficiary is marked as blocked or blacklisted.',
          },
        ),
      );
    }

    const sanctionsMatch =
      beneficiaryContext
        .sanctionsMatch ===
        true ||
      context.sanctionsMatch ===
        true;

    if (
      sanctionsMatch
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.SANCTIONS,
          FRAUD_REASON_CODES.SANCTIONS_MATCH,
          100,
          {
            hardBlock:
              true,

            reviewRequired:
              true,

            reason:
              'A sanctions match was supplied by an upstream screening boundary.',
          },
        ),
      );
    }

    if (
      context.compliance
        ?.blocked ===
      true
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.COMPLIANCE,
          FRAUD_REASON_CODES.COMPLIANCE_BLOCK,
          100,
          {
            hardBlock:
              true,

            reviewRequired:
              true,

            reason:
              'An upstream compliance control blocked the disbursement.',
          },
        ),
      );
    }

    const newBeneficiary =
      readBoolean(
        beneficiaryContext,
        'newBeneficiary',
        'isNew',
      ) ||
      context.newBeneficiary ===
        true;

    const unverifiedBeneficiary =
      readBoolean(
        beneficiaryContext,
        'unverified',
        'unverifiedBeneficiary',
        'isUnverified',
      );

    const beneficiaryMismatch =
      readBoolean(
        beneficiaryContext,
        'nameMismatch',
        'identityMismatch',
        'mismatch',
      );

    if (
      beneficiaryMismatch
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.BENEFICIARY,
          FRAUD_REASON_CODES.BENEFICIARY_MISMATCH,
          this.config.beneficiary
            .mismatchScore,
          {
            reviewRequired:
              true,

            reason:
              'Beneficiary identity evidence is inconsistent.',
          },
        ),
      );
    }

    if (
      newBeneficiary
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.BENEFICIARY,
          FRAUD_REASON_CODES.NEW_BENEFICIARY,
          this.config.beneficiary
            .newBeneficiaryScore,
          {
            reviewRequired:
              true,

            reason:
              'Beneficiary appears newly established or first-seen.',
          },
        ),
      );
    }

    if (
      unverifiedBeneficiary
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.BENEFICIARY,
          FRAUD_REASON_CODES.UNVERIFIED_BENEFICIARY,
          this.config.beneficiary
            .unverifiedBeneficiaryScore,
          {
            reviewRequired:
              true,

            reason:
              'Beneficiary verification evidence is incomplete.',
          },
        ),
      );
    }

    const device =
      isPlainObject(
        context.device,
      )
        ? context.device
        : {};

    if (
      device.mismatch ===
        true ||
      device.deviceMismatch ===
        true
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.DEVICE,
          FRAUD_REASON_CODES.DEVICE_MISMATCH,
          this.config.device
            .mismatchScore,
          {
            reviewRequired:
              true,

            reason:
              'Device identity differs from the established customer profile.',
          },
        ),
      );
    } else if (
      device.newDevice ===
        true ||
      device.firstSeen ===
        true
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.DEVICE,
          FRAUD_REASON_CODES.NEW_DEVICE,
          this.config.device
            .newDeviceScore,
          {
            reviewRequired:
              true,

            reason:
              'The request originated from a new or first-seen device.',
          },
        ),
      );
    }

    const network =
      isPlainObject(
        context.network,
      )
        ? context.network
        : {};

    if (
      network.tor ===
      true
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.NETWORK,
          FRAUD_REASON_CODES.NETWORK_RISK,
          this.config.network
            .torScore,
          {
            hardBlock:
              false,

            reviewRequired:
              true,

            reason:
              'Network evidence indicates Tor usage and materially increases fraud uncertainty.',
          },
        ),
      );
    } else if (
      network.riskyAsn ===
      true
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.NETWORK,
          FRAUD_REASON_CODES.NETWORK_RISK,
          this.config.network
            .riskyAsnScore,
          {
            reviewRequired:
              true,

            reason:
              'Network evidence indicates elevated infrastructure risk.',
          },
        ),
      );
    } else if (
      network.proxy ===
        true ||
      network.vpn ===
        true
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.NETWORK,
          FRAUD_REASON_CODES.NETWORK_RISK,
          network.proxy ===
            true
            ? this.config.network
                .proxyScore
            : this.config.network
                .vpnScore,
          {
            reviewRequired:
              false,

            reason:
              'Network privacy tooling increases uncertainty for the risk assessment.',
          },
        ),
      );
    } else if (
      context.network ===
      undefined
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.NETWORK,
          'FRAUD_NETWORK_EVIDENCE_MISSING',
          this.config.network
            .missingNetworkScore,
          {
            reason:
              'Network evidence is unavailable.',
          },
        ),
      );
    }

    const geography =
      isPlainObject(
        context.geography,
      )
        ? context.geography
        : {};

    if (
      geography.travelAnomaly ===
      true
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.GEOLOCATION,
          FRAUD_REASON_CODES.TRAVEL_ANOMALY,
          this.config.geography
            .travelScore,
          {
            reviewRequired:
              true,

            reason:
              'Geographic travel evidence is inconsistent with the established profile.',
          },
        ),
      );
    } else if (
      geography.countryMismatch ===
        true ||
      geography.regionMismatch ===
        true
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.GEOLOCATION,
          FRAUD_REASON_CODES.GEO_MISMATCH,
          this.config.geography
            .mismatchScore,
          {
            reviewRequired:
              true,

            reason:
              'Current geographic evidence differs from the established customer profile.',
          },
        ),
      );
    } else if (
      context.geography ===
      undefined
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.GEOLOCATION,
          'FRAUD_GEO_EVIDENCE_MISSING',
          this.config.geography
            .missingScore,
          {
            reason:
              'Geographic evidence is unavailable.',
          },
        ),
      );
    }

    const account =
      isPlainObject(
        context.account,
      )
        ? context.account
        : {};

    const failedLogins =
      countFrom(
        account.failedLogins,
      );

    const takeoverSignal =
      Math.max(
        account.passwordReset ===
          true
          ? this.config.account
              .passwordResetScore
          : 0,

        account.newDevice ===
          true
          ? this.config.account
              .newDeviceScore
          : 0,

        account.newIp ===
          true
          ? this.config.account
              .newIpScore
          : 0,

        failedLogins >=
          this.config.account
            .failedLoginThreshold
          ? this.config.account
              .failedLoginScore
          : 0,
      );

    if (
      takeoverSignal >=
      this.config.account
        .failedLoginScore
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.ACCOUNT,
          FRAUD_REASON_CODES.ACCOUNT_TAKEOVER,
          Math.min(
            100,
            takeoverSignal,
          ),
          {
            reviewRequired:
              true,

            reason:
              'Account-security signals indicate possible account takeover activity.',

            evidence: {
              failedLoginCount:
                failedLogins,
            },
          },
        ),
      );
    }

    const behaviour =
      isPlainObject(
        context.behaviour ??
          context.behavior,
      )
        ? context.behaviour ??
          context.behavior
        : {};

    const behaviourScore =
      clamp(
        behaviour.score ??
          behaviour.riskScore ??
          (
            behaviour.extreme ===
              true
              ? this.config
                  .behaviour
                  .extremeScore
              : behaviour.unusual ===
                  true
                ? this.config
                    .behaviour
                    .unusualScore
                : this.config
                    .behaviour
                    .defaultScore
          ),
      );

    if (
      behaviourScore >=
      this.config.behaviour
        .unusualScore
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.BEHAVIOUR,
          FRAUD_REASON_CODES.BEHAVIOUR_ANOMALY,
          behaviourScore,
          {
            reviewRequired:
              behaviourScore >=
              70,

            reason:
              'Behavioural evidence deviates materially from the established profile.',
          },
        ),
      );
    }

    if (
      isRoundAmount(
        context.amountMinor,
      )
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.TRANSACTION_PATTERN,
          FRAUD_REASON_CODES.ROUND_AMOUNT,
          this.config
            .transactionPattern
            .roundAmountScore,
          {
            reason:
              'Transaction amount exhibits a configured round-value pattern.',
          },
        ),
      );
    }

    const hour =
      localHourFrom(
        context,
      );

    if (
      hour !== undefined &&
      (
        hour < 5 ||
        hour >= 23
      )
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.TRANSACTION_PATTERN,
          FRAUD_REASON_CODES.ODD_HOUR,
          this.config
            .transactionPattern
            .oddHourScore,
          {
            reason:
              'Transaction occurred during a configured elevated-risk hour.',

            evidence: {
              hour,
            },
          },
        ),
      );
    }

    if (
      context.repeatedBeneficiary ===
        true ||
      context.pattern
        ?.repeatedBeneficiary ===
        true
    ) {
      signals.push(
        this.#baseSignal(
          SIGNAL_TYPES.TRANSACTION_PATTERN,
          'FRAUD_REPEATED_BENEFICIARY_PATTERN',
          this.config
            .transactionPattern
            .repeatedBeneficiaryScore,
          {
            reason:
              'Transaction pattern indicates repeated beneficiary activity.',
          },
        ),
      );
    }

    return signals;
  }

  async #invoke(
    dependency,
    methods,
    context,
    sourceType,
  ) {
    if (!dependency) {
      return {
        source:
          sourceType,

        available:
          false,

        skipped:
          true,
      };
    }

    const methodName =
      methods.find(
        (name) =>
          isFunction(
            dependency?.[
              name
            ],
          ),
      );

    if (
      !methodName
    ) {
      return {
        source:
          sourceType,

        available:
          false,

        invalidContract:
          true,
      };
    }

    try {
      const result =
        await dependency[
          methodName
        ].call(
          dependency,
          context,
        );

      return {
        source:
          sourceType,

        available:
          true,

        method:
          methodName,

        result:
          sanitize(
            result ?? {},
            this.config,
          ),
      };
    } catch (error) {
      this.statistics.externalFailures++;

      this.#log(
        'error',
        'Fraud dependency evaluation failed.',
        {
          source:
            sourceType,

          method:
            methodName,

          message:
            error?.message,
        },
      );

      return {
        source:
          sourceType,

        available:
          false,

        failed:
          true,

        errorCode:
          boundedText(
            error?.code,
            LIMITS.errorCodeLength,
          ),
      };
    }
  }

  async #externalSignals(
    context,
  ) {
    const dependencies = [
      [
        this.riskEngine,

        [
          'evaluateDisbursement',
          'evaluate',
          'score',
          'assess',
        ],

        SIGNAL_TYPES.RISK_ENGINE,
      ],

      [
        this.fraudDetectionService,

        [
          'analyzeTransaction',
          'evaluateDisbursement',
          'evaluate',
          'check',
          'assess',
        ],

        SIGNAL_TYPES.LEGACY_FRAUD_ENGINE,
      ],

      [
        this.fraudModelEngine,

        [
          'assess',
          'score',
          'evaluate',
          'predict',
        ],

        SIGNAL_TYPES.MODEL,
      ],

      [
        this.predictionEngine,

        [
          'predictFraudRisk',
          'predict',
        ],

        SIGNAL_TYPES.PREDICTION,
      ],

      [
        this.blacklist,

        [
          'check',
          'contains',
          'isBlocked',
          'evaluate',
        ],

        SIGNAL_TYPES.BLACKLIST,
      ],

      [
        this.sanctionsService,

        [
          'screen',
          'check',
          'evaluate',
        ],

        SIGNAL_TYPES.SANCTIONS,
      ],

      [
        this.complianceService,

        [
          'evaluateDisbursement',
          'evaluate',
          'check',
        ],

        SIGNAL_TYPES.COMPLIANCE,
      ],

      [
        this.deviceRiskService,

        [
          'evaluate',
          'assess',
          'check',
        ],

        SIGNAL_TYPES.DEVICE,
      ],

      [
        this.velocityService,

        [
          'evaluate',
          'assess',
          'check',
        ],

        SIGNAL_TYPES.VELOCITY,
      ],

      [
        this.behavioralService,

        [
          'evaluate',
          'assess',
          'check',
        ],

        SIGNAL_TYPES.BEHAVIOUR,
      ],
    ];

    const results =
      await Promise.all(
        dependencies.map(
          ([
            dependency,
            methods,
            type,
          ]) =>
            this.#invoke(
              dependency,
              methods,
              context,
              type,
            ),
        ),
      );

    const signals = [];
    const evidence = [];

    for (
      const item of results
    ) {
      evidence.push(
        item,
      );

      if (
        item.failed
      ) {
        const isRiskAuthority =
          [
            SIGNAL_TYPES.RISK_ENGINE,
            SIGNAL_TYPES.LEGACY_FRAUD_ENGINE,
          ].includes(
            item.source,
          );

        if (
          isRiskAuthority &&
          this.config.security
            .failClosedOnExternalEngineFailure
        ) {
          signals.push(
            this.#baseSignal(
              SIGNAL_TYPES.EVIDENCE_QUALITY,
              FRAUD_REASON_CODES.ENGINE_FAILURE,
              100,
              {
                hardBlock:
                  this.config.security
                    .failClosed,

                reviewRequired:
                  true,

                reason:
                  `${item.source} failed during fraud evaluation.`,

                source:
                  item.source,
              },
            ),
          );
        }
      }

      if (
        !item.available ||
        !item.result
      ) {
        continue;
      }

      const score =
        readScore(
          item.result,
        );

      const decision =
        readDecision(
          item.result,
        );

      const evidenceQuality =
        readEvidenceQuality(
          item.result,
        );

      if (
        isAuthoritativeBlock(
          item.result,
        )
      ) {
        signals.push(
          this.#baseSignal(
            SIGNAL_TYPES.HARD_RULE,
            FRAUD_REASON_CODES.EXTERNAL_RISK_BLOCK,
            100,
            {
              hardBlock:
                true,

              reviewRequired:
                true,

              reason:
                `${item.source} returned an authoritative fraud block.`,

              source:
                item.source,

              evidence: {
                decision,

                evidenceQuality,
              },
            },
          ),
        );

        continue;
      }

      if (
        score !== null
      ) {
        const signalType =
          item.source ===
          SIGNAL_TYPES.MODEL
            ? SIGNAL_TYPES.MODEL
            : item.source ===
                SIGNAL_TYPES.PREDICTION
              ? SIGNAL_TYPES.PREDICTION
              : item.source;

        signals.push(
          this.#baseSignal(
            signalType,
            `FRAUD_EXTERNAL_${item.source}`,
            score,
            {
              reviewRequired:
                isReviewSignal(
                  item.result,
                ),

              reason:
                boundedText(
                  item.result
                    .reason ??
                    item.result
                      .message ??
                    `${item.source} supplied fraud-risk evidence.`,
                  500,
                ),

              source:
                item.source,

              evidence: {
                decision,

                evidenceQuality,

                modelVersion:
                  boundedText(
                    item.result
                      .modelVersion,
                    120,
                  ),

                riskVersion:
                  boundedText(
                    item.result
                      .riskVersion,
                    120,
                  ),
              },
            },
          ),
        );
      }

      if (
        evidenceQuality <
        this.config.thresholds
          .minimumEvidenceScore
      ) {
        signals.push(
          this.#baseSignal(
            SIGNAL_TYPES.EVIDENCE_QUALITY,
            FRAUD_REASON_CODES.EVIDENCE_UNAVAILABLE,
            45,
            {
              reviewRequired:
                true,

              reason:
                `${item.source} supplied insufficient fraud evidence quality.`,

              source:
                item.source,

              evidence: {
                evidenceQuality,
              },
            },
          ),
        );
      }
    }

    const availableExternal =
      results.filter(
        (item) =>
          item.available,
      ).length;

    const configuredExternal =
      dependencies.filter(
        ([
          dependency,
        ]) =>
          Boolean(
            dependency,
          ),
      ).length;

    return {
      signals,

      evidence,

      availableExternal,

      configuredExternal,
    };
  }

  #customRuleSignals(
    context,
    rules = this.rules,
  ) {
    return rules.map(
      async (rule) => {
        const evaluate =
          rule?.evaluate ??
          rule?.check ??
          rule?.assess;

        if (
          !isFunction(
            evaluate,
          )
        ) {
          return this.#baseSignal(
            SIGNAL_TYPES.RULE,
            FRAUD_REASON_CODES.RULE_FAILURE,
            100,
            {
              hardBlock:
                true,

              reason:
                'Configured fraud rule does not expose a supported evaluation method.',

              source:
                rule?.name ??
                'anonymous_rule',
            },
          );
        }

        try {
          const result =
            await evaluate.call(
              rule,
              context,
            );

          const score =
            readScore(
              result,
            ) ??
            (
              result?.allowed ===
              false
                ? 100
                : 0
            );

          const blocked =
            result?.hardBlock ===
              true ||
            result?.blocked ===
              true ||
            (
              result?.allowed ===
                false &&
              (
                result?.authoritative ===
                  true ||
                result?.severity ===
                  'CRITICAL'
              )
            );

          return this.#baseSignal(
            SIGNAL_TYPES.RULE,
            boundedText(
              result?.reasonCode ??
                rule?.code ??
                rule?.name ??
                FRAUD_REASON_CODES.RULE_FAILURE,
              160,
            ),
            score,
            {
              hardBlock:
                blocked,

              reviewRequired:
                result?.requiresReview ===
                  true,

              reason:
                result?.reason ??
                result?.message ??
                `Custom fraud rule ${rule?.name ?? 'anonymous_rule'} evaluated.`,

              source:
                rule?.name ??
                'anonymous_rule',

              evidence:
                result,
            },
          );
        } catch (error) {
          return this.#baseSignal(
            SIGNAL_TYPES.RULE,
            FRAUD_REASON_CODES.RULE_FAILURE,
            100,
            {
              hardBlock:
                this.config.security
                  .failClosed,

              reviewRequired:
                true,

              reason:
                `Fraud rule evaluation failed: ${error?.message ?? 'unknown error'}`,

              source:
                rule?.name ??
                'anonymous_rule',
            },
          );
        }
      },
    );
  }

  async #runCustomRules(
    context,
  ) {
    if (
      !this.rules.length
    ) {
      return [];
    }

    const ordered = [
      ...this.rules,
    ].sort(
      (a, b) =>
        finiteNumber(
          b?.priority,
          0,
        ) -
        finiteNumber(
          a?.priority,
          0,
        ),
    );

    return Promise.all(
      this.#customRuleSignals(
        context,
        ordered,
      ),
    );
  }

  #calculateScore(
    signals,
  ) {
    if (
      !signals.length
    ) {
      return {
        score:
          0,

        evidenceQuality:
          0,
      };
    }

    const weighted = [];
    let weightTotal = 0;

    for (
      const signal of signals
    ) {
      const categoryWeight =
        this.#weightForSignal(
          signal.type,
        );

      weighted.push({
        score:
          clamp(
            signal.score,
          ),

        weight:
          categoryWeight,
      });

      weightTotal +=
        categoryWeight;
    }

    const baseScore =
      weightTotal > 0
        ? weighted.reduce(
            (
              sum,
              item,
            ) =>
              sum +
              item.score *
                item.weight,
            0,
          ) /
          weightTotal
        : 0;

    const hardScores =
      signals
        .filter(
          (signal) =>
            signal.hardBlock ===
            true,
        )
        .map(
          (signal) =>
            clamp(
              signal.score,
            ),
        );

    const score =
      hardScores.length
        ? Math.max(
            100,
            baseScore,
          )
        : baseScore;

    const evidenceQuality =
      clamp(
        100 -
          signals.filter(
            (signal) =>
              signal.type ===
                SIGNAL_TYPES.EVIDENCE_QUALITY ||
              signal.code ===
                FRAUD_REASON_CODES.EVIDENCE_UNAVAILABLE,
          ).length *
            20,
      );

    return {
      score:
        round(
          score,
        ),

      evidenceQuality:
        round(
          evidenceQuality,
        ),
    };
  }

  #weightForSignal(
    type,
  ) {
    const map = {
      [SIGNAL_TYPES.VELOCITY]:
        this.config.weights
          .velocity,

      [SIGNAL_TYPES.AMOUNT]:
        this.config.weights
          .amount,

      [SIGNAL_TYPES.BENEFICIARY]:
        this.config.weights
          .beneficiary,

      [SIGNAL_TYPES.DEVICE]:
        this.config.weights
          .device,

      [SIGNAL_TYPES.NETWORK]:
        this.config.weights
          .network,

      [SIGNAL_TYPES.GEOLOCATION]:
        this.config.weights
          .geography,

      [SIGNAL_TYPES.BEHAVIOUR]:
        this.config.weights
          .behaviour,

      [SIGNAL_TYPES.ACCOUNT]:
        this.config.weights
          .account,

      [SIGNAL_TYPES.TRANSACTION_PATTERN]:
        this.config.weights
          .transactionPattern,

      [SIGNAL_TYPES.RISK_ENGINE]:
        this.config.weights
          .externalRisk,

      [SIGNAL_TYPES.LEGACY_FRAUD_ENGINE]:
        this.config.weights
          .externalRisk,

      [SIGNAL_TYPES.BLACKLIST]:
        1,

      [SIGNAL_TYPES.SANCTIONS]:
        1,

      [SIGNAL_TYPES.COMPLIANCE]:
        1,

      [SIGNAL_TYPES.MODEL]:
        this.config.weights
          .model,

      [SIGNAL_TYPES.PREDICTION]:
        this.config.weights
          .prediction,

      [SIGNAL_TYPES.EVIDENCE_QUALITY]:
        0.25,

      [SIGNAL_TYPES.HARD_RULE]:
        1,

      [SIGNAL_TYPES.RULE]:
        0.5,
    };

    return Math.max(
      0.01,
      finiteNumber(
        map[type],
        0.1,
      ),
    );
  }

  #reasonCodes(
    signals,
  ) {
    return [
      ...new Set(
        signals
          .filter(
            (signal) =>
              signal.code,
          )
          .sort(
            (a, b) =>
              clamp(
                b.score,
              ) -
              clamp(
                a.score,
              ),
          )
          .map(
            (signal) =>
              signal.code,
          )
          .slice(
            0,
            this.config
              .metadata
              .maxReasons,
          ),
      ),
    ];
  }

  #buildResult(
    context,
    signals,
    scoreData,
    external,
  ) {
    const hardBlock =
      signals.some(
        (signal) =>
          signal.hardBlock ===
          true,
      );

    const reviewRequired =
      signals.some(
        (signal) =>
          signal.reviewRequired ===
          true,
      );

    const calculatedDecision =
      decisionForScore(
        scoreData.score,
        this.config,
      );

    let decision =
      calculatedDecision;

    if (
      hardBlock
    ) {
      decision =
        FRAUD_DECISIONS.BLOCK;
    } else if (
      reviewRequired &&
      decision ===
        FRAUD_DECISIONS.ALLOW
    ) {
      decision =
        FRAUD_DECISIONS.REVIEW;
    }

    const riskLevel =
      riskLevelForScore(
        scoreData.score,
        this.config,
      );

    const outcome =
      decision ===
      FRAUD_DECISIONS.BLOCK
        ? FRAUD_OUTCOMES.BLOCKED
        : decision ===
            FRAUD_DECISIONS.REVIEW
          ? FRAUD_OUTCOMES.REVIEW
          : FRAUD_OUTCOMES.CLEAR;

    const fingerprint =
      sha256({
        schemaVersion:
          SCHEMA_VERSION,

        tenantId:
          context.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        transactionId:
          context.transactionId,

        amountMinor:
          context.amountMinor,

        currency:
          context.currency,

        reference:
          context.reference,

        beneficiaryFingerprint:
          context.beneficiaryFingerprint,

        originalIdempotencyKeyHash:
          sha256(
            context.originalIdempotencyKey,
          ),

        offlineState:
          context.offlineState,

        decision,

        riskScore:
          scoreData.score,
      });

    const result = {
      success:
        true,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      component:
        COMPONENT,

      engineVersion:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      decision,

      outcome,

      allowed:
        decision ===
        FRAUD_DECISIONS.ALLOW,

      passed:
        decision ===
        FRAUD_DECISIONS.ALLOW,

      blocked:
        decision ===
        FRAUD_DECISIONS.BLOCK,

      requiresReview:
        decision ===
        FRAUD_DECISIONS.REVIEW,

      approvalRequired:
        decision !==
          FRAUD_DECISIONS.ALLOW ||
        riskLevel ===
          RISK_LEVELS.HIGH ||
        riskLevel ===
          RISK_LEVELS.CRITICAL,

      riskScore:
        scoreData.score,

      riskLevel,

      evidenceQuality:
        scoreData.evidenceQuality,

      reasonCode:
        this.#reasonCodes(
          signals,
        )[0] ??
        'FRAUD_SCREENING_COMPLETED',

      reasons:
        this.#reasonCodes(
          signals,
        ),

      signals:
        signals.slice(
          0,
          this.config.metadata
            .maxSignals,
        ),

      tenantId:
        context.tenantId,

      disbursementId:
        context.disbursementId,

      transactionId:
        context.transactionId,

      customerIdHash:
        context.customerId
          ? sha256(
              context.customerId,
            )
          : undefined,

      beneficiaryFingerprint:
        context.beneficiaryFingerprint,

      originalIdempotencyKeyHash:
        sha256(
          context.originalIdempotencyKey,
        ),

      reference:
        context.reference,

      inputFingerprint:
        fingerprint,

      evaluatedAt:
        nowIso(
          this.clock,
        ),

      externalEvidence:
        external?.evidence ??
        [],

      externalEnginesConfigured:
        external
          ?.configuredExternal ??
        0,

      externalEnginesAvailable:
        external
          ?.availableExternal ??
        0,

      nextAction:
        decision ===
        FRAUD_DECISIONS.BLOCK
          ? 'BLOCK_DISBURSEMENT'
          : decision ===
              FRAUD_DECISIONS.REVIEW
            ? 'REQUIRE_REVIEW'
            : 'CONTINUE_TO_APPROVAL_OR_EXECUTION',

      financialSafety: {
        ...FINANCIAL_SAFETY_BOUNDARY,

        preserveOriginalIdempotencyKey:
          true,

        directLedgerMutation:
          false,

        directBalanceMutation:
          false,

        directProviderExecution:
          false,
      },
    };

    return deepFreeze(
      sanitize(
        result,
        this.config,
      ),
    );
  }

  async assess(
    input = {},
  ) {
    this.statistics.evaluations +=
      1;

    const startedAt =
      nowMs(
        this.clock,
      );

    let context;

    try {
      context =
        this.#normalizeContext(
          input,
        );

      const builtInSignals =
        this.#builtInSignals(
          context,
        );

      const customSignals =
        await this.#runCustomRules(
          context,
        );

      const external =
        await this.#externalSignals(
          context,
        );

      const allSignals = [
        ...builtInSignals,
        ...customSignals,
        ...external.signals,
      ];

      const scoreData =
        this.#calculateScore(
          allSignals,
        );

      if (
        this.config.security
          .requireExternalEngine &&
        external.configuredExternal ===
          0
      ) {
        allSignals.push(
          this.#baseSignal(
            SIGNAL_TYPES.EVIDENCE_QUALITY,
            FRAUD_REASON_CODES.EVIDENCE_UNAVAILABLE,
            70,
            {
              hardBlock:
                this.config.security
                  .failClosed,

              reviewRequired:
                true,

              reason:
                'No external fraud-risk engine is configured.',
            },
          ),
        );
      }

      const finalScoreData =
        this.#calculateScore(
          allSignals,
        );

      const result =
        this.#buildResult(
          context,
          allSignals,
          finalScoreData,
          external,
        );

      const durationMs =
        Math.max(
          0,
          nowMs(
            this.clock,
          ) -
            startedAt,
        );

      const completed =
        deepFreeze({
          ...result,

          durationMs,
        });

      if (
        completed.decision ===
        FRAUD_DECISIONS.BLOCK
      ) {
        this.statistics
          .blocked +=
          1;
      } else if (
        completed.decision ===
        FRAUD_DECISIONS.REVIEW
      ) {
        this.statistics
          .reviews +=
          1;
      } else {
        this.statistics
          .allowed +=
          1;
      }

      this.#metric(
        'increment',
        'airtel.disbursement.fraud.evaluation.total',
      );

      this.#metric(
        'increment',
        `airtel.disbursement.fraud.${completed.decision.toLowerCase()}.total`,
      );

      this.#metric(
        'observe',
        'airtel.disbursement.fraud.duration_ms',
        durationMs,
      );

      await this.#audit(
        completed,
        'FRAUD_EVALUATION_COMPLETED',
      );

      if (
        completed.decision ===
        FRAUD_DECISIONS.BLOCK
      ) {
        await this.#emit(
          completed,
          'PAYMENT.AIRTEL.DISBURSEMENT.FRAUD_BLOCKED',
          {
            reasonCodes:
              completed.reasons,
          },
        );
      } else if (
        completed.decision ===
        FRAUD_DECISIONS.REVIEW
      ) {
        await this.#emit(
          completed,
          'PAYMENT.AIRTEL.DISBURSEMENT.FRAUD_REVIEW_REQUIRED',
          {
            reasonCodes:
              completed.reasons,
          },
        );
      }

      return completed;
    } catch (error) {
      this.statistics.failed +=
        1;

      this.#metric(
        'increment',
        'airtel.disbursement.fraud.evaluation.failed',
      );

      if (
        error instanceof
        FraudGuardError
      ) {
        throw error;
      }

      this.#log(
        'error',
        'Unexpected Airtel disbursement fraud evaluation failure.',
        {
          message:
            error?.message,

          tenantId:
            context?.tenantId,

          transactionId:
            context?.transactionId,
        },
      );

      if (
        this.config.security
          .failClosed
      ) {
        this.#throw(
          FRAUD_REASON_CODES.ENGINE_FAILURE,
          'Fraud evaluation failed and the configured policy is fail-closed.',
          {},
          {
            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      const fallbackContext =
        context ?? {
          tenantId:
            boundedText(
              input?.tenantId,
              LIMITS.tenantIdLength,
            ),

          transactionId:
            boundedText(
              input?.transactionId,
              LIMITS.transactionIdLength,
            ),
        };

      return deepFreeze({
        success:
          false,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        component:
          COMPONENT,

        decision:
          FRAUD_DECISIONS.ERROR,

        outcome:
          FRAUD_OUTCOMES.FAILED,

        allowed:
          false,

        passed:
          false,

        blocked:
          false,

        requiresReview:
          true,

        approvalRequired:
          true,

        riskScore:
          100,

        riskLevel:
          RISK_LEVELS.CRITICAL,

        reasonCode:
          FRAUD_REASON_CODES.ENGINE_FAILURE,

        reasons: [
          FRAUD_REASON_CODES.ENGINE_FAILURE,
        ],

        tenantId:
          fallbackContext.tenantId,

        transactionId:
          fallbackContext.transactionId,

        inputFingerprint:
          sha256({
            tenantId:
              fallbackContext
                .tenantId,

            transactionId:
              fallbackContext
                .transactionId,
          }),

        evaluatedAt:
          nowIso(
            this.clock,
          ),
      });
    }
  }

  async evaluateDisbursement(
    input = {},
  ) {
    return this.assess(
      input,
    );
  }

  async evaluate(
    input = {},
  ) {
    return this.assess(
      input,
    );
  }

  async inspect(
    input = {},
  ) {
    return this.assess(
      input,
    );
  }

  async check(
    input = {},
  ) {
    return this.assess(
      input,
    );
  }

  async enforce(
    input = {},
  ) {
    const result =
      await this.assess(
        input,
      );

    if (
      result.decision ===
      FRAUD_DECISIONS.BLOCK
    ) {
      this.#throw(
        FRAUD_REASON_CODES.CRITICAL_RISK,
        'Airtel disbursement was blocked by fraud controls.',
        {
          riskScore:
            result.riskScore,

          riskLevel:
            result.riskLevel,

          reasonCodes:
            result.reasons,
        },
        {
          statusCode:
            403,
        },
      );
    }

    return result;
  }

  getStatistics() {
    return deepFreeze({
      ...this.statistics,
    });
  }

  resetStatistics() {
    this.statistics = {
      evaluations:
        0,

      allowed:
        0,

      reviews:
        0,

      blocked:
        0,

      failed:
        0,

      externalFailures:
        0,
    };
  }

  health() {
    const dependencies = {
      riskEngine:
        Boolean(
          this.riskEngine,
        ),

      fraudDetectionService:
        Boolean(
          this.fraudDetectionService,
        ),

      fraudModelEngine:
        Boolean(
          this.fraudModelEngine,
        ),

      predictionEngine:
        Boolean(
          this.predictionEngine,
        ),

      blacklist:
        Boolean(
          this.blacklist,
        ),

      sanctionsService:
        Boolean(
          this.sanctionsService,
        ),

      complianceService:
        Boolean(
          this.complianceService,
        ),

      deviceRiskService:
        Boolean(
          this.deviceRiskService,
        ),

      velocityService:
        Boolean(
          this.velocityService,
        ),

      behavioralService:
        Boolean(
          this.behavioralService,
        ),

      auditService:
        Boolean(
          this.auditService,
        ),

      eventBus:
        Boolean(
          this.eventBus,
        ),
    };

    const externalConfigured =
      Object.values(
        dependencies,
      ).filter(
        Boolean,
      ).length;

    const healthy =
      !this.config.security
        .requireExternalEngine ||
      Boolean(
        this.riskEngine ||
          this.fraudDetectionService ||
          this.fraudModelEngine ||
          this.predictionEngine,
      );

    return deepFreeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      version:
        ENGINE_VERSION,

      healthy,

      status:
        healthy
          ? 'UP'
          : 'DEGRADED',

      dependencies,

      configuredDependencyCount:
        externalConfigured,

      controls: {
        tenantIsolation:
          this.config.security
            .requireTenantId,

        originalIdempotencyRequired:
          this.config.security
            .requireOriginalIdempotencyKey,

        rejectUnsafeOffline:
          this.config.security
            .rejectUnsafeOffline,

        failClosed:
          this.config.security
            .failClosed,

        protectSensitiveFeatures:
          this.config.security
            .protectSensitiveFeatures,

        directProviderExecution:
          false,

        directLedgerMutation:
          false,

        directBalanceMutation:
          false,
      },

      statistics:
        this.getStatistics(),
    });
  }

  readiness() {
    return this.health();
  }

  capabilities() {
    return Object.freeze({
      provider:
        PROVIDER,

      operation:
        OPERATION,

      deterministicScoring:
        true,

      customRules:
        true,

      externalRiskEngine:
        Boolean(
          this.riskEngine,
        ),

      legacyFraudService:
        Boolean(
          this.fraudDetectionService,
        ),

      fraudModelEngine:
        Boolean(
          this.fraudModelEngine,
        ),

      predictionEngine:
        Boolean(
          this.predictionEngine,
        ),

      tenantIsolation:
        true,

      originalIdempotencyPreserved:
        true,

      exactMinorUnitComparison:
        true,

      privacyPreservingFingerprints:
        true,

      authoritativeModelBlockRequired:
        true,

      directProviderCall:
        false,

      directLedgerMutation:
        false,

      directBalanceMutation:
        false,

      settlementFinality:
        false,
    });
  }
}

export const createFraudGuard = (
  options = {},
) =>
  new FraudGuard(
    options,
  );

export const createAirtelFraudGuard =
  createFraudGuard;

export const DisbursementFraudGuard =
  FraudGuard;

export const AirtelDisbursementFraudGuard =
  FraudGuard;

export default FraudGuard;