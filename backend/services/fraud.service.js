// services/fraud.service.js
// Production-grade transaction scoring and fraud utilities
//
// Features:
// - Deterministic, explainable scoring with configurable weights and thresholds
// - Multiple risk checks: amount, phone presence, velocity, blacklists, country mismatch, account age
// - Optional enrichment hooks (IP geolocation, device fingerprint, external risk APIs)
// - Pluggable storage for counters (Redis) to support velocity checks
// - Returns structured result with score, riskLevel, and human-readable reasons
//
// Usage:
// const fraudService = require("./fraud.service");
// const result = await fraudService.scoreTransaction(transaction);

const assert = require("assert");
const Decimal = require("decimal.js"); // npm i decimal.js
const logger = require("../utils/logger"); // optional structured logger

// Optional integrations (provide implementations in your app if needed)
let redisClient = null; // set via setRedisClient if you use Redis for velocity checks
let enrichFn = null; // optional async enrichment function (ip -> geo, device -> risk, etc.)

// Configurable weights and thresholds (override via environment variables)
const CONFIG = {
  WEIGHTS: {
    amount: Number(process.env.FRAUD_WEIGHT_AMOUNT) || 40,
    missingPhone: Number(process.env.FRAUD_WEIGHT_MISSING_PHONE) || 20,
    velocity: Number(process.env.FRAUD_WEIGHT_VELOCITY) || 20,
    blacklist: Number(process.env.FRAUD_WEIGHT_BLACKLIST) || 60,
    countryMismatch: Number(process.env.FRAUD_WEIGHT_COUNTRY_MISMATCH) || 15,
    accountAge: Number(process.env.FRAUD_WEIGHT_ACCOUNT_AGE) || 10,
  },
  THRESHOLDS: {
    highAmount: new Decimal(process.env.FRAUD_HIGH_AMOUNT || "1000000"), // currency units
    velocityCount: Number(process.env.FRAUD_VELOCITY_COUNT || 5), // attempts window
    velocityWindowSeconds: Number(process.env.FRAUD_VELOCITY_WINDOW || 60 * 60), // 1 hour
    highRiskScore: Number(process.env.FRAUD_HIGH_RISK_SCORE || 70),
    mediumRiskScore: Number(process.env.FRAUD_MEDIUM_RISK_SCORE || 40),
    minAccountAgeDays: Number(process.env.FRAUD_MIN_ACCOUNT_AGE_DAYS || 7),
  },
  BLACKLISTS: {
    phones: (process.env.FRAUD_BLACKLIST_PHONES || "").split(",").filter(Boolean),
    accounts: (process.env.FRAUD_BLACKLIST_ACCOUNTS || "").split(",").filter(Boolean),
    ips: (process.env.FRAUD_BLACKLIST_IPS || "").split(",").filter(Boolean),
  },
};

// Helper: set Redis client for velocity checks (optional)
exports.setRedisClient = (client) => {
  redisClient = client;
};

// Helper: set enrichment function (optional). Should be async and return object { country, ipRiskScore, deviceRiskScore, ... }
exports.setEnrichmentFunction = (fn) => {
  enrichFn = fn;
};

/**
 * scoreTransaction
 *
 * Main entry point. Accepts a transaction object and returns a structured risk assessment:
 * {
 *   score: Number (0-100),
 *   riskLevel: "LOW"|"MEDIUM"|"HIGH",
 *   reasons: [ "explanation strings" ],
 *   details: { perCheckScores, enrichment }
 * }
 *
 * transaction expected shape (partial):
 * {
 *   _id, amount, currency, phone, userId, ip, accountId, createdAt, metadata: { ... }
 * }
 */
