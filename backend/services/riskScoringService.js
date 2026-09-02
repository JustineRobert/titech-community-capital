// ============================================================================
// File: backend/services/riskScoringService.js
// Description: Enterprise Risk Scoring Service
// Purpose:
//   - Credit Risk Scoring
//   - Member Risk Profiling
//   - Loan Eligibility Assessment
//   - Savings Behavior Analysis
//   - KYC / AML Risk Integration
//   - Fraud Risk Integration
//   - Multi-Tenant Fintech SaaS Support
// ============================================================================

"use strict";

const crypto = require("crypto");

const logger = require("../utils/logger");

let KYCService;
let AMLService;
let FraudDetectionService;

try {
  KYCService = require("./kycService");
} catch (_) {}

try {
  AMLService = require("./amlService");
} catch (_) {}

try {
  FraudDetectionService = require("./fraudDetectionService");
} catch (_) {}

// ============================================================================
// Constants
// ============================================================================

const RISK_LEVELS = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  VERY_HIGH: "VERY_HIGH"
};

const DECISIONS = {
  APPROVE: "APPROVE",
  REVIEW: "REVIEW",
  REJECT: "REJECT"
};

const DEFAULT_WEIGHTS = {
  KYC: 0.15,
  AML: 0.20,
  FRAUD: 0.20,
  SAVINGS_BEHAVIOR: 0.15,
  REPAYMENT_HISTORY: 0.20,
  INCOME_STABILITY: 0.10
};

// ============================================================================
// Error Class
// ============================================================================

class RiskScoringError extends Error {
  constructor(
    message,
    code = "RISK_SCORING_ERROR",
    status = 500,
    metadata = {}
  ) {
    super(message);

    this.name = "RiskScoringError";
    this.code = code;
    this.status = status;
    this.metadata = metadata;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function generateAssessmentId() {
  return `risk_${crypto.randomUUID()}`;
}

function normalizeScore(score) {
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(score)
    )
  );
}

function determineRiskLevel(score) {
  if (score >= 80) {
    return RISK_LEVELS.LOW;
  }

  if (score >= 60) {
    return RISK_LEVELS.MEDIUM;
  }

  if (score >= 40) {
    return RISK_LEVELS.HIGH;
  }

  return RISK_LEVELS.VERY_HIGH;
}

function determineDecision(score) {
  if (score >= 70) {
    return DECISIONS.APPROVE;
  }

  if (score >= 50) {
    return DECISIONS.REVIEW;
  }

  return DECISIONS.REJECT;
}

// ============================================================================
// Savings Behaviour Assessment
// ============================================================================

function evaluateSavingsBehavior(member = {}) {
  let score = 50;

  if (
    member.savingsMonths >= 12
  ) {
    score += 20;
  }

  if (
    member.averageMonthlySavings >=
    100000
  ) {
    score += 15;
  }

  if (
    member.missedSavingsMonths === 0
  ) {
    score += 15;
  }

  return normalizeScore(score);
}

// ============================================================================
// Repayment Assessment
// ============================================================================

function evaluateRepaymentHistory(
  member = {}
) {
  let score = 50;

  if (
    member.loansRepaidOnTime >= 5
  ) {
    score += 25;
  }

  if (
    member.loanDefaultCount === 0
  ) {
    score += 25;
  }

  return normalizeScore(score);
}

// ============================================================================
// Income Assessment
// ============================================================================

function evaluateIncomeStability(
  member = {}
) {
  let score = 50;

  if (
    member.monthlyIncome >=
    1000000
  ) {
    score += 20;
  }

  if (
    member.employmentYears >= 2
  ) {
    score += 20;
  }

  if (
    member.incomeVerified
  ) {
    score += 10;
  }

  return normalizeScore(score);
}

// ============================================================================
// KYC Assessment
// ============================================================================

async function evaluateKYC(
  member = {}
) {
  try {
    if (
      !KYCService ||
      !KYCService.validateTransaction
    ) {
      return 70;
    }

    if (
      member.kycLevel === "TIER_3"
    ) {
      return 100;
    }

    if (
      member.kycLevel === "TIER_2"
    ) {
      return 80;
    }

    return 60;
  } catch (_) {
    return 50;
  }
}

// ============================================================================
// AML Assessment
// ============================================================================

