// ============================================================================
// File: backend/services/amlService.js
// Description: Enterprise Anti-Money Laundering (AML) Service
// ============================================================================

const crypto = require("crypto");
const logger = require("../utils/logger");

// ============================================================================
// Constants
// ============================================================================

const AML_RISK_LEVELS = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL"
};

const ALERT_TYPES = {
  LARGE_TRANSACTION: "LARGE_TRANSACTION",
  VELOCITY_BREACH: "VELOCITY_BREACH",
  STRUCTURING: "STRUCTURING",
  SANCTIONS_MATCH: "SANCTIONS_MATCH",
  PEP_MATCH: "PEP_MATCH",
  HIGH_RISK_COUNTRY: "HIGH_RISK_COUNTRY",
  UNUSUAL_ACTIVITY: "UNUSUAL_ACTIVITY"
};

const CASE_STATUS = {
  OPEN: "OPEN",
  UNDER_REVIEW: "UNDER_REVIEW",
  ESCALATED: "ESCALATED",
  CLOSED: "CLOSED"
};

// ============================================================================
// AML Thresholds (UGX)
// ============================================================================

const AML_THRESHOLDS = {
  LARGE_TRANSACTION: Number(
    process.env.AML_LARGE_TRANSACTION_LIMIT ||
      10000000
  ),

  DAILY_LIMIT: Number(
    process.env.AML_DAILY_LIMIT ||
      50000000
  ),

  MONTHLY_LIMIT: Number(
    process.env.AML_MONTHLY_LIMIT ||
      250000000
  ),

  STRUCTURING_WINDOW_HOURS: Number(
    process.env
      .AML_STRUCTURING_WINDOW_HOURS ||
      24
  ),

  STRUCTURING_TRANSACTION_COUNT:
    Number(
      process.env
        .AML_STRUCTURING_TRANSACTION_COUNT ||
        5
    )
};

// ============================================================================
// High Risk Countries
// ============================================================================

const HIGH_RISK_COUNTRIES = [
  "IR",
  "KP",
  "SY",
  "AF",
  "RU"
];

// ============================================================================
// Custom Error
// ============================================================================

