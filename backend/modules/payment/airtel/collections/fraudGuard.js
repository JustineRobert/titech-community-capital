'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Collection Fraud Guard
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/collections/fraudGuard.js
 *
 * Architectural role
 * ------------------
 * Pre-execution fraud, risk and abuse-control boundary for Airtel Money
 * COLLECTION operations. This module evaluates the payer/source side of an
 * inbound collection request and returns a deterministic, explainable decision
 * envelope to the canonical Airtel collection orchestration service.
 *
 * Canonical position
 * ------------------
 *
 *   Collection Request
 *          |
 *          v
 *   Validation / Identity
 *          |
 *          v
 *   +---------------------+
 *   |   Collection Fraud  |
 *   |        Guard        |
 *   +---------------------+
 *      |    |    |    |
 *      v    v    v    v
 *    rules risk AML models / intelligence
 *      \    |    |    /
 *       \   |    |   /
 *        v  v    v  v
 *        evidence aggregation
 *              |
 *        +-----+-------+
 *        |             |
 *       BLOCK        REVIEW / ALLOW
 *        |             |
 *        +------v------+
 *        CollectionService
 *              |
 *        Airtel Provider
 *              |
 *        Financial Core
 *
 * Responsibilities
 * ----------------
 * - Enforce tenant/provider/operation boundaries.
 * - Require financial identity and original idempotency identity.
 * - Normalize collection amount, currency, payer phone and source identity.
 * - Apply deterministic collection fraud/abuse rules.
 * - Evaluate velocity, duplicate-pattern, account, device, network, geography
 *   and behavioural risk signals.
 * - Consume injected risk, fraud, AML, sanctions, compliance, device,
 *   behavioural, prediction and model engines as evidence.
 * - Honour authoritative hard-block decisions from governed external controls.
 * - Prevent protected/demographic attributes from being direct adverse inputs.
 * - Produce ALLOW / REVIEW / BLOCK / ERROR decisions with bounded evidence.
 * - Preserve the original transaction and idempotency identity.
 * - Produce privacy-preserving fingerprints and audit/event evidence.
 * - Expose health/readiness/capability/diagnostic information.
 *
 * Explicit non-responsibilities
 * -----------------------------
 * - No Airtel HTTP/API calls.
 * - No OAuth/authentication implementation.
 * - No callback reception or callback signature verification.
 * - No transaction state-machine transitions.
 * - No ledger/journal posting.
 * - No balance/wallet mutation.
 * - No settlement/finality.
 * - No KYC/AML/sanctions source-of-truth implementation.
 * - No account blocking persistence.
 * - No autonomous model training or policy modification.
 * - No provider retry, reconciliation or compensation.
 *
 * Financial-safety principles
 * ---------------------------
 * 1. Fraud decisions are execution gates, not financial mutations.
 * 2. Provider acceptance/success is not financial settlement.
 * 3. External intelligence is evidence unless explicitly marked authoritative.
 * 4. A failed authoritative control does not accidentally become ALLOW when
 *    fail-closed operation is enabled.
 * 5. Original collection financial identity and idempotency identity are never
 *    replaced by fraud scoring.
 * 6. Exact money comparisons use integer minor units / integer strings; binary
 *    floating-point arithmetic is never used to make a financial risk decision.
 * 7. Tenant scope is part of every authoritative decision and fingerprint.
 * 8. Ambiguous provider outcomes remain a provider/reconciliation concern and
 *    are never converted into fraud conclusions by this component.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins only; no new runtime dependency.
 * =============================================================================
 */

import {
  createHash,
  randomUUID,
} from 'node:crypto';

export const MODULE_NAME =
  'titech.airtel.collections.fraud-guard';

export const ENGINE_NAME =
  'airtel-collection-fraud-guard';

export const ENGINE_VERSION =
  '3.1.0';

export const COMPONENT =
  ENGINE_NAME;

export const PROVIDER =
  'AIRTEL';

export const OPERATION =
  'COLLECTION';

export const SCHEMA_VERSION =
  3;

export const FRAUD_DECISIONS = Object.freeze({
  ALLOW: 'ALLOW',
  REVIEW: 'REVIEW',
  BLOCK: 'BLOCK',
  ERROR: 'ERROR',
});

export const FRAUD_OUTCOMES = Object.freeze({
  CLEAR: 'CLEAR',
  REVIEW: 'REVIEW',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
});

export const RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const SIGNAL_TYPES = Object.freeze({
  HARD_RULE: 'HARD_RULE',
  AMOUNT: 'AMOUNT',
  VELOCITY: 'VELOCITY',
  PAYER: 'PAYER',
  SOURCE_ACCOUNT: 'SOURCE_ACCOUNT',
  DEVICE: 'DEVICE',
  NETWORK: 'NETWORK',
  GEOGRAPHY: 'GEOGRAPHY',
  BEHAVIOUR: 'BEHAVIOUR',
  ACCOUNT: 'ACCOUNT',
  TRANSACTION_PATTERN: 'TRANSACTION_PATTERN',
  DUPLICATE_PATTERN: 'DUPLICATE_PATTERN',
  BLACKLIST: 'BLACKLIST',
  SANCTIONS: 'SANCTIONS',
  COMPLIANCE: 'COMPLIANCE',
  RISK_ENGINE: 'RISK_ENGINE',
  LEGACY_FRAUD_ENGINE: 'LEGACY_FRAUD_ENGINE',
  MODEL: 'MODEL',
  PREDICTION: 'PREDICTION',
  EVIDENCE_QUALITY: 'EVIDENCE_QUALITY',
  COLLECTION_CONTEXT: 'COLLECTION_CONTEXT',
  RULE: 'RULE',
  UNKNOWN: 'UNKNOWN',
});

export const FRAUD_REASON_CODES = Object.freeze({
  TENANT_REQUIRED: 'COLLECTION_FRAUD_TENANT_REQUIRED',
  TENANT_SCOPE_MISMATCH: 'COLLECTION_FRAUD_TENANT_SCOPE_MISMATCH',
  PROVIDER_SCOPE_VIOLATION: 'COLLECTION_FRAUD_PROVIDER_SCOPE_VIOLATION',
  OPERATION_SCOPE_VIOLATION: 'COLLECTION_FRAUD_OPERATION_SCOPE_VIOLATION',
  FINANCIAL_IDENTITY_REQUIRED: 'COLLECTION_FRAUD_FINANCIAL_IDENTITY_REQUIRED',
  IDEMPOTENCY_REQUIRED: 'COLLECTION_FRAUD_ORIGINAL_IDEMPOTENCY_REQUIRED',
  OFFLINE_UNSAFE: 'COLLECTION_FRAUD_OFFLINE_UNSAFE',
  PAYER_REQUIRED: 'COLLECTION_FRAUD_PAYER_REQUIRED',
  PHONE_REQUIRED: 'COLLECTION_FRAUD_PHONE_REQUIRED',
  AMOUNT_INVALID: 'COLLECTION_FRAUD_AMOUNT_INVALID',
  CURRENCY_INVALID: 'COLLECTION_FRAUD_CURRENCY_INVALID',
  BLACKLISTED: 'COLLECTION_FRAUD_BLACKLISTED',
  SANCTIONS_MATCH: 'COLLECTION_FRAUD_SANCTIONS_MATCH',
  COMPLIANCE_BLOCK: 'COLLECTION_FRAUD_COMPLIANCE_BLOCK',
  VELOCITY_HIGH: 'COLLECTION_FRAUD_VELOCITY_HIGH',
  VELOCITY_CRITICAL: 'COLLECTION_FRAUD_VELOCITY_CRITICAL',
  HIGH_VALUE: 'COLLECTION_FRAUD_HIGH_VALUE',
  CRITICAL_VALUE: 'COLLECTION_FRAUD_CRITICAL_VALUE',
  NEW_PAYER: 'COLLECTION_FRAUD_NEW_PAYER',
  UNVERIFIED_PAYER: 'COLLECTION_FRAUD_UNVERIFIED_PAYER',
  PAYER_MISMATCH: 'COLLECTION_FRAUD_PAYER_MISMATCH',
  DEVICE_MISMATCH: 'COLLECTION_FRAUD_DEVICE_MISMATCH',
  NEW_DEVICE: 'COLLECTION_FRAUD_NEW_DEVICE',
  NETWORK_RISK: 'COLLECTION_FRAUD_NETWORK_RISK',
  GEO_MISMATCH: 'COLLECTION_FRAUD_GEO_MISMATCH',
  TRAVEL_ANOMALY: 'COLLECTION_FRAUD_TRAVEL_ANOMALY',
  ACCOUNT_TAKEOVER: 'COLLECTION_FRAUD_ACCOUNT_TAKEOVER',
  BEHAVIOUR_ANOMALY: 'COLLECTION_FRAUD_BEHAVIOUR_ANOMALY',
  ROUND_AMOUNT: 'COLLECTION_FRAUD_ROUND_AMOUNT',
  ODD_HOUR: 'COLLECTION_FRAUD_ODD_HOUR',
  DUPLICATE_PATTERN: 'COLLECTION_FRAUD_DUPLICATE_PATTERN',
  SPLIT_PAYMENT_PATTERN: 'COLLECTION_FRAUD_SPLIT_PAYMENT_PATTERN',
  RAPID_REVERSAL_PATTERN: 'COLLECTION_FRAUD_RAPID_REVERSAL_PATTERN',
  EXTERNAL_RISK_BLOCK: 'COLLECTION_FRAUD_EXTERNAL_RISK_BLOCK',
  CRITICAL_RISK: 'COLLECTION_FRAUD_CRITICAL_RISK',
  HIGH_RISK: 'COLLECTION_FRAUD_HIGH_RISK',
  REVIEW_RISK: 'COLLECTION_FRAUD_REVIEW_RISK',
  EVIDENCE_UNAVAILABLE: 'COLLECTION_FRAUD_EVIDENCE_UNAVAILABLE',
  ENGINE_FAILURE: 'COLLECTION_FRAUD_ENGINE_FAILURE',
  RULE_FAILURE: 'COLLECTION_FRAUD_RULE_FAILURE',
});

export const ERROR_CODES = Object.freeze({
  REQUEST_REQUIRED: 'COLLECTION_FRAUD_REQUEST_REQUIRED',
  TENANT_REQUIRED: FRAUD_REASON_CODES.TENANT_REQUIRED,
  PROVIDER_INVALID: FRAUD_REASON_CODES.PROVIDER_SCOPE_VIOLATION,
  OPERATION_INVALID: FRAUD_REASON_CODES.OPERATION_SCOPE_VIOLATION,
  IDENTITY_REQUIRED: FRAUD_REASON_CODES.FINANCIAL_IDENTITY_REQUIRED,
  IDEMPOTENCY_REQUIRED: FRAUD_REASON_CODES.IDEMPOTENCY_REQUIRED,
  PAYER_REQUIRED: FRAUD_REASON_CODES.PAYER_REQUIRED,
  PHONE_REQUIRED: FRAUD_REASON_CODES.PHONE_REQUIRED,
  AMOUNT_INVALID: FRAUD_REASON_CODES.AMOUNT_INVALID,
  CURRENCY_INVALID: FRAUD_REASON_CODES.CURRENCY_INVALID,
  OFFLINE_UNSAFE: FRAUD_REASON_CODES.OFFLINE_UNSAFE,
  ENGINE_FAILURE: FRAUD_REASON_CODES.ENGINE_FAILURE,
  RULE_FAILURE: FRAUD_REASON_CODES.RULE_FAILURE,
  AUDIT_UNAVAILABLE: 'COLLECTION_FRAUD_AUDIT_UNAVAILABLE',
  EVENT_UNAVAILABLE: 'COLLECTION_FRAUD_EVENT_UNAVAILABLE',
  INTERNAL_ERROR: 'COLLECTION_FRAUD_INTERNAL_ERROR',
});

