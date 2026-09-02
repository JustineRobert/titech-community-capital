// backend/modules/finance/services/regulatoryAnalyticsService.js

'use strict';

const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const Journal = require('../models/Journal');
const JournalEntry = require('../models/JournalEntry');

const Loan = require('../../loans/models/Loan');

/**
 * ----------------------------------------------------
 * HELPERS
 * ----------------------------------------------------
 */

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function percentage(part, total) {
  if (!total) return 0;
  return round((part / total) * 100);
}

/**
 * ----------------------------------------------------
 * TOTAL SAVINGS
 * ----------------------------------------------------
 */

async function getTotalSavings(tenantId) {
  const accounts = await Account.find({
    tenantId,
    type: 'LIABILITY',
    isActive: true
  });

  let total = 0;

  accounts.forEach(account => {
    total += Number(account.balance || 0);
  });

  return round(total);
}

/**
 * ----------------------------------------------------
 * TOTAL LOAN PORTFOLIO
 * ----------------------------------------------------
 */

async function getLoanPortfolio(tenantId) {
  const loans = await Loan.find({
    tenantId,
    status: {
      $in: [
        'ACTIVE',
        'DISBURSED',
        'OVERDUE'
      ]
    }
  });

  let portfolio = 0;

  loans.forEach(loan => {
    portfolio += Number(
      loan.outstandingBalance ||
      loan.amount ||
      0
    );
  });

  return round(portfolio);
}

/**
 * ----------------------------------------------------
 * NON PERFORMING LOANS
 * ----------------------------------------------------
 */

async function getNPLMetrics(tenantId) {
  const loans = await Loan.find({
    tenantId
  });

  let totalPortfolio = 0;
  let nplPortfolio = 0;

  loans.forEach(loan => {
    const balance =
      Number(
        loan.outstandingBalance ||
        loan.amount ||
        0
      );

    totalPortfolio += balance;

    if (
      [
        'DEFAULTED',
        'WRITE_OFF',
        'OVERDUE'
      ].includes(
        loan.status
      )
    ) {
      nplPortfolio += balance;
    }
  });

  return {
    totalPortfolio:
      round(totalPortfolio),

    nonPerformingPortfolio:
      round(nplPortfolio),

    nplRatio:
      percentage(
        nplPortfolio,
        totalPortfolio
      )
  };
}

/**
 * ----------------------------------------------------
 * PAR30
 * ----------------------------------------------------
 */

async function calculatePAR30(
  tenantId
) {
  const loans =
    await Loan.find({
      tenantId,
      daysPastDue: {
        $gte: 30
      }
    });

  const portfolio =
    await getLoanPortfolio(
      tenantId
    );

  let overdue = 0;

  loans.forEach(loan => {
    overdue += Number(
      loan.outstandingBalance ||
      0
    );
  });

  return {
    overduePortfolio:
      round(overdue),

    par30:
      percentage(
        overdue,
        portfolio
      )
  };
}

/**
 * ----------------------------------------------------
 * LIQUIDITY RATIO
 * ----------------------------------------------------
 */

async function calculateLiquidityRatio(
  tenantId
) {
  const assets =
    await Account.find({
      tenantId,
      type: 'ASSET'
    });

  const liabilities =
    await Account.find({
      tenantId,
      type: 'LIABILITY'
    });

  const assetTotal =
    assets.reduce(
      (sum, a) =>
        sum +
        Number(
          a.balance || 0
        ),
      0
    );

  const liabilityTotal =
    liabilities.reduce(
      (sum, a) =>
        sum +
        Number(
          a.balance || 0
        ),
      0
    );

  return {
    totalAssets:
      round(assetTotal),

    totalLiabilities:
      round(
        liabilityTotal
      ),

    liquidityRatio:
      liabilityTotal > 0
        ? round(
            assetTotal /
              liabilityTotal
          )
        : 0
  };
}

/**
 * ----------------------------------------------------
 * CAPITAL ADEQUACY
 * ----------------------------------------------------
 */

async function calculateCapitalAdequacy(
  tenantId
) {
  const equity =
    await Account.find({
      tenantId,
      type: 'EQUITY'
    });

  const assets =
    await Account.find({
      tenantId,
      type: 'ASSET'
    });

  const totalEquity =
    equity.reduce(
      (sum, account) =>
        sum +
        Number(
          account.balance || 0
        ),
      0
    );

  const totalAssets =
    assets.reduce(
      (sum, account) =>
        sum +
        Number(
          account.balance || 0
        ),
      0
    );

  return {
    totalEquity:
      round(totalEquity),

    totalAssets:
      round(totalAssets),

    capitalAdequacyRatio:
      percentage(
        totalEquity,
        totalAssets
      )
  };
}

