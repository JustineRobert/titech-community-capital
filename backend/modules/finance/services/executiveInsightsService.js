// backend/modules/finance/services/executiveInsightsService.js
'use strict';

const portfolioAnalyticsService = require('./portfolioAnalyticsService');
const predictiveRiskAnalyticsService = require('./predictiveRiskAnalyticsService');
const memberBehaviorAnalyticsService = require('./memberBehaviorAnalyticsService');
const liquidityForecastService = require('./liquidityForecastService');
const dividendForecastService = require('./dividendForecastService');
const fraudAnalyticsService = require('./fraudAnalyticsService');
const regulatoryAnalyticsService = require('./regulatoryAnalyticsService');

const Loan = require('../../loans/models/Loan');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');

/**
 * ---------------------------------------------------------
 * HELPERS
 * ---------------------------------------------------------
 */

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function growthRate(current, previous) {
  if (!previous) return 0;

  return round(
    ((current - previous) / previous) * 100
  );
}

/**
 * ---------------------------------------------------------
 * EXECUTIVE KPI SUMMARY
 * ---------------------------------------------------------
 */

async function getExecutiveKPIs(tenantId) {
  const [
    activeLoans,
    transactions,
    accounts
  ] = await Promise.all([
    Loan.countDocuments({
      tenantId,
      status: {
        $in: ['ACTIVE', 'DISBURSED']
      }
    }),

    Transaction.countDocuments({
      tenantId
    }),

    Account.countDocuments({
      tenantId,
      isActive: true
    })
  ]);

  return {
    activeLoans,
    transactions,
    activeAccounts: accounts
  };
}

/**
 * ---------------------------------------------------------
 * GROWTH ANALYTICS
 * ---------------------------------------------------------
 */

async function getGrowthAnalytics(tenantId) {
  const currentMonthStart =
    new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    );

  const previousMonthStart =
    new Date(
      new Date().getFullYear(),
      new Date().getMonth() - 1,
      1
    );

  const previousMonthEnd =
    new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      0
    );

  const currentTransactions =
    await Transaction.countDocuments({
      tenantId,
      createdAt: {
        $gte: currentMonthStart
      }
    });

  const previousTransactions =
    await Transaction.countDocuments({
      tenantId,
      createdAt: {
        $gte: previousMonthStart,
        $lte: previousMonthEnd
      }
    });

  return {
    currentTransactions,
    previousTransactions,
    growthPercentage: growthRate(
      currentTransactions,
      previousTransactions
    )
  };
}

/**
 * ---------------------------------------------------------
 * EXECUTIVE RISK OVERVIEW
 * ---------------------------------------------------------
 */

async function getRiskOverview(tenantId) {
  const [
    portfolioRisk,
    fraudDashboard,
    regulatoryDashboard
  ] = await Promise.all([
    predictiveRiskAnalyticsService.getPortfolioRiskSummary(
      tenantId
    ),

    fraudAnalyticsService.getFraudDashboard(
      tenantId
    ),

    regulatoryAnalyticsService.getRegulatoryDashboard(
      tenantId
    )
  ]);

  return {
    portfolioRisk,
    fraudDashboard,
    regulatoryDashboard
  };
}

/**
 * ---------------------------------------------------------
 * EXECUTIVE LIQUIDITY INSIGHTS
 * ---------------------------------------------------------
 */

async function getLiquidityInsights(
  tenantId
) {
  const forecast =
    await liquidityForecastService.generateLiquidityForecast(
      tenantId
    );

  return {
    forecast
  };
}

/**
 * ---------------------------------------------------------
 * MEMBER HEALTH INSIGHTS
 * ---------------------------------------------------------
 */

async function getMemberInsights(
  tenantId
) {
  return memberBehaviorAnalyticsService.generateBehaviorDashboard(
    tenantId
  );
}

/**
 * ---------------------------------------------------------
 * DIVIDEND OUTLOOK
 * ---------------------------------------------------------
 */

async function getDividendInsights(
  tenantId
) {
  return dividendForecastService.generateDividendForecast(
    tenantId
  );
}

/**
 * ---------------------------------------------------------
 * CREDIT PORTFOLIO INSIGHTS
 * ---------------------------------------------------------
 */

async function getPortfolioInsights(
  tenantId
) {
  return portfolioAnalyticsService.generatePortfolioDashboard(
    tenantId
  );
}

/**
 * ---------------------------------------------------------
 * STRATEGIC RECOMMENDATIONS ENGINE
 * ---------------------------------------------------------
 */