export const OFFLINE_UNSAFE_STATES = Object.freeze([
  'LOCAL_ONLY',
  'PENDING_SYNC',
  'SYNCING',
  'SERVER_REJECTED',
  'CONFLICT',
  'REQUIRES_REVIEW',
]);

export const CAPABILITIES = Object.freeze({
  fraudEvaluation: true,
  deterministicRules: true,
  externalRiskSignals: true,
  amlSignals: true,
  sanctionsSignals: true,
  complianceSignals: true,
  payerRisk: true,
  velocityRisk: true,
  duplicatePatternRisk: true,
  callbackProcessing: false,
  providerCommunication: false,
  paymentExecution: false,
  stateMutation: false,
  ledgerMutation: false,
  balanceMutation: false,
  walletMutation: false,
  settlementFinality: false,
  modelTraining: false,
  policyMutation: false,
  tenantIsolation: true,
  privacyPreservingAudit: true,
});

const DEFAULT_CONFIG = Object.freeze({
  version: ENGINE_VERSION,

  thresholds: Object.freeze({
    reviewScore: 45,
    highRiskScore: 70,
    blockScore: 85,
    criticalScore: 90,
    maximumAutomaticEvidencePenalty: 30,
  }),

  weights: Object.freeze({
    amount: 0.09,
    velocity: 0.16,
    payer: 0.13,
    sourceAccount: 0.10,
    device: 0.09,
    network: 0.07,
    geography: 0.06,
    behaviour: 0.09,
    account: 0.08,
    transactionPattern: 0.05,
    duplicatePattern: 0.04,
    externalRisk: 0.06,
    model: 0.04,
    prediction: 0.04,
  }),

  amountThresholdsMinor: Object.freeze({
    UGX: Object.freeze({
      review: '5000000',
      high: '10000000',
      critical: '50000000',
    }),
  }),

  velocity: Object.freeze({
    hourlyReviewCount: 8,
    hourlyHighCount: 20,
    hourlyCriticalCount: 40,
    dailyReviewCount: 30,
    dailyHighCount: 80,
    dailyCriticalCount: 200,
    amountReviewCount: 6,
    amountHighCount: 15,
  }),

  payer: Object.freeze({
    newPayerScore: 30,
    unverifiedPayerScore: 40,
    mismatchScore: 75,
    dormantScore: 35,
    knownGoodScore: 0,
  }),

  sourceAccount: Object.freeze({
    newAccountScore: 25,
    unverifiedScore: 45,
    mismatchScore: 80,
    multipleCustomerScore: 55,
    muleLikeScore: 80,
  }),

  device: Object.freeze({
    mismatchScore: 80,
    newDeviceScore: 35,
    rootedScore: 60,
    emulatorScore: 70,
    automationScore: 90,
  }),

  network: Object.freeze({
    vpnScore: 35,
    torScore: 95,
    proxyScore: 60,
    riskyAsnScore: 65,
    hostingScore: 70,
    missingScore: 10,
  }),

  geography: Object.freeze({
    mismatchScore: 70,
    travelScore: 90,
    crossBorderScore: 55,
    missingScore: 10,
  }),

  behaviour: Object.freeze({
    unusualScore: 55,
    extremeScore: 90,
    defaultScore: 5,
  }),

  account: Object.freeze({
    passwordResetScore: 40,
    recentPhoneChangeScore: 50,
    recentProfileChangeScore: 30,
    failedLoginScore: 45,
    compromisedScore: 100,
  }),

  transactionPattern: Object.freeze({
    roundAmountScore: 20,
    oddHourScore: 20,
    rapidSuccessiveScore: 35,
    repeatedReferenceScore: 50,
  }),

  duplicatePattern: Object.freeze({
    exactDuplicateScore: 80,
    nearDuplicateScore: 60,
    burstScore: 70,
  }),

  evidence: Object.freeze({
    staleMaxAgeMs: 24 * 60 * 60 * 1000,
    externalTimeoutMs: 5000,
    unavailablePenalty: 15,
  }),

  security: Object.freeze({
    requireTenantId: true,
    requireFinancialIdentity: true,
    requireOriginalIdempotencyKey: true,
    requirePayer: true,
    requirePhone: true,
    requireSupportedCurrency: true,
    rejectUnsafeOffline: true,
    failClosed: true,
    failClosedOnExternalEngineFailure: true,
    failClosedOnAuditError: false,
    failClosedOnEventError: false,
    protectSensitiveFeatures: true,
  }),

  collection: Object.freeze({
    defaultCurrency: 'UGX',
    supportedCurrencies: Object.freeze(['UGX']),
    countryCode: 'UG',
    minimumPositiveAmountMinor: '1',
    maximumAmountMinor: '5000000000',
  }),

  metadata: Object.freeze({
    maxSignals: 100,
    maxReasons: 30,
    maxEvidenceItems: 80,
    maxKeys: 80,
    maxArrayLength: 50,
    maxDepth: 6,
    maxStringLength: 512,
  }),
});

const SENSITIVE_KEY_PATTERNS = Object.freeze([
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
  /rawpayload/i,
  /raw_payload/i,
]);

const PROTECTED_FEATURE_PATTERNS = Object.freeze([
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

const UNSAFE_KEY_NAMES = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype,
  );
}

function isFunction(value) {
  return typeof value === 'function';
}

function boundedString(
  value,
  maxLength = DEFAULT_CONFIG.metadata.maxStringLength,
) {
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
}

function upper(value) {
  const normalized = boundedString(
    value,
    256,
  );

  return normalized
    ? normalized.toUpperCase()
    : undefined;
}

function finiteNumber(
  value,
  fallback = 0,
) {
  const numeric =
    typeof value === 'number'
      ? value
      : Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : fallback;
}

function clamp(
  value,
  minimum = 0,
  maximum = 100,
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      finiteNumber(
        value,
        minimum,
      ),
    ),
  );
}

function deepFreeze(
  value,
  seen = new WeakSet(),
) {
  if (
    !value ||
    typeof value !== 'object' ||
    seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (const child of Object.values(value)) {
    deepFreeze(
      child,
      seen,
    );
  }

  return Object.freeze(value);
}

function stable(value) {
  if (
    value === undefined
  ) {
    return '[undefined]';
  }

  if (
    value === null
  ) {
    return null;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(stable);
  }

  if (
    isPlainObject(value)
  ) {
    return Object.keys(value)
      .filter(
        (key) =>
          !UNSAFE_KEY_NAMES.has(key),
      )
      .sort()
      .reduce(
        (result, key) => {
          result[key] = stable(
            value[key],
          );
          return result;
        },
        {},
      );
  }

  if (
    typeof value === 'bigint'
  ) {
    return value.toString();
  }

  return value;
}

function sha256(value) {
  return createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : JSON.stringify(
            stable(value),
          ),
      'utf8',
    )
    .digest('hex');
}

