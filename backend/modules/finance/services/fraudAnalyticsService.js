// backend/modules/finance/services/fraudAnalyticsService.js
'use strict';

const crypto = require('crypto');

const Transaction = require('../models/Transaction');
const Loan = require('../../loans/models/Loan');
const Account = require('../models/Account');

/**
 * -----------------------------------------------------
 * CONFIGURATION
 * -----------------------------------------------------
 */

const FRAUD_THRESHOLDS = {
  HIGH_VALUE_TRANSACTION: 50000000,
  RAPID_TRANSACTION_COUNT: 10,
  RAPID_TRANSACTION_WINDOW_MINUTES: 15,
  DUPLICATE_WINDOW_MINUTES: 5,
  HIGH_RISK_SCORE: 80
};

/**
 * -----------------------------------------------------
 * HELPERS
 * -----------------------------------------------------
 */

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function hashFingerprint(payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

function minutesAgo(minutes) {
  return new Date(
    Date.now() - minutes * 60 * 1000
  );
}

/**
 * -----------------------------------------------------
 * HIGH VALUE TRANSACTION DETECTION
 * -----------------------------------------------------
 */

async function detectHighValueTransactions(
  tenantId
) {
  const transactions =
    await Transaction.find({
      tenantId,
      amount: {
        $gte:
          FRAUD_THRESHOLDS.HIGH_VALUE_TRANSACTION
      }
    });

  return transactions.map(tx => ({
    riskType:
      'HIGH_VALUE_TRANSACTION',
    transactionId: tx._id,
    amount: Number(tx.amount),
    riskScore: 70
  }));
}

/**
 * -----------------------------------------------------
 * RAPID VELOCITY DETECTION
 * -----------------------------------------------------
 */

async function detectVelocityFraud(
  tenantId
) {
  const windowStart =
    minutesAgo(
      FRAUD_THRESHOLDS.RAPID_TRANSACTION_WINDOW_MINUTES
    );

  const transactions =
    await Transaction.find({
      tenantId,
      createdAt: {
        $gte: windowStart
      }
    });

  const grouped = {};

  for (const tx of transactions) {
    const wallet =
      tx.fromWallet?.toString();

    if (!wallet) continue;

    grouped[wallet] =
      (grouped[wallet] || 0) + 1;
  }

  const alerts = [];

  Object.entries(grouped).forEach(
    ([walletId, count]) => {
      if (
        count >=
        FRAUD_THRESHOLDS.RAPID_TRANSACTION_COUNT
      ) {
        alerts.push({
          riskType:
            'VELOCITY_FRAUD',
          walletId,
          transactionCount:
            count,
          riskScore: 75
        });
      }
    }
  );

  return alerts;
}

/**
 * -----------------------------------------------------
 * DUPLICATE TRANSACTION DETECTION
 * -----------------------------------------------------
 */

async function detectDuplicateTransactions(
  tenantId
) {
  const windowStart =
    minutesAgo(
      FRAUD_THRESHOLDS.DUPLICATE_WINDOW_MINUTES
    );

  const transactions =
    await Transaction.find({
      tenantId,
      createdAt: {
        $gte: windowStart
      }
    });

  const seen = new Map();
  const duplicates = [];

  for (const tx of transactions) {
    const fingerprint =
      hashFingerprint({
        amount: tx.amount,
        fromWallet:
          tx.fromWallet,
        toWallet:
          tx.toWallet
      });

    if (
      seen.has(fingerprint)
    ) {
      duplicates.push({
        riskType:
          'DUPLICATE_TRANSACTION',
        transactionId:
          tx._id,
        riskScore: 90
      });
    }

    seen.set(
      fingerprint,
      tx._id
    );
  }

  return duplicates;
}

/**
 * -----------------------------------------------------
 * LOAN FRAUD ANALYTICS
 * -----------------------------------------------------
 */

async function detectLoanFraud(
  tenantId
) {
  const loans =
    await Loan.find({
      tenantId
    });

  const alerts = [];

  for (const loan of loans) {
    const score =
      Number(
        loan.creditScore || 0
      );

    const amount =
      Number(
        loan.amount || 0
      );

    if (
      score < 400 &&
      amount > 5000000
    ) {
      alerts.push({
        riskType:
          'LOAN_FRAUD_RISK',
        loanId: loan._id,
        score,
        amount,
        riskScore: 85
      });
    }
  }

  return alerts;
}

/**
 * -----------------------------------------------------
 * ACCOUNT TAKEOVER DETECTION
 * -----------------------------------------------------
 */

async function detectAccountTakeover(
  tenantId
) {
  const suspicious =
    await Transaction.find({
      tenantId,
      provider: {
        $exists: true
      }
    });

  return suspicious
    .filter(tx => {
      const meta =
        tx.metadata || {};

      return (
        meta.deviceMismatch ||
        meta.locationMismatch
      );
    })
    .map(tx => ({
      riskType:
        'ACCOUNT_TAKEOVER',
      transactionId:
        tx._id,
      riskScore: 95
    }));
}

/**
 * -----------------------------------------------------
 * AML STRUCTURING DETECTION
 * -----------------------------------------------------
 */

async function detectStructuring(
  tenantId
) {
  const transactions =
    await Transaction.find({
      tenantId
    });

  const grouped = {};

  transactions.forEach(tx => {
    const wallet =
      tx.fromWallet?.toString();

    if (!wallet) return;

    grouped[wallet] =
      (grouped[wallet] || 0) +
      Number(tx.amount || 0);
  });

  const alerts = [];

  Object.entries(grouped).forEach(
    ([walletId, total]) => {
      if (
        total >
        100000000
      ) {
        alerts.push({
          riskType:
            'AML_STRUCTURING',
          walletId,
          totalAmount:
            round(total),
          riskScore: 90
        });
      }
    }
  );

  return alerts;
}

/**
 * -----------------------------------------------------
 * INSIDER FRAUD DETECTION
 * -----------------------------------------------------
 */

async function detectInsiderFraud(
  tenantId
) {
  const transactions =
    await Transaction.find({
      tenantId
    });

  const alerts = [];

  transactions.forEach(tx => {
    const metadata =
      tx.metadata || {};

    if (
      metadata.manualOverride
    ) {
      alerts.push({
        riskType:
          'INSIDER_OVERRIDE',
        transactionId:
          tx._id,
        riskScore: 80
      });
    }
  });

  return alerts;
}

/**
 * -----------------------------------------------------
 * MEMBER RISK SCORE
 * -----------------------------------------------------
 */

async function calculateFraudRiskScore(
  memberMetrics = {}
) {
  let score = 0;

  if (
    memberMetrics.duplicateTransactions
  )
    score += 25;

  if (
    memberMetrics.velocityFraud
  )
    score += 25;

  if (
    memberMetrics.highValueActivity
  )
    score += 20;

  if (
    memberMetrics.deviceMismatch
  )
    score += 15;

  if (
    memberMetrics.locationMismatch
  )
    score += 15;

  return Math.min(
    score,
    100
  );
}

/**
 * -----------------------------------------------------
 * FRAUD SUMMARY
 * -----------------------------------------------------
 */

async function getFraudSummary(
  tenantId
) {
  const [
    highValue,
    velocity,
    duplicates,
    loans,
    takeover,
    aml,
    insider
  ] = await Promise.all([
    detectHighValueTransactions(
      tenantId
    ),
    detectVelocityFraud(
      tenantId
    ),
    detectDuplicateTransactions(
      tenantId
    ),
    detectLoanFraud(
      tenantId
    ),
    detectAccountTakeover(
      tenantId
    ),
    detectStructuring(
      tenantId
    ),
    detectInsiderFraud(
      tenantId
    )
  ]);

  const allAlerts = [
    ...highValue,
    ...velocity,
    ...duplicates,
    ...loans,
    ...takeover,
    ...aml,
    ...insider
  ];

  const critical =
    allAlerts.filter(
      a => a.riskScore >= 90
    ).length;

  const high =
    allAlerts.filter(
      a =>
        a.riskScore >= 75 &&
        a.riskScore < 90
    ).length;

  const medium =
    allAlerts.filter(
      a =>
        a.riskScore >= 50 &&
        a.riskScore < 75
    ).length;

  return {
    generatedAt:
      new Date(),

    totalAlerts:
      allAlerts.length,

    criticalAlerts:
      critical,

    highRiskAlerts:
      high,

    mediumRiskAlerts:
      medium,

    alerts: allAlerts
  };
}

/**
 * -----------------------------------------------------
 * FRAUD DASHBOARD
 * -----------------------------------------------------
 */

async function getFraudDashboard(
  tenantId
) {
  const summary =
    await getFraudSummary(
      tenantId
    );

  return {
    generatedAt:
      new Date(),

    riskLevel:
      summary.criticalAlerts > 0
        ? 'CRITICAL'
        : summary.highRiskAlerts > 0
        ? 'HIGH'
        : 'NORMAL',

    ...summary
  };
}

/**
 * -----------------------------------------------------
 * EXPORTS
 * -----------------------------------------------------
 */

module.exports = {
  detectHighValueTransactions,
  detectVelocityFraud,
  detectDuplicateTransactions,
  detectLoanFraud,
  detectAccountTakeover,
  detectStructuring,
  detectInsiderFraud,
  calculateFraudRiskScore,
  getFraudSummary,
  getFraudDashboard
};