class AMLError extends Error {
  constructor(
    message,
    code,
    status = 400,
    metadata = {}
  ) {
    super(message);

    this.name = "AMLError";
    this.code = code;
    this.status = status;
    this.metadata = metadata;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function generateAlertId() {
  return `aml_alert_${crypto.randomUUID()}`;
}

function generateCaseId() {
  return `aml_case_${crypto.randomUUID()}`;
}

function buildAlert(
  type,
  riskLevel,
  details
) {
  return {
    id: generateAlertId(),
    type,
    riskLevel,
    details,
    createdAt: new Date()
  };
}

// ============================================================================
// Risk Scoring
// ============================================================================

function calculateRiskScore({
  amount = 0,
  sanctionsMatch = false,
  pepMatch = false,
  highRiskCountry = false,
  kycRiskScore = 0
}) {
  let score = 0;

  if (
    amount >
    AML_THRESHOLDS.LARGE_TRANSACTION
  ) {
    score += 25;
  }

  if (sanctionsMatch) score += 100;

  if (pepMatch) score += 40;

  if (highRiskCountry) score += 30;

  score += Number(kycRiskScore || 0);

  let riskLevel =
    AML_RISK_LEVELS.LOW;

  if (score >= 100) {
    riskLevel =
      AML_RISK_LEVELS.CRITICAL;
  } else if (score >= 60) {
    riskLevel =
      AML_RISK_LEVELS.HIGH;
  } else if (score >= 30) {
    riskLevel =
      AML_RISK_LEVELS.MEDIUM;
  }

  return {
    score,
    riskLevel
  };
}

// ============================================================================
// Large Transaction Detection
// ============================================================================

function detectLargeTransaction(
  amount
) {
  if (
    amount >=
    AML_THRESHOLDS.LARGE_TRANSACTION
  ) {
    return buildAlert(
      ALERT_TYPES.LARGE_TRANSACTION,
      AML_RISK_LEVELS.HIGH,
      {
        amount,
        threshold:
          AML_THRESHOLDS.LARGE_TRANSACTION
      }
    );
  }

  return null;
}

// ============================================================================
// Velocity Monitoring
// ============================================================================

function detectVelocityRisk({
  amount,
  dailyTotal,
  monthlyTotal
}) {
  const alerts = [];

  if (
    dailyTotal + amount >
    AML_THRESHOLDS.DAILY_LIMIT
  ) {
    alerts.push(
      buildAlert(
        ALERT_TYPES.VELOCITY_BREACH,
        AML_RISK_LEVELS.HIGH,
        {
          amount,
          dailyTotal
        }
      )
    );
  }

  if (
    monthlyTotal + amount >
    AML_THRESHOLDS.MONTHLY_LIMIT
  ) {
    alerts.push(
      buildAlert(
        ALERT_TYPES.VELOCITY_BREACH,
        AML_RISK_LEVELS.CRITICAL,
        {
          amount,
          monthlyTotal
        }
      )
    );
  }

  return alerts;
}

// ============================================================================
// Structuring Detection
// ============================================================================

function detectStructuring(
  recentTransactions = []
) {
  if (
    recentTransactions.length <
    AML_THRESHOLDS
      .STRUCTURING_TRANSACTION_COUNT
  ) {
    return null;
  }

  const total =
    recentTransactions.reduce(
      (sum, tx) =>
        sum + Number(tx.amount || 0),
      0
    );

  if (
    total >
    AML_THRESHOLDS
      .LARGE_TRANSACTION
  ) {
    return buildAlert(
      ALERT_TYPES.STRUCTURING,
      AML_RISK_LEVELS.HIGH,
      {
        transactionCount:
          recentTransactions.length,
        totalAmount: total
      }
    );
  }

  return null;
}

// ============================================================================
// Sanctions Screening Hook
// ============================================================================

async function screenSanctions(
  customer
) {
  logger.info(
    "AML sanctions screening initiated",
    {
      userId: customer?.id
    }
  );

  return {
    matched: false,
    provider:
      "SANCTIONS_PROVIDER",
    screenedAt: new Date()
  };
}

// ============================================================================
// PEP Screening Hook
// ============================================================================

async function screenPEP(
  customer
) {
  logger.info(
    "AML PEP screening initiated",
    {
      userId: customer?.id
    }
  );

  return {
    matched: false,
    provider: "PEP_PROVIDER",
    screenedAt: new Date()
  };
}

// ============================================================================
// Country Risk Assessment
// ============================================================================

function assessCountryRisk(
  countryCode
) {
  const highRisk =
    HIGH_RISK_COUNTRIES.includes(
      String(countryCode || "")
        .toUpperCase()
    );

  return {
    highRisk,
    countryCode,
    riskLevel: highRisk
      ? AML_RISK_LEVELS.HIGH
      : AML_RISK_LEVELS.LOW
  };
}

// ============================================================================
// Transaction AML Validation
// ============================================================================

async function validateTransaction(
  transaction
) {
  const alerts = [];

  const amount =
    Number(
      transaction.amount || 0
    );

  const largeTxAlert =
    detectLargeTransaction(
      amount
    );

  if (largeTxAlert) {
    alerts.push(largeTxAlert);
  }

  alerts.push(
    ...detectVelocityRisk({
      amount,
      dailyTotal:
        transaction.dailyTotal || 0,
      monthlyTotal:
        transaction.monthlyTotal || 0
    })
  );

  const risk =
    calculateRiskScore({
      amount,
      sanctionsMatch:
        transaction.sanctionsMatch,
      pepMatch:
        transaction.pepMatch,
      highRiskCountry:
        transaction.highRiskCountry,
      kycRiskScore:
        transaction.kycRiskScore
    });

  const shouldBlock =
    risk.riskLevel ===
      AML_RISK_LEVELS.CRITICAL ||
    Boolean(
      transaction.sanctionsMatch
    );

  logger.info(
    "AML transaction validation completed",
    {
      transactionId:
        transaction.id,
      riskLevel:
        risk.riskLevel,
      alerts: alerts.length,
      shouldBlock
    }
  );

  return {
    approved: !shouldBlock,
    shouldBlock,
    alerts,
    risk
  };
}

// ============================================================================
// Suspicious Activity Report
// ============================================================================

async function generateSAR({
  user,
  alerts,
  transaction
}) {
  const sarId =
    `sar_${crypto.randomUUID()}`;

  logger.warn(
    "Suspicious Activity Report generated",
    {
      sarId,
      userId: user?.id
    }
  );

  return {
    sarId,
    userId: user?.id,
    transactionId:
      transaction?.id,
    alerts,
    generatedAt:
      new Date()
  };
}

// ============================================================================
// AML Investigation Case
// ============================================================================

async function createCase({
  userId,
  alert,
  createdBy
}) {
  const caseId =
    generateCaseId();

  logger.warn(
    "AML investigation case created",
    {
      caseId,
      userId,
      alertType: alert?.type
    }
  );

  return {
    caseId,
    userId,
    alert,
    createdBy,
    status:
      CASE_STATUS.OPEN,
    createdAt:
      new Date()
  };
}

// ============================================================================
// Continuous Monitoring
// ============================================================================

async function monitorCustomer(
  customer
) {
  const sanctions =
    await screenSanctions(
      customer
    );

  const pep =
    await screenPEP(customer);

  return {
    customerId: customer?.id,
    sanctions,
    pep,
    monitoredAt:
      new Date()
  };
}

// ============================================================================
// Health Check
// ============================================================================

async function healthCheck() {
  return {
    service: "aml-service",
    status: "UP",
    timestamp:
      new Date().toISOString()
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  AML_RISK_LEVELS,
  ALERT_TYPES,
  CASE_STATUS,
  AML_THRESHOLDS,

  AMLError,

  calculateRiskScore,

  detectLargeTransaction,
  detectVelocityRisk,
  detectStructuring,

  screenSanctions,
  screenPEP,

  assessCountryRisk,

  validateTransaction,

  generateSAR,
  createCase,

  monitorCustomer,

  healthCheck
};