function sanitize(
  value,
  config,
  depth = 0,
  seen = new WeakSet(),
) {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  if (
    depth >
    config.metadata.maxDepth
  ) {
    return '[TRUNCATED]';
  }

  if (
    typeof value === 'string'
  ) {
    return value.slice(
      0,
      config.metadata.maxStringLength,
    );
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    typeof value === 'bigint'
  ) {
    return value.toString();
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    seen.has(value)
  ) {
    return '[CIRCULAR]';
  }

  seen.add(value);

  if (
    Array.isArray(value)
  ) {
    return value
      .slice(
        0,
        config.metadata.maxArrayLength,
      )
      .map(
        (item) =>
          sanitize(
            item,
            config,
            depth + 1,
            seen,
          ),
      );
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const result = {};

  for (
    const key of Object.keys(value).slice(
      0,
      config.metadata.maxKeys,
    )
  ) {
    if (
      UNSAFE_KEY_NAMES.has(key)
    ) {
      continue;
    }

    if (
      SENSITIVE_KEY_PATTERNS.some(
        (pattern) =>
          pattern.test(key),
      )
    ) {
      result[key] =
        '[REDACTED]';
      continue;
    }

    if (
      config.security
        .protectSensitiveFeatures &&
      PROTECTED_FEATURE_PATTERNS.some(
        (pattern) =>
          pattern.test(key),
      )
    ) {
      result[key] =
        '[EXCLUDED_FEATURE]';
      continue;
    }

    result[key] = sanitize(
      value[key],
      config,
      depth + 1,
      seen,
    );
  }

  return result;
}

function parseDate(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? null
    : date;
}

function normalizePhone(
  value,
  countryCode = 'UG',
) {
  const raw = boundedString(
    value,
    64,
  );

  if (!raw) {
    return undefined;
  }

  const digits = raw.replace(
    /\D/g,
    '',
  );

  if (!digits) {
    return undefined;
  }

  if (
    digits.startsWith('00')
  ) {
    return `+${digits.slice(2)}`;
  }

  if (
    digits.startsWith('256')
  ) {
    return `+${digits}`;
  }

  if (
    countryCode === 'UG' &&
    digits.length === 10 &&
    digits.startsWith('0')
  ) {
    return `+256${digits.slice(1)}`;
  }

  if (
    countryCode === 'UG' &&
    digits.length === 9
  ) {
    return `+256${digits}`;
  }

  return `+${digits}`;
}

function maskPhone(value) {
  if (!value) return undefined;
  if (value.length <= 7) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-3)}`;
}

function normalizeMinorAmount(
  value,
  currency,
  config,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const raw =
    String(value).trim();

  if (
    /^\d+$/.test(raw)
  ) {
    try {
      const integer =
        BigInt(raw);

      return integer >= 0n &&
        integer <=
          BigInt(Number.MAX_SAFE_INTEGER)
        ? integer.toString()
        : null;
    } catch {
      return null;
    }
  }

  if (
    !/^\d+(?:\.\d+)?$/.test(raw)
  ) {
    return null;
  }

  const units =
    Number(
      config?.currencyMinorUnits?.[
        currency
      ] ??
        (
          currency === 'UGX' ||
          currency === 'RWF'
            ? 0
            : 2
        ),
    );

  if (!Number.isInteger(units)) {
    return null;
  }

  const [
    whole,
    fractional = '',
  ] = raw.split('.');

  if (
    fractional.length > units &&
    /[^0]/.test(
      fractional.slice(units),
    )
  ) {
    return null;
  }

  const scale =
    10n ** BigInt(units);

  const fractionPadded =
    `${fractional}00000000`.slice(
      0,
      units,
    );

  try {
    const result =
      BigInt(whole) *
        scale +
      BigInt(
        fractionPadded ||
          '0',
      );

    if (
      result < 0n ||
      result >
        BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return null;
    }

    return result.toString();
  } catch {
    return null;
  }
}

function compareMinorAmounts(
  left,
  right,
) {
  if (
    left === null ||
    left === undefined ||
    right === null ||
    right === undefined
  ) {
    return null;
  }

  try {
    const a = BigInt(left);
    const b = BigInt(right);

    return a === b
      ? 0
      : a > b
        ? 1
        : -1;
  } catch {
    return null;
  }
}

function addMinorAmounts(
  values = [],
) {
  try {
    let total = 0n;

    for (
      const value of values
    ) {
      if (
        value === null ||
        value === undefined
      ) {
        continue;
      }

      total += BigInt(value);
    }

    return total.toString();
  } catch {
    return null;
  }
}

function readScore(result) {
  if (!result) return null;

  const values = [
    result.riskScore,
    result.fraudScore,
    result.score,
    result.probability,
    result.risk,
  ];

  for (const value of values) {
    const numeric =
      finiteNumber(
        value,
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
}

function readDecision(result) {
  return upper(
    result?.decision?.action ??
      result?.decision?.status ??
      result?.decision ??
      result?.action ??
      result?.status ??
      result?.outcome,
  );
}

function readEvidenceQuality(result) {
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
      'ERROR',
    ].includes(state)
  ) {
    return 0;
  }

  if (
    [
      'PARTIAL',
      'INSUFFICIENT_EVIDENCE',
    ].includes(state)
  ) {
    return 35;
  }

  if (
    [
      'AVAILABLE',
      'COMPLETED',
      'HEALTHY',
    ].includes(state)
  ) {
    return 100;
  }

  return 70;
}

function isAuthoritativeBlock(result) {
  return (
    result?.authoritative === true &&
    (
      result?.blocked === true ||
      [
        'BLOCK',
        'DENY',
        'DENIED',
        'REJECT',
        'REJECTED',
      ].includes(
        readDecision(result),
      )
    )
  );
}

function requiresReview(result) {
  return (
    Boolean(
      result?.requiresReview ??
        result?.reviewRequired ??
        false,
    ) ||
    [
      'REVIEW',
      'REVIEW_REQUIRED',
      'ESCALATE',
      'ESCALATED',
      'MANUAL_REVIEW',
    ].includes(
      readDecision(result),
    )
  );
}

function toCount(value) {
  const numeric =
    finiteNumber(
      value,
      0,
    );

  return Math.max(
    0,
    Math.floor(numeric),
  );
}

function scoreVelocity(
  count,
  review,
  high,
  critical,
) {
  if (
    count >= critical
  ) return 100;

  if (
    count >= high
  ) return 85;

  if (
    count >= review
  ) return 65;

  if (
    review <= 0
  ) return 0;

  return clamp(
    (count / review) * 45,
  );
}

function riskLevelForScore(
  score,
  config,
) {
  const numeric =
    clamp(score);

  if (
    numeric >=
    config.thresholds.criticalScore
  ) {
    return RISK_LEVELS.CRITICAL;
  }

  if (
    numeric >=
    config.thresholds.highRiskScore
  ) {
    return RISK_LEVELS.HIGH;
  }

  if (
    numeric >=
    config.thresholds.reviewScore
  ) {
    return RISK_LEVELS.MEDIUM;
  }

  return RISK_LEVELS.LOW;
}

function scoreDecision(
  score,
  config,
) {
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
}

function numericWeightedScore(
  signals,
  weights,
) {
  let weighted = 0;
  let totalWeight = 0;

  for (const signal of signals) {
    const weight =
      finiteNumber(
        weights[signal.key],
        0,
      );

    if (
      weight <= 0 ||
      !Number.isFinite(
        signal.score,
      )
    ) {
      continue;
    }

    weighted +=
      clamp(signal.score) *
      weight;

    totalWeight += weight;
  }

  return totalWeight > 0
    ? weighted / totalWeight
    : 0;
}

function isUnsafeOfflineState(value) {
  return OFFLINE_UNSAFE_STATES.includes(
    upper(value),
  );
}

function maskReference(value) {
  const normalized =
    boundedString(
      value,
      256,
    );

  if (!normalized) {
    return undefined;
  }

  return normalized.length <= 8
    ? '***'
    : `${normalized.slice(0, 4)}***${normalized.slice(-4)}`;
}

function normalizedIdentifier(value) {
  return boundedString(
    value,
    256,
  );
}

export class CollectionFraudGuardError
  extends Error {
  constructor(
    message,
    {
      code = ERROR_CODES.INTERNAL_ERROR,
      statusCode = 500,
      retryable = false,
      tenantId = null,
      transactionId = null,
      correlationId = null,
      details = {},
      cause,
      config,
    } = {},
  ) {
    super(
      String(
        message ||
          'Airtel collection fraud evaluation failed.',
      ),
      cause
        ? { cause }
        : undefined,
    );

    this.name =
      'CollectionFraudGuardError';

    this.code = code;
    this.statusCode =
      Number(statusCode) || 500;
    this.retryable =
      Boolean(retryable);
    this.tenantId =
      tenantId ?? null;
    this.transactionId =
      transactionId ?? null;
    this.correlationId =
      correlationId ?? null;
    this.details = sanitize(
      details,
      config ||
        DEFAULT_CONFIG,
    );
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode:
        this.statusCode,
      retryable:
        this.retryable,
      tenantId:
        this.tenantId,
      transactionId:
        this.transactionId,
      correlationId:
        this.correlationId,
      details:
        this.details,
    };
  }
}

export class CollectionFraudGuard {
  constructor(options = {}) {
    const supplied =
      options.configuration ??
      options.config ??
      {};

    this.config = deepFreeze({
      ...DEFAULT_CONFIG,
      ...supplied,

      thresholds: {
        ...DEFAULT_CONFIG.thresholds,
        ...(supplied.thresholds || {}),
      },

      weights: {
        ...DEFAULT_CONFIG.weights,
        ...(supplied.weights || {}),
      },

      amountThresholdsMinor: {
        ...DEFAULT_CONFIG.amountThresholdsMinor,
        ...(supplied.amountThresholdsMinor || {}),
      },

      velocity: {
        ...DEFAULT_CONFIG.velocity,
        ...(supplied.velocity || {}),
      },

      payer: {
        ...DEFAULT_CONFIG.payer,
        ...(supplied.payer || {}),
      },

      sourceAccount: {
        ...DEFAULT_CONFIG.sourceAccount,
        ...(supplied.sourceAccount || {}),
      },

      device: {
        ...DEFAULT_CONFIG.device,
        ...(supplied.device || {}),
      },

      network: {
        ...DEFAULT_CONFIG.network,
        ...(supplied.network || {}),
      },

      geography: {
        ...DEFAULT_CONFIG.geography,
        ...(supplied.geography || {}),
      },

      behaviour: {
        ...DEFAULT_CONFIG.behaviour,
        ...(supplied.behaviour || {}),
      },

      account: {
        ...DEFAULT_CONFIG.account,
        ...(supplied.account || {}),
      },

      transactionPattern: {
        ...DEFAULT_CONFIG.transactionPattern,
        ...(supplied.transactionPattern || {}),
      },

      duplicatePattern: {
        ...DEFAULT_CONFIG.duplicatePattern,
        ...(supplied.duplicatePattern || {}),
      },

      evidence: {
        ...DEFAULT_CONFIG.evidence,
        ...(supplied.evidence || {}),
      },

      security: {
        ...DEFAULT_CONFIG.security,
        ...(supplied.security || {}),
      },

      collection: {
        ...DEFAULT_CONFIG.collection,
        ...(supplied.collection || {}),
      },

      metadata: {
        ...DEFAULT_CONFIG.metadata,
        ...(supplied.metadata || {}),
      },

      currencyMinorUnits: {
        UGX: 0,
        RWF: 0,
        KES: 2,
        TZS: 2,
        ZMW: 2,
        GHS: 2,
        NGN: 2,
        USD: 2,
        ...(supplied.currencyMinorUnits || {}),
      },
    });

    this.rules =
      Array.isArray(options.rules)
        ? [...options.rules]
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
      options.modelEngine ??
      null;

    this.predictionEngine =
      options.predictionEngine ??
      null;

    this.sanctionsService =
      options.sanctionsService ??
      null;

    this.complianceService =
      options.complianceService ??
      null;

    this.blacklist =
      options.blacklist ??
      options.blacklistService ??
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

    this.networkRiskService =
      options.networkRiskService ??
      null;

    this.geographyRiskService =
      options.geographyRiskService ??
      null;

    this.duplicateDetectionService =
      options.duplicateDetectionService ??
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
        `collection-fraud-${randomUUID()}`);

    this.statistics = {
      evaluations: 0,
      allowed: 0,
      reviews: 0,
      blocked: 0,
      failed: 0,
      externalFailures: 0,
      authoritativeBlocks: 0,
      sanctionsBlocks: 0,
      complianceBlocks: 0,
      blacklistBlocks: 0,
      velocityReviews: 0,
      velocityBlocks: 0,
      duplicateReviews: 0,
      evidenceDegradation: 0,
      auditFailures: 0,
      eventFailures: 0,
    };
  }

  #throw(
    code,
    message,
    details = {},
    options = {},
  ) {
    throw new CollectionFraudGuardError(
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
      const fn =
        this.logger?.[level] ??
        this.logger?.log ??
        this.logger?.info;

      if (!isFunction(fn)) {
        return;
      }

      fn.call(
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
    value = 1,
  ) {
    try {
      const fn =
        this.metrics?.[method];

      if (!isFunction(fn)) {
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

  #normalizeContext(
    input = {},
  ) {
    if (!isPlainObject(input)) {
      this.#throw(
        ERROR_CODES.REQUEST_REQUIRED,
        'Collection fraud evaluation input must be a plain object.',
        {},
        { statusCode: 422 },
      );
    }

    const tenantId =
      boundedString(
        input.tenantId,
        160,
      );

    if (
      this.config.security
        .requireTenantId &&
      !tenantId
    ) {
      this.#throw(
        FRAUD_REASON_CODES.TENANT_REQUIRED,
        'tenantId is required for Airtel collection fraud evaluation.',
        {},
        { statusCode: 422 },
      );
    }

    const provider =
      upper(
        input.provider ??
          PROVIDER,
      );

    if (
      provider !== PROVIDER
    ) {
      this.#throw(
        FRAUD_REASON_CODES.PROVIDER_SCOPE_VIOLATION,
        'Collection fraud guard is scoped to Airtel.',
        { provider },
        { statusCode: 409 },
      );
    }

    const operation =
      upper(
        input.operation ??
          OPERATION,
      );

    if (
      operation !== OPERATION
    ) {
      this.#throw(
        FRAUD_REASON_CODES.OPERATION_SCOPE_VIOLATION,
        'Collection fraud guard only supports COLLECTION operations.',
        { operation },
        { statusCode: 409 },
      );
    }

    const transactionId =
      normalizedIdentifier(
        input.transactionId ??
          input.paymentId ??
          input.collectionId,
      );

    if (
      this.config.security
        .requireFinancialIdentity &&
      !transactionId
    ) {
      this.#throw(
        FRAUD_REASON_CODES.FINANCIAL_IDENTITY_REQUIRED,
        'transactionId, paymentId or collectionId is required.',
        {},
        { statusCode: 422 },
      );
    }

    const originalIdempotencyKey =
      normalizedIdentifier(
        input.originalIdempotencyKey ??
          input.idempotencyKey,
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
        { statusCode: 422 },
      );
    }

    const payer =
      input.payer ??
      input.customer ??
      input.customerIdentity ??
      {};

    if (
      this.config.security.requirePayer &&
      !payer
    ) {
      this.#throw(
        FRAUD_REASON_CODES.PAYER_REQUIRED,
        'Payer identity is required for collection fraud evaluation.',
        {},
        { statusCode: 422 },
      );
    }

    const country =
      upper(
        input.country ??
          this.config.collection
            .countryCode,
      );

    const currency =
      upper(
        input.currency ??
          this.config.collection
            .defaultCurrency,
      );

    if (
      this.config.security
        .requireSupportedCurrency &&
      !this.config.collection
        .supportedCurrencies
        .includes(currency)
    ) {
      this.#throw(
        FRAUD_REASON_CODES.CURRENCY_INVALID,
        'Currency is not supported by the Airtel collection fraud policy.',
        { currency },
        { statusCode: 422 },
      );
    }

    const amountMinor =
      normalizeMinorAmount(
        input.amountMinor ??
          input.amount,
        currency,
        this.config,
      );

    if (!amountMinor) {
      this.#throw(
        FRAUD_REASON_CODES.AMOUNT_INVALID,
        'A valid positive collection amount is required.',
        {},
        { statusCode: 422 },
      );
    }

    const minimum =
      this.config.collection
        .minimumPositiveAmountMinor;

    if (
      compareMinorAmounts(
        amountMinor,
        minimum,
      ) < 1
    ) {
      this.#throw(
        FRAUD_REASON_CODES.AMOUNT_INVALID,
        'Collection amount must be greater than zero.',
        {},
        { statusCode: 422 },
      );
    }

    if (
      compareMinorAmounts(
        amountMinor,
        this.config.collection
          .maximumAmountMinor,
      ) > 0
    ) {
      this.#throw(
        FRAUD_REASON_CODES.AMOUNT_INVALID,
        'Collection amount exceeds the configured fraud-evaluation ceiling.',
        {},
        { statusCode: 422 },
      );
    }

    const phone =
      normalizePhone(
        input.phoneNumber ??
          input.msisdn ??
          payer.phoneNumber ??
          payer.phone ??
          payer.msisdn,
        this.config.collection
          .countryCode,
      );

    if (
      this.config.security.requirePhone &&
      !phone
    ) {
      this.#throw(
        FRAUD_REASON_CODES.PHONE_REQUIRED,
        'Payer phone number is required for Airtel collection fraud evaluation.',
        {},
        { statusCode: 422 },
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
        'Unresolved offline state cannot enter financial collection execution.',
        { offlineState },
        { statusCode: 409 },
      );
    }

    const actorTenantId =
      boundedString(
        input.actor?.tenantId,
        160,
      );

    if (
      actorTenantId &&
      actorTenantId !== tenantId
    ) {
      this.#throw(
        FRAUD_REASON_CODES.TENANT_SCOPE_MISMATCH,
        'Actor tenant does not match the collection fraud tenant.',
        {},
        { statusCode: 403 },
      );
    }

    const context = {
      tenantId,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      transactionId,
      collectionId:
        normalizedIdentifier(
          input.collectionId ??
            input.transactionId ??
            input.paymentId,
        ),
      originalIdempotencyKey,
      amountMinor,
      currency,
      phone,
      payer,
      payerFingerprint:
        sha256(
          stable(payer),
        ),
      sourceAccount:
        input.sourceAccount ??
        input.source ??
        null,
      customerId:
        normalizedIdentifier(
          input.customerId ??
            input.memberId ??
            payer.customerId ??
            payer.memberId,
        ),
      merchantId:
        normalizedIdentifier(
          input.merchantId ??
            input.institutionId,
        ),
      groupId:
        normalizedIdentifier(
          input.groupId,
        ),
      externalReference:
        normalizedIdentifier(
          input.externalReference ??
            input.reference,
        ),
      reference:
        normalizedIdentifier(
          input.reference ??
            input.externalReference,
        ),
      country,
      channel:
        upper(
          input.channel ??
            'AIRTEL',
        ),
      offlineState,
      device:
        input.device ??
        {},
      network:
        input.network ??
        {},
      geography:
        input.geography ??
        {},
      behaviour:
        input.behaviour ??
        input.behavior ??
        {},
      account:
        input.account ??
        {},
      velocity:
        input.velocity ??
        {},
      transactionPattern:
        input.transactionPattern ??
        {},
      duplicatePattern:
        input.duplicatePattern ??
        {},
      compliance:
        input.compliance ??
        {},
      metadata:
        sanitize(
          input.metadata ?? {},
          this.config,
        ),
      occurredAt:
        parseDate(
          input.occurredAt ??
            input.timestamp,
        ),
      requestId:
        boundedString(
          input.requestId,
          160,
        ),
      correlationId:
        boundedString(
          input.correlationId,
          160,
        ),
      traceId:
        boundedString(
          input.traceId,
          160,
        ),
    };

    return context;
  }

  #inputFingerprint(context) {
    return sha256({
      tenantId:
        context.tenantId,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      transactionId:
        context.transactionId,
      originalIdempotencyKeyHash:
        context.originalIdempotencyKey
          ? sha256(
              context.originalIdempotencyKey,
            )
          : null,
      amountMinor:
        context.amountMinor,
      currency:
        context.currency,
      phone:
        context.phone,
      payerFingerprint:
        context.payerFingerprint,
      sourceAccountFingerprint:
        context.sourceAccount
          ? sha256(
              stable(
                context.sourceAccount,
              ),
            )
          : null,
      externalReference:
        context.externalReference,
    });
  }

  #baseSignal(
    key,
    type,
    code,
    score,
    {
      hardBlock = false,
      reviewRequired = false,
      reason,
      evidence,
      source,
    } = {},
  ) {
    return {
      key,
      type,
      code,
      score:
        clamp(score),
      hardBlock:
        hardBlock === true,
      reviewRequired:
        reviewRequired === true,
      severity:
        riskLevelForScore(
          score,
          this.config,
        ),
      reason:
        boundedString(
          reason,
          500,
        ),
      evidence:
        sanitize(
          evidence ?? {},
          this.config,
        ),
      source:
        boundedString(
          source,
          160,
        ),
    };
  }

  #deterministicSignals(
    context,
  ) {
    const signals = [];
    const amountThresholds =
      this.config.amountThresholdsMinor[
        context.currency
      ] ||
      this.config.amountThresholdsMinor.UGX;

    if (
      amountThresholds
    ) {
      if (
        compareMinorAmounts(
          context.amountMinor,
          amountThresholds.critical,
        ) >= 0
      ) {
        signals.push(
          this.#baseSignal(
            'amount',
            SIGNAL_TYPES.AMOUNT,
            FRAUD_REASON_CODES.CRITICAL_VALUE,
            75,
            {
              reviewRequired:
                true,
              reason:
                'Collection amount is above the configured critical-value threshold.',
              evidence: {
                amountClass:
                  'CRITICAL',
              },
            },
          ),
        );
      } else if (
        compareMinorAmounts(
          context.amountMinor,
          amountThresholds.high,
        ) >= 0
      ) {
        signals.push(
          this.#baseSignal(
            'amount',
            SIGNAL_TYPES.AMOUNT,
            FRAUD_REASON_CODES.HIGH_VALUE,
            50,
            {
              reviewRequired:
                true,
              reason:
                'Collection amount is above the configured high-value threshold.',
              evidence: {
                amountClass:
                  'HIGH',
              },
            },
          ),
        );
      } else if (
        compareMinorAmounts(
          context.amountMinor,
          amountThresholds.review,
        ) >= 0
      ) {
        signals.push(
          this.#baseSignal(
            'amount',
            SIGNAL_TYPES.AMOUNT,
            FRAUD_REASON_CODES.HIGH_VALUE,
            35,
            {
              reviewRequired:
                true,
              reason:
                'Collection amount is elevated relative to configured review thresholds.',
            },
          ),
        );
      }
    }

    if (
      this.#isRoundAmount(
        context.amountMinor,
        context.currency,
      )
    ) {
      signals.push(
        this.#baseSignal(
          'transactionPattern',
          SIGNAL_TYPES.TRANSACTION_PATTERN,
          FRAUD_REASON_CODES.ROUND_AMOUNT,
          this.config.transactionPattern
            .roundAmountScore,
          {
            reason:
              'Collection amount exhibits a configured round-amount pattern.',
          },
        ),
      );
    }

    const hourlyCount =
      toCount(
        context.velocity.hourlyCount ??
          context.velocityHourlyCount ??
          context.history?.hourlyCount,
      );

    const dailyCount =
      toCount(
        context.velocity.dailyCount ??
          context.velocityDailyCount ??
          context.history?.dailyCount,
      );

    const hourlyScore =
      scoreVelocity(
        hourlyCount,
        this.config.velocity
          .hourlyReviewCount,
        this.config.velocity
          .hourlyHighCount,
        this.config.velocity
          .hourlyCriticalCount,
      );

    const dailyScore =
      scoreVelocity(
        dailyCount,
        this.config.velocity
          .dailyReviewCount,
        this.config.velocity
          .dailyHighCount,
        this.config.velocity
          .dailyCriticalCount,
      );

    const velocityScore =
      Math.max(
        hourlyScore,
        dailyScore,
      );

    if (
      velocityScore >=
      this.config.thresholds.blockScore
    ) {
      this.statistics.velocityBlocks +=
        1;

      signals.push(
        this.#baseSignal(
          'velocity',
          SIGNAL_TYPES.VELOCITY,
          FRAUD_REASON_CODES.VELOCITY_CRITICAL,
          95,
          {
            hardBlock:
              true,
            reviewRequired:
              true,
            reason:
              'Collection velocity exceeded the configured critical threshold.',
            evidence: {
              hourlyCount,
              dailyCount,
            },
          },
        ),
      );
    } else if (
      velocityScore >=
      this.config.thresholds.highRiskScore
    ) {
      this.statistics.velocityReviews +=
        1;

      signals.push(
        this.#baseSignal(
          'velocity',
          SIGNAL_TYPES.VELOCITY,
          FRAUD_REASON_CODES.VELOCITY_HIGH,
          velocityScore,
          {
            reviewRequired:
              true,
            reason:
              'Collection velocity is materially elevated.',
            evidence: {
              hourlyCount,
              dailyCount,
            },
          },
        ),
      );
    } else if (
      velocityScore >=
      this.config.thresholds.reviewScore
    ) {
      signals.push(
        this.#baseSignal(
          'velocity',
          SIGNAL_TYPES.VELOCITY,
          FRAUD_REASON_CODES.VELOCITY_HIGH,
          velocityScore,
          {
            reviewRequired:
              true,
            reason:
              'Collection velocity requires additional review.',
            evidence: {
              hourlyCount,
              dailyCount,
            },
          },
        ),
      );
    }

    const payer =
      isPlainObject(
        context.payer,
      )
        ? context.payer
        : {};

    if (
      payer.blacklisted === true ||
      payer.blocked === true
    ) {
      this.statistics.blacklistBlocks +=
        1;

      signals.push(
        this.#baseSignal(
          'payer',
          SIGNAL_TYPES.BLACKLIST,
          FRAUD_REASON_CODES.BLACKLISTED,
          100,
          {
            hardBlock:
              true,
            reviewRequired:
              true,
            reason:
              'Payer is marked blocked or blacklisted by upstream evidence.',
          },
        ),
      );
    }

    if (
      payer.sanctionsMatch === true ||
      context.compliance.sanctionsMatch ===
        true
    ) {
      this.statistics.sanctionsBlocks +=
        1;

      signals.push(
        this.#baseSignal(
          'payer',
          SIGNAL_TYPES.SANCTIONS,
          FRAUD_REASON_CODES.SANCTIONS_MATCH,
          100,
          {
            hardBlock:
              true,
            reviewRequired:
              true,
            reason:
              'Upstream sanctions screening indicates a match.',
          },
        ),
      );
    }

    if (
      context.compliance.blocked ===
        true
    ) {
      this.statistics.complianceBlocks +=
        1;

      signals.push(
        this.#baseSignal(
          'compliance',
          SIGNAL_TYPES.COMPLIANCE,
          FRAUD_REASON_CODES.COMPLIANCE_BLOCK,
          100,
          {
            hardBlock:
              true,
            reviewRequired:
              true,
            reason:
              'An upstream compliance control blocked the collection.',
          },
        ),
      );
    }

    const newPayer =
      payer.newPayer === true ||
      payer.isNew === true ||
      context.newPayer === true;

    const unverifiedPayer =
      payer.unverified === true ||
      payer.isUnverified === true ||
      payer.identityVerified === false;

    const payerMismatch =
      payer.mismatch === true ||
      payer.identityMismatch === true ||
      payer.nameMismatch === true;

    if (newPayer) {
      signals.push(
        this.#baseSignal(
          'payer',
          SIGNAL_TYPES.PAYER,
          FRAUD_REASON_CODES.NEW_PAYER,
          this.config.payer.newPayerScore,
          {
            reviewRequired:
              false,
            reason:
              'Payer is new to the tenant/payment relationship.',
          },
        ),
      );
    }

    if (unverifiedPayer) {
      signals.push(
        this.#baseSignal(
          'payer',
          SIGNAL_TYPES.PAYER,
          FRAUD_REASON_CODES.UNVERIFIED_PAYER,
          this.config.payer.unverifiedPayerScore,
          {
            reviewRequired:
              true,
            reason:
              'Payer identity is not sufficiently verified.',
          },
        ),
      );
    }

    if (payerMismatch) {
      signals.push(
        this.#baseSignal(
          'payer',
          SIGNAL_TYPES.PAYER,
          FRAUD_REASON_CODES.PAYER_MISMATCH,
          this.config.payer.mismatchScore,
          {
            reviewRequired:
              true,
            reason:
              'Payer identity information is inconsistent.',
          },
        ),
      );
    }

    const source =
      isPlainObject(
        context.sourceAccount,
      )
        ? context.sourceAccount
        : {};

    if (
      source.muleLike === true ||
      source.suspectedMule === true
    ) {
      signals.push(
        this.#baseSignal(
          'sourceAccount',
          SIGNAL_TYPES.SOURCE_ACCOUNT,
          FRAUD_REASON_CODES.MULE_LIKE,
          this.config.sourceAccount.muleLikeScore,
          {
            reviewRequired:
              true,
            reason:
              'Source account exhibits an upstream mule-risk indicator.',
          },
        ),
      );
    }

    if (
      source.multipleCustomerPayers ===
        true ||
      toCount(
        source.distinctCustomers,
      ) > 5
    ) {
      signals.push(
        this.#baseSignal(
          'sourceAccount',
          SIGNAL_TYPES.SOURCE_ACCOUNT,
          FRAUD_REASON_CODES.SPLIT_PAYMENT_PATTERN,
          this.config.sourceAccount
            .multipleCustomerScore,
          {
            reviewRequired:
              true,
            reason:
              'Source account is associated with multiple collection identities.',
            evidence: {
              distinctCustomers:
                toCount(
                  source.distinctCustomers,
                ),
            },
          },
        ),
      );
    }

    if (
      source.unverified === true
    ) {
      signals.push(
        this.#baseSignal(
          'sourceAccount',
          SIGNAL_TYPES.SOURCE_ACCOUNT,
          FRAUD_REASON_CODES.UNVERIFIED_PAYER,
          this.config.sourceAccount
            .unverifiedScore,
          {
            reviewRequired:
              true,
            reason:
              'Source account verification is incomplete.',
          },
        ),
      );
    }

    const device =
      context.device || {};

    if (
      device.mismatch === true ||
      device.identityMismatch === true
    ) {
      signals.push(
        this.#baseSignal(
          'device',
          SIGNAL_TYPES.DEVICE,
          FRAUD_REASON_CODES.DEVICE_MISMATCH,
          this.config.device
            .mismatchScore,
          {
            reviewRequired:
              true,
            reason:
              'Collection device does not match expected payer/account evidence.',
          },
        ),
      );
    }

    if (
      device.newDevice === true
    ) {
      signals.push(
        this.#baseSignal(
          'device',
          SIGNAL_TYPES.DEVICE,
          FRAUD_REASON_CODES.NEW_DEVICE,
          this.config.device
            .newDeviceScore,
          {
            reason:
              'Collection originates from a newly observed device.',
          },
        ),
      );
    }

    if (
      device.rooted === true
    ) {
      signals.push(
        this.#baseSignal(
          'device',
          SIGNAL_TYPES.DEVICE,
          FRAUD_REASON_CODES.DEVICE_MISMATCH,
          this.config.device
            .rootedScore,
          {
            reviewRequired:
              true,
            reason:
              'Device posture indicates elevated execution risk.',
          },
        ),
      );
    }

    if (
      device.automated === true ||
      device.bot === true
    ) {
      signals.push(
        this.#baseSignal(
          'device',
          SIGNAL_TYPES.DEVICE,
          FRAUD_REASON_CODES.ACCOUNT_TAKEOVER,
          this.config.device
            .automationScore,
          {
            hardBlock:
              true,
            reviewRequired:
              true,
            reason:
              'Collection request presents automation characteristics inconsistent with safe payer execution.',
          },
        ),
      );
    }

    const network =
      context.network || {};

    if (
      network.tor === true
    ) {
      signals.push(
        this.#baseSignal(
          'network',
          SIGNAL_TYPES.NETWORK,
          FRAUD_REASON_CODES.NETWORK_RISK,
          this.config.network.torScore,
          {
            reviewRequired:
              true,
            reason:
              'Network evidence identifies a high-risk anonymization service.',
          },
        ),
      );
    } else if (
      network.vpn === true
    ) {
      signals.push(
        this.#baseSignal(
          'network',
          SIGNAL_TYPES.NETWORK,
          FRAUD_REASON_CODES.NETWORK_RISK,
          this.config.network.vpnScore,
          {
            reason:
              'Collection was initiated through a VPN network.',
          },
        ),
      );
    }

    if (
      network.proxy === true
    ) {
      signals.push(
        this.#baseSignal(
          'network',
          SIGNAL_TYPES.NETWORK,
          FRAUD_REASON_CODES.NETWORK_RISK,
          this.config.network.proxyScore,
          {
            reason:
              'Collection network presents proxy characteristics.',
          },
        ),
      );
    }

    if (
      network.riskyAsn === true ||
      network.hostingProvider === true
    ) {
      signals.push(
        this.#baseSignal(
          'network',
          SIGNAL_TYPES.NETWORK,
          FRAUD_REASON_CODES.NETWORK_RISK,
          Math.max(
            this.config.network.riskyAsnScore,
            this.config.network.hostingScore,
          ),
          {
            reason:
              'Network ASN/hosting evidence has elevated abuse risk.',
          },
        ),
      );
    }

    const geography =
      context.geography || {};

    if (
      geography.identityMismatch === true ||
      geography.countryMismatch === true
    ) {
      signals.push(
        this.#baseSignal(
          'geography',
          SIGNAL_TYPES.GEOGRAPHY,
          FRAUD_REASON_CODES.GEO_MISMATCH,
          this.config.geography
            .mismatchScore,
          {
            reviewRequired:
              true,
            reason:
              'Collection geography does not align with trusted payer evidence.',
          },
        ),
      );
    }

    if (
      geography.impossibleTravel === true
    ) {
      signals.push(
        this.#baseSignal(
          'geography',
          SIGNAL_TYPES.GEOGRAPHY,
          FRAUD_REASON_CODES.TRAVEL_ANOMALY,
          this.config.geography
            .travelScore,
          {
            hardBlock:
              false,
            reviewRequired:
              true,
            reason:
              'Payer activity contains a configured impossible-travel anomaly.',
          },
        ),
      );
    }

    const behaviour =
      context.behaviour || {};

    if (
      behaviour.extreme === true
    ) {
      signals.push(
        this.#baseSignal(
          'behaviour',
          SIGNAL_TYPES.BEHAVIOUR,
          FRAUD_REASON_CODES.BEHAVIOUR_ANOMALY,
          this.config.behaviour
            .extremeScore,
          {
            reviewRequired:
              true,
            reason:
              'Collection behaviour differs materially from the payer baseline.',
          },
        ),
      );
    } else if (
      behaviour.unusual === true
    ) {
      signals.push(
        this.#baseSignal(
          'behaviour',
          SIGNAL_TYPES.BEHAVIOUR,
          FRAUD_REASON_CODES.BEHAVIOUR_ANOMALY,
          this.config.behaviour
            .unusualScore,
          {
            reviewRequired:
              true,
            reason:
              'Collection behaviour is unusual relative to the configured baseline.',
          },
        ),
      );
    }

    const account =
      context.account || {};

    if (
      account.compromised === true
    ) {
      signals.push(
        this.#baseSignal(
          'account',
          SIGNAL_TYPES.ACCOUNT,
          FRAUD_REASON_CODES.ACCOUNT_TAKEOVER,
          this.config.account
            .compromisedScore,
          {
            hardBlock:
              true,
            reviewRequired:
              true,
            reason:
              'Payer account is reported compromised by an upstream security control.',
          },
        ),
      );
    }

    if (
      account.recentPasswordReset === true
    ) {
      signals.push(
        this.#baseSignal(
          'account',
          SIGNAL_TYPES.ACCOUNT,
          FRAUD_REASON_CODES.ACCOUNT_TAKEOVER,
          this.config.account
            .passwordResetScore,
          {
            reviewRequired:
              true,
            reason:
              'Collection follows a recent account credential reset.',
          },
        ),
      );
    }

    if (
      account.recentPhoneChange === true
    ) {
      signals.push(
        this.#baseSignal(
          'account',
          SIGNAL_TYPES.ACCOUNT,
          FRAUD_REASON_CODES.ACCOUNT_TAKEOVER,
          this.config.account
            .recentPhoneChangeScore,
          {
            reviewRequired:
              true,
            reason:
              'Collection follows a recent payer phone-number change.',
          },
        ),
      );
    }

    const failedLogins =
      toCount(
        account.failedLogins,
      );

    if (
      failedLogins >= 3
    ) {
      signals.push(
        this.#baseSignal(
          'account',
          SIGNAL_TYPES.ACCOUNT,
          FRAUD_REASON_CODES.ACCOUNT_TAKEOVER,
          this.config.account
            .failedLoginScore,
          {
            reviewRequired:
              true,
            reason:
              'Payer account has repeated failed-login activity.',
            evidence: {
              failedLogins,
            },
          },
        ),
      );
    }

    const pattern =
      context.transactionPattern ||
      {};

    const oddHour =
      pattern.oddHour === true ||
      this.#isOddHour(
        context.occurredAt,
      );

    if (oddHour) {
      signals.push(
        this.#baseSignal(
          'transactionPattern',
          SIGNAL_TYPES.TRANSACTION_PATTERN,
          FRAUD_REASON_CODES.ODD_HOUR,
          this.config.transactionPattern
            .oddHourScore,
          {
            reason:
              'Collection was initiated during a configured unusual hour.',
          },
        ),
      );
    }

    if (
      toCount(
        pattern.rapidSuccessiveCount,
      ) >=
      this.config.velocity
        .amountReviewCount
    ) {
      signals.push(
        this.#baseSignal(
          'transactionPattern',
          SIGNAL_TYPES.TRANSACTION_PATTERN,
          FRAUD_REASON_CODES.RAPID_REVERSAL_PATTERN,
          this.config.transactionPattern
            .rapidSuccessiveScore,
          {
            reviewRequired:
              true,
            reason:
              'Payer has generated a rapid successive collection pattern.',
            evidence: {
              rapidSuccessiveCount:
                toCount(
                  pattern.rapidSuccessiveCount,
                ),
            },
          },
        ),
      );
    }

    const duplicate =
      context.duplicatePattern ||
      {};

    if (
      duplicate.exactDuplicate === true
    ) {
      this.statistics.duplicateReviews +=
        1;

      signals.push(
        this.#baseSignal(
          'duplicatePattern',
          SIGNAL_TYPES.DUPLICATE_PATTERN,
          FRAUD_REASON_CODES.DUPLICATE_PATTERN,
          this.config.duplicatePattern
            .exactDuplicateScore,
          {
            reviewRequired:
              true,
            reason:
              'Collection request appears to duplicate an existing financial request.',
          },
        ),
      );
    } else if (
      duplicate.nearDuplicate === true
    ) {
      signals.push(
        this.#baseSignal(
          'duplicatePattern',
          SIGNAL_TYPES.DUPLICATE_PATTERN,
          FRAUD_REASON_CODES.DUPLICATE_PATTERN,
          this.config.duplicatePattern
            .nearDuplicateScore,
          {
            reviewRequired:
              true,
            reason:
              'Collection request is similar to a recent existing request.',
          },
        ),
      );
    }

    const splitTotal =
      addMinorAmounts(
        context.velocity
          .recentCollectionAmountsMinor ||
        [],
      );

    if (
      splitTotal &&
      compareMinorAmounts(
        splitTotal,
        this.config.amountThresholdsMinor
          [context.currency]?.high ||
          this.config.amountThresholdsMinor.UGX.high,
      ) >= 0 &&
      toCount(
        context.velocity.recentCollectionCount,
      ) >= 5
    ) {
      signals.push(
        this.#baseSignal(
          'velocity',
          SIGNAL_TYPES.VELOCITY,
          FRAUD_REASON_CODES.SPLIT_PAYMENT_PATTERN,
          65,
          {
            reviewRequired:
              true,
            reason:
              'Recent collection pattern may represent transaction splitting.',
            evidence: {
              recentCollectionCount:
                toCount(
                  context.velocity
                    .recentCollectionCount,
                ),
              recentCollectionAmountMinor:
                splitTotal,
            },
          },
        ),
      );
    }

    return signals;
  }

  #isRoundAmount(
    amountMinor,
    currency,
  ) {
    if (!amountMinor) {
      return false;
    }

    const units =
      Number(
        this.config.currencyMinorUnits?.[
          currency
        ] ?? 0,
      );

    if (units > 0) {
      return BigInt(amountMinor) %
        100000n ===
        0n;
    }

    return (
      BigInt(amountMinor) >= 100000n &&
      BigInt(amountMinor) %
        100000n ===
        0n
    );
  }

  #isOddHour(dateValue) {
    if (!dateValue) {
      return false;
    }

    const date =
      dateValue instanceof Date
        ? dateValue
        : parseDate(
            dateValue,
          );

    if (!date) {
      return false;
    }

    const hour =
      date.getHours();

    return hour < 5 ||
      hour >= 23;
  }

  async #externalAssessment(
    context,
  ) {
    const signals = [];
    const dependencies = [
      {
        key: 'riskEngine',
        type: SIGNAL_TYPES.RISK_ENGINE,
        service:
          this.riskEngine,
        methods: [
          'assessCollection',
          'assess',
          'evaluate',
          'score',
        ],
      },
      {
        key: 'fraudDetectionService',
        type: SIGNAL_TYPES.LEGACY_FRAUD_ENGINE,
        service:
          this.fraudDetectionService,
        methods: [
          'inspectCollection',
          'inspect',
          'assess',
          'evaluate',
          'score',
        ],
      },
      {
        key: 'fraudModelEngine',
        type: SIGNAL_TYPES.MODEL,
        service:
          this.fraudModelEngine,
        methods: [
          'predictCollection',
          'predict',
          'score',
          'evaluate',
        ],
      },
      {
        key: 'predictionEngine',
        type: SIGNAL_TYPES.PREDICTION,
        service:
          this.predictionEngine,
        methods: [
          'predictCollection',
          'predict',
          'score',
          'evaluate',
        ],
      },
      {
        key: 'blacklist',
        type: SIGNAL_TYPES.BLACKLIST,
        service:
          this.blacklist,
        methods: [
          'checkPayer',
          'check',
          'evaluate',
        ],
      },
      {
        key: 'sanctionsService',
        type: SIGNAL_TYPES.SANCTIONS,
        service:
          this.sanctionsService,
        methods: [
          'screenPayer',
          'screen',
          'check',
          'evaluate',
        ],
      },
      {
        key: 'complianceService',
        type: SIGNAL_TYPES.COMPLIANCE,
        service:
          this.complianceService,
        methods: [
          'checkCollection',
          'check',
          'evaluate',
          'assess',
        ],
      },
      {
        key: 'deviceRiskService',
        type: SIGNAL_TYPES.DEVICE,
        service:
          this.deviceRiskService,
        methods: [
          'assessCollection',
          'assess',
          'evaluate',
          'score',
        ],
      },
      {
        key: 'velocityService',
        type: SIGNAL_TYPES.VELOCITY,
        service:
          this.velocityService,
        methods: [
          'assessCollection',
          'assess',
          'evaluate',
          'check',
        ],
      },
      {
        key: 'behavioralService',
        type: SIGNAL_TYPES.BEHAVIOUR,
        service:
          this.behavioralService,
        methods: [
          'assessCollection',
          'assess',
          'evaluate',
          'score',
        ],
      },
      {
        key: 'networkRiskService',
        type: SIGNAL_TYPES.NETWORK,
        service:
          this.networkRiskService,
        methods: [
          'assessCollection',
          'assess',
          'evaluate',
          'score',
        ],
      },
      {
        key: 'geographyRiskService',
        type: SIGNAL_TYPES.GEOGRAPHY,
        service:
          this.geographyRiskService,
        methods: [
          'assessCollection',
          'assess',
          'evaluate',
          'score',
        ],
      },
      {
        key: 'duplicateDetectionService',
        type: SIGNAL_TYPES.DUPLICATE_PATTERN,
        service:
          this.duplicateDetectionService,
        methods: [
          'checkCollection',
          'check',
          'assess',
          'evaluate',
        ],
      },
    ];

    const contextPayload = {
      provider:
        PROVIDER,
      operation:
        OPERATION,
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      collectionId:
        context.collectionId,
      customerId:
        context.customerId,
      merchantId:
        context.merchantId,
      groupId:
        context.groupId,
      amountMinor:
        context.amountMinor,
      currency:
        context.currency,
      phoneNumber:
        context.phone,
      payer:
        sanitize(
          context.payer,
          this.config,
        ),
      sourceAccount:
        sanitize(
          context.sourceAccount,
          this.config,
        ),
      device:
        sanitize(
          context.device,
          this.config,
        ),
      network:
        sanitize(
          context.network,
          this.config,
        ),
      geography:
        sanitize(
          context.geography,
          this.config,
        ),
      behaviour:
        sanitize(
          context.behaviour,
          this.config,
        ),
      account:
        sanitize(
          context.account,
          this.config,
        ),
      metadata:
        context.metadata,
    };

    for (const dependency of dependencies) {
      if (!dependency.service) {
        continue;
      }

      const method =
        dependency.methods.find(
          (name) =>
            isFunction(
              dependency.service?.[name],
            ),
        );

      if (!method) {
        continue;
      }

      try {
        const result =
          await Promise.resolve(
            dependency.service[method](
              contextPayload,
            ),
          );

        if (!result) {
          continue;
        }

        const score =
          readScore(result);

        const decision =
          readDecision(result);

        const hardBlock =
          isAuthoritativeBlock(
            result,
          ) ||
          [
            'BLOCK',
            'DENY',
            'DENIED',
            'REJECT',
            'REJECTED',
          ].includes(
            decision,
          ) &&
          (
            dependency.type ===
              SIGNAL_TYPES.SANCTIONS ||
            dependency.type ===
              SIGNAL_TYPES.COMPLIANCE ||
            result.hardBlock === true
          );

        const review =
          requiresReview(
            result,
          );

        const evidenceQuality =
          readEvidenceQuality(
            result,
          );

        if (
          evidenceQuality < 50
        ) {
          this.statistics.evidenceDegradation +=
            1;
        }

        let normalizedScore =
          score ?? 0;

        if (
          score == null
        ) {
          if (hardBlock) {
            normalizedScore =
              100;
          } else if (review) {
            normalizedScore =
              this.config.thresholds
                .reviewScore;
          } else {
            normalizedScore =
              0;
          }
        }

        if (
          evidenceQuality < 50 &&
          !hardBlock
        ) {
          normalizedScore =
            Math.min(
              100,
              normalizedScore +
                this.config.evidence
                  .unavailablePenalty,
            );
        }

        signals.push(
          this.#baseSignal(
            dependency.key,
            dependency.type,
            boundedString(
              result.reasonCode ??
                result.code ??
                `EXTERNAL_${dependency.key.toUpperCase()}`,
              160,
            ),
            normalizedScore,
            {
              hardBlock,
              reviewRequired:
                review,
              reason:
                result.reason ??
                result.message ??
                undefined,
              source:
                dependency.key,
              evidence: {
                decision,
                evidenceQuality,
                authoritative:
                  result.authoritative ===
                  true,
                status:
                  upper(
                    result.status,
                  ),
                modelVersion:
                  boundedString(
                    result.modelVersion,
                    160,
                  ),
                policyVersion:
                  boundedString(
                    result.policyVersion,
                    160,
                  ),
              },
            },
          ),
        );
      } catch (error) {
        this.statistics.externalFailures +=
          1;

        this.#metric(
          'increment',
          `titech_airtel_collection_fraud_external_failure_${dependency.key}_total`,
        );

        this.#log(
          'error',
          'Collection fraud external assessment failed.',
          {
            dependency:
              dependency.key,
            error:
              error?.message,
            tenantId:
              context.tenantId,
          },
        );

        if (
          this.config.security
            .failClosed &&
          this.config.security
            .failClosedOnExternalEngineFailure &&
          [
            SIGNAL_TYPES.SANCTIONS,
            SIGNAL_TYPES.COMPLIANCE,
          ].includes(
            dependency.type,
          )
        ) {
          this.#throw(
            ERROR_CODES.ENGINE_FAILURE,
            `${dependency.key} control is unavailable under fail-closed policy.`,
            {
              dependency:
                dependency.key,
            },
            {
              statusCode:
                503,
              retryable:
                true,
              tenantId:
                context.tenantId,
              transactionId:
                context.transactionId,
              correlationId:
                context.correlationId,
            },
          );
        }

        signals.push(
          this.#baseSignal(
            dependency.key,
            SIGNAL_TYPES.EVIDENCE_QUALITY,
            FRAUD_REASON_CODES.EVIDENCE_UNAVAILABLE,
            this.config.evidence
              .unavailablePenalty,
            {
              reviewRequired:
                true,
              reason:
                `${dependency.key} evidence is unavailable.`,
              source:
                dependency.key,
            },
          ),
        );
      }
    }

    return signals;
  }

  async #customRules(
    context,
  ) {
    const signals = [];

    for (
      let index = 0;
      index < this.rules.length;
      index += 1
    ) {
      const rule =
        this.rules[index];

      if (!isFunction(rule)) {
        continue;
      }

      try {
        const result =
          await Promise.resolve(
            rule(
              sanitize(
                {
                  ...context,
                  payer:
                    context.payer,
                  sourceAccount:
                    context.sourceAccount,
                },
                this.config,
              ),
            ),
          );

        if (!result) {
          continue;
        }

        const score =
          readScore(result) ??
          finiteNumber(
            result.score,
            result.blocked
              ? 100
              : result.reviewRequired
                ? this.config.thresholds
                    .reviewScore
                : 0,
          );

        const hardBlock =
          result.hardBlock === true ||
          (
            result.authoritative === true &&
            result.blocked === true
          );

        signals.push(
          this.#baseSignal(
            `customRule:${index}`,
            SIGNAL_TYPES.RULE,
            boundedString(
              result.reasonCode ??
                result.code ??
                `CUSTOM_RULE_${index}`,
              160,
            ),
            score,
            {
              hardBlock,
              reviewRequired:
                Boolean(
                  result.reviewRequired ??
                    result.requiresReview,
                ),
              reason:
                result.reason ??
                result.message,
              source:
                `customRule:${index}`,
              evidence:
                result.evidence,
            },
          ),
        );
      } catch (error) {
        this.#log(
          'error',
          'Collection fraud custom rule failed.',
          {
            ruleIndex:
              index,
            error:
              error?.message,
            tenantId:
              context.tenantId,
          },
        );

        if (
          this.config.security
            .failClosed
        ) {
          this.#throw(
            ERROR_CODES.RULE_FAILURE,
            'A configured collection fraud rule failed under fail-closed policy.',
            {
              ruleIndex:
                index,
            },
            {
              statusCode:
                503,
              retryable:
                true,
              tenantId:
                context.tenantId,
              transactionId:
                context.transactionId,
              correlationId:
                context.correlationId,
            },
          );
        }
      }
    }

    return signals;
  }

  #buildInputSummary(
    context,
  ) {
    return {
      tenantId:
        context.tenantId,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      transactionId:
        context.transactionId,
      collectionId:
        context.collectionId,
      customerId:
        context.customerId,
      merchantId:
        context.merchantId,
      groupId:
        context.groupId,
      amountMinor:
        context.amountMinor,
      currency:
        context.currency,
      phone:
        maskPhone(
          context.phone,
        ),
      country:
        context.country,
      channel:
        context.channel,
      payerFingerprint:
        context.payerFingerprint,
      sourceAccountFingerprint:
        context.sourceAccount
          ? sha256(
              stable(
                context.sourceAccount,
              ),
            )
          : undefined,
      externalReference:
        maskReference(
          context.externalReference,
        ),
      offlineState:
        context.offlineState,
      requestId:
        context.requestId,
      correlationId:
        context.correlationId,
      traceId:
        context.traceId,
    };
  }

  #summarizeSignals(
    signals,
  ) {
    return signals
      .slice(
        0,
        this.config.metadata.maxSignals,
      )
      .map(
        (signal) => ({
          key:
            signal.key,
          type:
            signal.type,
          code:
            signal.code,
          score:
            clamp(
              signal.score,
            ),
          severity:
            signal.severity,
          hardBlock:
            Boolean(
              signal.hardBlock,
            ),
          reviewRequired:
            Boolean(
              signal.reviewRequired,
            ),
          reason:
            signal.reason,
          source:
            signal.source,
          evidence:
            sanitize(
              signal.evidence,
              this.config,
            ),
        }),
      );
  }

  #collectReasons(
    signals,
  ) {
    const reasons = [];
    const seen = new Set();

    for (const signal of signals) {
      if (!signal.reason) {
        continue;
      }

      const key =
        `${signal.code}:${signal.reason}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      reasons.push(
        signal.code,
      );

      if (
        reasons.length >=
        this.config.metadata.maxReasons
      ) {
        break;
      }
    }

    return reasons;
  }

  #aggregate(
    context,
    signals,
    fingerprint,
  ) {
    const hardBlocks =
      signals.filter(
        (signal) =>
          signal.hardBlock === true,
      );

    const reviewSignals =
      signals.filter(
        (signal) =>
          signal.reviewRequired ===
          true,
      );

    const weightedSignals =
      signals.filter(
        (signal) =>
          signal.key &&
          ![
            'blacklist',
            'compliance',
            'payer',
          ].includes(
            signal.key,
          ),
      );

    let riskScore =
      numericWeightedScore(
        weightedSignals.length
          ? weightedSignals
          : signals,
        this.config.weights,
      );

    if (hardBlocks.length) {
      riskScore = 100;
      this.statistics.authoritativeBlocks +=
        hardBlocks.length;
    } else if (
      reviewSignals.length >= 4
    ) {
      riskScore = Math.max(
        riskScore,
        this.config.thresholds
          .highRiskScore,
      );
    }

    const severeSignals =
      signals.filter(
        (signal) =>
          signal.score >=
          this.config.thresholds.criticalScore,
      );

    if (
      severeSignals.length >= 2 &&
      !hardBlocks.length
    ) {
      riskScore = Math.max(
        riskScore,
        this.config.thresholds
          .blockScore,
      );
    }

    const decision =
      hardBlocks.length
        ? FRAUD_DECISIONS.BLOCK
        : scoreDecision(
            riskScore,
            this.config,
          );

    const finalDecision =
      decision === FRAUD_DECISIONS.ALLOW &&
      reviewSignals.length
        ? FRAUD_DECISIONS.REVIEW
        : decision;

    const outcome =
      finalDecision ===
      FRAUD_DECISIONS.BLOCK
        ? FRAUD_OUTCOMES.BLOCKED
        : finalDecision ===
          FRAUD_DECISIONS.REVIEW
          ? FRAUD_OUTCOMES.REVIEW
          : FRAUD_OUTCOMES.CLEAR;

    const riskLevel =
      riskLevelForScore(
        riskScore,
        this.config,
      );

    const reasons =
      this.#collectReasons(
        signals,
      );

    const result = {
      success:
        finalDecision !==
        FRAUD_DECISIONS.ERROR,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      component:
        COMPONENT,
      engine:
        ENGINE_NAME,
      engineVersion:
        ENGINE_VERSION,
      schemaVersion:
        SCHEMA_VERSION,
      decision:
        finalDecision,
      outcome,
      allowed:
        finalDecision ===
        FRAUD_DECISIONS.ALLOW,
      passed:
        finalDecision ===
        FRAUD_DECISIONS.ALLOW,
      blocked:
        finalDecision ===
        FRAUD_DECISIONS.BLOCK,
      requiresReview:
        finalDecision ===
        FRAUD_DECISIONS.REVIEW,
      reviewRequired:
        finalDecision ===
        FRAUD_DECISIONS.REVIEW,
      approvalRequired:
        finalDecision ===
        FRAUD_DECISIONS.REVIEW,
      riskScore:
        roundScore(
          riskScore,
        ),
      riskLevel,
      reasons,
      reasonCodes:
        reasons,
      tenantId:
        context.tenantId,
      transactionId:
        context.transactionId,
      collectionId:
        context.collectionId,
      customerId:
        context.customerId,
      payerFingerprint:
        context.payerFingerprint,
      inputFingerprint:
        fingerprint,
      originalIdempotencyKeyHash:
        context.originalIdempotencyKey
          ? sha256(
              context.originalIdempotencyKey,
            )
          : undefined,
      amountMinor:
        context.amountMinor,
      currency:
        context.currency,
      input:
        this.#buildInputSummary(
          context,
        ),
      signals:
        this.#summarizeSignals(
          signals,
        ),
      hardBlocks:
        hardBlocks.map(
          (signal) => ({
            type:
              signal.type,
            code:
              signal.code,
            source:
              signal.source,
            reason:
              signal.reason,
          }),
        ),
      evidence: {
        signalCount:
          signals.length,
        hardBlockCount:
          hardBlocks.length,
        reviewSignalCount:
          reviewSignals.length,
        evidenceQuality:
          this.#evidenceQuality(
            signals,
          ),
      },
      evaluatedAt:
        new Date(
          nowMs(this.clock),
        ).toISOString(),
      correlationId:
        context.correlationId,
      requestId:
        context.requestId,
      traceId:
        context.traceId,
    };

    return deepFreeze(
      result,
    );
  }

  #evidenceQuality(
    signals,
  ) {
    if (!signals.length) {
      return 0;
    }

    let sum = 0;

    for (const signal of signals) {
      const q =
        signal.evidence?.evidenceQuality;

      sum +=
        Number.isFinite(q)
          ? q
          : 70;
    }

    return clamp(
      sum / signals.length,
    );
  }

  async assess(
    input = {},
  ) {
    this.statistics.evaluations +=
      1;

    const context =
      this.#normalizeContext(
        input,
      );

    const fingerprint =
      this.#inputFingerprint(
        context,
      );

    const evaluationSignals =
      this.#deterministicSignals(
        context,
      );

    const externalSignals =
      await this.#externalAssessment(
        context,
      );

    const customSignals =
      await this.#customRules(
        context,
      );

    const signals = [
      ...evaluationSignals,
      ...externalSignals,
      ...customSignals,
    ].slice(
      0,
      this.config.metadata.maxSignals,
    );

    const result =
      this.#aggregate(
        context,
        signals,
        fingerprint,
      );

    await this.#recordAudit(
      result,
      'COLLECTION_FRAUD_EVALUATED',
    );

    await this.#publishEvent(
      result,
      'AIRTEL_COLLECTION_FRAUD_EVALUATED',
    );

    if (
      result.decision ===
      FRAUD_DECISIONS.ALLOW
    ) {
      this.statistics.allowed +=
        1;
    } else if (
      result.decision ===
      FRAUD_DECISIONS.REVIEW
    ) {
      this.statistics.reviews +=
        1;
    } else if (
      result.decision ===
      FRAUD_DECISIONS.BLOCK
    ) {
      this.statistics.blocked +=
        1;
    }

    this.#metric(
      'increment',
      'titech_airtel_collection_fraud_evaluations_total',
    );

    this.#metric(
      'increment',
      `titech_airtel_collection_fraud_decision_${result.decision.toLowerCase()}_total`,
    );

    return result;
  }

  async evaluateCollection(
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
      throw new CollectionFraudGuardError(
        'Airtel collection was blocked by fraud controls.',
        {
          code:
            result.reasons?.[0] ||
            FRAUD_REASON_CODES.CRITICAL_RISK,
          statusCode:
            403,
          retryable:
            false,
          tenantId:
            result.tenantId,
          transactionId:
            result.transactionId,
          correlationId:
            result.correlationId,
          details: {
            riskScore:
              result.riskScore,
            riskLevel:
              result.riskLevel,
            reasons:
              result.reasons,
          },
          config:
            this.config,
        },
      );
    }

    return result;
  }

  async #recordAudit(
    result,
    action,
  ) {
    const fn =
      this.auditService?.record ??
      this.auditService?.append ??
      this.auditService?.write ??
      this.auditService?.log;

    if (!isFunction(fn)) {
      return null;
    }

    const record = {
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
      transactionId:
        result.transactionId,
      collectionId:
        result.collectionId,
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
        result.signals?.length ??
        0,
      payerFingerprint:
        result.payerFingerprint,
      inputFingerprint:
        result.inputFingerprint,
      originalIdempotencyKeyHash:
        result.originalIdempotencyKeyHash,
      occurredAt:
        nowIso(this.clock),
      auditCorrelationId:
        result.correlationId,
    };

    const envelope = {
      ...record,
      auditFingerprint:
        sha256(record),
    };

    try {
      return await fn.call(
        this.auditService,
        envelope,
      );
    } catch (error) {
      this.statistics.auditFailures +=
        1;

      this.#log(
        'error',
        'Collection fraud audit write failed.',
        {
          action,
          error:
            error?.message,
          tenantId:
            result.tenantId,
        },
      );

      if (
        this.config.security
          .failClosedOnAuditError
      ) {
        this.#throw(
          ERROR_CODES.AUDIT_UNAVAILABLE,
          'Collection fraud audit boundary is unavailable.',
          {},
          {
            statusCode:
              503,
            retryable:
              true,
            tenantId:
              result.tenantId,
            transactionId:
              result.transactionId,
            correlationId:
              result.correlationId,
          },
        );
      }

      return null;
    }
  }

  async #publishEvent(
    result,
    type,
  ) {
    const fn =
      this.eventBus?.publish ??
      this.eventBus?.enqueue ??
      this.eventBus?.emit;

    if (!isFunction(fn)) {
      return null;
    }

    const event = {
      eventId:
        this.idFactory(),
      schemaVersion:
        SCHEMA_VERSION,
      type,
      occurredAt:
        nowIso(this.clock),
      provider:
        PROVIDER,
      operation:
        OPERATION,
      tenantId:
        result.tenantId,
      transactionId:
        result.transactionId,
      collectionId:
        result.collectionId,
      correlationId:
        result.correlationId,
      inputFingerprint:
        result.inputFingerprint,
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
      payload: {
        payerFingerprint:
          result.payerFingerprint,
        signalCount:
          result.signals?.length ??
          0,
        evidenceQuality:
          result.evidence
            ?.evidenceQuality,
      },
    };

    try {
      return await fn.call(
        this.eventBus,
        event,
      );
    } catch (error) {
      this.statistics.eventFailures +=
        1;

      this.#log(
        'error',
        'Collection fraud event publication failed.',
        {
          type,
          error:
            error?.message,
          tenantId:
            result.tenantId,
        },
      );

      if (
        this.config.security
          .failClosedOnEventError
      ) {
        this.#throw(
          ERROR_CODES.EVENT_UNAVAILABLE,
          'Collection fraud event boundary is unavailable.',
          {},
          {
            statusCode:
              503,
            retryable:
              true,
            tenantId:
              result.tenantId,
            transactionId:
              result.transactionId,
            correlationId:
              result.correlationId,
          },
        );
      }

      return null;
    }
  }

  getStatistics() {
    return deepFreeze({
      ...this.statistics,
    });
  }

  resetStatistics() {
    for (
      const key of Object.keys(
        this.statistics,
      )
    ) {
      this.statistics[key] =
        0;
    }

    return this.getStatistics();
  }

  health() {
    const externalDependencies = {
      riskEngine:
        Boolean(
          this.riskEngine,
        ),
      fraudDetectionService:
        Boolean(
          this.fraudDetectionService,
        ),
      sanctionsService:
        Boolean(
          this.sanctionsService,
        ),
      complianceService:
        Boolean(
          this.complianceService,
        ),
      blacklist:
        Boolean(
          this.blacklist,
        ),
      deviceRiskService:
        Boolean(
          this.deviceRiskService,
        ),
      velocityService:
        Boolean(
          this.velocityService,
        ),
      behaviouralService:
        Boolean(
          this.behavioralService,
        ),
      networkRiskService:
        Boolean(
          this.networkRiskService,
        ),
      geographyRiskService:
        Boolean(
          this.geographyRiskService,
        ),
      duplicateDetectionService:
        Boolean(
          this.duplicateDetectionService,
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

    const requiredMissing = [];

    if (
      this.config.security
        .requireTenantId === true
    ) {
      // Tenant is request scoped and is checked in #normalizeContext.
    }

    if (
      this.config.security
        .failClosed &&
      !this.sanctionsService
    ) {
      requiredMissing.push(
        'sanctionsService',
      );
    }

    if (
      this.config.security
        .failClosed &&
      !this.complianceService
    ) {
      requiredMissing.push(
        'complianceService',
      );
    }

    return {
      provider:
        PROVIDER,
      operation:
        OPERATION,
      component:
        COMPONENT,
      version:
        ENGINE_VERSION,
      status:
        requiredMissing.length
          ? 'DEGRADED'
          : 'UP',
      ready:
        requiredMissing.length === 0,
      requiredMissing,
      dependencies:
        externalDependencies,
      capabilities:
        CAPABILITIES,
      statistics:
        this.getStatistics(),
      timestamp:
        nowIso(this.clock),
    };
  }

  readiness() {
    const h =
      this.health();

    return {
      status:
        h.status,
      ready:
        h.ready,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      missing:
        h.requiredMissing,
      timestamp:
        nowIso(this.clock),
    };
  }

  capabilities() {
    return deepFreeze({
      ...CAPABILITIES,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      engine:
        ENGINE_NAME,
      version:
        ENGINE_VERSION,
      supportedCurrencies:
        [
          ...this.config.collection
            .supportedCurrencies,
        ],
      protectedFeaturesExcluded:
        this.config.security
          .protectSensitiveFeatures,
    });
  }

  diagnostics() {
    return {
      module:
        MODULE_NAME,
      component:
        COMPONENT,
      provider:
        PROVIDER,
      operation:
        OPERATION,
      engine:
        ENGINE_NAME,
      engineVersion:
        ENGINE_VERSION,
      schemaVersion:
        SCHEMA_VERSION,
      configuration:
        sanitize(
          this.config,
          this.config,
        ),
      statistics:
        this.getStatistics(),
      health:
        this.health(),
      boundaries: {
        providerCommunication:
          false,
        databaseAccess:
          false,
        ledgerMutation:
          false,
        balanceMutation:
          false,
        walletMutation:
          false,
        settlementFinality:
          false,
        stateMutation:
          false,
      },
      security: {
        tenantIsolation:
          true,
        rawPayloadPersistence:
          false,
        rawPayloadAudit:
          false,
        rawPayloadEvents:
          false,
        originalIdempotencyPreserved:
          true,
        protectedFeatureExclusion:
          this.config.security
            .protectSensitiveFeatures,
        exactMinorUnitArithmetic:
          true,
        failClosed:
          this.config.security
            .failClosed,
      },
    };
  }

  snapshot() {
    return this.diagnostics();
  }

  normalize(
    input = {},
  ) {
    const context =
      this.#normalizeContext(
        input,
      );

    return deepFreeze({
      ...this.#buildInputSummary(
        context,
      ),
      payerFingerprint:
        context.payerFingerprint,
      inputFingerprint:
        this.#inputFingerprint(
          context,
        ),
    });
  }

  fingerprint(
    input = {},
  ) {
    const context =
      this.#normalizeContext(
        input,
      );

    return this.#inputFingerprint(
      context,
    );
  }
}

