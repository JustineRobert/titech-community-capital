// services/aiRiskEngine.js

class AIRiskEngine {
  /**
   * Adaptive credit weights (simple ML-style tuning)
   */
  static adjustWeights(financials) {
    return {
      savingsWeight: financials.savingsFrequency > 5 ? 50 : 30,
      repaymentWeight: financials.repaymentRate > 0.9 ? 350 : 250,
      volatilityPenalty: financials.spendingVolatility > 0.7 ? 80 : 40
    };
  }

  /**
   * Dynamic fraud scoring (pattern-sensitive)
   */
  static enhanceFraudScore(baseScore, transaction) {
    let score = baseScore;

    // Pattern amplification
    if (transaction.amount > 2000000) score += 0.2;
    if (transaction.frequency < 10) score += 0.1;

    // Risk clustering
    if (transaction.newDevice && transaction.locationMismatch) {
      score += 0.25;
    }

    return Math.min(1, score);
  }
}

module.exports = AIRiskEngine;