exports.scoreTransaction = async (transaction = {}) => {
  // Basic validation
  assert(transaction, "transaction is required");

  const reasons = [];
  const perCheckScores = {};

  // Normalize amount using Decimal for safe comparisons
  let amountDecimal;
  try {
    amountDecimal = new Decimal(transaction.amount || 0);
  } catch (err) {
    logger?.warn?.("Invalid transaction amount for fraud scoring", { transactionId: transaction._id, amount: transaction.amount });
    amountDecimal = new Decimal(0);
  }

  // 1) Amount check
  perCheckScores.amount = 0;
  if (amountDecimal.greaterThanOrEqualTo(CONFIG.THRESHOLDS.highAmount)) {
    perCheckScores.amount = CONFIG.WEIGHTS.amount;
    reasons.push(`High amount: ${amountDecimal.toString()} >= ${CONFIG.THRESHOLDS.highAmount.toString()}`);
  }

  // 2) Missing phone check
  perCheckScores.missingPhone = 0;
  if (!transaction.phone) {
    perCheckScores.missingPhone = CONFIG.WEIGHTS.missingPhone;
    reasons.push("Missing phone number");
  }

  // 3) Blacklist checks (phone, account, ip)
  perCheckScores.blacklist = 0;
  const blacklisted = [];
  if (transaction.phone && CONFIG.BLACKLISTS.phones.includes(transaction.phone)) blacklisted.push("phone");
  if (transaction.accountId && CONFIG.BLACKLISTS.accounts.includes(String(transaction.accountId))) blacklisted.push("account");
  if (transaction.ip && CONFIG.BLACKLISTS.ips.includes(transaction.ip)) blacklisted.push("ip");
  if (blacklisted.length > 0) {
    perCheckScores.blacklist = CONFIG.WEIGHTS.blacklist;
    reasons.push(`Blacklisted identifiers: ${blacklisted.join(", ")}`);
  }

  // 4) Velocity check (attempts from same user/phone/ip within window)
  perCheckScores.velocity = 0;
  try {
    const velocityScore = await _computeVelocityScore(transaction);
    perCheckScores.velocity = velocityScore;
    if (velocityScore > 0) {
      reasons.push("High velocity of attempts detected");
    }
  } catch (err) {
    // If velocity check fails (no redis), we log and continue without penalizing
    logger?.debug?.("Velocity check skipped or failed", { err: err?.message });
  }

  // 5) Account age check (new accounts are slightly riskier)
  perCheckScores.accountAge = 0;
  try {
    const createdAt = transaction.createdAt || transaction.metadata?.accountCreatedAt;
    if (createdAt) {
      const ageDays = _daysSince(new Date(createdAt));
      if (ageDays < CONFIG.THRESHOLDS.minAccountAgeDays) {
        perCheckScores.accountAge = CONFIG.WEIGHTS.accountAge;
        reasons.push(`Account age ${ageDays} days is less than ${CONFIG.THRESHOLDS.minAccountAgeDays}`);
      }
    }
  } catch (err) {
    logger?.debug?.("Account age check failed", { err: err?.message });
  }

  // 6) Enrichment checks (IP geolocation, device risk). Optional and pluggable.
  let enrichment = null;
  perCheckScores.countryMismatch = 0;
  try {
    if (typeof enrichFn === "function") {
      enrichment = await enrichFn(transaction);
      // Example: enrichment = { country: "UG", ipRiskScore: 30, deviceRiskScore: 10, phoneCountry: "KE" }
      if (enrichment) {
        // Country mismatch between phone/tenant and IP
        if (enrichment.phoneCountry && enrichment.country && enrichment.phoneCountry !== enrichment.country) {
          perCheckScores.countryMismatch = CONFIG.WEIGHTS.countryMismatch;
          reasons.push(`Country mismatch: phone ${enrichment.phoneCountry} vs ip ${enrichment.country}`);
        }
        // IP risk score can add to velocity-like risk (scaled)
        if (typeof enrichment.ipRiskScore === "number" && enrichment.ipRiskScore > 0) {
          // scale ipRiskScore (0-100) into a portion of velocity weight
          const scaled = Math.min(CONFIG.WEIGHTS.velocity, Math.round((enrichment.ipRiskScore / 100) * CONFIG.WEIGHTS.velocity));
          perCheckScores.velocity = Math.max(perCheckScores.velocity, scaled);
          if (scaled > 0) reasons.push(`IP risk score: ${enrichment.ipRiskScore}`);
        }
        // Device risk
        if (typeof enrichment.deviceRiskScore === "number" && enrichment.deviceRiskScore > 0) {
          const scaledDevice = Math.min(CONFIG.WEIGHTS.accountAge, Math.round((enrichment.deviceRiskScore / 100) * CONFIG.WEIGHTS.accountAge));
          perCheckScores.accountAge = Math.max(perCheckScores.accountAge, scaledDevice);
          if (scaledDevice > 0) reasons.push(`Device risk score: ${enrichment.deviceRiskScore}`);
        }
      }
    }
  } catch (err) {
    logger?.warn?.("Enrichment function failed", { err: err?.message });
  }

  // Sum up scores but cap at 100
  const rawScore = Object.values(perCheckScores).reduce((s, v) => s + (v || 0), 0);
  const score = Math.min(100, Math.round(rawScore));

  // Determine risk level
  let riskLevel = "LOW";
  if (score >= CONFIG.THRESHOLDS.highRiskScore) riskLevel = "HIGH";
  else if (score >= CONFIG.THRESHOLDS.mediumRiskScore) riskLevel = "MEDIUM";

  // Add final reason if none
  if (reasons.length === 0) reasons.push("No immediate risk indicators detected");

  const result = {
    score,
    riskLevel,
    reasons,
    details: {
      perCheckScores,
      config: {
        thresholds: CONFIG.THRESHOLDS,
        weights: CONFIG.WEIGHTS,
      },
      enrichment,
    },
  };

  // Optional: persist or emit metrics/logs for monitoring
  logger?.info?.("Fraud score computed", {
    transactionId: transaction._id,
    score,
    riskLevel,
    reasons,
  });

  return result;
};

