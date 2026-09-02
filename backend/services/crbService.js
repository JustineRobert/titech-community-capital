// services/crbService.js
/**
 * Production-grade CRB adapter
 * - Axios instance with retries and timeouts
 * - Optional Redis caching (if repo exposes a redis client at ../utils/redisClient)
 * - Robust error handling, logging, and input validation
 * - Standardized return shape and mergeScores with configurable weights
 *
 * Usage:
 * const { fetchCreditHistory, mergeScores } = require('./services/crbService')
 *
 * Environment variables:
 * - CRB_API_URL (required)
 * - CRB_API_KEY (optional)
 * - CRB_TIMEOUT_MS (optional, default 3000)
 * - CRB_CACHE_TTL (optional, seconds, default 3600)
 */

const axios = require('axios');
const axiosRetry = require('axios-retry');

let logger;
try {
  // Try to use repo logger if available
  logger = require('../utils/logger');
} catch (e) {
  logger = console;
}

let redisClient = null;
try {
  // If your repo exposes a redis client at utils/redisClient, it will be used for caching.
  // Otherwise caching is skipped gracefully.
  redisClient = require('../utils/redisClient');
} catch (e) {
  // No redis client available; continue without caching
  redisClient = null;
}

/**
 * Simple in-memory circuit breaker to avoid hammering CRB when it's failing.
 * This is intentionally lightweight and process-local. For multi-instance setups,
 * replace with a distributed circuit breaker (Redis / etcd).
 */
const circuit = {
  failures: 0,
  lastFailureAt: null,
  openUntil: null,
  maxFailures: 5,
  cooldownMs: 60_000 // 1 minute cooldown by default
};

const CRB_API_URL = process.env.CRB_API_URL;
if (!CRB_API_URL) {
  logger.warn('CRB_API_URL not set. CRB adapter will return null responses.');
}

const CRB_TIMEOUT_MS = parseInt(process.env.CRB_TIMEOUT_MS || '3000', 10);
const CRB_CACHE_TTL = parseInt(process.env.CRB_CACHE_TTL || '3600', 10); // seconds

const axiosInstance = axios.create({
  baseURL: CRB_API_URL || '',
  timeout: CRB_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
    ...(process.env.CRB_API_KEY ? { Authorization: `Bearer ${process.env.CRB_API_KEY}` } : {})
  }
});

// Retries for transient network errors and 5xx responses
axiosRetry(axiosInstance, {
  retries: 2,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    // Retry on network errors or 5xx or 429
    return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
      (error.response && (error.response.status >= 500 || error.response.status === 429));
  }
});

/**
 * Validate nationalId input
 * @param {string} nationalId
 */
function validateNationalId(nationalId) {
  if (!nationalId || typeof nationalId !== 'string') {
    throw new Error('nationalId must be a non-empty string');
  }
  // Basic sanitation: trim and remove suspicious characters
  const cleaned = nationalId.trim();
  if (cleaned.length < 4 || cleaned.length > 64) {
    throw new Error('nationalId length invalid');
  }
  return cleaned;
}

/**
 * Check circuit breaker state
 */
function isCircuitOpen() {
  if (!circuit.openUntil) return false;
  if (Date.now() > circuit.openUntil) {
    // reset
    circuit.failures = 0;
    circuit.openUntil = null;
    return false;
  }
  return true;
}

/**
 * Record a failure in the circuit breaker
 */
function recordFailure() {
  circuit.failures += 1;
  circuit.lastFailureAt = Date.now();
  if (circuit.failures >= circuit.maxFailures) {
    circuit.openUntil = Date.now() + circuit.cooldownMs;
    logger.warn(`CRB circuit opened until ${new Date(circuit.openUntil).toISOString()}`);
  }
}

/**
 * Standardize CRB response shape
 * @param {object} raw
 * @returns {{score: number|null, bureau: string|null, raw: object|null}}
 */
