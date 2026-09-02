// ============================================================================
// File: backend/services/fraudDetectionService.js
// Description: Enterprise Fraud Detection Service
// ============================================================================

"use strict";

const crypto = require("crypto");

const FraudLog = require("../models/FraudLog");
const logger = require("../utils/logger");

let notificationService;
let amlService;

try {
  notificationService = require("./notificationService");
} catch (_) {}

try {
  amlService = require("./amlService");
} catch (_) {}

// ============================================================================
// Configuration
// ============================================================================

const FRAUD_DECISIONS = {
  ALLOW: "ALLOW",
  REVIEW: "REVIEW",
  BLOCK: "BLOCK"
};

const DEFAULT_RULES = {
  HIGH_AMOUNT_THRESHOLD: Number(
    process.env.FRAUD_HIGH_AMOUNT || 5000000
  ),

  NEW_DEVICE_WEIGHT: 0.25,

  QUICK_REPEAT_WEIGHT: 0.30,

  PATTERN_DEVIATION_WEIGHT: 0.40,

  HIGH_AMOUNT_WEIGHT: 0.25,

  GEO_RISK_WEIGHT: 0.25,

  AML_WEIGHT: 0.40
};

// ============================================================================
// Error
// ============================================================================

class FraudDetectionError extends Error {
  constructor(
    message,
    code = "FRAUD_ERROR",
    status = 500,
    metadata = {}
  ) {
    super(message);

    this.name = "FraudDetectionError";
    this.code = code;
    this.status = status;
    this.metadata = metadata;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function generateRiskId() {
  return `risk_${crypto.randomUUID()}`;
}

function normalizeScore(score) {
  return Math.max(
    0,
    Math.min(1, Number(score.toFixed(2)))
  );
}

function determineDecision(score) {
  if (score >= 0.80) {
    return FRAUD_DECISIONS.BLOCK;
  }

  if (score >= 0.50) {
    return FRAUD_DECISIONS.REVIEW;
  }

  return FRAUD_DECISIONS.ALLOW;
}

// ============================================================================
// Risk Engine
// ============================================================================

async function calculateRisk(transaction) {
  let score = 0;
  const reasons = [];

  // --------------------------------------------------------------------------
  // High Value Transaction
  // --------------------------------------------------------------------------

  if (
    transaction.amount >=
    DEFAULT_RULES.HIGH_AMOUNT_THRESHOLD
  ) {
    score += DEFAULT_RULES.HIGH_AMOUNT_WEIGHT;

    reasons.push({
      code: "HIGH_AMOUNT",
      description:
        "Transaction exceeds high value threshold"
    });
  }

  // --------------------------------------------------------------------------
  // New Device
  // --------------------------------------------------------------------------

  if (transaction.isNewDevice) {
    score += DEFAULT_RULES.NEW_DEVICE_WEIGHT;

    reasons.push({
      code: "NEW_DEVICE",
      description:
        "Transaction initiated from new device"
    });
  }

  // --------------------------------------------------------------------------
  // Velocity / Repeat Transactions
  // --------------------------------------------------------------------------

  if (transaction.quickRepeat) {
    score += DEFAULT_RULES.QUICK_REPEAT_WEIGHT;

    reasons.push({
      code: "QUICK_REPEAT",
      description:
        "Multiple transactions in short period"
    });
  }

  // --------------------------------------------------------------------------
  // User Behaviour Deviation
  // --------------------------------------------------------------------------

  if (
    Number(
      transaction.userPatternDeviation || 0
    ) > 0.7
  ) {
    score +=
      DEFAULT_RULES.PATTERN_DEVIATION_WEIGHT;

    reasons.push({
      code: "PATTERN_DEVIATION",
      description:
        "Transaction deviates from user behavior"
    });
  }

  // --------------------------------------------------------------------------
  // Geo Risk
  // --------------------------------------------------------------------------

  if (transaction.highRiskCountry) {
    score += DEFAULT_RULES.GEO_RISK_WEIGHT;

    reasons.push({
      code: "HIGH_RISK_GEO",
      description:
        "Transaction originated from high-risk region"
    });
  }

  // --------------------------------------------------------------------------
  // AML Integration
  // --------------------------------------------------------------------------

  if (
    amlService &&
    typeof amlService.assessRisk ===
      "function"
  ) {
    try {
      const amlRisk =
        await amlService.assessRisk(
          transaction
        );

      if (
        amlRisk &&
        amlRisk.riskScore >= 0.70
      ) {
        score +=
          DEFAULT_RULES.AML_WEIGHT;

        reasons.push({
          code: "AML_RISK",
          description:
            amlRisk.reason ||
            "AML engine flagged transaction"
        });
      }
    } catch (error) {
      logger.warn(
        "AML risk check failed",
        {
          error: error.message
        }
      );
    }
  }

  return {
    score: normalizeScore(score),
    reasons
  };
}

// ============================================================================
// Main Fraud Check
// ============================================================================

async function checkFraud(
  transaction = {}
) {
  const riskId = generateRiskId();

  try {
    const {
      score,
      reasons
    } = await calculateRisk(
      transaction
    );

    const decision =
      determineDecision(score);

    const fraudLog =
      await FraudLog.create({
        riskId,

        tenantId:
          transaction.tenantId,

        userId:
          transaction.userId,

        transactionId:
          transaction.id,

        amount:
          transaction.amount,

        fraudScore: score,

        decision,

        reasons,

        metadata: {
          deviceId:
            transaction.deviceId,

          ipAddress:
            transaction.ipAddress,

          country:
            transaction.country
        }
      });

    // ------------------------------------------------------------------------
    // Alerting
    // ------------------------------------------------------------------------

    if (
      decision !==
      FRAUD_DECISIONS.ALLOW
    ) {
      logger.warn(
        "Fraud risk detected",
        {
          riskId,
          score,
          decision
        }
      );

      if (
        notificationService &&
        notificationService.send
      ) {
        try {
          await notificationService.send({
            recipients: [
              transaction.userId
            ],

            type: "AML_ALERT",

            title:
              "Transaction Under Review",

            message:
              decision ===
              FRAUD_DECISIONS.BLOCK
                ? "Transaction blocked due to fraud risk."
                : "Transaction flagged for manual review.",

            payload: {
              riskId,
              score,
              decision
            }
          });
        } catch (err) {
          logger.warn(
            "Fraud notification failed",
            {
              error:
                err.message
            }
          );
        }
      }
    }

    return {
      success: true,

      riskId,

      score,

      decision,

      reasons,

      fraudLogId:
        fraudLog._id
    };
  } catch (error) {
    logger.error(
      "Fraud evaluation failed",
      {
        error: error.message
      }
    );

    throw new FraudDetectionError(
      error.message,
      "FRAUD_CHECK_FAILED"
    );
  }
}

// ============================================================================
// Health Check
// ============================================================================

async function healthCheck() {
  return {
    service:
      "fraud-detection-service",

    status: "UP",

    timestamp:
      new Date().toISOString()
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  FRAUD_DECISIONS,

  FraudDetectionError,

  checkFraud,

  calculateRisk,

  healthCheck
};