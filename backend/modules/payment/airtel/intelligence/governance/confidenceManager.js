'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Intelligence Confidence Manager
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/governance/confidenceManager.js
 *
 * Purpose:
 *   Govern confidence produced by Airtel payment intelligence components.
 *   This module normalizes heterogeneous evidence, applies bounded weighting,
 *   freshness and contradiction controls, optionally calibrates the score, and
 *   emits an explainable confidence assessment with provenance.
 *
 * RESPONSIBILITIES
 * ----------------
 * - Normalize evidence from provider, retry, recommendation, reconciliation,
 *   regulatory and learning engines.
 * - Produce deterministic [0,1] confidence scores and action-specific outcomes.
 * - Track evidence quality, status, freshness, provenance and contradictions.
 * - Fail closed on explicit hard compliance blocks and critical identity/
 *   financial/reconciliation contradictions.
 * - Support optional calibrated models and model-version provenance.
 * - Produce deterministic assessment/audit fingerprints.
 * - Provide threshold, merge, compare and health helpers.
 *
 * NON-RESPONSIBILITIES / IMPORTANT BOUNDARIES
 * --------------------------------------------
 * - Confidence is NOT authorization.
 * - No provider API calls.
 * - No database/persistence writes.
 * - No transaction, wallet, balance, journal or ledger mutation.
 * - No Financial Core posting.
 * - No KYC/AML/sanctions/fraud-policy replacement.
 * - No compliance override authority.
 * - No creation of financial identity or idempotency keys.
 * - No conversion of offline/local state into final settlement.
 *
 * FINANCIAL / GOVERNANCE SAFETY PRINCIPLES
 * -----------------------------------------
 * 1. A high confidence score can never override a regulatory hard block.
 * 2. Missing or unavailable evidence never becomes positive evidence.
 * 3. Stale evidence is down-weighted.
 * 4. Contradictory evidence lowers confidence and may force REVIEW.
 * 5. Evidence-source weight is bounded to prevent self-inflation.
 * 6. Assessment output explicitly states that it is not execution authority.
 * 7. Original financial idempotency identity is informational only and is never
 *    generated or changed by this module.
 * 8. Tenant and provider scope are enforced.
 * 9. Every material assessment has evidence and assessment fingerprints.
 * 10. Optional calibration may change confidence, but not hard governance gates.
 *
 * MODULE FORMAT
 * -------------
 * Native ESM. Node built-in crypto only. Runtime dependencies are injected.
 * =============================================================================
 */

import { createHash } from 'node:crypto';

export const ENGINE_NAME = 'airtel-confidence-manager';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';

export const CONFIDENCE_LEVELS = Object.freeze({
  VERY_LOW: 'VERY_LOW',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  VERY_HIGH: 'VERY_HIGH',
});

export const CONFIDENCE_OUTCOMES = Object.freeze({
  ACCEPT: 'ACCEPT',
  REVIEW: 'REVIEW',
  RECONCILE: 'RECONCILE',
  BLOCK: 'BLOCK',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
});

export const EVIDENCE_QUALITIES = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  AUTHORITATIVE: 'AUTHORITATIVE',
});

