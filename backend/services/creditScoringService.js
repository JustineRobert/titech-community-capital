// services/creditScoringService.js
"use strict";

const RiskProfile = require("../models/RiskProfile");

/**
 * Calculate credit score based on user data
 * @param {Object} userData - { savingsConsistency, repaymentHistory, missedPayments }
 * @returns {Object} - { score, riskLevel }
 */
exports.calculateScore = async (userData) => {
  let score = 500;

  if (userData.savingsConsistency > 0.8) score += 150;
  if (userData.repaymentHistory > 0.9) score += 200;
  if (userData.missedPayments > 2) score -= 200;

  // Clamp score between 0 and 1000
  if (score > 1000) score = 1000;
  if (score < 0) score = 0;

  // Risk level bands
  let riskLevel = "MEDIUM";
  if (score > 700) riskLevel = "LOW";
  if (score < 400) riskLevel = "HIGH";

  return { score, riskLevel };
};

/**
 * Store score in RiskProfile collection
 * @param {Object} params - { userId, tenantId, score, riskLevel }
 * @returns {Promise<Document>} - Updated RiskProfile document
 */
exports.storeScore = async ({ userId, tenantId, score, riskLevel }) => {
  return RiskProfile.findOneAndUpdate(
    { userId, tenantId },
    { creditScore: score, riskLevel },
    { upsert: true, new: true }
  );
};
