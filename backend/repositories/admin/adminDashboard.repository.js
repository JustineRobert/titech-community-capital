'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Dashboard Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/admin/adminDashboard.repository.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical persistence/data-access layer for the TITech Community Capital
 * administrative dashboard.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Tenant-scoped dashboard reads
 * - KPI aggregations
 * - Transaction summaries
 * - Savings portfolio summaries
 * - Contribution summaries
 * - Loan portfolio summaries
 * - Member summaries
 * - Risk / fraud summaries
 * - Compliance summaries
 * - Audit activity summaries
 * - Time-series dashboard data
 * - Recent activity queries
 * - Deterministic pagination primitives
 *
 * Architectural boundaries
 * ----------------------------------------------------------------------------
 * Repository:
 *   - Talks to Mongoose models.
 *   - Builds safe MongoDB filters.
 *   - Performs database aggregation.
 *   - Does NOT contain business decisions.
 *   - Does NOT perform authorization/RBAC.
 *   - Does NOT write financial records.
 *   - Does NOT mutate tenant data.
 *   - Does NOT format HTTP responses.
 *   - Does NOT expose raw credentials/secrets.
 *
 * Service:
 *   adminAnalytics.service.js
 *   adminSystem.service.js
 *   adminAudit.service.js
 *   adminReports.service.js
 *
 * Controller:
 *   Validates authenticated administrator/tenant context and maps service
 *   results to HTTP responses.
 *
 * Tenant-type reality in the current project
 * ----------------------------------------------------------------------------
 * ObjectId tenantId:
 *   - Transaction
 *   - Contribution
 *   - AuditLog
 *
 * String tenantId:
 *   - Member
 *   - Savings
 *   - Loan
 *   - FraudLog
 *   - ComplianceLog
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This repository deliberately does not query Group globally because the
 * current Group model does not provide a reliable tenantId discriminator.
 * Returning a global Group count here would create a cross-tenant data leak.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const Transaction = require('../../models/Transaction');
const Contribution = require('../../models/Contribution');
const Member = require('../../models/Member');
const Savings = require('../../models/Savings');
const Loan = require('../../models/Loan');
const FraudLog = require('../../models/FraudLog');
const ComplianceLog = require('../../models/ComplianceLog');
const AuditLog = require('../../models/AuditLog');

/**
 * ============================================================================
 * SERVICE METADATA
 * ============================================================================
 */

const REPOSITORY_NAME =
  'AdminDashboardRepository';

const REPOSITORY_VERSION =
  '2026.1';

const DEFAULT_LIMIT =
  20;

const MAX_LIMIT =
  100;

const DEFAULT_DAYS =
  30;

const MAX_DAYS =
  3660;

/**
 * ============================================================================
 * ERROR
 * ============================================================================
 */

class AdminDashboardRepositoryError extends Error {
  constructor(
    message,
    {
      code = 'ADMIN_DASHBOARD_REPOSITORY_ERROR',
      cause = null,
      details = null,
    } = {},
  ) {
    super(message);

    this.name =
      'AdminDashboardRepositoryError';

    this.code =
      code;

    this.cause =
      cause;

    this.details =
      details;
  }
}

/**
 * ============================================================================
 * VALUE HELPERS
 * ============================================================================
 */

function normalizeString(
  value,
  fallback = null,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const normalized =
    String(value).trim();

  return normalized ||
    fallback;
}

function normalizeLimit(
  value,
  fallback = DEFAULT_LIMIT,
) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    return fallback;
  }

  return Math.min(
    parsed,
    MAX_LIMIT,
  );
}

function normalizeDays(
  value,
) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    return DEFAULT_DAYS;
  }

  return Math.min(
    parsed,
    MAX_DAYS,
  );
}

function toObjectId(
  value,
  fieldName = 'id',
) {
  const normalized =
    normalizeString(value);

  if (!normalized) {
    throw new AdminDashboardRepositoryError(
      `${fieldName} is required.`,
      {
        code:
          `${String(
            fieldName,
          ).toUpperCase()}_REQUIRED`,
      },
    );
  }

  if (
    !mongoose.Types.ObjectId.isValid(
      normalized,
    )
  ) {
    throw new AdminDashboardRepositoryError(
      `${fieldName} must be a valid MongoDB ObjectId.`,
      {
        code:
          `INVALID_${String(
            fieldName,
          ).toUpperCase()}`,
      },
    );
  }

  return new mongoose.Types.ObjectId(
    normalized,
  );
}

function normalizeDate(
  value,
  fieldName,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const date =
    value instanceof Date
      ? new Date(
          value.getTime(),
        )
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new AdminDashboardRepositoryError(
      `Invalid ${fieldName}.`,
      {
        code:
          `INVALID_${String(
            fieldName,
          ).toUpperCase()}`,
      },
    );
  }

  return date;
}

function buildDateRange(
  {
    from = null,
    to = null,
    days = DEFAULT_DAYS,
  } = {},
) {
  const now =
    new Date();

  const resolvedTo =
    normalizeDate(
      to,
      'to',
    ) ||
    now;

  const resolvedFrom =
    normalizeDate(
      from,
      'from',
    ) ||
    new Date(
      resolvedTo.getTime() -
        normalizeDays(days) *
          24 *
          60 *
          60 *
          1000,
    );

  if (
    resolvedFrom >
    resolvedTo
  ) {
    throw new AdminDashboardRepositoryError(
      '`from` cannot be later than `to`.',
      {
        code:
          'INVALID_DATE_RANGE',
      },
    );
  }

  return {
    from:
      resolvedFrom,

    to:
      resolvedTo,
  };
}

function safeNumber(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  if (
    typeof value === 'object' &&
    typeof value.toString ===
      'function'
  ) {
    const numeric =
      Number(
        value.toString(),
      );

    return Number.isFinite(
      numeric,
    )
      ? numeric
      : 0;
  }

  const numeric =
    Number(value);

  return Number.isFinite(
    numeric,
  )
    ? numeric
    : 0;
}

function round(
  value,
  decimals = 2,
) {
  const factor =
    10 ** decimals;

  return (
    Math.round(
      safeNumber(value) *
        factor,
    ) / factor
  );
}

function serializeId(
  value,
) {
  return value
    ? String(value)
    : null;
}

function first(
  value,
) {
  return Array.isArray(value) &&
    value.length > 0
    ? value[0]
    : null;
}

/**
 * ============================================================================
 * REPOSITORY
 * ============================================================================
 */

