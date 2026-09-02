/**
 * =============================================================================
 * TITech Community Capital LTD
 * Production Fraud & Transaction Risk Service
 * =============================================================================
 *
 * File:
 *   backend/services/fraud.service.js
 *
 * Responsibilities:
 *   - Deterministic transaction risk scoring
 *   - Explainable risk reasons / reason codes
 *   - Amount anomaly detection
 *   - Phone / identifier validation
 *   - Blacklist detection
 *   - Redis-backed velocity detection
 *   - Account-age risk
 *   - Optional IP/device enrichment
 *   - Country mismatch detection
 *   - Structured fraud decision
 *   - Backwards-compatible helper APIs
 *
 * Design principles:
 *   - Never use floating-point arithmetic for money comparisons
 *   - Never log sensitive identifiers unnecessarily
 *   - Never expose raw configuration secrets
 *   - No database mutation from the scorer itself
 *   - Optional Redis/enrichment failures must be observable
 *   - Fraud scoring must remain deterministic and explainable
 *
 * Usage:
 *
 *   const fraudService = require('./fraud.service');
 *
 *   const result = await fraudService.scoreTransaction(transaction);
 *
 * =============================================================================
 */

'use strict';

const Decimal = require('decimal.js');

// =============================================================================
// LOGGER
// =============================================================================

let logger;

try {
  // eslint-disable-next-line global-require
  logger = require('../utils/logger');
} catch {
  logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

// =============================================================================
// OPTIONAL INTEGRATIONS
// =============================================================================

let redisClient = null;
let enrichFn = null;

// =============================================================================
// CONSTANTS
// =============================================================================

const RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
});

const DECISIONS = Object.freeze({
  ALLOW: 'ALLOW',
  REVIEW: 'REVIEW',
  BLOCK: 'BLOCK',
});

const REASON_CODES = Object.freeze({
  HIGH_AMOUNT: 'HIGH_AMOUNT',
  MISSING_PHONE: 'MISSING_PHONE',
  BLACKLISTED_IDENTIFIER: 'BLACKLISTED_IDENTIFIER',
  HIGH_VELOCITY: 'HIGH_VELOCITY',
  NEW_ACCOUNT: 'NEW_ACCOUNT',
  COUNTRY_MISMATCH: 'COUNTRY_MISMATCH',
  HIGH_IP_RISK: 'HIGH_IP_RISK',
  HIGH_DEVICE_RISK: 'HIGH_DEVICE_RISK',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  VELOCITY_UNAVAILABLE: 'VELOCITY_UNAVAILABLE',
  ENRICHMENT_UNAVAILABLE: 'ENRICHMENT_UNAVAILABLE',
  NO_RISK_INDICATORS: 'NO_RISK_INDICATORS',
});

// =============================================================================
// ENVIRONMENT PARSING
// =============================================================================

function numberEnv(name, fallback, options = {}) {
  const raw = process.env[name];

  if (
    raw === undefined ||
    raw === null ||
    String(raw).trim() === ''
  ) {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    logger.warn('Invalid fraud numeric configuration; using fallback', {
      name,
      fallback,
    });

    return fallback;
  }

  if (
    options.min !== undefined &&
    value < options.min
  ) {
    return fallback;
  }

  if (
    options.max !== undefined &&
    value > options.max
  ) {
    return fallback;
  }

  return value;
}

function decimalEnv(name, fallback) {
  const raw = process.env[name];

  if (
    raw === undefined ||
    raw === null ||
    String(raw).trim() === ''
  ) {
    return new Decimal(fallback);
  }

  try {
    const value = new Decimal(String(raw));

    if (!value.isFinite() || value.isNegative()) {
      throw new Error('Invalid decimal value');
    }

    return value;
  } catch (error) {
    logger.warn('Invalid fraud decimal configuration; using fallback', {
      name,
      fallback: String(fallback),
      error: error.message,
    });

    return new Decimal(fallback);
  }
}

