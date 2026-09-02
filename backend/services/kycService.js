const KYC = require('../models/KYC');

async function createOrUpdateKYC(userId, data) {
  const filter = { userId };
  const update = { $set: data };
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  return KYC.findOneAndUpdate(filter, update, opts).lean();
}

async function getKYCByUser(userId) {
  return KYC.findOne({ userId }).lean();
}

async function requireVerifiedKYC(req, res, next) {
  const userId = req.user && req.user.id;
  if (!userId) return res.status(401).json({ success: false, error: { code: 'UNAUTH', message: 'Unauthorized' } });
  const kyc = await KYC.findOne({ userId }).lean();
  if (!kyc || kyc.status !== 'VERIFIED') {
    return res.status(403).json({ success: false, error: { code: 'KYC_REQUIRED', message: 'KYC verification required' } });
  }
  next();
}

module.exports = { createOrUpdateKYC, getKYCByUser, requireVerifiedKYC };
// ============================================================================
// File: backend/services/kycService.js
// Description: Enterprise KYC Service
// ============================================================================

const crypto = require("crypto");
const logger = require("../utils/logger");

// ============================================================================
// Constants
// ============================================================================

const KYC_LEVELS = {
  TIER_1: "TIER_1",
  TIER_2: "TIER_2",
  TIER_3: "TIER_3"
};

const VERIFICATION_STATUS = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED"
};

const RISK_LEVELS = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH"
};

// ============================================================================
// KYC Limits (UGX)
// ============================================================================

const KYC_LIMITS = {
  [KYC_LEVELS.TIER_1]: {
    maxSingleTransaction: 500000,
    dailyLimit: 2000000,
    monthlyLimit: 10000000,
    loanEligibility: false
  },

  [KYC_LEVELS.TIER_2]: {
    maxSingleTransaction: 2000000,
    dailyLimit: 10000000,
    monthlyLimit: 50000000,
    loanEligibility: true
  },

  [KYC_LEVELS.TIER_3]: {
    maxSingleTransaction: Number.MAX_SAFE_INTEGER,
    dailyLimit: Number.MAX_SAFE_INTEGER,
    monthlyLimit: Number.MAX_SAFE_INTEGER,
    loanEligibility: true
  }
};

// ============================================================================
// Custom Error
// ============================================================================