class AdminDashboardRepository {
  constructor({
    models = {},
  } = {}) {
    this.models = {
      Transaction:
        models.Transaction ||
        Transaction,

      Contribution:
        models.Contribution ||
        Contribution,

      Member:
        models.Member ||
        Member,

      Savings:
        models.Savings ||
        Savings,

      Loan:
        models.Loan ||
        Loan,

      FraudLog:
        models.FraudLog ||
        FraudLog,

      ComplianceLog:
        models.ComplianceLog ||
        ComplianceLog,

      AuditLog:
        models.AuditLog ||
        AuditLog,
    };
  }

  /**
   * ==========================================================================
   * TENANT FILTER FACTORIES
   * ==========================================================================
   */

  objectTenantFilter(
    tenantId,
  ) {
    return {
      tenantId:
        toObjectId(
          tenantId,
          'tenantId',
        ),
    };
  }

  stringTenantFilter(
    tenantId,
  ) {
    const normalized =
      normalizeString(
        tenantId,
      );

    if (!normalized) {
      throw new AdminDashboardRepositoryError(
        'tenantId is required.',
        {
          code:
            'TENANT_ID_REQUIRED',
        },
      );
    }

    return {
      tenantId:
        normalized,
    };
  }

  /**
   * ==========================================================================
   * DASHBOARD DATE CONTEXT
   * ==========================================================================
   */

  normalizeDashboardOptions(
    options = {},
  ) {
    const range =
      buildDateRange(
        options,
      );

    return {
      ...range,

      limit:
        normalizeLimit(
          options.limit,
        ),

      granularity:
        this.resolveGranularity(
          options.granularity,
          range,
        ),
    };
  }

  resolveGranularity(
    granularity,
    range,
  ) {
    if (
      [
        'hour',
        'day',
        'week',
        'month',
      ].includes(
        granularity,
      )
    ) {
      return granularity;
    }

    const diffMs =
      range.to.getTime() -
      range.from.getTime();

    const diffDays =
      diffMs /
      (
        24 *
        60 *
        60 *
        1000
      );

    if (
      diffDays <= 2
    ) {
      return 'hour';
    }

    if (
      diffDays <= 90
    ) {
      return 'day';
    }

    if (
      diffDays <= 365
    ) {
      return 'week';
    }

    return 'month';
  }

  /**
   * ==========================================================================
   * COMPLETE DASHBOARD DATASET
   * ==========================================================================
   *
   * This method is intentionally a repository composition primitive, not a
   * business-service orchestrator.
   * ==========================================================================
   */

  async getDashboardDataset(
    tenantId,
    options = {},
  ) {
    const normalizedTenantId =
      normalizeString(
        tenantId,
      );

    if (!normalizedTenantId) {
      throw new AdminDashboardRepositoryError(
        'tenantId is required.',
        {
          code:
            'TENANT_ID_REQUIRED',
        },
      );
    }

    const normalizedOptions =
      this.normalizeDashboardOptions(
        options,
      );

    const [
      kpis,
      transactions,
      savings,
      contributions,
      loans,
      members,
      risk,
      compliance,
      audit,
      trends,
      recentActivity,
    ] =
      await Promise.all([
        this.getKpis(
          normalizedTenantId,
          normalizedOptions,
        ),

        this.getTransactionSummary(
          normalizedTenantId,
          normalizedOptions,
        ),

        this.getSavingsSummary(
          normalizedTenantId,
        ),

        this.getContributionSummary(
          normalizedTenantId,
          normalizedOptions,
        ),

        this.getLoanSummary(
          normalizedTenantId,
        ),

        this.getMemberSummary(
          normalizedTenantId,
        ),

        this.getRiskSummary(
          normalizedTenantId,
          normalizedOptions,
        ),

        this.getComplianceSummary(
          normalizedTenantId,
          normalizedOptions,
        ),

        this.getAuditSummary(
          normalizedTenantId,
          normalizedOptions,
        ),

        this.getTrends(
          normalizedTenantId,
          normalizedOptions,
        ),

        this.getRecentActivity(
          normalizedTenantId,
          normalizedOptions,
        ),
      ]);

    return {
      repository: {
        name:
          REPOSITORY_NAME,

        version:
          REPOSITORY_VERSION,
      },

      tenantId:
        normalizedTenantId,

      period: {
        from:
          normalizedOptions.from,

        to:
          normalizedOptions.to,

        granularity:
          normalizedOptions.granularity,
      },

      kpis,

      transactions,

      savings,

      contributions,

      loans,

      members,

      risk,

      compliance,

      audit,

      trends,

      recentActivity,

      generatedAt:
        new Date(),
    };
  }

  /**
   * ==========================================================================
   * CORE KPI AGGREGATION
   * ==========================================================================
   */

  async getKpis(
    tenantId,
    options = {},
  ) {
    const normalizedOptions =
      this.normalizeDashboardOptions(
        options,
      );

    const [
      member,
      savings,
      loan,
      transaction,
      contribution,
    ] =
      await Promise.all([
        this.getMemberSummary(
          tenantId,
        ),

        this.getSavingsSummary(
          tenantId,
        ),

        this.getLoanSummary(
          tenantId,
        ),

        this.getTransactionSummary(
          tenantId,
          normalizedOptions,
        ),

        this.getContributionSummary(
          tenantId,
          normalizedOptions,
        ),
      ]);

    return {
      totalMembers:
        member.totalMembers,

      activeMembers:
        member.activeMembers,

      memberGrowth:
        member.newMembersInPeriod,

      totalSavingsBalance:
        savings.totalBalance,

      availableSavingsBalance:
        savings.availableBalance,

      totalDeposits:
        savings.totalDeposits,

      totalWithdrawals:
        savings.totalWithdrawals,

      netSavings:
        savings.netSavings,

      loanPortfolio:
        loan.totalPrincipal,

      loanOutstanding:
        loan.outstandingBalance,

      loanAmountRepaid:
        loan.amountRepaid,

      loanCollectionRate:
        loan.collectionRate,

      loanNplRatio:
        loan.nplRatio,

      transactions:
        transaction.totalCount,

      transactionVolume:
        transaction.totalAmount,

      transactionSuccessRate:
        transaction.successRate,

      transactionFailureRate:
        transaction.failureRate,

      contributions:
        contribution.totalCount,

      contributionVolume:
        contribution.totalAmount,

      kycCompletionRate:
        member.kycCompletionRate,

      amlCompletionRate:
        member.amlCompletionRate,

      sanctionsScreeningRate:
        member.sanctionsScreeningRate,
    };
  }

  /**
   * ==========================================================================
   * TRANSACTION SUMMARY
   * ==========================================================================
   */