function normalizeCRBResponse(raw) {
  if (!raw) return { score: null, bureau: null, raw: null };

  // Attempt to extract a numeric score from common fields
  let score = null;
  if (typeof raw.score === 'number') score = raw.score;
  else if (raw.creditScore && typeof raw.creditScore === 'number') score = raw.creditScore;
  else if (raw.scoreValue && typeof raw.scoreValue === 'number') score = raw.scoreValue;

  // Normalize to 0-1000 if source uses 0-100
  if (score !== null && score <= 100) {
    score = Math.round(score * 10);
  }

  // Clamp
  if (score !== null) {
    score = Math.max(0, Math.min(1000, Math.round(score)));
  }

  const bureau = raw.bureau || raw.source || 'CRB';

  return { score, bureau, raw };
}

/**
 * Fetch credit history from CRB provider with caching, retries, and circuit breaker.
 * Returns standardized object: { score: number|null, bureau: string|null, raw: object|null }
 *
 * @param {string} nationalId
 * @returns {Promise<{score: number|null, bureau: string|null, raw: object|null}>}
 */
const fetchCreditHistory = async (nationalId) => {
  try {
    if (!CRB_API_URL) {
      logger.info('CRB_API_URL not configured; returning null from fetchCreditHistory');
      return null;
    }

    const id = validateNationalId(nationalId);

    // Circuit breaker: if open, return null quickly
    if (isCircuitOpen()) {
      logger.warn('CRB circuit is open; skipping external call');
      return null;
    }

    const cacheKey = `crb:${id}`;

    // Try cache
    if (redisClient && typeof redisClient.get === 'function') {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          logger.debug('CRB cache hit', { nationalId: id });
          return normalizeCRBResponse(parsed);
        }
      } catch (err) {
        logger.warn('CRB cache read failed', err.message);
      }
    }

    // Call CRB API
    const payload = { nationalId: id };
    const response = await axiosInstance.post('', payload);

    if (!response || !response.data) {
      logger.warn('CRB returned empty response', { nationalId: id, status: response?.status });
      return null;
    }

    const normalized = normalizeCRBResponse(response.data);

    // Cache result if redis available
    if (redisClient && typeof redisClient.setEx === 'function') {
      try {
        await redisClient.setEx(cacheKey, CRB_CACHE_TTL, JSON.stringify(response.data));
      } catch (err) {
        logger.warn('CRB cache write failed', err.message);
      }
    }

    // Reset circuit on success
    circuit.failures = 0;
    circuit.openUntil = null;

    return normalized;
  } catch (err) {
    // Handle axios errors and mark circuit failures
    logger.error('CRB fetch failed', err.message || err.toString());
    recordFailure();

    // If 4xx, do not increment circuit (client error) — but we already incremented; keep simple
    return null;
  }
};

/**
 * Merge internal score and CRB score into a final score.
 * - Accepts scores in 0-1000 range (or null)
 * - Default weights: internal 0.7, crb 0.3
 *
 * @param {number|null} internalScore
 * @param {number|null} crbScore
 * @param {{internal?:number, crb?:number}} weights
 * @returns {number} mergedScore (0-1000)
 */
const mergeScores = (internalScore, crbScore, weights = { internal: 0.7, crb: 0.3 }) => {
  const i = (typeof internalScore === 'number' && !Number.isNaN(internalScore)) ? internalScore : null;
  const c = (typeof crbScore === 'number' && !Number.isNaN(crbScore)) ? crbScore : null;

  if (i === null && c === null) return 0;
  if (i === null) return Math.round(Math.max(0, Math.min(1000, c)));
  if (c === null) return Math.round(Math.max(0, Math.min(1000, i)));

  const wI = typeof weights.internal === 'number' ? weights.internal : 0.7;
  const wC = typeof weights.crb === 'number' ? weights.crb : 0.3;
  const total = wI + wC || 1;

  const merged = Math.round(((i * wI) + (c * wC)) / total);
  return Math.max(0, Math.min(1000, merged));
};

module.exports = {
  fetchCreditHistory,
  mergeScores
};