async function evaluateAML(
  member = {}
) {
  try {
    if (
      AMLService &&
      AMLService.assessRisk
    ) {
      const result =
        await AMLService.assessRisk(
          member
        );

      return normalizeScore(
        100 -
          (
            result.riskScore *
            100
          )
      );
    }

    return 80;
  } catch (_) {
    return 50;
  }
}

// ============================================================================
// Fraud Assessment
// ============================================================================

async function evaluateFraud(
  member = {}
) {
  try {
    if (
      FraudDetectionService &&
      FraudDetectionService.calculateRisk
    ) {
      const result =
        await FraudDetectionService.calculateRisk(
          member
        );

      return normalizeScore(
        100 -
          (
            result.score *
            100
          )
      );
    }

    return 80;
  } catch (_) {
    return 50;
  }
}

// ============================================================================
// Main Risk Calculation
// ============================================================================

async function calculateRiskScore(
  member = {}
) {
  const assessmentId =
    generateAssessmentId();

  try {
    const [
      kycScore,
      amlScore,
      fraudScore
    ] = await Promise.all([
      evaluateKYC(member),
      evaluateAML(member),
      evaluateFraud(member)
    ]);

    const savingsScore =
      evaluateSavingsBehavior(
        member
      );

    const repaymentScore =
      evaluateRepaymentHistory(
        member
      );

    const incomeScore =
      evaluateIncomeStability(
        member
      );

    const weightedScore =
      (
        kycScore *
          DEFAULT_WEIGHTS.KYC +
        amlScore *
          DEFAULT_WEIGHTS.AML +
        fraudScore *
          DEFAULT_WEIGHTS.FRAUD +
        savingsScore *
          DEFAULT_WEIGHTS
            .SAVINGS_BEHAVIOR +
        repaymentScore *
          DEFAULT_WEIGHTS
            .REPAYMENT_HISTORY +
        incomeScore *
          DEFAULT_WEIGHTS
            .INCOME_STABILITY
      );

    const finalScore =
      normalizeScore(
        weightedScore
      );

    const riskLevel =
      determineRiskLevel(
        finalScore
      );

    const decision =
      determineDecision(
        finalScore
      );

    const result = {
      success: true,

      assessmentId,

      score: finalScore,

      riskLevel,

      decision,

      breakdown: {
        kycScore,
        amlScore,
        fraudScore,
        savingsScore,
        repaymentScore,
        incomeScore
      },

      assessedAt:
        new Date().toISOString()
    };

    logger.info(
      "Risk score calculated",
      {
        assessmentId,
        memberId:
          member._id,
        score:
          finalScore,
        riskLevel,
        decision
      }
    );

    return result;
  } catch (error) {
    logger.error(
      "Risk scoring failed",
      {
        error:
          error.message
      }
    );

    throw new RiskScoringError(
      error.message,
      "RISK_SCORING_FAILED"
    );
  }
}

// ============================================================================
// Loan Eligibility Assessment
// ============================================================================

async function assessLoanEligibility({
  member,
  requestedAmount,
  requestedTermMonths
}) {
  const risk =
    await calculateRiskScore(
      member
    );

  const maxMultiplier =
    risk.score >= 80
      ? 5
      : risk.score >= 60
      ? 3
      : 1;

  const eligibleAmount =
    (
      member.averageMonthlySavings ||
      0
    ) * maxMultiplier;

  return {
    eligible:
      risk.decision !==
        DECISIONS.REJECT &&
      requestedAmount <=
        eligibleAmount,

    decision:
      risk.decision,

    riskLevel:
      risk.riskLevel,

    riskScore:
      risk.score,

    requestedAmount,

    approvedAmount:
      Math.min(
        requestedAmount,
        eligibleAmount
      ),

    maximumEligibleAmount:
      eligibleAmount,

    recommendedTermMonths:
      requestedTermMonths
  };
}

// ============================================================================
// Health Check
// ============================================================================

async function healthCheck() {
  return {
    service:
      "risk-scoring-service",

    status: "UP",

    integrations: {
      kyc:
        !!KYCService,
      aml:
        !!AMLService,
      fraud:
        !!FraudDetectionService
    },

    timestamp:
      new Date().toISOString()
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  RISK_LEVELS,
  DECISIONS,

  RiskScoringError,

  calculateRiskScore,

  assessLoanEligibility,

  evaluateKYC,
  evaluateAML,
  evaluateFraud,

  evaluateSavingsBehavior,
  evaluateRepaymentHistory,
  evaluateIncomeStability,

  healthCheck
};