class KYCError extends Error {
  constructor(message, code, status = 400, metadata = {}) {
    super(message);

    this.name = "KYCError";
    this.code = code;
    this.status = status;
    this.metadata = metadata;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getUserKycLevel(user) {
  return (
    user?.kycLevel ||
    KYC_LEVELS.TIER_1
  );
}

function getLimits(level) {
  return (
    KYC_LIMITS[level] ||
    KYC_LIMITS[KYC_LEVELS.TIER_1]
  );
}

function generateVerificationId() {
  return `kyc_${crypto.randomUUID()}`;
}

// ============================================================================
// Verification Validation
// ============================================================================

function ensureUserVerified(user) {
  const status =
    user?.verificationStatus;

  if (
    status !==
    VERIFICATION_STATUS.VERIFIED
  ) {
    throw new KYCError(
      "User is not KYC verified",
      "KYC_NOT_VERIFIED",
      403
    );
  }

  return true;
}

// ============================================================================
// Transaction Validation
// ============================================================================

function validateTransaction(
  user,
  amount,
  options = {}
) {
  const level =
    getUserKycLevel(user);

  const limits =
    getLimits(level);

  ensureUserVerified(user);

  if (!amount || amount <= 0) {
    throw new KYCError(
      "Invalid transaction amount",
      "INVALID_AMOUNT"
    );
  }

  if (
    amount >
    limits.maxSingleTransaction
  ) {
    throw new KYCError(
      "Transaction exceeds KYC transaction limit",
      "KYC_TRANSACTION_LIMIT_EXCEEDED",
      403,
      {
        amount,
        limit:
          limits.maxSingleTransaction,
        level
      }
    );
  }

  const dailyTotal =
    Number(
      options.dailyTransactionTotal ||
      0
    );

  if (
    dailyTotal + amount >
    limits.dailyLimit
  ) {
    throw new KYCError(
      "Daily KYC limit exceeded",
      "KYC_DAILY_LIMIT_EXCEEDED",
      403,
      {
        amount,
        dailyTotal,
        dailyLimit:
          limits.dailyLimit
      }
    );
  }

  const monthlyTotal =
    Number(
      options.monthlyTransactionTotal ||
      0
    );

  if (
    monthlyTotal + amount >
    limits.monthlyLimit
  ) {
    throw new KYCError(
      "Monthly KYC limit exceeded",
      "KYC_MONTHLY_LIMIT_EXCEEDED",
      403,
      {
        amount,
        monthlyTotal,
        monthlyLimit:
          limits.monthlyLimit
      }
    );
  }

  logger.info(
    "KYC transaction validation passed",
    {
      userId: user?.id,
      level,
      amount
    }
  );

  return true;
}

// ============================================================================
// Savings Eligibility
// ============================================================================

function validateSavingsAccess(user) {
  ensureUserVerified(user);

  return {
    allowed: true,
    level: getUserKycLevel(user)
  };
}

// ============================================================================
// Loan Eligibility
// ============================================================================

function validateLoanEligibility(
  user,
  requestedAmount
) {
  ensureUserVerified(user);

  const level =
    getUserKycLevel(user);

  const limits =
    getLimits(level);

  if (!limits.loanEligibility) {
    throw new KYCError(
      "Current KYC tier is not eligible for loans",
      "LOAN_NOT_ALLOWED",
      403
    );
  }

  logger.info(
    "Loan eligibility approved",
    {
      userId: user?.id,
      level,
      requestedAmount
    }
  );

  return {
    eligible: true,
    level
  };
}

// ============================================================================
// Upgrade Evaluation
// ============================================================================

function evaluateKycUpgrade(user) {
  const level =
    getUserKycLevel(user);

  const missingRequirements = [];

  if (!user?.nationalIdVerified) {
    missingRequirements.push(
      "nationalId"
    );
  }

  if (!user?.selfieVerified) {
    missingRequirements.push(
      "selfieVerification"
    );
  }

  if (!user?.addressVerified) {
    missingRequirements.push(
      "proofOfAddress"
    );
  }

  return {
    currentLevel: level,
    eligible:
      missingRequirements.length === 0,
    missingRequirements
  };
}

// ============================================================================
// Verification Request
// ============================================================================

async function createVerificationRequest(
  user
) {
  const verificationId =
    generateVerificationId();

  logger.info(
    "KYC verification request created",
    {
      verificationId,
      userId: user?.id
    }
  );

  return {
    verificationId,
    userId: user?.id,
    status:
      VERIFICATION_STATUS.PENDING,
    createdAt: new Date()
  };
}

// ============================================================================
// Risk Assessment
// ============================================================================

function calculateRiskScore(
  user = {}
) {
  let score = 0;

  if (!user.nationalIdVerified)
    score += 30;

  if (!user.selfieVerified)
    score += 20;

  if (!user.addressVerified)
    score += 10;

  if (user.sanctionsMatch)
    score += 100;

  let riskLevel =
    RISK_LEVELS.LOW;

  if (score >= 100) {
    riskLevel =
      RISK_LEVELS.HIGH;
  } else if (score >= 40) {
    riskLevel =
      RISK_LEVELS.MEDIUM;
  }

  return {
    score,
    riskLevel
  };
}

// ============================================================================
// Sanctions Screening Hook
// ============================================================================

async function screenAgainstSanctions(
  user
) {
  logger.info(
    "Sanctions screening initiated",
    {
      userId: user?.id
    }
  );

  return {
    screened: true,
    matched: false,
    provider: "SANCTIONS_PROVIDER"
  };
}

// ============================================================================
// Health Check
// ============================================================================

async function healthCheck() {
  return {
    service: "kyc-service",
    status: "UP",
    timestamp:
      new Date().toISOString()
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  KYC_LEVELS,
  KYC_LIMITS,
  VERIFICATION_STATUS,
  RISK_LEVELS,

  KYCError,

  validateTransaction,
  validateSavingsAccess,
  validateLoanEligibility,

  createVerificationRequest,
  evaluateKycUpgrade,

  calculateRiskScore,
  screenAgainstSanctions,

  ensureUserVerified,
  healthCheck
};