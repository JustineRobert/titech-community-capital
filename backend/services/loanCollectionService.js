// ============================================================================
// File: backend/services/loanCollectionService.js
// Description: Enterprise Loan Collection & Repayment Service
// ============================================================================

const crypto = require("crypto");

const logger = require("../utils/logger");

// Optional integrations
let loanAccountingService;
let amlService;
let kycService;

try {
  loanAccountingService = require("../modules/loanAccountingService");
} catch (_) {}

try {
  amlService = require("./amlService");
} catch (_) {}

try {
  kycService = require("./kycService");
} catch (_) {}

// ============================================================================
// Constants
// ============================================================================

const COLLECTION_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  PARTIAL: "PARTIAL",
  REVERSED: "REVERSED"
};

const LOAN_STATUS = {
  ACTIVE: "ACTIVE",
  CURRENT: "CURRENT",
  DELINQUENT: "DELINQUENT",
  DEFAULTED: "DEFAULTED",
  CLOSED: "CLOSED"
};

const ALLOCATION_ORDER = [
  "penalties",
  "fees",
  "interest",
  "principal"
];

// ============================================================================
// Errors
// ============================================================================

class LoanCollectionError extends Error {
  constructor(
    message,
    code,
    status = 400,
    metadata = {}
  ) {
    super(message);

    this.name = "LoanCollectionError";
    this.code = code;
    this.status = status;
    this.metadata = metadata;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function generateCollectionId() {
  return `lcol_${crypto.randomUUID()}`;
}

function generateReceiptNumber() {
  return `RCP-${Date.now()}`;
}

function safeNumber(value) {
  return Number(value || 0);
}

// ============================================================================
// Allocation Engine
// ============================================================================

function allocateRepayment(
  amount,
  balances
) {
  let remaining = safeNumber(amount);

  const allocation = {
    penalties: 0,
    fees: 0,
    interest: 0,
    principal: 0
  };

  for (const bucket of ALLOCATION_ORDER) {
    const outstanding =
      safeNumber(
        balances[bucket]
      );

    if (
      remaining <= 0 ||
      outstanding <= 0
    ) {
      continue;
    }

    const applied =
      Math.min(
        remaining,
        outstanding
      );

    allocation[bucket] =
      applied;

    remaining -= applied;
  }

  return {
    allocation,
    unallocatedAmount:
      remaining
  };
}

// ============================================================================
// Collection Validation
// ============================================================================

async function validateCollection({
  borrower,
  loan,
  amount
}) {
  if (!loan) {
    throw new LoanCollectionError(
      "Loan not found",
      "LOAN_NOT_FOUND"
    );
  }

  if (
    loan.status ===
    LOAN_STATUS.CLOSED
  ) {
    throw new LoanCollectionError(
      "Loan already closed",
      "LOAN_CLOSED"
    );
  }

  if (
    !amount ||
    Number(amount) <= 0
  ) {
    throw new LoanCollectionError(
      "Invalid collection amount",
      "INVALID_AMOUNT"
    );
  }

  if (
    kycService?.validateTransaction
  ) {
    await kycService.validateTransaction(
      borrower,
      amount
    );
  }

  if (
    amlService?.validateTransaction
  ) {
    const amlResult =
      await amlService.validateTransaction(
        {
          amount
        }
      );

    if (amlResult.shouldBlock) {
      throw new LoanCollectionError(
        "AML validation blocked transaction",
        "AML_BLOCKED"
      );
    }
  }

  return true;
}

// ============================================================================
// Process Repayment
// ============================================================================

async function processRepayment({
  loan,
  borrower,
  amount,
  paymentMethod,
  transactionReference,
  collectedBy
}) {
  await validateCollection({
    borrower,
    loan,
    amount
  });

  const collectionId =
    generateCollectionId();

  const receiptNumber =
    generateReceiptNumber();

  const balances = {
    penalties:
      loan.outstandingPenalties,
    fees:
      loan.outstandingFees,
    interest:
      loan.outstandingInterest,
    principal:
      loan.outstandingPrincipal
  };

  const allocationResult =
    allocateRepayment(
      amount,
      balances
    );

  const repayment = {
    collectionId,
    receiptNumber,

    loanId: loan.id,
    borrowerId: borrower?.id,

    amount,

    paymentMethod,
    transactionReference,

    allocation:
      allocationResult.allocation,

    unallocatedAmount:
      allocationResult.unallocatedAmount,

    status:
      COLLECTION_STATUS.SUCCESS,

    collectedBy,

    collectedAt:
      new Date()
  };

  logger.info(
    "Loan repayment processed",
    {
      collectionId,
      loanId: loan.id,
      amount
    }
  );

  if (
    loanAccountingService
      ?.recordRepayment
  ) {
    try {
      await loanAccountingService.recordRepayment(
        repayment
      );
    } catch (err) {
      logger.error(
        "Accounting posting failed",
        {
          collectionId,
          error: err.message
        }
      );
    }
  }

  return repayment;
}

// ============================================================================
// Arrears Calculation
// ============================================================================

function calculateArrears(
  loan
) {
  const arrears =
    safeNumber(
      loan.outstandingInstallments
    ) *
    safeNumber(
      loan.installmentAmount
    );

  return {
    loanId: loan.id,
    arrears,
    daysPastDue:
      safeNumber(
        loan.daysPastDue
      )
  };
}

// ============================================================================
// Delinquency Assessment
// ============================================================================

function assessDelinquency(
  loan
) {
  const days =
    safeNumber(
      loan.daysPastDue
    );

  let status =
    LOAN_STATUS.CURRENT;

  if (days >= 30) {
    status =
      LOAN_STATUS.DELINQUENT;
  }

  if (days >= 90) {
    status =
      LOAN_STATUS.DEFAULTED;
  }

  return {
    loanId: loan.id,
    status,
    daysPastDue: days
  };
}

// ============================================================================
// Penalty Calculation
// ============================================================================

function calculatePenalty({
  overdueAmount,
  dailyRate,
  daysPastDue
}) {
  const penalty =
    safeNumber(
      overdueAmount
    ) *
    safeNumber(dailyRate) *
    safeNumber(daysPastDue);

  return {
    penalty
  };
}

// ============================================================================
// Collection Retry
// ============================================================================

async function createRetrySchedule({
  collectionId,
  retryCount = 0
}) {
  const nextRetry =
    new Date(
      Date.now() +
      (retryCount + 1) *
        24 *
        60 *
        60 *
        1000
    );

  return {
    collectionId,
    retryCount:
      retryCount + 1,
    nextRetry
  };
}

// ============================================================================
// Recovery Queue Candidate
// ============================================================================

function evaluateRecoveryCase(
  loan
) {
  const daysPastDue =
    safeNumber(
      loan.daysPastDue
    );

  return {
    loanId: loan.id,
    eligible:
      daysPastDue >= 90,
    daysPastDue
  };
}

// ============================================================================
// Portfolio Metrics
// ============================================================================

function calculateCollectionMetrics(
  loans = []
) {
  let totalOutstanding = 0;
  let totalArrears = 0;

  for (const loan of loans) {
    totalOutstanding +=
      safeNumber(
        loan.outstandingPrincipal
      );

    totalArrears +=
      safeNumber(
        loan.arrearsAmount
      );
  }

  return {
    totalLoans:
      loans.length,
    totalOutstanding,
    totalArrears
  };
}

// ============================================================================
// Health Check
// ============================================================================

async function healthCheck() {
  return {
    service:
      "loan-collection-service",
    status: "UP",
    timestamp:
      new Date().toISOString()
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  COLLECTION_STATUS,
  LOAN_STATUS,

  LoanCollectionError,

  allocateRepayment,

  validateCollection,
  processRepayment,

  calculateArrears,
  assessDelinquency,
  calculatePenalty,

  createRetrySchedule,
  evaluateRecoveryCase,

  calculateCollectionMetrics,

  healthCheck
};