/**
 * _computeVelocityScore
 *
 * Uses Redis (if configured) to count recent attempts for the same key(s).
 * Returns a score (0..WEIGHTS.velocity) based on how many attempts exceed the threshold.
 *
 * Keys considered (in order of priority): phone, userId, ip
 */
async function _computeVelocityScore(transaction) {
  if (!redisClient) {
    // Redis not configured; skip velocity scoring
    return 0;
  }

  const window = CONFIG.THRESHOLDS.velocityWindowSeconds;
  const threshold = CONFIG.THRESHOLDS.velocityCount;
  const weight = CONFIG.WEIGHTS.velocity;

  // Build keys to increment (phone first, then userId, then ip)
  const keys = [];
  if (transaction.phone) keys.push(`fraud:vel:phone:${transaction.phone}`);
  if (transaction.userId) keys.push(`fraud:vel:user:${transaction.userId}`);
  if (transaction.ip) keys.push(`fraud:vel:ip:${transaction.ip}`);

  if (keys.length === 0) return 0;

  // Use Redis INCR and EXPIRE to maintain sliding window counters
  let maxScore = 0;
  try {
    for (const key of keys) {
      const count = await _redisIncrWithExpire(key, window);
      if (count >= threshold) {
        // scale score linearly from threshold to 2*threshold
        const over = Math.min(count - threshold, threshold);
        const scaled = Math.round((over / threshold) * weight);
        const scoreForKey = Math.min(weight, scaled + Math.round(weight * 0.5)); // base penalty
        maxScore = Math.max(maxScore, scoreForKey);
      }
    }
  } catch (err) {
    logger?.warn?.("Redis velocity check failed", { err: err?.message });
    return 0;
  }

  return maxScore;
}

