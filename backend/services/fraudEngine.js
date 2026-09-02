// services/fraudEngine.js

/**
 * Fraud evaluation engine
 * - Deterministic rule-based scoring
 * - Extensible for ML / external risk APIs
 * - Safe defaults + input validation
 */

const FRAUD_THRESHOLDS = {
  BLOCKED: 70,
  REVIEW: 40,
};

const FRAUD_RULES = {
  HIGH_AMOUNT: {
    threshold: 1000000,
    score: 50,
  },
  HIGH_FREQUENCY: {
    threshold: 10,
    score: 30,
  },
  NEW_DEVICE: {
    score: 20,
  },
};

/**
 * Validate transaction input
 */
function validateTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object') {
    throw new Error('Invalid transaction object');
  }

  if (typeof transaction.amount !== 'number') {
    throw new Error('Transaction amount must be a number');
  }

  if (transaction.frequency !== undefined && typeof transaction.frequency !== 'number') {
    throw new Error('Transaction frequency must be a number');
  }

  if (transaction.newDevice !== undefined && typeof transaction.newDevice !== 'boolean') {
    throw new Error('Transaction newDevice must be boolean');
  }
}

/**
 * Evaluate fraud score + decision
 */
function evaluateFraud(transaction) {
  validateTransaction(transaction);

  let score = 0;
  const triggeredRules = [];

  // ✅ Rule 1: High Amount
  if (transaction.amount > FRAUD_RULES.HIGH_AMOUNT.threshold) {
    score += FRAUD_RULES.HIGH_AMOUNT.score;
    triggeredRules.push('HIGH_AMOUNT');
  }

  // ✅ Rule 2: High Frequency
  if (transaction.frequency && transaction.frequency > FRAUD_RULES.HIGH_FREQUENCY.threshold) {
    score += FRAUD_RULES.HIGH_FREQUENCY.score;
    triggeredRules.push('HIGH_FREQUENCY');
  }

  // ✅ Rule 3: New Device
  if (transaction.newDevice === true) {
    score += FRAUD_RULES.NEW_DEVICE.score;
    triggeredRules.push('NEW_DEVICE');
  }

  // ✅ Decision logic
  let decision = 'SAFE';
  if (score >= FRAUD_THRESHOLDS.BLOCKED) {
    decision = 'BLOCKED';
  } else if (score >= FRAUD_THRESHOLDS.REVIEW) {
    decision = 'REVIEW';
  }

  return {
    score,
    decision,
    triggeredRules,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  evaluateFraud,
};