export const EVIDENCE_STATUSES = Object.freeze({
  PRESENT: 'PRESENT',
  MISSING: 'MISSING',
  STALE: 'STALE',
  CONTRADICTORY: 'CONTRADICTORY',
  INVALID: 'INVALID',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const SIGNAL_DIRECTIONS = Object.freeze({
  POSITIVE: 'POSITIVE',
  NEGATIVE: 'NEGATIVE',
  NEUTRAL: 'NEUTRAL',
  UNKNOWN: 'UNKNOWN',
});

export const OFFLINE_STATES = Object.freeze({
  LOCAL_ONLY: 'LOCAL_ONLY',
  PENDING_SYNC: 'PENDING_SYNC',
  SYNCING: 'SYNCING',
  SERVER_ACCEPTED: 'SERVER_ACCEPTED',
  SERVER_REJECTED: 'SERVER_REJECTED',
  CONFLICT: 'CONFLICT',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  CONFIRMED: 'CONFIRMED',
});

export const GOVERNANCE_FLAGS = Object.freeze({
  REGULATORY_HARD_BLOCK: 'REGULATORY_HARD_BLOCK',
  IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
  FINANCIAL_MISMATCH: 'FINANCIAL_MISMATCH',
  PROVIDER_MISMATCH: 'PROVIDER_MISMATCH',
  RECONCILIATION_CONFLICT: 'RECONCILIATION_CONFLICT',
  AMBIGUOUS_OUTCOME: 'AMBIGUOUS_OUTCOME',
  OFFLINE_UNRESOLVED: 'OFFLINE_UNRESOLVED',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  DATA_QUALITY_LOW: 'DATA_QUALITY_LOW',
  CONTRADICTORY_EVIDENCE: 'CONTRADICTORY_EVIDENCE',
});

export const DEFAULT_THRESHOLDS = Object.freeze({
  accept: 0.85,
  review: 0.65,
  reconcile: 0.45,
  minimumEvidence: 2,
  minimumQuality: 0.35,
});

export const ACTION_THRESHOLDS = Object.freeze({
  INITIATE: {
    accept: 0.80,
    review: 0.60,
    reconcile: 0.40,
  },

  RETRY: {
    accept: 0.90,
    review: 0.70,
    reconcile: 0.50,
  },

  STATUS_CHECK: {
    accept: 0.55,
    review: 0.40,
    reconcile: 0.25,
  },

  RECONCILE: {
    accept: 0.75,
    review: 0.55,
    reconcile: 0.35,
  },

  REPAIR: {
    accept: 0.90,
    review: 0.75,
    reconcile: 0.55,
  },

  SETTLE: {
    accept: 0.95,
    review: 0.80,
    reconcile: 0.60,
  },

  REFUND: {
    accept: 0.95,
    review: 0.80,
    reconcile: 0.60,
  },

  REVERSE: {
    accept: 0.95,
    review: 0.80,
    reconcile: 0.60,
  },

  CANCEL: {
    accept: 0.90,
    review: 0.70,
    reconcile: 0.50,
  },

  SYNC_OFFLINE: {
    accept: 0.85,
    review: 0.65,
    reconcile: 0.45,
  },

  REVIEW: {
    accept: 1,
    review: 0,
    reconcile: 0,
  },
});

const QUALITY_MULTIPLIER = Object.freeze({
  UNKNOWN: 0.35,
  LOW: 0.55,
  MEDIUM: 0.75,
  HIGH: 0.90,
  AUTHORITATIVE: 1,
});

const STATUS_MULTIPLIER = Object.freeze({
  PRESENT: 1,
  MISSING: 0,
  STALE: 0.55,
  CONTRADICTORY: 0.30,
  INVALID: 0,
  UNAVAILABLE: 0,
});

const SEVERITY_PENALTY = Object.freeze({
  INFO: 0,
  LOW: 0.01,
  MEDIUM: 0.03,
  HIGH: 0.08,
  CRITICAL: 0.15,
});

const HARD_BLOCK_DECISIONS = new Set([
  'BLOCK',
  'DENY',
  'HARD_BLOCK',
  'BLOCKED',
]);

const HARD_FLAGS = new Set([
  GOVERNANCE_FLAGS.REGULATORY_HARD_BLOCK,
  GOVERNANCE_FLAGS.IDENTITY_MISMATCH,
  GOVERNANCE_FLAGS.FINANCIAL_MISMATCH,
  GOVERNANCE_FLAGS.PROVIDER_MISMATCH,
  GOVERNANCE_FLAGS.RECONCILIATION_CONFLICT,
]);

const UNRESOLVED_OFFLINE_STATES = new Set([
  OFFLINE_STATES.LOCAL_ONLY,
  OFFLINE_STATES.PENDING_SYNC,
  OFFLINE_STATES.SYNCING,
  OFFLINE_STATES.SERVER_REJECTED,
  OFFLINE_STATES.CONFLICT,
  OFFLINE_STATES.REQUIRES_REVIEW,
]);

const SECRET_FIELD_PATTERN =
  /(password|secret|token|authorization|cookie|session|otp|pin|cvv|cvc|pan|card(number)?|private.?key|access.?key|api.?key|signature|credential|raw(request|response)|provider.?payload)/i;

const SENSITIVE_PATH_PATTERN =
  /(request|response)\.(body|payload|headers|raw)|(^|\.)(authorization|cookie|token|secret|password|pin|otp|cvv|pan)$/i;

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const normalizeString = (
  value,
  max = 240,
) => {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  const text = String(value).trim();

  return text
    ? text.slice(0, max)
    : undefined;
};

const upper = (value) =>
  normalizeString(
    value,
    160,
  )?.toUpperCase();

const numberOrUndefined = (
  value,
) => {
  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === 'string' &&
    value.trim()
  ) {
    const parsed = Number(value);

    return Number.isFinite(parsed)
      ? parsed
      : undefined;
  }

  return undefined;
};

const bounded = (
  value,
  min = 0,
  max = 1,
) =>
  Math.min(
    max,
    Math.max(
      min,
      Number.isFinite(
        Number(value),
      )
        ? Number(value)
        : min,
    ),
  );

const normalizeScore = (
  value,
) => {
  const number =
    numberOrUndefined(value);

  if (
    number === undefined
  ) {
    return undefined;
  }

  return bounded(
    number > 1
      ? number / 100
      : number,
  );
};

const normalizeWeight = (
  value,
) =>
  Math.min(
    10,
    Math.max(
      0,
      numberOrUndefined(value) ??
        1,
    ),
  );

const stableSerialize = (
  value,
) => {
  if (
    value === undefined
  ) {
    return 'undefined';
  }

  if (
    value === null
  ) {
    return 'null';
  }

  if (
    typeof value === 'bigint'
  ) {
    return `bigint:${value}`;
  }

  if (
    value instanceof Date
  ) {
    return `date:${value.toISOString()}`;
  }

  if (
    Array.isArray(value)
  ) {
    return `[${value
      .map(stableSerialize)
      .join(',')}]`;
  }

  if (
    isPlainObject(value)
  ) {
    return `{${Object.keys(
      value,
    )
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(
            key,
          )}:${stableSerialize(
            value[key],
          )}`,
      )
      .join(',')}}`;
  }

  if (
    typeof value === 'number' &&
    Object.is(value, -0)
  ) {
    return '0';
  }

  return JSON.stringify(
    value,
  );
};

const sha256 = (
  value,
) =>
  createHash('sha256')
    .update(
      stableSerialize(value),
    )
    .digest('hex');

const clone = (
  value,
) =>
  value === undefined
    ? undefined
    : JSON.parse(
        JSON.stringify(value),
      );

const sanitize = (
  value,
  path = '',
  depth = 0,
) => {
  if (
    depth > 6
  ) {
    return '[TRUNCATED]';
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value === 'string'
  ) {
    return value.length > 2000
      ? `${value.slice(
          0,
          2000,
        )}…`
      : value;
  }

  if (
    typeof value !== 'object'
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
      .slice(0, 100)
      .map(
        (item, index) =>
          sanitize(
            item,
            `${path}[${index}]`,
            depth + 1,
          ),
      );
  }

  const output = {};

  for (
    const key of Object.keys(
      value,
    ).slice(0, 100)
  ) {
    const childPath =
      path
        ? `${path}.${key}`
        : key;

    output[key] =
      SECRET_FIELD_PATTERN.test(
        key,
      ) ||
      SENSITIVE_PATH_PATTERN.test(
        childPath,
      )
        ? '[REDACTED]'
        : sanitize(
            value[key],
            childPath,
            depth + 1,
          );
  }

  return output;
};

const deepFreeze = (
  value,
  seen = new WeakSet(),
) => {
  if (
    !value ||
    typeof value !== 'object' ||
    seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (
    const child of Object.values(
      value,
    )
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
) =>
  typeof clock?.now ===
  'function'
    ? clock.now()
    : Date.now();

const nowIso = (
  clock,
) =>
  new Date(
    nowMs(clock),
  ).toISOString();

const qualityMultiplier = (
  quality,
) =>
  QUALITY_MULTIPLIER[
    upper(quality) ??
      'UNKNOWN'
  ] ??
  QUALITY_MULTIPLIER.UNKNOWN;

const statusMultiplier = (
  status,
) =>
  STATUS_MULTIPLIER[
    upper(status) ??
      'PRESENT'
  ] ??
  0;

const severityPenalty = (
  severity,
) =>
  SEVERITY_PENALTY[
    upper(severity) ??
      'INFO'
  ] ??
  0;

const levelFor = (
  score,
) => {
  if (
    score < 0.2
  ) {
    return CONFIDENCE_LEVELS.VERY_LOW;
  }

  if (
    score < 0.4
  ) {
    return CONFIDENCE_LEVELS.LOW;
  }

  if (
    score < 0.7
  ) {
    return CONFIDENCE_LEVELS.MEDIUM;
  }

  if (
    score < 0.9
  ) {
    return CONFIDENCE_LEVELS.HIGH;
  }

  return CONFIDENCE_LEVELS.VERY_HIGH;
};

const clampThresholds = (
  value = {},
) => {
  const reconcile =
    bounded(
      value.reconcile ??
        DEFAULT_THRESHOLDS.reconcile,
    );

  const review = Math.max(
    reconcile,
    bounded(
      value.review ??
        DEFAULT_THRESHOLDS.review,
    ),
  );

  const accept = Math.max(
    review,
    bounded(
      value.accept ??
        DEFAULT_THRESHOLDS.accept,
    ),
  );

  return {
    reconcile,
    review,
    accept,
  };
};

const classify = (
  score,
  thresholds,
) => {
  if (
    score >=
    thresholds.accept
  ) {
    return CONFIDENCE_OUTCOMES.ACCEPT;
  }

  if (
    score >=
    thresholds.review
  ) {
    return CONFIDENCE_OUTCOMES.REVIEW;
  }

  if (
    score >=
    thresholds.reconcile
  ) {
    return CONFIDENCE_OUTCOMES.RECONCILE;
  }

  return (
    CONFIDENCE_OUTCOMES
      .INSUFFICIENT_EVIDENCE
  );
};

const directionFrom = (
  input,
) => {
  const explicit =
    upper(input.direction);

  if (
    Object.values(
      SIGNAL_DIRECTIONS,
    ).includes(explicit)
  ) {
    return explicit;
  }

  const score =
    normalizeScore(
      input.score ??
        input.confidence ??
        input.probability,
    );

  if (
    score === undefined
  ) {
    return SIGNAL_DIRECTIONS.UNKNOWN;
  }

  if (
    score >= 0.65
  ) {
    return SIGNAL_DIRECTIONS.POSITIVE;
  }

  if (
    score <= 0.35
  ) {
    return SIGNAL_DIRECTIONS.NEGATIVE;
  }

  return SIGNAL_DIRECTIONS.NEUTRAL;
};

export class AirtelConfidenceManagerError extends Error {
  constructor(
    code,
    message,
    details = {},
    options = {},
  ) {
    super(
      message,
      options,
    );

    this.name =
      'AirtelConfidenceManagerError';

    this.code =
      code;

    this.component =
      COMPONENT;

    this.provider =
      PROVIDER;

    this.details =
      sanitize(details);

    this.retryable =
      Boolean(
        options.retryable,
      );

    this.httpStatus =
      options.httpStatus ??
      400;
  }
}

export const normalizeEvidence = (
  input = {},
) => {
  if (
    !isPlainObject(input)
  ) {
    throw new AirtelConfidenceManagerError(
      'INVALID_EVIDENCE',
      'Evidence item must be an object.',
    );
  }

  const rawScore =
    numberOrUndefined(
      input.score ??
        input.confidence ??
        input.probability,
    );

  const observedAt =
    input.observedAt
      ? new Date(
          input.observedAt,
        )
      : null;

  const expiresAt =
    input.expiresAt
      ? new Date(
          input.expiresAt,
        )
      : null;

  return {
    id:
      normalizeString(
        input.id ??
          input.signalId ??
          input.sourceId,
        180,
      ),

    source:
      normalizeString(
        input.source ??
          input.engine ??
          input.component,
        180,
      ) ??
      'UNKNOWN_SOURCE',

    sourceVersion:
      normalizeString(
        input.sourceVersion ??
          input.engineVersion ??
          input.version,
        100,
      ),

    type:
      upper(
        input.type ??
          input.signalType,
      ) ??
      'GENERAL',

    rawScore,

    score:
      normalizeScore(
        rawScore,
      ),

    direction:
      directionFrom(input),

    weight:
      normalizeWeight(
        input.weight,
      ),

    quality:
      upper(
        input.quality ??
          input.evidenceQuality,
      ) ??
      EVIDENCE_QUALITIES.UNKNOWN,

    status:
      upper(
        input.status,
      ) ??
      EVIDENCE_STATUSES.PRESENT,

    severity:
      upper(
        input.severity,
      ) ??
      'INFO',

    flag:
      upper(
        input.flag ??
          input.governanceFlag,
      ),

    decision:
      upper(
        input.decision ??
          input.outcome,
      ),

    observation:
      normalizeString(
        input.observation ??
          input.summary ??
          input.reason,
        1000,
      ),

    observedAt:
      observedAt &&
      Number.isFinite(
        observedAt.getTime(),
      )
        ? observedAt.toISOString()
        : undefined,

    expiresAt:
      expiresAt &&
      Number.isFinite(
        expiresAt.getTime(),
      )
        ? expiresAt.toISOString()
        : undefined,

    freshnessMs:
      numberOrUndefined(
        input.freshnessMs,
      ),

    metadata:
      sanitize(
        input.metadata ??
          {},
      ),
  };
};

export const buildEvidenceFingerprint = (
  evidence,
) =>
  sha256(
    sanitize(
      evidence,
    ),
  );

export const buildAssessmentFingerprint = (
  assessment,
) =>
  sha256({
    tenantId:
      assessment.tenantId,

    provider:
      assessment.provider,

    operation:
      assessment.operation,

    action:
      assessment.action,

    confidence:
      assessment.confidence,

    outcome:
      assessment.outcome,

    level:
      assessment.level,

    flags:
      assessment.flags,

    evidenceFingerprint:
      assessment.evidenceFingerprint,

    modelVersion:
      assessment.modelVersion,

    calibrationVersion:
      assessment.calibrationVersion,
  });

export class AirtelConfidenceManager {
  constructor(
    options = {},
  ) {
    const config =
      options.config ??
      {};

    this.config =
      Object.freeze({
        minimumEvidence:
          Math.max(
            0,
            Math.trunc(
              config.minimumEvidence ??
                DEFAULT_THRESHOLDS
                  .minimumEvidence,
            ),
          ),

        minimumQuality:
          bounded(
            config.minimumQuality ??
              DEFAULT_THRESHOLDS
                .minimumQuality,
          ),

        thresholds:
          config.thresholds ??
          {},

        actionThresholds:
          config.actionThresholds ??
          {},

        staleAfterMs:
          Math.max(
            1,
            Number(
              config.staleAfterMs ??
                15 * 60 * 1000,
            ),
          ),

        contradictionPenalty:
          bounded(
            config.contradictionPenalty ??
              0.20,
          ),

        missingEvidencePenalty:
          bounded(
            config.missingEvidencePenalty ??
              0.05,
          ),

        maxSources:
          Math.max(
            1,
            Math.trunc(
              config.maxSources ??
                50,
            ),
          ),

        maxSignalsPerSource:
          Math.max(
            1,
            Math.trunc(
              config.maxSignalsPerSource ??
                20,
            ),
          ),

        requireTenantId:
          config.requireTenantId ??
          true,

        enforceAirtelProvider:
          config.enforceAirtelProvider ??
          true,

        failClosedOnCalibrationError:
          config.failClosedOnCalibrationError ??
          false,
      });

    this.calibrator =
      options.calibrator ??
      options.calibrationAdapter ??
      null;

    this.modelRegistry =
      options.modelRegistry ??
      null;

    this.audit =
      options.audit ??
      null;

    this.logger =
      options.logger ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.clock =
      options.clock ??
      {
        now: () =>
          Date.now(),
      };
  }

  _requireTenant(
    input,
  ) {
    const tenantId =
      normalizeString(
        input.tenantId,
        160,
      );

    if (
      this.config
        .requireTenantId &&
      !tenantId
    ) {
      throw new AirtelConfidenceManagerError(
        'TENANT_REQUIRED',
        'tenantId is required for governed confidence assessment.',
      );
    }

    return tenantId;
  }

  _requireProvider(
    input,
  ) {
    const provider =
      upper(
        input.provider ??
          PROVIDER,
      ) ??
      PROVIDER;

    if (
      this.config
        .enforceAirtelProvider &&
      provider !==
        PROVIDER
    ) {
      throw new AirtelConfidenceManagerError(
        'PROVIDER_SCOPE_VIOLATION',
        'Confidence manager is scoped to Airtel provider intelligence.',
        {
          provider,
        },
      );
    }

    return provider;
  }

  _thresholds(
    action,
  ) {
    const normalized =
      upper(action);

    return clampThresholds({
      ...DEFAULT_THRESHOLDS,

      ...(
        ACTION_THRESHOLDS[
          normalized
        ] ??
        {}
      ),

      ...(
        this.config
          .actionThresholds[
          normalized
        ] ??
        {}
      ),

      ...this.config.thresholds,
    });
  }

  _freshnessFactor(
    item,
    now,
  ) {
    if (
      item.status ===
      EVIDENCE_STATUSES.INVALID
    ) {
      return 0;
    }

    if (
      item.status ===
      EVIDENCE_STATUSES.UNAVAILABLE
    ) {
      return 0;
    }

    if (
      item.status ===
      EVIDENCE_STATUSES.STALE
    ) {
      return 0.55;
    }

    if (
      !item.observedAt
    ) {
      return 1;
    }

    const observed =
      new Date(
        item.observedAt,
      ).getTime();

    if (
      !Number.isFinite(
        observed,
      )
    ) {
      return 0.35;
    }

    if (
      item.expiresAt
    ) {
      const expiry =
        new Date(
          item.expiresAt,
        ).getTime();

      if (
        Number.isFinite(
          expiry,
        ) &&
        now >= expiry
      ) {
        return 0.15;
      }
    }

    const age =
      Math.max(
        0,
        now - observed,
      );

    if (
      age <=
      this.config
        .staleAfterMs
    ) {
      return 1;
    }

    return Math.max(
      0.25,
      this.config
        .staleAfterMs /
        age,
    );
  }

  _validateEvidenceSet(
    input,
  ) {
    if (
      !Array.isArray(input)
    ) {
      throw new AirtelConfidenceManagerError(
        'EVIDENCE_ARRAY_REQUIRED',
        'evidence must be an array.',
      );
    }

    const items =
      input.map(
        normalizeEvidence,
      );

    const sourceCount =
      new Map();

    for (
      const item of items
    ) {
      const count =
        (
          sourceCount.get(
            item.source,
          ) ??
          0
        ) + 1;

      sourceCount.set(
        item.source,
        count,
      );

      if (
        count >
        this.config
          .maxSignalsPerSource
      ) {
        throw new AirtelConfidenceManagerError(
          'SOURCE_SIGNAL_LIMIT_EXCEEDED',
          'An evidence source supplied too many signals.',
          {
            source:
              item.source,
          },
        );
      }
    }

    if (
      sourceCount.size >
      this.config.maxSources
    ) {
      throw new AirtelConfidenceManagerError(
        'SOURCE_LIMIT_EXCEEDED',
        'Too many evidence sources were supplied.',
      );
    }

    return items;
  }

  _scoreEvidence(
    item,
    now,
  ) {
    const freshness =
      this._freshnessFactor(
        item,
        now,
      );

    const quality =
      qualityMultiplier(
        item.quality,
      );

    const status =
      statusMultiplier(
        item.status,
      );

    const weight =
      normalizeWeight(
        item.weight,
      );

    const riskPenalty =
      severityPenalty(
        item.severity,
      ) *
      (
        item.direction ===
        SIGNAL_DIRECTIONS.NEGATIVE
          ? 1
          : 0.25
      );

    const effectiveWeight =
      weight *
      quality *
      status *
      freshness;

    const contribution =
      (
        item.score ??
        0
      ) *
      effectiveWeight;

    return {
      ...item,

      freshnessFactor:
        Number(
          freshness.toFixed(
            6,
          ),
        ),

      qualityMultiplier:
        Number(
          quality.toFixed(
            6,
          ),
        ),

      statusMultiplier:
        Number(
          status.toFixed(
            6,
          ),
        ),

      effectiveWeight:
        Number(
          effectiveWeight.toFixed(
            6,
          ),
        ),

      contribution:
        Number(
          contribution.toFixed(
            6,
          ),
        ),

      riskPenalty:
        Number(
          riskPenalty.toFixed(
            6,
          ),
        ),
    };
  }

  _detectFlags(
    input,
    evidence,
  ) {
    const flags =
      new Set();

    for (
      const item of evidence
    ) {
      if (
        item.flag
      ) {
        flags.add(
          item.flag,
        );
      }

      if (
        item.status ===
        EVIDENCE_STATUSES.CONTRADICTORY
      ) {
        flags.add(
          GOVERNANCE_FLAGS
            .CONTRADICTORY_EVIDENCE,
        );
      }

      if (
        item.decision &&
        HARD_BLOCK_DECISIONS.has(
          item.decision,
        ) &&
        (
          item.type.includes(
            'REGUL',
          ) ||
          item.source
            .toUpperCase()
            .includes(
              'REGUL',
            )
        )
      ) {
        flags.add(
          GOVERNANCE_FLAGS
            .REGULATORY_HARD_BLOCK,
        );
      }
    }

    const regulatoryDecision =
      upper(
        input.regulatoryDecision ??
          input.regulatoryOutcome ??
          input.complianceDecision,
      );

    if (
      HARD_BLOCK_DECISIONS.has(
        regulatoryDecision,
      )
    ) {
      flags.add(
        GOVERNANCE_FLAGS
          .REGULATORY_HARD_BLOCK,
      );
    }

    const offlineState =
      upper(
        input.offlineState,
      );

    if (
      UNRESOLVED_OFFLINE_STATES.has(
        offlineState,
      )
    ) {
      flags.add(
        GOVERNANCE_FLAGS
          .OFFLINE_UNRESOLVED,
      );
    }

    const outcome =
      upper(
        input.providerOutcome ??
          input.outcome ??
          input.status,
      );

    if (
      [
        'AMBIGUOUS',
        'UNKNOWN',
        'TIMEOUT',
      ].includes(
        outcome,
      )
    ) {
      flags.add(
        GOVERNANCE_FLAGS
          .AMBIGUOUS_OUTCOME,
      );
    }

    return [
      ...flags,
    ];
  }

  _contradictions(
    evidence,
  ) {
    const groups =
      new Map();

    for (
      const item of evidence
    ) {
      const bucket =
        groups.get(
          item.type,
        ) ??
        [];

      bucket.push(
        item,
      );

      groups.set(
        item.type,
        bucket,
      );
    }

    const contradictions =
      [];

    for (
      const [
        type,
        items,
      ] of groups
    ) {
      const positive =
        items.filter(
          (item) =>
            item.direction ===
            SIGNAL_DIRECTIONS.POSITIVE,
        );

      const negative =
        items.filter(
          (item) =>
            item.direction ===
            SIGNAL_DIRECTIONS.NEGATIVE,
        );

      if (
        positive.length &&
        negative.length
      ) {
        contradictions.push({
          type,

          positiveSources:
            [
              ...new Set(
                positive.map(
                  (item) =>
                    item.source,
                ),
              ),
            ],

          negativeSources:
            [
              ...new Set(
                negative.map(
                  (item) =>
                    item.source,
                ),
              ),
            ],
        });
      }
    }

    return contradictions;
  }

  _hardBlock(
    input,
    flags,
    evidence,
  ) {
    const decision =
      upper(
        input.regulatoryDecision ??
          input.regulatoryOutcome ??
          input.complianceDecision,
      );

    if (
      HARD_BLOCK_DECISIONS.has(
        decision,
      )
    ) {
      return {
        blocked: true,
        reason:
          'EXPLICIT_COMPLIANCE_BLOCK',
      };
    }

    if (
      flags.includes(
        GOVERNANCE_FLAGS
          .REGULATORY_HARD_BLOCK,
      )
    ) {
      return {
        blocked: true,
        reason:
          GOVERNANCE_FLAGS
            .REGULATORY_HARD_BLOCK,
      };
    }

    const hardEvidence =
      evidence.find(
        (item) =>
          item.flag &&
          HARD_FLAGS.has(
            item.flag,
          ),
      );

    if (
      hardEvidence
    ) {
      return {
        blocked: true,
        reason:
          hardEvidence.flag,
      };
    }

    return {
      blocked: false,
    };
  }

  async _calibrate(
    score,
    context,
  ) {
    if (
      !this.calibrator
    ) {
      return {
        score,

        calibrated:
          false,

        calibrationVersion:
          undefined,

        calibrationSource:
          undefined,
      };
    }

    const method =
      this.calibrator
        .calibrate ??
      this.calibrator
        .adjust ??
      this.calibrator
        .transform;

    if (
      typeof method !==
      'function'
    ) {
      return {
        score,

        calibrated:
          false,

        calibrationVersion:
          undefined,

        calibrationSource:
          undefined,
      };
    }

    try {
      const result =
        await method.call(
          this.calibrator,
          {
            score,

            context:
              sanitize(
                context,
              ),
          },
        );

      return {
        score:
          normalizeScore(
            result?.score ??
              result?.calibratedScore ??
              score,
          ) ??
          score,

        calibrated:
          true,

        calibrationVersion:
          normalizeString(
            result?.version ??
              result?.calibrationVersion,
            120,
          ),

        calibrationSource:
          normalizeString(
            result?.source ??
              result?.calibrationSource,
            180,
          ),
      };
    } catch (
      error
    ) {
      this._log(
        'error',
        'Confidence calibration failed.',
        {
          message:
            error?.message,
        },
      );

      if (
        this.config
          .failClosedOnCalibrationError
      ) {
        throw new AirtelConfidenceManagerError(
          'CALIBRATION_UNAVAILABLE',
          'Confidence calibration is unavailable and governance is configured to fail closed.',
          {},
          {
            retryable:
              true,

            httpStatus:
              503,
          },
        );
      }

      return {
        score,

        calibrated:
          false,

        calibrationVersion:
          undefined,

        calibrationSource:
          undefined,
      };
    }
  }

  _modelVersion(
    input,
  ) {
    const requested =
      normalizeString(
        input.modelVersion ??
          input.engineVersion,
        120,
      );

    if (
      requested
    ) {
      return requested;
    }

    const getter =
      this.modelRegistry
        ?.getActiveVersion ??
      this.modelRegistry
        ?.getVersion;

    if (
      typeof getter !==
      'function'
    ) {
      return ENGINE_VERSION;
    }

    try {
      const result =
        getter.call(
          this.modelRegistry,
          {
            provider:
              PROVIDER,

            operation:
              input.operation,

            action:
              input.action,
          },
        );

      if (
        result &&
        typeof result.then ===
          'function'
      ) {
        return ENGINE_VERSION;
      }

      return (
        normalizeString(
          result?.version ??
            result,
          120,
        ) ??
        ENGINE_VERSION
      );
    } catch {
      return ENGINE_VERSION;
    }
  }

  _rawScore(
    evidence,
    contradictions,
  ) {
    let numerator = 0;
    let denominator = 0;
    let riskPenaltyTotal =
      0;

    for (
      const item of evidence
    ) {
      numerator +=
        item.contribution;

      denominator +=
        item.effectiveWeight;

      riskPenaltyTotal +=
        item.riskPenalty;
    }

    const base =
      denominator > 0
        ? numerator /
          denominator
        : 0;

    const contradictionPenalty =
      Math.min(
        0.40,
        contradictions.length *
          this.config
            .contradictionPenalty,
      );

    const missing =
      evidence.filter(
        (item) =>
          [
            EVIDENCE_STATUSES.MISSING,
            EVIDENCE_STATUSES.UNAVAILABLE,
          ].includes(
            item.status,
          ),
      ).length;

    const missingPenalty =
      Math.min(
        0.20,
        missing *
          this.config
            .missingEvidencePenalty,
      );

    return bounded(
      base -
        contradictionPenalty -
        missingPenalty -
        Math.min(
          0.20,
          riskPenaltyTotal,
        ),
    );
  }

  _minimumEvidence(
    evidence,
  ) {
    const usable =
      evidence.filter(
        (item) =>
          item.score !==
            undefined &&
          item.status !==
            EVIDENCE_STATUSES.INVALID &&
          item.status !==
            EVIDENCE_STATUSES.UNAVAILABLE,
      );

    const qualityAccepted =
      usable.filter(
        (item) =>
          qualityMultiplier(
            item.quality,
          ) >=
          this.config
            .minimumQuality,
      );

    return {
      usableCount:
        usable.length,

      acceptedQualityCount:
        qualityAccepted.length,

      sufficient:
        qualityAccepted.length >=
        this.config
          .minimumEvidence,
    };
  }

  async evaluate(
    input = {},
  ) {
    const normalized =
      sanitize(
        clone(input) ??
          {},
      );

    const tenantId =
      this._requireTenant(
        normalized,
      );

    const provider =
      this._requireProvider(
        normalized,
      );

    const action =
      upper(
        normalized.action ??
          normalized.command,
      ) ??
      'GENERAL';

    const operation =
      upper(
        normalized.operation ??
          normalized.operationType,
      ) ??
      'GENERAL';

    const evidence =
      this._validateEvidenceSet(
        normalized.evidence ??
          normalized.signals ??
          [],
      );

    const now =
      nowMs(
        this.clock,
      );

    const scoredEvidence =
      evidence.map(
        (item) =>
          this._scoreEvidence(
            item,
            now,
          ),
      );

    const flags =
      this._detectFlags(
        normalized,
        scoredEvidence,
      );

    const contradictions =
      this._contradictions(
        scoredEvidence,
      );

    if (
      contradictions.length
    ) {
      flags.push(
        GOVERNANCE_FLAGS
          .CONTRADICTORY_EVIDENCE,
      );
    }

    const minimumEvidence =
      this._minimumEvidence(
        scoredEvidence,
      );

    const hardBlock =
      this._hardBlock(
        normalized,
        flags,
        scoredEvidence,
      );

    const thresholds =
      this._thresholds(
        action,
      );

    const rawScore =
      this._rawScore(
        scoredEvidence,
        contradictions,
      );

    const calibration =
      await this._calibrate(
        rawScore,
        {
          tenantId,
          provider,
          operation,
          action,
          evidence:
            scoredEvidence,
          flags,
        },
      );

    let confidence =
      bounded(
        calibration.score ??
          rawScore,
      );

    let outcome;

    if (
      hardBlock.blocked
    ) {
      outcome =
        CONFIDENCE_OUTCOMES.BLOCK;

      confidence =
        Math.min(
          confidence,
          0.01,
        );
    } else if (
      !minimumEvidence.sufficient
    ) {
      outcome =
        CONFIDENCE_OUTCOMES
          .INSUFFICIENT_EVIDENCE;

      flags.push(
        GOVERNANCE_FLAGS
          .DATA_QUALITY_LOW,
      );
    } else {
      outcome =
        classify(
          confidence,
          thresholds,
        );
    }

    if (
      outcome ===
        CONFIDENCE_OUTCOMES.ACCEPT &&
      flags.some(
        (flag) =>
          [
            GOVERNANCE_FLAGS
              .AMBIGUOUS_OUTCOME,

            GOVERNANCE_FLAGS
              .OFFLINE_UNRESOLVED,

            GOVERNANCE_FLAGS
              .CONTRADICTORY_EVIDENCE,

            GOVERNANCE_FLAGS
              .DATA_QUALITY_LOW,
          ].includes(
            flag,
          ),
      )
    ) {
      outcome =
        CONFIDENCE_OUTCOMES.REVIEW;
    }

    const assessment = {
      component:
        COMPONENT,

      provider:
        provider,

      engineVersion:
        ENGINE_VERSION,

      modelVersion:
        this._modelVersion(
          normalized,
        ),

      calibrationVersion:
        calibration.calibrationVersion,

      calibrationSource:
        calibration.calibrationSource,

      calibrated:
        calibration.calibrated,

      tenantId,

      operation,

      action,

      rawScore:
        Number(
          rawScore.toFixed(
            6,
          ),
        ),

      confidence:
        Number(
          confidence.toFixed(
            6,
          ),
        ),

      percentage:
        Number(
          (
            confidence *
            100
          ).toFixed(4),
        ),

      level:
        levelFor(
          confidence,
        ),

      outcome,

      thresholds,

      flags: [
        ...new Set(
          flags,
        ),
      ],

      contradictions,

      evidenceCount:
        scoredEvidence.length,

      usableEvidenceCount:
        minimumEvidence
          .usableCount,

      qualityAcceptedEvidenceCount:
        minimumEvidence
          .acceptedQualityCount,

      evidenceFingerprint:
        buildEvidenceFingerprint(
          scoredEvidence,
        ),

      evidence:
        scoredEvidence.map(
          sanitize,
        ),

      governance: {
        confidenceIsAuthorization:
          false,

        financialExecutionAuthorized:
          false,

        complianceOverrideGranted:
          false,

        ledgerMutationAuthorized:
          false,

        balanceMutationAuthorized:
          false,

        settlementConfirmed:
          false,

        authoritativeBoundary:
          'TITECH_FINANCIAL_CORE',
      },

      evaluatedAt:
        nowIso(
          this.clock,
        ),
    };

    assessment.assessmentFingerprint =
      buildAssessmentFingerprint(
        assessment,
      );

    const frozen =
      deepFreeze(
        clone(
          assessment,
        ),
      );

    await this._writeAudit(
      this.buildAuditEnvelope(
        frozen,
      ),
    );

    this._metric(
      'airtel_confidence_assessment_total',
      {
        action,
        outcome,
        level:
          frozen.level,
      },
    );

    return frozen;
  }

  async assess(
    input = {},
  ) {
    return this.evaluate(
      input,
    );
  }

  async calculate(
    input = {},
  ) {
    return this.evaluate(
      input,
    );
  }

  async score(
    input = {},
  ) {
    return this.evaluate(
      input,
    );
  }

  evaluateThreshold(
    confidence,
    action,
  ) {
    const score =
      normalizeScore(
        confidence,
      );

    if (
      score === undefined
    ) {
      return {
        eligible:
          false,

        score:
          0,

        level:
          CONFIDENCE_LEVELS.VERY_LOW,

        outcome:
          CONFIDENCE_OUTCOMES
            .INSUFFICIENT_EVIDENCE,
      };
    }

    const thresholds =
      this._thresholds(
        action,
      );

    const outcome =
      classify(
        score,
        thresholds,
      );

    return {
      eligible:
        outcome ===
        CONFIDENCE_OUTCOMES.ACCEPT,

      score,

      level:
        levelFor(
          score,
        ),

      outcome,

      thresholds,
    };
  }

  compare(
    left,
    right,
  ) {
    const a =
      normalizeScore(
        left?.confidence ??
          left?.score,
      ) ?? 0;

    const b =
      normalizeScore(
        right?.confidence ??
          right?.score,
      ) ?? 0;

    return {
      relation:
        a === b
          ? 'EQUAL'
          : a > b
            ? 'LEFT_HIGHER'
            : 'RIGHT_HIGHER',

      left: a,

      right: b,

      delta:
        Number(
          (
            a - b
          ).toFixed(6),
        ),
    };
  }

  rank(
    assessments = [],
  ) {
    if (
      !Array.isArray(
        assessments,
      )
    ) {
      throw new AirtelConfidenceManagerError(
        'ASSESSMENT_ARRAY_REQUIRED',
        'assessments must be an array.',
      );
    }

    return assessments
      .slice()
      .sort(
        (
          a,
          b,
        ) =>
          (
            normalizeScore(
              b?.confidence ??
                b?.score,
            ) ?? 0
          ) -
          (
            normalizeScore(
              a?.confidence ??
                a?.score,
            ) ?? 0
          ),
      );
  }

  merge(
    assessments = [],
    options = {},
  ) {
    if (
      !Array.isArray(
        assessments,
      )
    ) {
      throw new AirtelConfidenceManagerError(
        'ASSESSMENT_ARRAY_REQUIRED',
        'assessments must be an array.',
      );
    }

    const valid =
      assessments.filter(
        (item) =>
          normalizeScore(
            item?.confidence ??
              item?.score,
          ) !== undefined,
      );

    if (
      !valid.length
    ) {
      return {
        confidence:
          0,

        percentage:
          0,

        level:
          CONFIDENCE_LEVELS.VERY_LOW,

        outcome:
          CONFIDENCE_OUTCOMES
            .INSUFFICIENT_EVIDENCE,

        evidenceCount:
          0,

        flags: [
          GOVERNANCE_FLAGS
            .DATA_QUALITY_LOW,
        ],

        governance: {
          confidenceIsAuthorization:
            false,
        },
      };
    }

    let numerator = 0;
    let denominator = 0;

    for (
      const item of valid
    ) {
      const score =
        normalizeScore(
          item.confidence ??
            item.score,
        ) ?? 0;

      const weight =
        normalizeWeight(
          item.weight,
        );

      numerator +=
        score * weight;

      denominator +=
        weight;
    }

    let confidence =
      denominator > 0
        ? numerator /
          denominator
        : 0;

    const flags = [
      ...new Set(
        valid.flatMap(
          (item) =>
            item.flags ??
            [],
        ),
      ),
    ];

    const hardBlocked =
      valid.some(
        (item) =>
          item.outcome ===
            CONFIDENCE_OUTCOMES.BLOCK ||
          (
            item.flags ??
            []
          ).some(
            (flag) =>
              HARD_FLAGS.has(
                flag,
              ),
          ),
      );

    if (
      hardBlocked
    ) {
      confidence =
        Math.min(
          confidence,
          0.01,
        );
    }

    let outcome =
      hardBlocked
        ? CONFIDENCE_OUTCOMES.BLOCK
        : classify(
            confidence,
            this._thresholds(
              options.action,
            ),
          );

    if (
      !hardBlocked &&
      outcome ===
        CONFIDENCE_OUTCOMES.ACCEPT &&
      flags.some(
        (flag) =>
          [
            GOVERNANCE_FLAGS
              .AMBIGUOUS_OUTCOME,

            GOVERNANCE_FLAGS
              .OFFLINE_UNRESOLVED,

            GOVERNANCE_FLAGS
              .CONTRADICTORY_EVIDENCE,
          ].includes(
            flag,
          ),
      )
    ) {
      outcome =
        CONFIDENCE_OUTCOMES.REVIEW;
    }

    return deepFreeze({
      component:
        COMPONENT,

      provider:
        PROVIDER,

      confidence:
        Number(
          confidence.toFixed(
            6,
          ),
        ),

      percentage:
        Number(
          (
            confidence *
            100
          ).toFixed(4),
        ),

      level:
        levelFor(
          confidence,
        ),

      outcome,

      evidenceCount:
        valid.length,

      flags,

      thresholds:
        this._thresholds(
          options.action,
        ),

      governance: {
        confidenceIsAuthorization:
          false,

        financialExecutionAuthorized:
          false,
      },
    });
  }

  buildAuditEnvelope(
    assessment,
  ) {
    const event = {
      eventType:
        'AIRTEL_CONFIDENCE_ASSESSMENT',

      component:
        COMPONENT,

      provider:
        PROVIDER,

      engineVersion:
        ENGINE_VERSION,

      tenantId:
        assessment.tenantId,

      operation:
        assessment.operation,

      action:
        assessment.action,

      outcome:
        assessment.outcome,

      level:
        assessment.level,

      confidence:
        assessment.confidence,

      evidenceCount:
        assessment.evidenceCount,

      evidenceFingerprint:
        assessment.evidenceFingerprint,

      assessmentFingerprint:
        assessment.assessmentFingerprint,

      flags:
        assessment.flags,

      evaluatedAt:
        assessment.evaluatedAt,
    };

    return deepFreeze({
      ...event,

      auditFingerprint:
        sha256(
          event,
        ),
    });
  }

  _log(
    level,
    message,
    context = {},
  ) {
    const method =
      this.logger?.[level] ??
      this.logger?.info;

    if (
      typeof method ===
      'function'
    ) {
      method.call(
        this.logger,
        {
          component:
            COMPONENT,

          provider:
            PROVIDER,

          ...sanitize(
            context,
          ),
        },
        message,
      );
    }
  }

  _metric(
    name,
    labels = {},
  ) {
    try {
      const method =
        this.metrics?.increment ??
        this.metrics?.inc ??
        this.metrics?.counter;

      if (
        typeof method ===
        'function'
      ) {
        method.call(
          this.metrics,
          name,
          sanitize(
            labels,
          ),
        );
      }
    } catch {
      // Observability must never change governance decisions.
    }
  }

  async _writeAudit(
    event,
  ) {
    const method =
      this.audit?.append ??
      this.audit?.record ??
      this.audit?.write;

    if (
      typeof method !==
      'function'
    ) {
      return;
    }

    try {
      await method.call(
        this.audit,
        sanitize(
          event,
        ),
      );
    } catch (
      error
    ) {
      this._log(
        'error',
        'Confidence audit write failed.',
        {
          message:
            error?.message,
        },
      );

      // Confidence calculation remains available when audit is unavailable;
      // downstream authorization must still be enforced elsewhere.
    }
  }

  health() {
    return {
      component:
        COMPONENT,

      provider:
        PROVIDER,

      version:
        ENGINE_VERSION,

      healthy:
        true,

      tenantIsolationEnabled:
        Boolean(
          this.config
            .requireTenantId,
        ),

      calibratorConfigured:
        Boolean(
          this.calibrator,
        ),

      modelRegistryConfigured:
        Boolean(
          this.modelRegistry,
        ),

      auditConfigured:
        Boolean(
          this.audit,
        ),

      metricsConfigured:
        Boolean(
          this.metrics,
        ),

      confidenceIsAuthorization:
        false,

      financialExecutionAuthorized:
        false,
    };
  }
}

export const createConfidenceManager = (
  options = {},
) =>
  new AirtelConfidenceManager(
    options,
  );

export const defaultConfidenceManager =
  createConfidenceManager();

export const confidenceManager =
  defaultConfidenceManager;

export const ConfidenceManager =
  AirtelConfidenceManager;

export default AirtelConfidenceManager;