// Helper: increment redis key and set expiry if first seen
async function _redisIncrWithExpire(key, ttlSeconds) {
  // Expect redisClient to support multi/exec or simple commands returning promises
  // Implementation supports ioredis or node-redis v4
  if (!redisClient) throw new Error("redis client not configured");

  // node-redis v4: client.multi().incr(key).expire(key, ttl).exec()
  if (typeof redisClient.multi === "function") {
    const multi = redisClient.multi();
    multi.incr(key);
    multi.expire(key, ttlSeconds);
    const res = await multi.exec();
    // res is array of results; first is [null, value] or value depending on client
    const incrRes = res && res[0];
    if (Array.isArray(incrRes)) return incrRes[1];
    return incrRes;
  }

  // ioredis style or simple client with incr and expire
  const count = await redisClient.incr(key);
  const ttl = await redisClient.ttl(key);
  if (ttl === -1) {
    await redisClient.expire(key, ttlSeconds);
  }
  return count;
}

// Helper: days since date
function _daysSince(date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Date.now() - date.getTime();
  return Math.floor(diff / msPerDay);
}

/**
 * Convenience: isHighRisk
 * Returns boolean if transaction is high risk according to configured threshold
 */
exports.isHighRisk = async (transaction) => {
  const res = await exports.scoreTransaction(transaction);
  return res.score >= CONFIG.THRESHOLDS.highRiskScore;
};

/**
 * Convenience: flagTransaction
 * Example side-effect: persist a flag in DB, send alert to ops, or enqueue for manual review.
 * This function is intentionally generic; implement persistence/notification in your app.
 */
exports.flagTransaction = async (transaction, reason = "flagged by fraud service") => {
  logger?.warn?.("Transaction flagged for review", { transactionId: transaction._id, reason });
  // Example: push to a queue, create a Review record, or update transaction metadata
  // e.g., await Review.create({ transactionId: transaction._id, reason, createdAt: new Date() });
  return true;
};

/**
 * Expose config for tests and runtime adjustments
 */
exports._config = CONFIG;

/**
 * Example synchronous rule-based scorer (keeps backward compatibility)
 * Returns a simple numeric score (0..100)
 */
exports.simpleScore = (transaction) => {
  let score = 0;
  if (transaction.amount && Number(transaction.amount) > 1000000) score += 40;
  if (!transaction.phone) score += 20;
  return Math.min(100, score);
};
``````
// services/fraud.service.js
// Production-grade transaction scoring and fraud utilities
//
// Features:
// - Deterministic, explainable scoring with configurable weights and thresholds
// - Multiple risk checks: amount, phone presence, velocity, blacklists, country mismatch, account age
// - Optional enrichment hooks (IP geolocation, device fingerprint, external risk APIs)
// - Pluggable storage for counters (Redis) to support velocity checks
// - Returns structured result with score, riskLevel, and human-readable reasons
//
// Usage:
// const fraudService = require("./fraud.service");
// const result = await fraudService.scoreTransaction(transaction);

const assert = require("assert");
const Decimal = require("decimal.js"); // npm i decimal.js
const logger = require("../utils/logger"); // optional structured logger

// Optional integrations (provide implementations in your app if needed)
let redisClient = null; // set via setRedisClient if you use Redis for velocity checks
let enrichFn = null; // optional async enrichment function (ip -> geo, device -> risk, etc.)

// Configurable weights and thresholds (override via environment variables)
const CONFIG = {
  WEIGHTS: {
    amount: Number(process.env.FRAUD_WEIGHT_AMOUNT) || 40,
    missingPhone: Number(process.env.FRAUD_WEIGHT_MISSING_PHONE) || 20,
    velocity: Number(process.env.FRAUD_WEIGHT_VELOCITY) || 20,
    blacklist: Number(process.env.FRAUD_WEIGHT_BLACKLIST) || 60,
    countryMismatch: Number(process.env.FRAUD_WEIGHT_COUNTRY_MISMATCH) || 15,
    accountAge: Number(process.env.FRAUD_WEIGHT_ACCOUNT_AGE) || 10,
  },
  THRESHOLDS: {
    highAmount: new Decimal(process.env.FRAUD_HIGH_AMOUNT || "1000000"), // currency units
    velocityCount: Number(process.env.FRAUD_VELOCITY_COUNT || 5), // attempts window
    velocityWindowSeconds: Number(process.env.FRAUD_VELOCITY_WINDOW || 60 * 60), // 1 hour
    highRiskScore: Number(process.env.FRAUD_HIGH_RISK_SCORE || 70),
    mediumRiskScore: Number(process.env.FRAUD_MEDIUM_RISK_SCORE || 40),
    minAccountAgeDays: Number(process.env.FRAUD_MIN_ACCOUNT_AGE_DAYS || 7),
  },
  BLACKLISTS: {
    phones: (process.env.FRAUD_BLACKLIST_PHONES || "").split(",").filter(Boolean),
    accounts: (process.env.FRAUD_BLACKLIST_ACCOUNTS || "").split(",").filter(Boolean),
    ips: (process.env.FRAUD_BLACKLIST_IPS || "").split(",").filter(Boolean),
  },
};