function roundScore(
  value,
) {
  return Math.round(
    clamp(value) * 100,
  ) / 100;
}

function nowMs(clock) {
  try {
    if (isFunction(clock)) {
      const value =
        clock();

      if (
        value instanceof Date
      ) {
        return value.getTime();
      }

      const timestamp =
        Number(value);

      if (
        Number.isFinite(
          timestamp,
        )
      ) {
        return timestamp;
      }
    }
  } catch {
    // Fall through to wall clock.
  }

  return Date.now();
}

function nowIso(clock) {
  return new Date(
    nowMs(clock),
  ).toISOString();
}

export function createCollectionFraudGuard(
  options = {},
) {
  return new CollectionFraudGuard(
    options,
  );
}

export function normalizeCollectionPhone(
  value,
  countryCode = 'UG',
) {
  return normalizePhone(
    value,
    countryCode,
  );
}

export function normalizeCollectionMinorAmount(
  value,
  currency = 'UGX',
  configuration = DEFAULT_CONFIG,
) {
  return normalizeMinorAmount(
    value,
    upper(currency) || 'UGX',
    {
      ...DEFAULT_CONFIG,
      ...configuration,
      currencyMinorUnits: {
        ...DEFAULT_CONFIG.currencyMinorUnits,
        ...(configuration.currencyMinorUnits || {}),
      },
    },
  );
}