  async getTransactionSummary(
    tenantId,
    options = {},
  ) {
    const range =
      buildDateRange(
        options,
      );

    const match = {
      ...this.objectTenantFilter(
        tenantId,
      ),

      createdAt: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    const [
      overall,
      byStatus,
      byType,
      byProvider,
      byFlow,
      byCurrency,
    ] =
      await Promise.all([
        this.models.Transaction.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                null,

              totalCount:
                {
                  $sum: 1,
                },

              totalAmount:
                {
                  $sum:
                    '$amount',
                },

              totalFees:
                {
                  $sum:
                    '$fees',
                },

              totalNetAmount:
                {
                  $sum:
                    '$netAmount',
                },

              successfulCount:
                {
                  $sum: {
                    $cond: [
                      {
                        $in: [
                          '$status',
                          [
                            'SUCCESS',
                            'SETTLED',
                          ],
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              failedCount:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$status',
                          'FAILED',
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },
            },
          },
        ]),

        this.groupTransactions(
          match,
          '$status',
        ),

        this.groupTransactions(
          match,
          '$transactionType',
        ),

        this.groupTransactions(
          match,
          '$provider',
        ),

        this.groupTransactions(
          match,
          '$flow',
        ),

        this.groupTransactions(
          match,
          '$currency',
        ),
      ]);

    const result =
      first(overall) || {};

    return {
      totalCount:
        safeNumber(
          result.totalCount,
        ),

      totalAmount:
        round(
          result.totalAmount,
        ),

      totalFees:
        round(
          result.totalFees,
        ),

      totalNetAmount:
        round(
          result.totalNetAmount,
        ),

      successfulCount:
        safeNumber(
          result.successfulCount,
        ),

      failedCount:
        safeNumber(
          result.failedCount,
        ),

      successRate:
        this.calculatePercentage(
          result.successfulCount,
          result.totalCount,
        ),

      failureRate:
        this.calculatePercentage(
          result.failedCount,
          result.totalCount,
        ),

      byStatus:
        this.normalizeGroupedRows(
          byStatus,
          'status',
        ),

      byType:
        this.normalizeGroupedRows(
          byType,
          'transactionType',
        ),

      byProvider:
        this.normalizeGroupedRows(
          byProvider,
          'provider',
        ),

      byFlow:
        this.normalizeGroupedRows(
          byFlow,
          'flow',
        ),

      byCurrency:
        this.normalizeGroupedRows(
          byCurrency,
          'currency',
        ),
    };
  }

  async groupTransactions(
    match,
    field,
  ) {
    return this.models.Transaction.aggregate([
      {
        $match:
          match,
      },

      {
        $group: {
          _id:
            field,

          count:
            {
              $sum: 1,
            },

          amount:
            {
              $sum:
                '$amount',
            },

          fees:
            {
              $sum:
                '$fees',
            },
        },
      },

      {
        $sort: {
          amount:
            -1,

          count:
            -1,
        },
      },

      {
        $limit:
          100,
      },
    ]);
  }

  /**
   * ==========================================================================
   * SAVINGS SUMMARY
   * ==========================================================================
   */

  async getSavingsSummary(
    tenantId,
  ) {
    const match =
      this.stringTenantFilter(
        tenantId,
      );

    const [
      portfolio,
      byType,
      byStatus,
    ] =
      await Promise.all([
        this.models.Savings.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                null,

              accounts:
                {
                  $sum: 1,
                },

              activeAccounts:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$status',
                          'ACTIVE',
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              totalBalance:
                {
                  $sum:
                    '$balance',
                },

              availableBalance:
                {
                  $sum:
                    '$availableBalance',
                },

              blockedBalance:
                {
                  $sum:
                    '$blockedBalance',
                },

              totalDeposits:
                {
                  $sum:
                    '$totalDeposits',
                },

              totalWithdrawals:
                {
                  $sum:
                    '$totalWithdrawals',
                },

              netSavings:
                {
                  $sum:
                    '$netSavings',
                },

              accruedInterest:
                {
                  $sum:
                    '$accruedInterest',
                },

              dividends:
                {
                  $sum:
                    '$totalDividendsEarned',
                },
            },
          },
        ]),

        this.models.Savings.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$savingsType',

              count:
                {
                  $sum: 1,
                },

              balance:
                {
                  $sum:
                    '$balance',
                },