// Helper: set Redis client for velocity checks (optional)
exports.setRedisClient = (client) => {
  redisClient = client;
};

// Helper: set enrichment function (optional). Should be async and return object { country, ipRiskScore, deviceRiskScore, ... }
exports.setEnrichmentFunction = (fn) => {
  enrichFn = fn;
};

/**
 * scoreTransaction
 *
 * Main entry point. Accepts a transaction object and returns a structured risk assessment:
 * {
 *   score: Number (0-100),
 *   riskLevel: "LOW"|"MEDIUM"|"HIGH",
 *   reasons: [ "explanation strings" ],
 *   details: { perCheckScores, enrichment }
 * }
 *
 * transaction expected shape (partial):
 * {
 *   _id, amount, currency, phone, userId, ip, accountId, createdAt, metadata: { ... }
 * }
 */
exports.scoreTransaction = async (transaction = {}) => {
  // Basic validation
  assert(transaction, "transaction is required");

  const reasons = [];
  const perCheckScores = {};

  // Normalize amount using Decimal for safe comparisons
  let amountDecimal;
  try {
    amountDecimal = new Decimal(transaction.amount || 0);
  } catch (err) {
    logger?.warn?.("Invalid transaction amount for fraud scoring", { transactionId: transaction._id, amount: transaction.amount });
    amountDecimal = new Decimal(0);
  }

  // 1) Amount check
  perCheckScores.amount = 0;
  if (amountDecimal.greaterThanOrEqualTo(CONFIG.THRESHOLDS.highAmount)) {
    perCheckScores.amount = CONFIG.WEIGHTS.amount;
    reasons.push(`High amount: ${amountDecimal.toString()} >= ${CONFIG.THRESHOLDS.highAmount.toString()}`);
  }

  // 2) Missing phone check
  perCheckScores.missingPhone = 0;
  if (!transaction.phone) {
    perCheckScores.missingPhone = CONFIG.WEIGHTS.missingPhone;
    reasons.push("Missing phone number");
  }

  // 3) Blacklist checks (phone, account, ip)
  perCheckScores.blacklist = 0;
  const blacklisted = [];
  if (transaction.phone && CONFIG.BLACKLISTS.phones.includes(transaction.phone)) blacklisted.push("phone");
  if (transaction.accountId && CONFIG.BLACKLISTS.accounts.includes(String(transaction.accountId))) blacklisted.push("account");
  if (transaction.ip && CONFIG.BLACKLISTS.ips.includes(transaction.ip)) blacklisted.push("ip");
  if (blacklisted.length > 0) {
    perCheckScores.blacklist = CONFIG.WEIGHTS.blacklist;
    reasons.push(`Blacklisted identifiers: ${blacklisted.join(", ")}`);
  }

  // 4) Velocity check (attempts from same user/phone/ip within window)
  perCheckScores.velocity = 0;
  try {
    const velocityScore = await _computeVelocityScore(transaction);
    perCheckScores.velocity = velocityScore;
    if (velocityScore > 0) {
      reasons.push("High velocity of attempts detected");
    }
  } catch (err) {
    // If velocity check fails (no redis), we log and continue without penalizing
    logger?.debug?.("Velocity check skipped or failed", { err: err?.message });
  }

  // 5) Account age check (new accounts are slightly riskier)
  perCheckScores.accountAge = 0;
  try {
    const createdAt = transaction.createdAt || transaction.metadata?.accountCreatedAt;
    if (createdAt) {
      const ageDays = _daysSince(new Date(createdAt));
      if (ageDays < CONFIG.THRESHOLDS.minAccountAgeDays) {
        perCheckScores.accountAge = CONFIG.WEIGHTS.accountAge;
        reasons.push(`Account age ${ageDays} days is less than ${CONFIG.THRESHOLDS.minAccountAgeDays}`);
      }
    }
  } catch (err) {
    logger?.debug?.("Account age check failed", { err: err?.message });
  }

  // 6) Enrichment checks (IP geolocation, device risk). Optional and pluggable.
  let enrichment = null;
  perCheckScores.countryMismatch = 0;
  try {
    if (typeof enrichFn === "function") {
      enrichment = await enrichFn(transaction);
      // Example: enrichment = { country: "UG", ipRiskScore: 30, deviceRiskScore: 10, phoneCountry: "KE" }
      if (enrichment) {
        // Country mismatch between phone/tenant and IP
        if (enrichment.phoneCountry && enrichment.country && enrichment.phoneCountry !== enrichment.country) {
          perCheckScores.countryMismatch = CONFIG.WEIGHTS.countryMismatch;
          reasons.push(`Country mismatch: phone ${enrichment.phoneCountry} vs ip ${enrichment.country}`);
        }
        // IP risk score can add to velocity-like risk (scaled)
        if (typeof enrichment.ipRiskScore === "number" && enrichment.ipRiskScore > 0) {
          // scale ipRiskScore (0-100) into a portion of velocity weight
          const scaled = Math.min(CONFIG.WEIGHTS.velocity, Math.round((enrichment.ipRiskScore / 100) * CONFIG.WEIGHTS.velocity));
          perCheckScores.velocity = Math.max(perCheckScores.velocity, scaled);
          if (scaled > 0) reasons.push(`IP risk score: ${enrichment.ipRiskScore}`);
        }
        // Device risk
        if (typeof enrichment.deviceRiskScore === "number" && enrichment.deviceRiskScore > 0) {
          const scaledDevice = Math.min(CONFIG.WEIGHTS.accountAge, Math.round((enrichment.deviceRiskScore / 100) * CONFIG.WEIGHTS.accountAge));
          perCheckScores.accountAge = Math.max(perCheckScores.accountAge, scaledDevice);
          if (scaledDevice > 0) reasons.push(`Device risk score: ${enrichment.deviceRiskScore}`);
        }
      }
    }
  } catch (err) {
    logger?.warn?.("Enrichment function failed", { err: err?.message });
  }

  // Sum up scores but cap at 100
  const rawScore = Object.values(perCheckScores).reduce((s, v) => s + (v || 0), 0);
  const score = Math.min(100, Math.round(rawScore));

  // Determine risk level
  let riskLevel = "LOW";
  if (score >= CONFIG.THRESHOLDS.highRiskScore) riskLevel = "HIGH";
  else if (score >= CONFIG.THRESHOLDS.mediumRiskScore) riskLevel = "MEDIUM";

  // Add final reason if none
  if (reasons.length === 0) reasons.push("No immediate risk indicators detected");

  const result = {
    score,
    riskLevel,
    reasons,
    details: {
      perCheckScores,
      config: {
        thresholds: CONFIG.THRESHOLDS,
        weights: CONFIG.WEIGHTS,
      },
      enrichment,
    },
  };

  // Optional: persist or emit metrics/logs for monitoring
  logger?.info?.("Fraud score computed", {
    transactionId: transaction._id,
    score,
    riskLevel,
    reasons,
  });

  return result;
};