function csvEnv(name) {
  return [
    ...new Set(
      String(process.env[name] || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function booleanEnv(name, fallback) {
  const raw = process.env[name];

  if (raw === undefined) {
    return fallback;
  }

  return ['true', '1', 'yes', 'on'].includes(
    String(raw).trim().toLowerCase(),
  );
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = Object.freeze({
  WEIGHTS: Object.freeze({
    amount: numberEnv('FRAUD_WEIGHT_AMOUNT', 40, {
      min: 0,
      max: 100,
    }),

    missingPhone: numberEnv('FRAUD_WEIGHT_MISSING_PHONE', 20, {
      min: 0,
      max: 100,
    }),

    velocity: numberEnv('FRAUD_WEIGHT_VELOCITY', 20, {
      min: 0,
      max: 100,
    }),

    blacklist: numberEnv('FRAUD_WEIGHT_BLACKLIST', 60, {
      min: 0,
      max: 100,
    }),

    countryMismatch: numberEnv(
      'FRAUD_WEIGHT_COUNTRY_MISMATCH',
      15,
      {
        min: 0,
        max: 100,
      },
    ),

    accountAge: numberEnv('FRAUD_WEIGHT_ACCOUNT_AGE', 10, {
      min: 0,
      max: 100,
    }),

    ipRisk: numberEnv('FRAUD_WEIGHT_IP_RISK', 15, {
      min: 0,
      max: 100,
    }),

    deviceRisk: numberEnv('FRAUD_WEIGHT_DEVICE_RISK', 10, {
      min: 0,
      max: 100,
    }),
  }),

  THRESHOLDS: Object.freeze({
    highAmount: decimalEnv(
      'FRAUD_HIGH_AMOUNT',
      '1000000',
    ),

    velocityCount: numberEnv(
      'FRAUD_VELOCITY_COUNT',
      5,
      {
        min: 1,
        max: 10000,
      },
    ),

    velocityWindowSeconds: numberEnv(
      'FRAUD_VELOCITY_WINDOW',
      3600,
      {
        min: 1,
        max: 7 * 24 * 60 * 60,
      },
    ),

    highRiskScore: numberEnv(
      'FRAUD_HIGH_RISK_SCORE',
      70,
      {
        min: 1,
        max: 100,
      },
    ),

    mediumRiskScore: numberEnv(
      'FRAUD_MEDIUM_RISK_SCORE',
      40,
      {
        min: 1,
        max: 100,
      },
    ),

    minAccountAgeDays: numberEnv(
      'FRAUD_MIN_ACCOUNT_AGE_DAYS',
      7,
      {
        min: 0,
        max: 3650,
      },
    ),

    ipRiskScore: numberEnv(
      'FRAUD_IP_RISK_SCORE',
      70,
      {
        min: 0,
        max: 100,
      },
    ),

    deviceRiskScore: numberEnv(
      'FRAUD_DEVICE_RISK_SCORE',
      70,
      {
        min: 0,
        max: 100,
      },
    ),
  }),

  BLACKLISTS: Object.freeze({
    phones: csvEnv('FRAUD_BLACKLIST_PHONES'),
    accounts: csvEnv('FRAUD_BLACKLIST_ACCOUNTS'),
    ips: csvEnv('FRAUD_BLACKLIST_IPS'),
  }),

  POLICY: Object.freeze({
    requirePhone: booleanEnv(
      'FRAUD_REQUIRE_PHONE',
      true,
    ),

    blockBlacklisted: booleanEnv(
      'FRAUD_BLOCK_BLACKLISTED',
      true,
    ),

    blockHighRisk: booleanEnv(
      'FRAUD_BLOCK_HIGH_RISK',
      false,
    ),

    velocityFailureMode:
      String(
        process.env.FRAUD_VELOCITY_FAILURE_MODE || 'FAIL_OPEN',
      ).toUpperCase() === 'FAIL_CLOSED'
        ? 'FAIL_CLOSED'
        : 'FAIL_OPEN',

    enrichmentFailureMode:
      String(
        process.env.FRAUD_ENRICHMENT_FAILURE_MODE || 'FAIL_OPEN',
      ).toUpperCase() === 'FAIL_CLOSED'
        ? 'FAIL_CLOSED'
        : 'FAIL_OPEN',
  }),
});

// =============================================================================
// REDIS / ENRICHMENT CONFIGURATION
// =============================================================================

function setRedisClient(client) {
  redisClient = client || null;
}

function setEnrichmentFunction(fn) {
  if (fn !== null && typeof fn !== 'function') {
    throw new TypeError(
      'Fraud enrichment function must be a function or null',
    );
  }

  enrichFn = fn;
}

// =============================================================================
// GENERIC HELPERS
// =============================================================================

function safeString(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function normalizeCountry(value) {
  return safeString(value).toUpperCase();
}

function normalizeIdentifier(value) {
  return safeString(value).toLowerCase();
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function isValidDate(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function daysSince(dateValue) {
  const date = new Date(dateValue);

  if (!isValidDate(date)) {
    return null;
  }

  const diff = Date.now() - date.getTime();

  if (diff < 0) {
    return 0;
  }

  return Math.floor(
    diff / (24 * 60 * 60 * 1000),
  );
}

function sanitizeTransactionAmount(amount) {
  try {
    const decimal = new Decimal(
      amount === undefined ||
      amount === null ||
      amount === ''
        ? '0'
        : String(amount),
    );

    if (
      !decimal.isFinite() ||
      decimal.isNegative()
    ) {
      return null;
    }

    return decimal;
  } catch {
    return null;
  }
}

function createReason(
  code,
  message,
  score = 0,
) {
  return {
    code,
    message,
    score,
  };
}

function safeTransactionId(transaction) {
  return transaction?._id
    ? String(transaction._id)
    : transaction?.transactionId
      ? String(transaction.transactionId)
      : undefined;
}

// =============================================================================
// VELOCITY EVENT ID
// =============================================================================
//
// A fraud scorer may be called repeatedly for the same transaction.
// We therefore avoid counting the same transaction repeatedly when an ID
// is available.
//

function getVelocityEventId(transaction) {
  return (
    safeTransactionId(transaction) ||
    safeString(transaction?.attemptId) ||
    safeString(transaction?.metadata?.attemptId)
  );
}

// =============================================================================
// PUBLIC SCORER
// =============================================================================

async function scoreTransaction(transaction = {}) {
  if (
    transaction === null ||
    typeof transaction !== 'object' ||
    Array.isArray(transaction)
  ) {
    throw new TypeError(
      'transaction must be an object',
    );
  }

  const reasons = [];
  const perCheckScores = {
    amount: 0,
    missingPhone: 0,
    velocity: 0,
    blacklist: 0,
    countryMismatch: 0,
    accountAge: 0,
    ipRisk: 0,
    deviceRisk: 0,
  };

  const transactionId =
    safeTransactionId(transaction);

  const warnings = [];

  // ===========================================================================
  // 1. AMOUNT
  // ===========================================================================

  const amount = sanitizeTransactionAmount(
    transaction.amount,
  );

  if (amount === null) {
    reasons.push(
      createReason(
        REASON_CODES.INVALID_AMOUNT,
        'Transaction amount is invalid',
        0,
      ),
    );

    warnings.push('INVALID_TRANSACTION_AMOUNT');
  } else if (
    amount.greaterThanOrEqualTo(
      CONFIG.THRESHOLDS.highAmount,
    )
  ) {
    perCheckScores.amount =
      CONFIG.WEIGHTS.amount;

    reasons.push(
      createReason(
        REASON_CODES.HIGH_AMOUNT,
        `Transaction amount exceeds configured fraud threshold (${CONFIG.THRESHOLDS.highAmount.toString()})`,
        CONFIG.WEIGHTS.amount,
      ),
    );
  }

  // ===========================================================================
  // 2. PHONE
  // ===========================================================================

  const phone = safeString(transaction.phone);

  if (
    CONFIG.POLICY.requirePhone &&
    !phone
  ) {
    perCheckScores.missingPhone =
      CONFIG.WEIGHTS.missingPhone;

    reasons.push(
      createReason(
        REASON_CODES.MISSING_PHONE,
        'Required transaction phone number is missing',
        CONFIG.WEIGHTS.missingPhone,
      ),
    );
  }

  // ===========================================================================
  // 3. BLACKLIST
  // ===========================================================================

  const accountId =
    safeString(transaction.accountId);

  const ip =
    safeString(transaction.ip);

  const normalizedPhone =
    normalizeIdentifier(phone);

  const normalizedAccountId =
    normalizeIdentifier(accountId);

  const normalizedIp =
    normalizeIdentifier(ip);

  const blacklisted = [];

  if (
    normalizedPhone &&
    CONFIG.BLACKLISTS.phones
      .map(normalizeIdentifier)
      .includes(normalizedPhone)
  ) {
    blacklisted.push('phone');
  }

  if (
    normalizedAccountId &&
    CONFIG.BLACKLISTS.accounts
      .map(normalizeIdentifier)
      .includes(normalizedAccountId)
  ) {
    blacklisted.push('account');
  }

  if (
    normalizedIp &&
    CONFIG.BLACKLISTS.ips
      .map(normalizeIdentifier)
      .includes(normalizedIp)
  ) {
    blacklisted.push('ip');
  }

  if (blacklisted.length > 0) {
    perCheckScores.blacklist =
      CONFIG.WEIGHTS.blacklist;

    reasons.push(
      createReason(
        REASON_CODES.BLACKLISTED_IDENTIFIER,
        `Blacklisted identifier detected: ${blacklisted.join(', ')}`,
        CONFIG.WEIGHTS.blacklist,
      ),
    );
  }

  // ===========================================================================
  // 4. VELOCITY
  // ===========================================================================

  try {
    const velocity = await computeVelocityScore(
      transaction,
    );

    perCheckScores.velocity =
      velocity.score;

    if (velocity.score > 0) {
      reasons.push(
        createReason(
          REASON_CODES.HIGH_VELOCITY,
          `High transaction velocity detected (${velocity.maxCount} attempts within configured window)`,
          velocity.score,
        ),
      );
    }
  } catch (error) {
    warnings.push('VELOCITY_CHECK_FAILED');

    logger.warn('Fraud velocity check failed', {
      transactionId,
      error: error.message,
    });

    if (
      CONFIG.POLICY.velocityFailureMode ===
      'FAIL_CLOSED'
    ) {
      perCheckScores.velocity =
        CONFIG.WEIGHTS.velocity;

      reasons.push(
        createReason(
          REASON_CODES.VELOCITY_UNAVAILABLE,
          'Velocity service unavailable; configured fail-closed policy applied',
          CONFIG.WEIGHTS.velocity,
        ),
      );
    }
  }

  // ===========================================================================
  // 5. ACCOUNT AGE
  // ===========================================================================

  const accountCreatedAt =
    transaction.createdAt ||
    transaction.metadata?.accountCreatedAt;

  if (
    accountCreatedAt &&
    isValidDate(accountCreatedAt)
  ) {
    const ageDays =
      daysSince(accountCreatedAt);

    if (
      ageDays !== null &&
      ageDays <
        CONFIG.THRESHOLDS.minAccountAgeDays
    ) {
      perCheckScores.accountAge =
        CONFIG.WEIGHTS.accountAge;

      reasons.push(
        createReason(
          REASON_CODES.NEW_ACCOUNT,
          `Account age (${ageDays} days) is below configured minimum`,
          CONFIG.WEIGHTS.accountAge,
        ),
      );
    }
  }

  // ===========================================================================
  // 6. OPTIONAL ENRICHMENT
  // ===========================================================================

  let enrichment = null;

  if (typeof enrichFn === 'function') {
    try {
      enrichment =
        await enrichFn(transaction);

      if (
        enrichment &&
        typeof enrichment === 'object'
      ) {
        const phoneCountry =
          normalizeCountry(
            enrichment.phoneCountry,
          );

        const ipCountry =
          normalizeCountry(
            enrichment.country,
          );

        // ---------------------------------------------------------------------
        // Country mismatch
        // ---------------------------------------------------------------------

        if (
          phoneCountry &&
          ipCountry &&
          phoneCountry !== ipCountry
        ) {
          perCheckScores.countryMismatch =
            CONFIG.WEIGHTS.countryMismatch;

          reasons.push(
            createReason(
              REASON_CODES.COUNTRY_MISMATCH,
              `Phone country (${phoneCountry}) differs from IP country (${ipCountry})`,
              CONFIG.WEIGHTS.countryMismatch,
            ),
          );
        }

        // ---------------------------------------------------------------------
        // IP risk
        // ---------------------------------------------------------------------

        const ipRisk =
          Number(enrichment.ipRiskScore);

        if (
          Number.isFinite(ipRisk) &&
          ipRisk > 0
        ) {
          const normalizedIpRisk =
            clamp(ipRisk);

          const scaledIpRisk = Math.round(
            (
              normalizedIpRisk / 100
            ) *
            CONFIG.WEIGHTS.ipRisk,
          );

          perCheckScores.ipRisk =
            scaledIpRisk;

          if (
            normalizedIpRisk >=
            CONFIG.THRESHOLDS.ipRiskScore
          ) {
            reasons.push(
              createReason(
                REASON_CODES.HIGH_IP_RISK,
                `IP risk score is ${normalizedIpRisk}/100`,
                scaledIpRisk,
              ),
            );
          }
        }

        // ---------------------------------------------------------------------
        // Device risk
        // ---------------------------------------------------------------------

        const deviceRisk =
          Number(
            enrichment.deviceRiskScore,
          );

        if (
          Number.isFinite(deviceRisk) &&
          deviceRisk > 0
        ) {
          const normalizedDeviceRisk =
            clamp(deviceRisk);

          const scaledDeviceRisk =
            Math.round(
              (
                normalizedDeviceRisk / 100
              ) *
              CONFIG.WEIGHTS.deviceRisk,
            );

          perCheckScores.deviceRisk =
            scaledDeviceRisk;

          if (
            normalizedDeviceRisk >=
            CONFIG.THRESHOLDS.deviceRiskScore
          ) {
            reasons.push(
              createReason(
                REASON_CODES.HIGH_DEVICE_RISK,
                `Device risk score is ${normalizedDeviceRisk}/100`,
                scaledDeviceRisk,
              ),
            );
          }
        }
      }
    } catch (error) {
      warnings.push(
        'ENRICHMENT_CHECK_FAILED',
      );

      logger.warn(
        'Fraud enrichment failed',
        {
          transactionId,
          error: error.message,
        },
      );

      if (
        CONFIG.POLICY
          .enrichmentFailureMode ===
        'FAIL_CLOSED'
      ) {
        reasons.push(
          createReason(
            REASON_CODES.ENRICHMENT_UNAVAILABLE,
            'Risk enrichment unavailable; configured fail-closed policy applied',
            0,
          ),
        );
      }
    }
  }

  // ===========================================================================
  // 7. FINAL SCORE
  // ===========================================================================

  const rawScore =
    Object.values(
      perCheckScores,
    ).reduce(
      (total, value) =>
        total + (Number(value) || 0),
      0,
    );

  let score = Math.min(
    100,
    Math.round(rawScore),
  );

  // A blacklist should never accidentally result in LOW/MEDIUM risk when
  // the deployment has explicitly enabled blacklist blocking.
  if (
    CONFIG.POLICY.blockBlacklisted &&
    blacklisted.length > 0 &&
    CONFIG.THRESHOLDS.highRiskScore > score
  ) {
    score =
      CONFIG.THRESHOLDS.highRiskScore;
  }

  // ===========================================================================
  // 8. RISK LEVEL
  // ===========================================================================

  let riskLevel =
    RISK_LEVELS.LOW;

  if (
    score >=
    CONFIG.THRESHOLDS.highRiskScore
  ) {
    riskLevel =
      RISK_LEVELS.HIGH;
  } else if (
    score >=
    CONFIG.THRESHOLDS.mediumRiskScore
  ) {
    riskLevel =
      RISK_LEVELS.MEDIUM;
  }

  // ===========================================================================
  // 9. DECISION
  // ===========================================================================

  let decision =
    DECISIONS.ALLOW;

  if (
    CONFIG.POLICY.blockBlacklisted &&
    blacklisted.length > 0
  ) {
    decision =
      DECISIONS.BLOCK;
  } else if (
    CONFIG.POLICY.blockHighRisk &&
    riskLevel === RISK_LEVELS.HIGH
  ) {
    decision =
      DECISIONS.BLOCK;
  } else if (
    riskLevel === RISK_LEVELS.HIGH ||
    riskLevel === RISK_LEVELS.MEDIUM
  ) {
    decision =
      DECISIONS.REVIEW;
  }

  if (reasons.length === 0) {
    reasons.push(
      createReason(
        REASON_CODES.NO_RISK_INDICATORS,
        'No immediate risk indicators detected',
        0,
      ),
    );
  }

  // ===========================================================================
  // 10. SAFE RESULT
  // ===========================================================================

  const result = {
    score,
    riskLevel,
    decision,

    reasons: reasons.map(
      (reason) => reason.message,
    ),

    reasonCodes: reasons.map(
      (reason) => reason.code,
    ),

    details: {
      perCheckScores,

      velocity:
        undefined,

      warnings,

      enrichment:
        enrichment || null,

      config: {
        thresholds: {
          highAmount:
            CONFIG.THRESHOLDS.highAmount.toString(),

          velocityCount:
            CONFIG.THRESHOLDS.velocityCount,

          velocityWindowSeconds:
            CONFIG.THRESHOLDS
              .velocityWindowSeconds,

          highRiskScore:
            CONFIG.THRESHOLDS
              .highRiskScore,

          mediumRiskScore:
            CONFIG.THRESHOLDS
              .mediumRiskScore,

          minAccountAgeDays:
            CONFIG.THRESHOLDS
              .minAccountAgeDays,
        },

        weights: {
          ...CONFIG.WEIGHTS,
        },
      },
    },
  };

  logger.info(
    'Fraud score computed',
    {
      transactionId,
      score,
      riskLevel,
      decision,
      reasonCodes: result.reasonCodes,
      warnings,
    },
  );

  return result;
}

// =============================================================================
// REDIS VELOCITY
// =============================================================================
//
// Uses Redis sorted sets rather than INCR/EXPIRE counters.
//
// Why:
//   INCR + EXPIRE creates a rolling TTL but does not give a true sliding
//   event window. A sorted set lets us remove events outside the exact window.
//
// One member represents one transaction/attempt. Re-scoring the same
// transaction does not create multiple members when transactionId is present.
//

async function computeVelocityScore(
  transaction,
) {
  if (!redisClient) {
    return {
      score: 0,
      maxCount: 0,
      available: false,
    };
  }

  const phone =
    safeString(transaction.phone);

  const userId =
    safeString(transaction.userId);

  const ip =
    safeString(transaction.ip);

  const eventId =
    getVelocityEventId(transaction);

  // Avoid turning a pure scoring call into an unbounded counter when the
  // transaction has no stable identifier.
  if (!eventId) {
    return {
      score: 0,
      maxCount: 0,
      available: true,
      skipped: true,
      reason: 'NO_STABLE_EVENT_ID',
    };
  }

  const identifiers = [];

  if (phone) {
    identifiers.push({
      type: 'phone',
      value: normalizeIdentifier(phone),
    });
  }

  if (userId) {
    identifiers.push({
      type: 'user',
      value: normalizeIdentifier(userId),
    });
  }

  if (ip) {
    identifiers.push({
      type: 'ip',
      value: normalizeIdentifier(ip),
    });
  }

  if (identifiers.length === 0) {
    return {
      score: 0,
      maxCount: 0,
      available: true,
      skipped: true,
      reason: 'NO_VELOCITY_IDENTIFIERS',
    };
  }

  const nowMs =
    Date.now();

  const windowMs =
    CONFIG.THRESHOLDS
      .velocityWindowSeconds *
    1000;

  const minimumTimestamp =
    nowMs - windowMs;

  let maxCount = 0;

  for (const identifier of identifiers) {
    const key =
      `fraud:velocity:${identifier.type}:${identifier.value}`;

    const member =
      `${eventId}`;

    const count =
      await redisSlidingWindowCount(
        key,
        nowMs,
        minimumTimestamp,
        member,
      );

    maxCount =
      Math.max(maxCount, count);
  }

  if (
    maxCount <
    CONFIG.THRESHOLDS.velocityCount
  ) {
    return {
      score: 0,
      maxCount,
      available: true,
    };
  }

  const excess =
    Math.min(
      maxCount -
        CONFIG.THRESHOLDS.velocityCount +
        1,
      CONFIG.THRESHOLDS.velocityCount,
    );

  const basePenalty =
    Math.round(
      CONFIG.WEIGHTS.velocity * 0.5,
    );

  const scaledPenalty =
    Math.round(
      (
        excess /
        CONFIG.THRESHOLDS.velocityCount
      ) *
      CONFIG.WEIGHTS.velocity *
      0.5,
    );

  const score =
    Math.min(
      CONFIG.WEIGHTS.velocity,
      basePenalty +
        scaledPenalty,
    );

  return {
    score,
    maxCount,
    available: true,
  };
}

// =============================================================================
// REDIS SLIDING WINDOW
// =============================================================================

async function redisSlidingWindowCount(
  key,
  nowMs,
  minimumTimestamp,
  member,
) {
  if (!redisClient) {
    throw new Error(
      'Redis client not configured',
    );
  }

  if (
    typeof redisClient.multi !==
    'function'
  ) {
    throw new Error(
      'Redis client does not support multi()',
    );
  }

  const multi =
    redisClient.multi();

  // node-redis v4:
  //   zAdd(key, [{ score, value }])
  //
  // ioredis:
  //   zadd(key, score, member)
  //
  // We support both invocation forms.

  if (
    typeof multi.zAdd ===
    'function'
  ) {
    multi.zAdd(key, [
      {
        score: nowMs,
        value: member,
      },
    ]);

    multi.zRemRangeByScore(
      key,
      0,
      minimumTimestamp,
    );

    multi.zCard(key);

    multi.expire(
      key,
      CONFIG.THRESHOLDS
        .velocityWindowSeconds + 60,
    );
  } else if (
    typeof multi.zadd ===
    'function'
  ) {
    multi.zadd(
      key,
      nowMs,
      member,
    );

    multi.zremrangebyscore(
      key,
      0,
      minimumTimestamp,
    );

    multi.zcard(key);

    multi.expire(
      key,
      CONFIG.THRESHOLDS
        .velocityWindowSeconds + 60,
    );
  } else {
    throw new Error(
      'Redis client does not support sorted sets',
    );
  }

  const results =
    await multi.exec();

  return extractRedisResult(
    results?.[2],
  );
}

// =============================================================================
// REDIS RESULT NORMALIZATION
// =============================================================================

function extractRedisResult(value) {
  // ioredis multi results often look like:
  //   [error, result]
  //
  // node-redis v4 generally returns:
  //   result

  if (Array.isArray(value)) {
    return Number(value[1]) || 0;
  }

  return Number(value) || 0;
}

// =============================================================================
// HIGH-RISK CONVENIENCE API
// =============================================================================

async function isHighRisk(transaction) {
  const result =
    await scoreTransaction(
      transaction,
    );

  return (
    result.riskLevel ===
    RISK_LEVELS.HIGH
  );
}

// =============================================================================
// FLAGGING HOOK
// =============================================================================
//
// This remains deliberately storage-agnostic.
//
// The transaction service / review service can replace this later with:
//   - FraudReview collection
//   - queue publishing
//   - notification
//   - case management
//   - compliance workflow
//

async function flagTransaction(
  transaction,
  reason = 'flagged by fraud service',
  context = {},
) {
  const transactionId =
    safeTransactionId(transaction);

  logger.warn(
    'Transaction flagged for fraud review',
    {
      transactionId,
      reason,
      source: context.source ||
        'fraud.service',
    },
  );

  return {
    flagged: true,
    transactionId,
    reason,
    flaggedAt: new Date(),
  };
}

// =============================================================================
// BACKWARDS-COMPATIBLE SIMPLE SCORE
// =============================================================================

function simpleScore(
  transaction = {},
) {
  let score = 0;

  const amount =
    sanitizeTransactionAmount(
      transaction.amount,
    );

  if (
    amount &&
    amount.greaterThan(
      new Decimal('1000000'),
    )
  ) {
    score += 40;
  }

  if (
    CONFIG.POLICY.requirePhone &&
    !safeString(transaction.phone)
  ) {
    score += 20;
  }

  return Math.min(100, score);
}

// =============================================================================
// SAFE CONFIG SNAPSHOT
// =============================================================================
//
// Exposes runtime configuration needed by tests/diagnostics without exposing
// raw environment variables or secrets.
//

function getConfigSnapshot() {
  return {
    weights: {
      ...CONFIG.WEIGHTS,
    },

    thresholds: {
      highAmount:
        CONFIG.THRESHOLDS.highAmount.toString(),

      velocityCount:
        CONFIG.THRESHOLDS.velocityCount,

      velocityWindowSeconds:
        CONFIG.THRESHOLDS.velocityWindowSeconds,

      highRiskScore:
        CONFIG.THRESHOLDS.highRiskScore,

      mediumRiskScore:
        CONFIG.THRESHOLDS.mediumRiskScore,

      minAccountAgeDays:
        CONFIG.THRESHOLDS.minAccountAgeDays,

      ipRiskScore:
        CONFIG.THRESHOLDS.ipRiskScore,

      deviceRiskScore:
        CONFIG.THRESHOLDS.deviceRiskScore,
    },

    policy: {
      requirePhone:
        CONFIG.POLICY.requirePhone,

      blockBlacklisted:
        CONFIG.POLICY.blockBlacklisted,

      blockHighRisk:
        CONFIG.POLICY.blockHighRisk,

      velocityFailureMode:
        CONFIG.POLICY.velocityFailureMode,

      enrichmentFailureMode:
        CONFIG.POLICY
          .enrichmentFailureMode,
    },

    integrations: {
      redisConfigured:
        Boolean(redisClient),

      enrichmentConfigured:
        typeof enrichFn === 'function',
    },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Core
  scoreTransaction,
  isHighRisk,
  flagTransaction,

  // Integration configuration
  setRedisClient,
  setEnrichmentFunction,

  // Compatibility
  simpleScore,

  // Diagnostics / tests
  getConfigSnapshot,

  // Constants
  RISK_LEVELS,
  DECISIONS,
  REASON_CODES,

  // Test-only configuration access.
  // Prefer getConfigSnapshot() in production diagnostics.
  _config: CONFIG,
};