/**
 * ----------------------------------------------------
 * AML METRICS
 * ----------------------------------------------------
 */

async function getAMLMetrics(
  tenantId
) {
  const transactions =
    await Transaction.find({
      tenantId
    });

  const highValue =
    transactions.filter(
      tx =>
        Number(
          tx.amount || 0
        ) >= 10000000
    );

  return {
    transactionCount:
      transactions.length,

    highValueTransactions:
      highValue.length,

    suspiciousTransactionRatio:
      percentage(
        highValue.length,
        transactions.length
      )
  };
}

/**
 * ----------------------------------------------------
 * LEDGER INTEGRITY
 * ----------------------------------------------------
 */

async function verifyLedgerIntegrity(
  tenantId
) {
  const journals =
    await Journal.find({
      tenantId
    });

  let balanced = 0;
  let unbalanced = 0;

  journals.forEach(
    journal => {
      if (
        journal.balanced
      ) {
        balanced++;
      } else {
        unbalanced++;
      }
    }
  );

  return {
    balancedJournals:
      balanced,

    unbalancedJournals:
      unbalanced,

    integrityScore:
      percentage(
        balanced,
        journals.length
      )
  };
}

/**
 * ----------------------------------------------------
 * TRANSACTION VOLUME
 * ----------------------------------------------------
 */

async function getTransactionVolume(
  tenantId,
  startDate,
  endDate
) {
  const query = {
    tenantId
  };

  if (
    startDate ||
    endDate
  ) {
    query.createdAt = {};

    if (startDate)
      query.createdAt.$gte =
        startDate;

    if (endDate)
      query.createdAt.$lte =
        endDate;
  }

  const transactions =
    await Transaction.find(
      query
    );

  let volume = 0;

  transactions.forEach(
    tx => {
      volume += Number(
        tx.amount || 0
      );
    }
  );

  return {
    count:
      transactions.length,

    volume:
      round(volume)
  };
}

/**
 * ----------------------------------------------------
 * REGULATORY DASHBOARD
 * ----------------------------------------------------
 */

async function getRegulatoryDashboard(
  tenantId
) {
  const [
    savings,
    portfolio,
    npl,
    par30,
    liquidity,
    capital,
    aml,
    ledger,
    volume
  ] = await Promise.all([
    getTotalSavings(
      tenantId
    ),
    getLoanPortfolio(
      tenantId
    ),
    getNPLMetrics(
      tenantId
    ),
    calculatePAR30(
      tenantId
    ),
    calculateLiquidityRatio(
      tenantId
    ),
    calculateCapitalAdequacy(
      tenantId
    ),
    getAMLMetrics(
      tenantId
    ),
    verifyLedgerIntegrity(
      tenantId
    ),
    getTransactionVolume(
      tenantId
    )
  ]);

  return {
    generatedAt:
      new Date(),

    savings,

    loanPortfolio:
      portfolio,

    nplMetrics:
      npl,

    par30Metrics:
      par30,

    liquidityMetrics:
      liquidity,

    capitalMetrics:
      capital,

    amlMetrics:
      aml,

    ledgerIntegrity:
      ledger,

    transactionVolume:
      volume
  };
}

/**
 * ----------------------------------------------------
 * REGULATORY REPORT
 * ----------------------------------------------------
 */

async function generateRegulatoryReport(
  tenantId
) {
  const dashboard =
    await getRegulatoryDashboard(
      tenantId
    );

  return {
    reportType:
      'REGULATORY_COMPLIANCE',

    generatedAt:
      new Date(),

    tenantId,

    report:
      dashboard
  };
}

/**
 * ----------------------------------------------------
 * EXPORTS
 * ----------------------------------------------------
 */

module.exports = {
  getTotalSavings,
  getLoanPortfolio,
  getNPLMetrics,
  calculatePAR30,
  calculateLiquidityRatio,
  calculateCapitalAdequacy,
  getAMLMetrics,
  verifyLedgerIntegrity,
  getTransactionVolume,
  getRegulatoryDashboard,
  generateRegulatoryReport
};