/**
 * _computeVelocityScore
 *
 * Uses Redis (if configured) to count recent attempts for the same key(s).
 * Returns a score (0..WEIGHTS.velocity) based on how many attempts exceed the threshold.
 *
 * Keys considered (in order of priority): phone, userId, ip
 */
async function _computeVelocityScore(transaction) {
  if (!redisClient) {
    // Redis not configured; skip velocity scoring
    return 0;
  }

  const window = CONFIG.THRESHOLDS.velocityWindowSeconds;
  const threshold = CONFIG.THRESHOLDS.velocityCount;
  const weight = CONFIG.WEIGHTS.velocity;

  // Build keys to increment (phone first, then userId, then ip)
  const keys = [];
  if (transaction.phone) keys.push(`fraud:vel:phone:${transaction.phone}`);
  if (transaction.userId) keys.push(`fraud:vel:user:${transaction.userId}`);
  if (transaction.ip) keys.push(`fraud:vel:ip:${transaction.ip}`);

  if (keys.length === 0) return 0;

  // Use Redis INCR and EXPIRE to maintain sliding window counters
  let maxScore = 0;
  try {
    for (const key of keys) {
      const count = await _redisIncrWithExpire(key, window);
      if (count >= threshold) {
        // scale score linearly from threshold to 2*threshold
        const over = Math.min(count - threshold, threshold);
        const scaled = Math.round((over / threshold) * weight);
        const scoreForKey = Math.min(weight, scaled + Math.round(weight * 0.5)); // base penalty
        maxScore = Math.max(maxScore, scoreForKey);
      }
    }
  } catch (err) {
    logger?.warn?.("Redis velocity check failed", { err: err?.message });
    return 0;
  }

  return maxScore;
}