              netSavings:
                {
                  $sum:
                    '$netSavings',
                },
            },
          },

          {
            $sort: {
              balance:
                -1,
            },
          },
        ]),

        this.models.Savings.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$status',

              count:
                {
                  $sum: 1,
                },

              balance:
                {
                  $sum:
                    '$balance',
                },
            },
          },

          {
            $sort: {
              count:
                -1,
            },
          },
        ]),
      ]);

    const result =
      first(portfolio) || {};

    return {
      accounts:
        safeNumber(
          result.accounts,
        ),

      activeAccounts:
        safeNumber(
          result.activeAccounts,
        ),

      activeRate:
        this.calculatePercentage(
          result.activeAccounts,
          result.accounts,
        ),

      totalBalance:
        round(
          result.totalBalance,
        ),

      availableBalance:
        round(
          result.availableBalance,
        ),

      blockedBalance:
        round(
          result.blockedBalance,
        ),

      totalDeposits:
        round(
          result.totalDeposits,
        ),

      totalWithdrawals:
        round(
          result.totalWithdrawals,
        ),

      netSavings:
        round(
          result.netSavings,
        ),

      accruedInterest:
        round(
          result.accruedInterest,
        ),

      dividends:
        round(
          result.dividends,
        ),

      byType:
        this.normalizeGroupedRows(
          byType,
          'savingsType',
        ),

      byStatus:
        this.normalizeGroupedRows(
          byStatus,
          'status',
        ),
    };
  }

  /**
   * ==========================================================================
   * CONTRIBUTION SUMMARY
   * ==========================================================================
   */

  async getContributionSummary(
    tenantId,
    options = {},
  ) {
    const range =
      buildDateRange(
        options,
      );

    const match = {
      ...this.objectTenantFilter(
        tenantId,
      ),

      isDeleted:
        false,

      date: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    const [
      overall,
      byCurrency,
    ] =
      await Promise.all([
        this.models.Contribution.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                null,

              totalCount:
                {
                  $sum: 1,
                },

              totalAmount:
                {
                  $sum:
                    '$amount',
                },

              averageAmount:
                {
                  $avg:
                    '$amount',
                },
            },
          },
        ]),

        this.models.Contribution.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$currency',

              count:
                {
                  $sum: 1,
                },

              amount:
                {
                  $sum:
                    '$amount',
                },
            },
          },

          {
            $sort: {
              amount:
                -1,
            },
          },
        ]),
      ]);

    const result =
      first(overall) || {};

    return {
      totalCount:
        safeNumber(
          result.totalCount,
        ),

      totalAmount:
        round(
          result.totalAmount,
        ),

      averageAmount:
        round(
          result.averageAmount,
        ),

      byCurrency:
        this.normalizeGroupedRows(
          byCurrency,
          'currency',
        ),
    };
  }

  /**
   * ==========================================================================
   * LOAN SUMMARY
   * ==========================================================================
   */

  async getLoanSummary(
    tenantId,
  ) {
    const match =
      this.stringTenantFilter(
        tenantId,
      );

    const [
      overall,
      byStatus,
      byPurpose,
      byRisk,
    ] =
      await Promise.all([
        this.models.Loan.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                null,

              totalLoans:
                {
                  $sum: 1,
                },

              totalPrincipal:
                {
                  $sum:
                    '$amount',
                },

              outstandingBalance:
                {
                  $sum:
                    '$outstandingBalance',
                },

              amountDue:
                {
                  $sum:
                    '$amountDue',
                },

              amountRepaid:
                {
                  $sum:
                    '$amountRepaid',
                },

              defaultedLoans:
                {
                  $sum: {
                    $cond: [
                      {
                        $in: [
                          '$status',
                          [
                            'defaulted',
                            'written_off',
                          ],
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              defaultedOutstanding:
                {
                  $sum: {
                    $cond: [
                      {
                        $in: [
                          '$status',
                          [
                            'defaulted',
                            'written_off',
                          ],
                        ],
                      },

                      '$outstandingBalance',

                      0,
                    ],
                  },
                },

              amountRecovered:
                {
                  $sum:
                    '$amountRecovered',
                },

              writtenOffAmount:
                {
                  $sum:
                    '$writtenOffAmount',
                },
            },
          },
        ]),

        this.models.Loan.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$status',

              count:
                {
                  $sum: 1,
                },

              principal:
                {
                  $sum:
                    '$amount',
                },

              outstanding:
                {
                  $sum:
                    '$outstandingBalance',
                },
            },
          },

          {
            $sort: {
              count:
                -1,
            },
          },
        ]),

        this.models.Loan.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$purpose',

              count:
                {
                  $sum: 1,
                },

              principal:
                {
                  $sum:
                    '$amount',
                },

              outstanding:
                {
                  $sum:
                    '$outstandingBalance',
                },
            },
          },

          {
            $sort: {
              principal:
                -1,
            },
          },
        ]),

        this.models.Loan.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id: {
                $switch: {
                  branches: [
                    {
                      case: {
                        $gte: [
                          '$riskScore',
                          80,
                        ],
                      },

                      then:
                        'HIGH',
                    },

                    {
                      case: {
                        $gte: [
                          '$riskScore',
                          60,
                        ],
                      },

                      then:
                        'MEDIUM',
                    },
                  ],

                  default:
                    'LOW',
                },
              },

              count:
                {
                  $sum: 1,
                },

              outstanding:
                {
                  $sum:
                    '$outstandingBalance',
                },
            },
          },

          {
            $sort: {
              outstanding:
                -1,
            },
          },
        ]),
      ]);

    const result =
      first(overall) || {};

    return {
      totalLoans:
        safeNumber(
          result.totalLoans,
        ),

      totalPrincipal:
        round(
          result.totalPrincipal,
        ),

      outstandingBalance:
        round(
          result.outstandingBalance,
        ),

      amountDue:
        round(
          result.amountDue,
        ),

      amountRepaid:
        round(
          result.amountRepaid,
        ),

      defaultedLoans:
        safeNumber(
          result.defaultedLoans,
        ),

      defaultedOutstanding:
        round(
          result.defaultedOutstanding,
        ),

      amountRecovered:
        round(
          result.amountRecovered,
        ),

      writtenOffAmount:
        round(
          result.writtenOffAmount,
        ),

      repaymentRate:
        this.calculatePercentage(
          result.amountRepaid,
          result.totalPrincipal,
        ),

      collectionRate:
        this.calculatePercentage(
          result.amountRepaid,
          result.amountDue,
        ),

      nplRatio:
        this.calculatePercentage(
          result.defaultedOutstanding,
          result.outstandingBalance,
        ),

      recoveryRate:
        this.calculatePercentage(
          result.amountRecovered,
          result.writtenOffAmount,
        ),

      byStatus:
        this.normalizeGroupedRows(
          byStatus,
          'status',
        ),

      byPurpose:
        this.normalizeGroupedRows(
          byPurpose,
          'purpose',
        ),

      byRisk:
        this.normalizeGroupedRows(
          byRisk,
          'risk',
        ),
    };
  }

  /**
   * ==========================================================================
   * MEMBER SUMMARY
   * ==========================================================================
   */

  async getMemberSummary(
    tenantId,
    options = {},
  ) {
    const match =
      this.stringTenantFilter(
        tenantId,
      );

    const range =
      buildDateRange(
        options,
      );

    const [
      overall,
      byStatus,
      byKyc,
      growth,
    ] =
      await Promise.all([
        this.models.Member.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                null,

              totalMembers:
                {
                  $sum: 1,
                },

              activeMembers:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$memberStatus',
                          'ACTIVE',
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              dormantMembers:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$memberStatus',
                          'DORMANT',
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              suspendedMembers:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$memberStatus',
                          'SUSPENDED',
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              kycVerified:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$kycVerified',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              amlChecked:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$amlChecked',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              sanctionsScreened:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$sanctionsScreened',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              highRiskMembers:
                {
                  $sum: {
                    $cond: [
                      {
                        $gte: [
                          '$riskScore',
                          80,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              fraudFlagged:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$fraudFlagged',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              blacklisted:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$blacklisted',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              savingsBalance:
                {
                  $sum:
                    '$savingsBalance',
                },

              outstandingLoanBalance:
                {
                  $sum:
                    '$outstandingLoanBalance',
                },
            },
          },
        ]),

        this.models.Member.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$memberStatus',

              count:
                {
                  $sum: 1,
                },
            },
          },

          {
            $sort: {
              count:
                -1,
            },
          },
        ]),

        this.models.Member.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$kycStatus',

              count:
                {
                  $sum: 1,
                },
            },
          },

          {
            $sort: {
              count:
                -1,
            },
          },
        ]),

        this.models.Member.aggregate([
          {
            $match: {
              ...match,

              joinedAt: {
                $gte:
                  range.from,

                $lte:
                  range.to,
              },
            },
          },

          {
            $group: {
              _id: {
                $dateToString: {
                  format:
                    '%Y-%m-%d',

                  date:
                    '$joinedAt',
                },
              },

              newMembers:
                {
                  $sum: 1,
                },
            },
          },

          {
            $sort: {
              _id:
                1,
            },
          },
        ]),
      ]);

    const result =
      first(overall) || {};

    return {
      totalMembers:
        safeNumber(
          result.totalMembers,
        ),

      activeMembers:
        safeNumber(
          result.activeMembers,
        ),

      dormantMembers:
        safeNumber(
          result.dormantMembers,
        ),

      suspendedMembers:
        safeNumber(
          result.suspendedMembers,
        ),

      kycVerified:
        safeNumber(
          result.kycVerified,
        ),

      amlChecked:
        safeNumber(
          result.amlChecked,
        ),

      sanctionsScreened:
        safeNumber(
          result.sanctionsScreened,
        ),

      highRiskMembers:
        safeNumber(
          result.highRiskMembers,
        ),

      fraudFlagged:
        safeNumber(
          result.fraudFlagged,
        ),

      blacklisted:
        safeNumber(
          result.blacklisted,
        ),

      savingsBalance:
        round(
          result.savingsBalance,
        ),

      outstandingLoanBalance:
        round(
          result.outstandingLoanBalance,
        ),

      kycCompletionRate:
        this.calculatePercentage(
          result.kycVerified,
          result.totalMembers,
        ),

      amlCompletionRate:
        this.calculatePercentage(
          result.amlChecked,
          result.totalMembers,
        ),

      sanctionsScreeningRate:
        this.calculatePercentage(
          result.sanctionsScreened,
          result.totalMembers,
        ),

      byStatus:
        this.normalizeGroupedRows(
          byStatus,
          'status',
        ),

      byKyc:
        this.normalizeGroupedRows(
          byKyc,
          'kycStatus',
        ),

      newMembersInPeriod:
        growth.reduce(
          (
            total,
            row,
          ) =>
            total +
            safeNumber(
              row.newMembers,
            ),
          0,
        ),

      growth:
        growth.map(
          (row) => ({
            date:
              row._id,

            newMembers:
              safeNumber(
                row.newMembers,
              ),
          }),
        ),
    };
  }

  /**
   * ==========================================================================
   * RISK SUMMARY
   * ==========================================================================
   */

  async getRiskSummary(
    tenantId,
    options = {},
  ) {
    const range =
      buildDateRange(
        options,
      );

    const [
      memberRisk,
      loanRisk,
      fraudRisk,
    ] =
      await Promise.all([
        this.models.Member.aggregate([
          {
            $match:
              this.stringTenantFilter(
                tenantId,
              ),
          },

          {
            $group: {
              _id:
                null,

              total:
                {
                  $sum: 1,
                },

              highRisk:
                {
                  $sum: {
                    $cond: [
                      {
                        $gte: [
                          '$riskScore',
                          80,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              fraudFlagged:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$fraudFlagged',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              blacklisted:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$blacklisted',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              averageRiskScore:
                {
                  $avg:
                    '$riskScore',
                },
            },
          },
        ]),

        this.models.Loan.aggregate([
          {
            $match:
              this.stringTenantFilter(
                tenantId,
              ),
          },

          {
            $group: {
              _id:
                null,

              total:
                {
                  $sum: 1,
                },

              highRisk:
                {
                  $sum: {
                    $cond: [
                      {
                        $gte: [
                          '$riskScore',
                          80,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              defaulted:
                {
                  $sum: {
                    $cond: [
                      {
                        $in: [
                          '$status',
                          [
                            'defaulted',
                            'written_off',
                          ],
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              outstanding:
                {
                  $sum:
                    '$outstandingBalance',
                },

              averageRiskScore:
                {
                  $avg:
                    '$riskScore',
                },
            },
          },
        ]),

        this.models.FraudLog.aggregate([
          {
            $match: {
              ...this.stringTenantFilter(
                tenantId,
              ),

              createdAt: {
                $gte:
                  range.from,

                $lte:
                  range.to,
              },
            },
          },

          {
            $group: {
              _id:
                null,

              total:
                {
                  $sum: 1,
                },

              blocked:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$decision',
                          'BLOCK',
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              stepUp:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$decision',
                          'STEP_UP',
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              unreviewed:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$reviewed',
                          false,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              averageScore:
                {
                  $avg:
                    '$fraudScore',
                },
            },
          },
        ]),
      ]);

    const members =
      first(memberRisk) || {};

    const loans =
      first(loanRisk) || {};

    const fraud =
      first(fraudRisk) || {};

    return {
      members: {
        total:
          safeNumber(
            members.total,
          ),

        highRisk:
          safeNumber(
            members.highRisk,
          ),

        fraudFlagged:
          safeNumber(
            members.fraudFlagged,
          ),

        blacklisted:
          safeNumber(
            members.blacklisted,
          ),

        averageRiskScore:
          round(
            members.averageRiskScore,
          ),
      },

      loans: {
        total:
          safeNumber(
            loans.total,
          ),

        highRisk:
          safeNumber(
            loans.highRisk,
          ),

        defaulted:
          safeNumber(
            loans.defaulted,
          ),

        defaultRate:
          this.calculatePercentage(
            loans.defaulted,
            loans.total,
          ),

        outstanding:
          round(
            loans.outstanding,
          ),

        averageRiskScore:
          round(
            loans.averageRiskScore,
          ),
      },

      fraud: {
        total:
          safeNumber(
            fraud.total,
          ),

        blocked:
          safeNumber(
            fraud.blocked,
          ),

        stepUp:
          safeNumber(
            fraud.stepUp,
          ),

        unreviewed:
          safeNumber(
            fraud.unreviewed,
          ),

        blockRate:
          this.calculatePercentage(
            fraud.blocked,
            fraud.total,
          ),

        reviewRate:
          this.calculatePercentage(
            safeNumber(
              fraud.total,
            ) -
              safeNumber(
                fraud.unreviewed,
              ),
            fraud.total,
          ),

        averageScore:
          round(
            fraud.averageScore,
            4,
          ),
      },
    };
  }

  /**
   * ==========================================================================
   * COMPLIANCE SUMMARY
   * ==========================================================================
   */

  async getComplianceSummary(
    tenantId,
    options = {},
  ) {
    const range =
      buildDateRange(
        options,
      );

    const [
      memberCompliance,
      complianceLogs,
    ] =
      await Promise.all([
        this.models.Member.aggregate([
          {
            $match:
              this.stringTenantFilter(
                tenantId,
              ),
          },

          {
            $group: {
              _id:
                null,

              total:
                {
                  $sum: 1,
                },

              kycVerified:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$kycVerified',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              amlChecked:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$amlChecked',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              sanctionsScreened:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$sanctionsScreened',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              blacklisted:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$blacklisted',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },
            },
          },
        ]),

        this.models.ComplianceLog.aggregate([
          {
            $match: {
              ...this.stringTenantFilter(
                tenantId,
              ),

              createdAt: {
                $gte:
                  range.from,

                $lte:
                  range.to,
              },
            },
          },

          {
            $group: {
              _id:
                null,

              total:
                {
                  $sum: 1,
                },

              flagged:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$flagged',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              unresolved:
                {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              '$flagged',
                              true,
                            ],
                          },

                          {
                            $eq: [
                              '$resolved',
                              false,
                            ],
                          },
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              resolved:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$resolved',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },
            },
          },
        ]),
      ]);

    const members =
      first(memberCompliance) || {};

    const logs =
      first(complianceLogs) || {};

    return {
      members: {
        total:
          safeNumber(
            members.total,
          ),

        kycVerified:
          safeNumber(
            members.kycVerified,
          ),

        amlChecked:
          safeNumber(
            members.amlChecked,
          ),

        sanctionsScreened:
          safeNumber(
            members.sanctionsScreened,
          ),

        blacklisted:
          safeNumber(
            members.blacklisted,
          ),

        kycRate:
          this.calculatePercentage(
            members.kycVerified,
            members.total,
          ),

        amlRate:
          this.calculatePercentage(
            members.amlChecked,
            members.total,
          ),

        sanctionsScreeningRate:
          this.calculatePercentage(
            members.sanctionsScreened,
            members.total,
          ),
      },

      activity: {
        total:
          safeNumber(
            logs.total,
          ),

        flagged:
          safeNumber(
            logs.flagged,
          ),

        unresolved:
          safeNumber(
            logs.unresolved,
          ),

        resolved:
          safeNumber(
            logs.resolved,
          ),

        flagRate:
          this.calculatePercentage(
            logs.flagged,
            logs.total,
          ),

        resolutionRate:
          this.calculatePercentage(
            logs.resolved,
            logs.flagged,
          ),
      },
    };
  }

  /**
   * ==========================================================================
   * AUDIT SUMMARY
   * ==========================================================================
   */

  async getAuditSummary(
    tenantId,
    options = {},
  ) {
    const range =
      buildDateRange(
        options,
      );

    const match = {
      ...this.objectTenantFilter(
        tenantId,
      ),

      createdAt: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    const [
      overall,
      byAction,
      byEntityType,
    ] =
      await Promise.all([
        this.models.AuditLog.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                null,

              total:
                {
                  $sum: 1,
                },

              users:
                {
                  $addToSet:
                    '$userId',
                },

              actions:
                {
                  $addToSet:
                    '$action',
                },
            },
          },
        ]),

        this.models.AuditLog.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$action',

              count:
                {
                  $sum: 1,
                },
            },
          },

          {
            $sort: {
              count:
                -1,
            },
          },

          {
            $limit:
              50,
          },
        ]),

        this.models.AuditLog.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$entityType',

              count:
                {
                  $sum: 1,
                },
            },
          },

          {
            $sort: {
              count:
                -1,
            },
          },

          {
            $limit:
              50,
          },
        ]),
      ]);

    const result =
      first(overall) || {};

    return {
      total:
        safeNumber(
          result.total,
        ),

      distinctUsers:
        Array.isArray(
          result.users,
        )
          ? result.users.length
          : 0,

      distinctActions:
        Array.isArray(
          result.actions,
        )
          ? result.actions.length
          : 0,

      byAction:
        byAction.map(
          (row) => ({
            action:
              row._id,

            count:
              safeNumber(
                row.count,
              ),
          }),
        ),

      byEntityType:
        byEntityType.map(
          (row) => ({
            entityType:
              row._id,

            count:
              safeNumber(
                row.count,
              ),
          }),
        ),
    };
  }

  /**
   * ==========================================================================
   * TIME-SERIES DASHBOARD TRENDS
   * ==========================================================================
   */

  async getTrends(
    tenantId,
    options = {},
  ) {
    const normalized =
      this.normalizeDashboardOptions(
        options,
      );

    const range =
      normalized;

    const transactionMatch = {
      ...this.objectTenantFilter(
        tenantId,
      ),

      createdAt: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    const contributionMatch = {
      ...this.objectTenantFilter(
        tenantId,
      ),

      isDeleted:
        false,

      date: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    const memberMatch = {
      ...this.stringTenantFilter(
        tenantId,
      ),

      joinedAt: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    const loanMatch = {
      ...this.stringTenantFilter(
        tenantId,
      ),

      createdAt: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    const [
      transactions,
      contributions,
      members,
      loans,
    ] =
      await Promise.all([
        this.getTransactionTrend(
          transactionMatch,
          range.granularity,
        ),

        this.getContributionTrend(
          contributionMatch,
          range.granularity,
        ),

        this.getMemberTrend(
          memberMatch,
          range.granularity,
        ),

        this.getLoanTrend(
          loanMatch,
          range.granularity,
        ),
      ]);

    return {
      granularity:
        range.granularity,

      transactions,

      contributions,

      members,

      loans,
    };
  }

  async getTransactionTrend(
    match,
    granularity,
  ) {
    const dateExpression =
      this.dateBucketExpression(
        '$createdAt',
        granularity,
      );

    return this.models.Transaction.aggregate([
      {
        $match:
          match,
      },

      {
        $group: {
          _id:
            dateExpression,

          count:
            {
              $sum: 1,
            },

          amount:
            {
              $sum:
                '$amount',
            },

          successful:
            {
              $sum: {
                $cond: [
                  {
                    $in: [
                      '$status',
                      [
                        'SUCCESS',
                        'SETTLED',
                      ],
                    ],
                  },

                  1,

                  0,
                ],
              },
            },

          failed:
            {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      '$status',
                      'FAILED',
                    ],
                  },

                  1,

                  0,
                ],
              },
            },
        },
      },

      {
        $sort: {
          _id:
            1,
        },
      },
    ]);
  }

  async getContributionTrend(
    match,
    granularity,
  ) {
    const dateExpression =
      this.dateBucketExpression(
        '$date',
        granularity,
      );

    return this.models.Contribution.aggregate([
      {
        $match:
          match,
      },

      {
        $group: {
          _id:
            dateExpression,

          count:
            {
              $sum: 1,
            },

          amount:
            {
              $sum:
                '$amount',
            },
        },
      },

      {
        $sort: {
          _id:
            1,
        },
      },
    ]);
  }

  async getMemberTrend(
    match,
    granularity,
  ) {
    const dateExpression =
      this.dateBucketExpression(
        '$joinedAt',
        granularity,
      );

    return this.models.Member.aggregate([
      {
        $match:
          match,
      },

      {
        $group: {
          _id:
            dateExpression,

          count:
            {
              $sum: 1,
            },
        },
      },

      {
        $sort: {
          _id:
            1,
        },
      },
    ]);
  }

  async getLoanTrend(
    match,
    granularity,
  ) {
    const dateExpression =
      this.dateBucketExpression(
        '$createdAt',
        granularity,
      );

    return this.models.Loan.aggregate([
      {
        $match:
          match,
      },

      {
        $group: {
          _id:
            dateExpression,

          count:
            {
              $sum: 1,
            },

          requested:
            {
              $sum:
                '$amount',
            },

          outstanding:
            {
              $sum:
                '$outstandingBalance',
            },
        },
      },

      {
        $sort: {
          _id:
            1,
        },
      },
    ]);
  }

  /**
   * ==========================================================================
   * DATE BUCKET EXPRESSION
   * ==========================================================================
   */

  dateBucketExpression(
    field,
    granularity,
  ) {
    if (
      granularity ===
      'hour'
    ) {
      return {
        $dateToString: {
          format:
            '%Y-%m-%dT%H:00:00.000Z',

          date:
            field,
        },
      };
    }

    if (
      granularity ===
      'week'
    ) {
      return {
        $dateToString: {
          format:
            '%G-W%V',

          date:
            field,
        },
      };
    }

    if (
      granularity ===
      'month'
    ) {
      return {
        $dateToString: {
          format:
            '%Y-%m',

          date:
            field,
        },
      };
    }

    return {
      $dateToString: {
        format:
          '%Y-%m-%d',

        date:
          field,
      },
    };
  }

  /**
   * ==========================================================================
   * RECENT TRANSACTIONS
   * ==========================================================================
   */

  async getRecentTransactions(
    tenantId,
    options = {},
  ) {
    const limit =
      normalizeLimit(
        options.limit,
      );

    const range =
      buildDateRange(
        options,
      );

    const filter = {
      ...this.objectTenantFilter(
        tenantId,
      ),

      createdAt: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    return this.models.Transaction
      .find(filter)
      .select(
        [
          '_id',
          'userId',
          'groupId',
          'loanId',
          'contributionId',
          'transactionType',
          'flow',
          'provider',
          'amount',
          'currency',
          'fees',
          'netAmount',
          'status',
          'reconciled',
          'accountingPosted',
          'externalId',
          'providerReferenceId',
          'createdAt',
        ].join(' '),
      )
      .sort({
        createdAt:
          -1,

        _id:
          -1,
      })
      .limit(
        limit,
      )
      .lean();
  }

  /**
   * ==========================================================================
   * RECENT AUDIT ACTIVITY
   * ==========================================================================
   */

  async getRecentAuditEvents(
    tenantId,
    options = {},
  ) {
    const limit =
      normalizeLimit(
        options.limit,
      );

    const range =
      buildDateRange(
        options,
      );

    return this.models.AuditLog
      .find({
        ...this.objectTenantFilter(
          tenantId,
        ),

        createdAt: {
          $gte:
            range.from,

          $lte:
            range.to,
        },
      })
      .select(
        [
          '_id',
          'action',
          'userId',
          'tenantId',
          'entityType',
          'entityId',
          'createdAt',
        ].join(' '),
      )
      .sort({
        createdAt:
          -1,

        _id:
          -1,
      })
      .limit(
        limit,
      )
      .lean();
  }

  /**
   * ==========================================================================
   * RECENT FRAUD ALERTS
   * ==========================================================================
   */

  async getRecentFraudAlerts(
    tenantId,
    options = {},
  ) {
    const limit =
      normalizeLimit(
        options.limit,
      );

    const range =
      buildDateRange(
        options,
      );

    return this.models.FraudLog
      .find({
        ...this.stringTenantFilter(
          tenantId,
        ),

        createdAt: {
          $gte:
            range.from,

          $lte:
            range.to,
        },
      })
      .select(
        [
          '_id',
          'userId',
          'transactionId',
          'fraudScore',
          'decision',
          'reviewed',
          'engine',
          'modelVersion',
          'createdAt',
        ].join(' '),
      )
      .sort({
        createdAt:
          -1,

        _id:
          -1,
      })
      .limit(
        limit,
      )
      .lean();
  }

  /**
   * ==========================================================================
   * RECENT COMPLIANCE ALERTS
   * ==========================================================================
   */

  async getRecentComplianceAlerts(
    tenantId,
    options = {},
  ) {
    const limit =
      normalizeLimit(
        options.limit,
      );

    const range =
      buildDateRange(
        options,
      );

    return this.models.ComplianceLog
      .find({
        ...this.stringTenantFilter(
          tenantId,
        ),

        flagged:
          true,

        resolved:
          false,

        createdAt: {
          $gte:
            range.from,

          $lte:
            range.to,
        },
      })
      .select(
        [
          '_id',
          'userId',
          'activity',
          'flagged',
          'reason',
          'reportId',
          'resolved',
          'createdAt',
        ].join(' '),
      )
      .sort({
        createdAt:
          -1,

        _id:
          -1,
      })
      .limit(
        limit,
      )
      .lean();
  }

  /**
   * ==========================================================================
   * RECENT ACTIVITY
   * ==========================================================================
   */

  async getRecentActivity(
    tenantId,
    options = {},
  ) {
    const limit =
      normalizeLimit(
        options.limit,
      );

    const [
      transactions,
      audit,
      fraud,
      compliance,
    ] =
      await Promise.all([
        this.getRecentTransactions(
          tenantId,
          {
            ...options,
            limit,
          },
        ),

        this.getRecentAuditEvents(
          tenantId,
          {
            ...options,
            limit,
          },
        ),

        this.getRecentFraudAlerts(
          tenantId,
          {
            ...options,
            limit,
          },
        ),

        this.getRecentComplianceAlerts(
          tenantId,
          {
            ...options,
            limit,
          },
        ),
      ]);

    return {
      transactions:
        transactions.map(
          (row) => ({
            id:
              serializeId(
                row._id,
              ),

            type:
              'transaction',

            transactionType:
              row.transactionType,

            flow:
              row.flow,

            provider:
              row.provider,

            amount:
              safeNumber(
                row.amount,
              ),

            currency:
              row.currency,

            status:
              row.status,

            userId:
              serializeId(
                row.userId,
              ),

            groupId:
              serializeId(
                row.groupId,
              ),

            loanId:
              serializeId(
                row.loanId,
              ),

            createdAt:
              row.createdAt,
          }),
        ),

      audit:
        audit.map(
          (row) => ({
            id:
              serializeId(
                row._id,
              ),

            type:
              'audit',

            action:
              row.action,

            userId:
              serializeId(
                row.userId,
              ),

            entityType:
              row.entityType,

            entityId:
              serializeId(
                row.entityId,
              ),

            createdAt:
              row.createdAt,
          }),
        ),

      fraud:
        fraud.map(
          (row) => ({
            id:
              serializeId(
                row._id,
              ),

            type:
              'fraud',

            userId:
              serializeId(
                row.userId,
              ),

            transactionId:
              serializeId(
                row.transactionId,
              ),

            fraudScore:
              safeNumber(
                row.fraudScore,
              ),

            decision:
              row.decision,

            reviewed:
              Boolean(
                row.reviewed,
              ),

            createdAt:
              row.createdAt,
          }),
        ),

      compliance:
        compliance.map(
          (row) => ({
            id:
              serializeId(
                row._id,
              ),

            type:
              'compliance',

            userId:
              serializeId(
                row.userId,
              ),

            activity:
              row.activity,

            reason:
              row.reason,

            reportId:
              row.reportId,

            flagged:
              Boolean(
                row.flagged,
              ),

            resolved:
              Boolean(
                row.resolved,
              ),

            createdAt:
              row.createdAt,
          }),
        ),
    };
  }

  /**
   * ==========================================================================
   * DASHBOARD RECENT ACTIVITY PAGINATION
   * ==========================================================================
   *
   * Generic deterministic transaction pagination primitive.
   *
   * Cursor:
   *   {
   *     createdAt,
   *     id
   *   }
   *
   * The service/controller can encode/decode the cursor.
   * ==========================================================================
   */

  async findRecentTransactionsPage(
    tenantId,
    {
      from = null,
      to = null,
      limit = DEFAULT_LIMIT,
      cursor = null,
      status = null,
      transactionType = null,
    } = {},
  ) {
    const safeLimit =
      normalizeLimit(
        limit,
      );

    const range =
      buildDateRange({
        from,
        to,
      });

    const filter = {
      ...this.objectTenantFilter(
        tenantId,
      ),

      createdAt: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    if (status) {
      filter.status =
        status;
    }

    if (
      transactionType
    ) {
      filter.transactionType =
        transactionType;
    }

    if (
      cursor &&
      cursor.createdAt &&
      cursor.id
    ) {
      const cursorDate =
        normalizeDate(
          cursor.createdAt,
          'cursor.createdAt',
        );

      const cursorId =
        toObjectId(
          cursor.id,
          'cursor.id',
        );

      filter.$or = [
        {
          createdAt: {
            $lt:
              cursorDate,
          },
        },

        {
          createdAt:
            cursorDate,

          _id: {
            $lt:
              cursorId,
          },
        },
      ];
    }

    const documents =
      await this.models.Transaction
        .find(filter)
        .select(
          [
            '_id',
            'userId',
            'groupId',
            'loanId',
            'transactionType',
            'flow',
            'provider',
            'amount',
            'currency',
            'fees',
            'netAmount',
            'status',
            'createdAt',
          ].join(' '),
        )
        .sort({
          createdAt:
            -1,

          _id:
            -1,
        })
        .limit(
          safeLimit + 1,
        )
        .lean();

    const hasNextPage =
      documents.length >
      safeLimit;

    const page =
      hasNextPage
        ? documents.slice(
            0,
            safeLimit,
          )
        : documents;

    const last =
      page[
        page.length - 1
      ];

    return {
      items:
        page,

      pageSize:
        safeLimit,

      hasNextPage,

      nextCursor:
        hasNextPage &&
        last
          ? {
              createdAt:
                last.createdAt,

              id:
                serializeId(
                  last._id,
                ),
            }
          : null,
    };
  }

  /**
   * ==========================================================================
   * REPOSITORY HEALTH
   * ==========================================================================
   */

  async health() {
    const models =
      this.models;

    const checks =
      {};

    for (
      const [
        name,
        model,
      ] of Object.entries(
        models,
      )
    ) {
      checks[name] =
        Boolean(
          model &&
            model.db &&
            model.db.readyState ===
              1,
        );
    }

    const healthy =
      Object.values(
        checks,
      ).every(Boolean);

    return {
      repository:
        REPOSITORY_NAME,

      version:
        REPOSITORY_VERSION,

      healthy,

      checks,

      timestamp:
        new Date(),
    };
  }

  /**
   * ==========================================================================
   * INTERNAL GROUPING HELPERS
   * ==========================================================================
   */

  normalizeGroupedRows(
    rows,
    label,
  ) {
    return rows.map(
      (row) => ({
        [label]:
          row._id,

        count:
          safeNumber(
            row.count,
          ),

        amount:
          round(
            row.amount,
          ),

        fees:
          round(
            row.fees,
          ),

        balance:
          round(
            row.balance,
          ),

        netSavings:
          round(
            row.netSavings,
          ),

        principal:
          round(
            row.principal,
          ),

        outstanding:
          round(
            row.outstanding,
          ),
      }),
    );
  }

  calculatePercentage(
    numerator,
    denominator,
  ) {
    const top =
      safeNumber(
        numerator,
      );

    const bottom =
      safeNumber(
        denominator,
      );

    if (
      bottom === 0
    ) {
      return 0;
    }

    return round(
      (
        top /
        bottom
      ) *
        100,
    );
  }

  /**
   * ==========================================================================
   * SAFE EXECUTION WRAPPER
   * ==========================================================================
   */

  async execute(
    operation,
    fn,
    context = {},
  ) {
    if (
      typeof fn !==
      'function'
    ) {
      throw new AdminDashboardRepositoryError(
        `${operation} requires a function.`,
        {
          code:
            'INVALID_REPOSITORY_OPERATION',
        },
      );
    }

    try {
      return await fn();
    } catch (error) {
      throw this.wrapError(
        error,
        operation,
        context,
      );
    }
  }

  wrapError(
    error,
    operation,
    context = {},
  ) {
    if (
      error instanceof
      AdminDashboardRepositoryError
    ) {
      return error;
    }

    return new AdminDashboardRepositoryError(
      `Admin dashboard repository operation failed: ${operation}.`,
      {
        code:
          'ADMIN_DASHBOARD_DATABASE_ERROR',

        cause:
          error,

        details:
          {
            operation,
            ...context,
          },
      },
    );
  }
}

/**
 * ============================================================================
 * SINGLETON
 * ============================================================================
 */

const adminDashboardRepository =
  new AdminDashboardRepository();

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  adminDashboardRepository;

module.exports.AdminDashboardRepository =
  AdminDashboardRepository;

module.exports.AdminDashboardRepositoryError =
  AdminDashboardRepositoryError;

module.exports.REPOSITORY_NAME =
  REPOSITORY_NAME;

module.exports.REPOSITORY_VERSION =
  REPOSITORY_VERSION;