export function createCollectionFraudFingerprint(
  input = {},
) {
  const config = {
    ...DEFAULT_CONFIG,
    security: {
      ...DEFAULT_CONFIG.security,
      requireTenantId: true,
      requireFinancialIdentity: false,
      requireOriginalIdempotencyKey: false,
      requirePayer: false,
      requirePhone: false,
    },
    collection: {
      ...DEFAULT_CONFIG.collection,
    },
    currencyMinorUnits: {
      ...DEFAULT_CONFIG.currencyMinorUnits,
    },
  };

  const tenantId =
    boundedString(
      input.tenantId,
      160,
    );

  const currency =
    upper(
      input.currency ??
        config.collection
          .defaultCurrency,
    );

  const normalized = {
    tenantId,
    provider:
      PROVIDER,
    operation:
      OPERATION,
    transactionId:
      normalizedIdentifier(
        input.transactionId ??
          input.collectionId ??
          input.paymentId,
      ),
    amountMinor:
      normalizeMinorAmount(
        input.amountMinor ??
          input.amount,
        currency,
        config,
      ),
    currency,
    phone:
      normalizePhone(
        input.phoneNumber ??
          input.phone ??
          input.msisdn,
        config.collection
          .countryCode,
      ),
    externalReference:
      normalizedIdentifier(
        input.externalReference ??
          input.reference,
      ),
    payerFingerprint:
      sha256(
        stable(
          input.payer ??
            input.customer ??
            {},
        ),
      ),
  };

  return sha256(
    normalized,
  );
}

export function isCollectionFraudDecisionBlocking(
  decision,
) {
  return (
    upper(decision) ===
    FRAUD_DECISIONS.BLOCK
  );
}

export function isCollectionFraudDecisionReview(
  decision,
) {
  return (
    upper(decision) ===
    FRAUD_DECISIONS.REVIEW
  );
}

export function getDefaultConfiguration() {
  return cloneConfig(
    DEFAULT_CONFIG,
  );
}

function cloneConfig(config) {
  return JSON.parse(
    JSON.stringify(
      config,
    ),
  );
}

export default CollectionFraudGuard;