// Helper: increment redis key and set expiry if first seen
async function _redisIncrWithExpire(key, ttlSeconds) {
  // Expect redisClient to support multi/exec or simple commands returning promises
  // Implementation supports ioredis or node-redis v4
  if (!redisClient) throw new Error("redis client not configured");

  // node-redis v4: client.multi().incr(key).expire(key, ttl).exec()
  if (typeof redisClient.multi === "function") {
    const multi = redisClient.multi();
    multi.incr(key);
    multi.expire(key, ttlSeconds);
    const res = await multi.exec();
    // res is array of results; first is [null, value] or value depending on client
    const incrRes = res && res[0];
    if (Array.isArray(incrRes)) return incrRes[1];
    return incrRes;
  }

  // ioredis style or simple client with incr and expire
  const count = await redisClient.incr(key);
  const ttl = await redisClient.ttl(key);
  if (ttl === -1) {
    await redisClient.expire(key, ttlSeconds);
  }
  return count;
}

// Helper: days since date
function _daysSince(date) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Date.now() - date.getTime();
  return Math.floor(diff / msPerDay);
}

/**
 * Convenience: isHighRisk
 * Returns boolean if transaction is high risk according to configured threshold
 */
exports.isHighRisk = async (transaction) => {
  const res = await exports.scoreTransaction(transaction);
  return res.score >= CONFIG.THRESHOLDS.highRiskScore;
};

/**
 * Convenience: flagTransaction
 * Example side-effect: persist a flag in DB, send alert to ops, or enqueue for manual review.
 * This function is intentionally generic; implement persistence/notification in your app.
 */
exports.flagTransaction = async (transaction, reason = "flagged by fraud service") => {
  logger?.warn?.("Transaction flagged for review", { transactionId: transaction._id, reason });
  // Example: push to a queue, create a Review record, or update transaction metadata
  // e.g., await Review.create({ transactionId: transaction._id, reason, createdAt: new Date() });
  return true;
};

/**
 * Expose config for tests and runtime adjustments
 */
exports._config = CONFIG;

/**
 * Example synchronous rule-based scorer (keeps backward compatibility)
 * Returns a simple numeric score (0..100)
 */
exports.simpleScore = (transaction) => {
  let score = 0;
  if (transaction.amount && Number(transaction.amount) > 1000000) score += 40;
  if (!transaction.phone) score += 20;
  return Math.min(100, score);
};