async function generateRecommendations(
  tenantId
) {
  const [
    liquidity,
    risk,
    portfolio
  ] = await Promise.all([
    liquidityForecastService.generateLiquidityForecast(
      tenantId
    ),

    predictiveRiskAnalyticsService.getPortfolioRiskSummary(
      tenantId
    ),

    portfolioAnalyticsService.generatePortfolioDashboard(
      tenantId
    )
  ]);

  const recommendations = [];

  if (
    liquidity.projectedLiquidityRatio <
    1.2
  ) {
    recommendations.push({
      priority: 'HIGH',
      category: 'LIQUIDITY',
      recommendation:
        'Increase liquidity reserves and reduce large loan disbursements.'
    });
  }

  if (
    risk.averageRiskScore >
    70
  ) {
    recommendations.push({
      priority: 'HIGH',
      category: 'RISK',
      recommendation:
        'Tighten lending criteria and strengthen collections.'
    });
  }

  if (
    portfolio.par30 >
    10
  ) {
    recommendations.push({
      priority: 'CRITICAL',
      category: 'PORTFOLIO',
      recommendation:
        'Immediate intervention required for delinquent loan recovery.'
    });
  }

  if (
    recommendations.length === 0
  ) {
    recommendations.push({
      priority: 'NORMAL',
      category: 'GROWTH',
      recommendation:
        'Portfolio performance is healthy. Continue controlled expansion.'
    });
  }

  return recommendations;
}

/**
 * ---------------------------------------------------------
 * BOARD REPORT
 * ---------------------------------------------------------
 */

async function generateBoardReport(
  tenantId
) {
  const [
    kpis,
    growth,
    risk,
    liquidity,
    dividends,
    portfolio,
    recommendations
  ] = await Promise.all([
    getExecutiveKPIs(
      tenantId
    ),

    getGrowthAnalytics(
      tenantId
    ),

    getRiskOverview(
      tenantId
    ),

    getLiquidityInsights(
      tenantId
    ),

    getDividendInsights(
      tenantId
    ),

    getPortfolioInsights(
      tenantId
    ),

    generateRecommendations(
      tenantId
    )
  ]);

  return {
    reportType:
      'BOARD_REPORT',

    generatedAt:
      new Date(),

    tenantId,

    executiveKPIs:
      kpis,

    growthAnalytics:
      growth,

    riskOverview:
      risk,

    liquidityInsights:
      liquidity,

    dividendOutlook:
      dividends,

    portfolioInsights:
      portfolio,

    recommendations
  };
}

/**
 * ---------------------------------------------------------
 * CEO COCKPIT
 * ---------------------------------------------------------
 */

async function generateCEODashboard(
  tenantId
) {
  const [
    kpis,
    growth,
    recommendations
  ] = await Promise.all([
    getExecutiveKPIs(
      tenantId
    ),

    getGrowthAnalytics(
      tenantId
    ),

    generateRecommendations(
      tenantId
    )
  ]);

  return {
    generatedAt:
      new Date(),

    executiveKPIs:
      kpis,

    growthAnalytics:
      growth,

    recommendations
  };
}

/**
 * ---------------------------------------------------------
 * INVESTOR REPORT
 * ---------------------------------------------------------
 */

async function generateInvestorReport(
  tenantId
) {
  const [
    portfolio,
    risk,
    growth
  ] = await Promise.all([
    getPortfolioInsights(
      tenantId
    ),

    getRiskOverview(
      tenantId
    ),

    getGrowthAnalytics(
      tenantId
    )
  ]);

  return {
    reportType:
      'INVESTOR_REPORT',

    generatedAt:
      new Date(),

    portfolio,

    risk,

    growth
  };
}

/**
 * ---------------------------------------------------------
 * EXECUTIVE INSIGHTS DASHBOARD
 * ---------------------------------------------------------
 */

async function generateExecutiveDashboard(
  tenantId
) {
  const [
    boardReport,
    investorReport
  ] = await Promise.all([
    generateBoardReport(
      tenantId
    ),

    generateInvestorReport(
      tenantId
    )
  ]);

  return {
    generatedAt:
      new Date(),

    boardReport,

    investorReport
  };
}

/**
 * ---------------------------------------------------------
 * EXPORTS
 * ---------------------------------------------------------
 */

module.exports = {
  getExecutiveKPIs,
  getGrowthAnalytics,
  getRiskOverview,
  getLiquidityInsights,
  getMemberInsights,
  getDividendInsights,
  getPortfolioInsights,
  generateRecommendations,
  generateBoardReport,
  generateCEODashboard,
  generateInvestorReport,
  generateExecutiveDashboard
};