// backend/modules/executiveDashboardService.js
'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Executive Dashboard Service
 * ============================================================================
 *
 * File:
 *   backend/modules/executiveDashboardService.js
 *
 * Purpose:
 *   Enterprise executive/business intelligence aggregation service for:
 *
 *   - Financial performance
 *   - Customer growth
 *   - Loan portfolio
 *   - Savings
 *   - Mobile money
 *   - Fraud
 *   - AML
 *   - KYC
 *   - SaaS subscriptions
 *   - Compliance
 *   - Platform/system health
 *
 * Design principles:
 *
 *   - Multi-tenant isolation
 *   - Read-only analytics
 *   - No direct financial mutations
 *   - Graceful degradation
 *   - Cache-first reads
 *   - Cache stampede protection
 *   - Bounded database queries
 *   - Structured observability
 *   - Auditability
 *   - Configurable thresholds
 *   - Production-safe exports
 *   - Backward-compatible service interfaces
 *
 * ============================================================================
 */

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const SERVICE_NAME =
  'executive-dashboard-service';

const DASHBOARD_VERSION =
  '2.0.0';

const DEFAULT_CACHE_TTL =
  300;

const DEFAULT_SNAPSHOT_RETENTION_DAYS =
  365;

const DEFAULT_LOOKBACK_DAYS =
  30;

const DEFAULT_SNAPSHOT_LIMIT =
  30;

const MAX_SNAPSHOT_LIMIT =
  365;

const DEFAULT_TIMEOUT_MS =
  15000;

const DEFAULT_RISK_THRESHOLDS = {
  fraudAlerts: 10,
  amlAlerts: 10,
  amlOpenCases: 5,
  kycPending: 50,
  overdueLoanRatio: 0.1,
};

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

/**
 * Safely convert a value to a finite number.
 */
function toNumber(value, fallback = 0) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

/**
 * Safely convert an aggregate result to a number.
 */
function aggregateTotal(
  result,
  field = 'total'
) {
  if (!Array.isArray(result)) {
    return 0;
  }

  return toNumber(
    result[0]?.[field],
    0
  );
}

/**
 * Safely calculate a ratio.
 */
function ratio(
  numerator,
  denominator
) {
  const n =
    toNumber(numerator);

  const d =
    toNumber(denominator);

  if (d <= 0) {
    return 0;
  }

  return n / d;
}

/**
 * Safely calculate a percentage.
 */
function percentage(
  numerator,
  denominator
) {
  return Number(
    (
      ratio(
        numerator,
        denominator
      ) * 100
    ).toFixed(2)
  );
}

/**
 * Return a Date representing N days ago.
 */
function daysAgo(days) {
  return new Date(
    Date.now() -
      Number(days) *
        24 *
        60 *
        60 *
        1000
  );
}

/**
 * Return a stable tenant-aware cache key.
 */
function buildCacheKey(
  tenantId,
  namespace = 'dashboard'
) {
  return [
    namespace,
    DASHBOARD_VERSION,
    String(tenantId),
  ].join(':');
}

/**
 * Detect whether a database collection/repository is available.
 */
function hasCollection(
  db,
  name
) {
  return Boolean(
    db &&
      db[name] &&
      typeof db[name] === 'object'
  );
}

/**
 * ============================================================================
 * Service
 * ============================================================================
 */

class ExecutiveDashboardService extends EventEmitter {
  constructor({
    db,
    cache,
    logger,
    queueService,
    auditService,
    metricsService,

    tenantBillingService,
    subscriptionService,
    customerService,
    loanAccountingService,
    savingsAccountingService,
    mobileMoneySettlementService,
    fraudDetectionService,
    amlService,
    kycService,
    riskScoringService,
    regulatoryReportingService,

    config = {},
  } = {}) {
    super();

    if (!db) {
      throw new TypeError(
        'ExecutiveDashboardService requires db.'
      );
    }

    this.db =
      db;

    this.cache =
      cache;

    this.logger =
      logger || console;

    this.queueService =
      queueService;

    this.auditService =
      auditService;

    this.metricsService =
      metricsService;

    this.tenantBillingService =
      tenantBillingService;

    this.subscriptionService =
      subscriptionService;

    this.customerService =
      customerService;

    this.loanAccountingService =
      loanAccountingService;

    this.savingsAccountingService =
      savingsAccountingService;

    this.mobileMoneySettlementService =
      mobileMoneySettlementService;

    this.fraudDetectionService =
      fraudDetectionService;

    this.amlService =
      amlService;

    this.kycService =
      kycService;

    this.riskScoringService =
      riskScoringService;

    this.regulatoryReportingService =
      regulatoryReportingService;

    this.config = {
      cacheTtl:
        DEFAULT_CACHE_TTL,

      snapshotRetentionDays:
        DEFAULT_SNAPSHOT_RETENTION_DAYS,

      lookbackDays:
        DEFAULT_LOOKBACK_DAYS,

      snapshotLimit:
        DEFAULT_SNAPSHOT_LIMIT,

      maxSnapshotLimit:
        MAX_SNAPSHOT_LIMIT,

      timeoutMs:
        DEFAULT_TIMEOUT_MS,

      dashboardVersion:
        DASHBOARD_VERSION,

      riskThresholds:
        {
          ...DEFAULT_RISK_THRESHOLDS,
        },

      failSoft:
        true,

      enableAudit:
        true,

      enableMetrics:
        true,

      ...config,
    };

    this._generationLocks =
      new Map();
  }

  /**
   * ==========================================================================
   * Dashboard API
   * ==========================================================================
   */

  async getDashboard(
    tenantId,
    options = {}
  ) {
    this.assertTenantId(
      tenantId
    );

    const {
      forceRefresh = false,
      requestId =
        crypto.randomUUID(),
    } = options;

    const cacheKey =
      buildCacheKey(
        tenantId
      );

    if (
      !forceRefresh &&
      this.cache
    ) {
      const cached =
        await this.safeCacheGet(
          cacheKey
        );

      if (cached) {
        await this.recordMetric(
          'dashboard.cache.hit',
          1,
          {
            tenantId,
          }
        );

        return cached;
      }

      await this.recordMetric(
        'dashboard.cache.miss',
        1,
        {
          tenantId,
        }
      );
    }

    /**
     * Prevent multiple concurrent dashboard generations for
     * the same tenant.
     */
    if (
      this._generationLocks.has(
        tenantId
      )
    ) {
      return this._generationLocks.get(
        tenantId
      );
    }

    const generationPromise =
      this.withTimeout(
        this.buildDashboard(
          tenantId,
          {
            requestId,
          }
        ),
        this.config.timeoutMs,
        'Dashboard generation timed out.'
      );

    this._generationLocks.set(
      tenantId,
      generationPromise
    );

    try {
      const dashboard =
        await generationPromise;

      if (this.cache) {
        await this.safeCacheSet(
          cacheKey,
          dashboard,
          this.config.cacheTtl
        );
      }

      await this.audit(
        tenantId,
        'EXECUTIVE_DASHBOARD_VIEWED',
        {
          requestId,
          generatedAt:
            dashboard.generatedAt,
        }
      );

      return dashboard;
    } catch (error) {
      this.logError(
        'Dashboard generation failed',
        error,
        {
          tenantId,
          requestId,
        }
      );

      await this.recordMetric(
        'dashboard.generation.error',
        1,
        {
          tenantId,
        }
      );

      throw error;
    } finally {
      this._generationLocks.delete(
        tenantId
      );
    }
  }

  /**
   * ==========================================================================
   * Dashboard Builder
   * ==========================================================================
   */

  async buildDashboard(
    tenantId,
    options = {}
  ) {
    this.assertTenantId(
      tenantId
    );

    const startedAt =
      Date.now();

    const generatedAt =
      new Date();

    const requestId =
      options.requestId ||
      crypto.randomUUID();

    const results =
      await Promise.all([
        this.safeSection(
          'financial',
          () =>
            this.getFinancialMetrics(
              tenantId
            )
        ),

        this.safeSection(
          'customers',
          () =>
            this.getCustomerMetrics(
              tenantId
            )
        ),

        this.safeSection(
          'loans',
          () =>
            this.getLoanMetrics(
              tenantId
            )
        ),

        this.safeSection(
          'savings',
          () =>
            this.getSavingsMetrics(
              tenantId
            )
        ),

        this.safeSection(
          'mobileMoney',
          () =>
            this.getMobileMoneyMetrics(
              tenantId
            )
        ),

        this.safeSection(
          'fraud',
          () =>
            this.getFraudMetrics(
              tenantId
            )
        ),

        this.safeSection(
          'aml',
          () =>
            this.getAMLAnalytics(
              tenantId
            )
        ),

        this.safeSection(
          'kyc',
          () =>
            this.getKYCMetrics(
              tenantId
            )
        ),

        this.safeSection(
          'subscriptions',
          () =>
            this.getSubscriptionMetrics(
              tenantId
            )
        ),

        this.safeSection(
          'compliance',
          () =>
            this.getComplianceMetrics(
              tenantId
            )
        ),

        this.safeSection(
          'system',
          () =>
            this.getSystemMetrics()
        ),
      ]);

    const [
      financial,
      customers,
      loans,
      savings,
      mobileMoney,
      fraud,
      aml,
      kyc,
      subscriptions,
      compliance,
      system,
    ] = results;

    const dashboard = {
      dashboardVersion:
        this.config
          .dashboardVersion,

      service:
        SERVICE_NAME,

      tenantId,

      requestId,

      generatedAt,

      generationDurationMs:
        Date.now() -
        startedAt,

      financial,

      customers,

      loans,

      savings,

      mobileMoney,

      fraud,

      aml,

      kyc,

      subscriptions,

      compliance,

      system,

      health:
        this.calculateDashboardHealth(
          {
            financial,
            customers,
            loans,
            savings,
            mobileMoney,
            fraud,
            aml,
            kyc,
            subscriptions,
            compliance,
            system,
          }
        ),
    };

    await this.recordMetric(
      'dashboard.generated',
      1,
      {
        tenantId,
      }
    );

    this.emit(
      'dashboard.generated',
      dashboard
    );

    return dashboard;
  }

  /**
   * ==========================================================================
   * Financial Metrics
   * ==========================================================================
   */

  async getFinancialMetrics(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    if (
      !hasCollection(
        this.db,
        'payments'
      )
    ) {
      return this.sectionUnavailable(
        'payments'
      );
    }

    const paymentMatch = {
      tenantId,
      status: 'paid',
    };

    const expenseMatch = {
      tenantId,
    };

    const assetMatch = {
      tenantId,
      type: 'asset',
    };

    const liabilityMatch = {
      tenantId,
      type: 'liability',
    };

    const [
      revenue,
      expenses,
      assets,
      liabilities,
    ] =
      await Promise.all([
        this.db.payments.aggregate([
          {
            $match:
              paymentMatch,
          },
          {
            $group: {
              _id: null,
              total: {
                $sum:
                  '$amount',
              },
            },
          },
        ]),

        hasCollection(
          this.db,
          'expenses'
        )
          ? this.db.expenses.aggregate([
              {
                $match:
                  expenseMatch,
              },
              {
                $group: {
                  _id: null,
                  total: {
                    $sum:
                      '$amount',
                  },
                },
              },
            ])
          : [],

        hasCollection(
          this.db,
          'accounts'
        )
          ? this.db.accounts.aggregate([
              {
                $match:
                  assetMatch,
              },
              {
                $group: {
                  _id: null,
                  total: {
                    $sum:
                      '$balance',
                  },
                },
              },
            ])
          : [],

        hasCollection(
          this.db,
          'accounts'
        )
          ? this.db.accounts.aggregate([
              {
                $match:
                  liabilityMatch,
              },
              {
                $group: {
                  _id: null,
                  total: {
                    $sum:
                      '$balance',
                  },
                },
              },
            ])
          : [],
      ]);

    const revenueTotal =
      aggregateTotal(
        revenue
      );

    const expensesTotal =
      aggregateTotal(
        expenses
      );

    const assetsTotal =
      aggregateTotal(
        assets
      );

    const liabilitiesTotal =
      aggregateTotal(
        liabilities
      );

    return {
      revenue:
        revenueTotal,

      expenses:
        expensesTotal,

      netIncome:
        revenueTotal -
        expensesTotal,

      assets:
        assetsTotal,

      liabilities:
        liabilitiesTotal,

      equity:
        assetsTotal -
        liabilitiesTotal,

      expenseRatio:
        percentage(
          expensesTotal,
          revenueTotal
        ),

      netMargin:
        percentage(
          revenueTotal -
            expensesTotal,
          revenueTotal
        ),

      accountingBalanceCheck:
        Number(
          (
            assetsTotal -
            liabilitiesTotal -
            (
              assetsTotal -
              liabilitiesTotal
            )
          ).toFixed(2)
        ),
    };
  }

  /**
   * ==========================================================================
   * Customer Analytics
   * ==========================================================================
   */

  async getCustomerMetrics(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    if (
      !hasCollection(
        this.db,
        'customers'
      )
    ) {
      return this.sectionUnavailable(
        'customers'
      );
    }

    const newCustomerSince =
      daysAgo(
        this.config
          .lookbackDays
      );

    const [
      total,
      active,
      suspended,
      newCustomers,
    ] =
      await Promise.all([
        this.db.customers.count({
          tenantId,
        }),

        this.db.customers.count({
          tenantId,
          status: 'active',
        }),

        this.db.customers.count({
          tenantId,
          status: 'suspended',
        }),

        this.db.customers.count({
          tenantId,
          createdAt: {
            $gte:
              newCustomerSince,
          },
        }),
      ]);

    return {
      total,

      active,

      suspended,

      newCustomers,

      activeRate:
        percentage(
          active,
          total
        ),

      suspendedRate:
        percentage(
          suspended,
          total
        ),

      growthRate:
        percentage(
          newCustomers,
          total
        ),
    };
  }

  /**
   * ==========================================================================
   * Loan Analytics
   * ==========================================================================
   */

  async getLoanMetrics(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    if (
      !hasCollection(
        this.db,
        'loans'
      )
    ) {
      return this.sectionUnavailable(
        'loans'
      );
    }

    const [
      activeLoans,
      overdueLoans,
      totalPortfolio,
      overduePortfolio,
      disbursedPortfolio,
    ] =
      await Promise.all([
        this.db.loans.count({
          tenantId,
          status: 'active',
        }),

        this.db.loans.count({
          tenantId,
          status: 'overdue',
        }),

        this.db.loans.aggregate([
          {
            $match: {
              tenantId,
            },
          },
          {
            $group: {
              _id: null,
              total: {
                $sum:
                  '$balance',
              },
            },
          },
        ]),

        this.db.loans.aggregate([
          {
            $match: {
              tenantId,
              status: 'overdue',
            },
          },
          {
            $group: {
              _id: null,
              total: {
                $sum:
                  '$balance',
              },
            },
          },
        ]),

        this.db.loans.aggregate([
          {
            $match: {
              tenantId,
            },
          },
          {
            $group: {
              _id: null,
              total: {
                $sum:
                  '$principal',
              },
            },
          },
        ]),
      ]);

    const portfolio =
      aggregateTotal(
        totalPortfolio
      );

    const overdueBalance =
      aggregateTotal(
        overduePortfolio
      );

    const disbursed =
      aggregateTotal(
        disbursedPortfolio
      );

    return {
      activeLoans,

      overdueLoans,

      totalPortfolio:
        portfolio,

      overduePortfolio:
        overdueBalance,

      disbursedPortfolio:
        disbursed,

      overdueLoanRatio:
        percentage(
          overdueLoans,
          activeLoans
        ),

      portfolioAtRiskRatio:
        percentage(
          overdueBalance,
          portfolio
        ),

      portfolioHealth:
        this.classifyPortfolioHealth(
          overdueBalance,
          portfolio
        ),
    };
  }

  /**
   * ==========================================================================
   * Savings Analytics
   * ==========================================================================
   */

  async getSavingsMetrics(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    if (
      !hasCollection(
        this.db,
        'savingsAccounts'
      )
    ) {
      return this.sectionUnavailable(
        'savingsAccounts'
      );
    }

    const [
      accounts,
      deposits,
      withdrawals,
      balances,
    ] =
      await Promise.all([
        this.db.savingsAccounts.count({
          tenantId,
        }),

        hasCollection(
          this.db,
          'savingsTransactions'
        )
          ? this.db.savingsTransactions.aggregate([
              {
                $match: {
                  tenantId,
                  type: 'deposit',
                },
              },
              {
                $group: {
                  _id: null,
                  total: {
                    $sum:
                      '$amount',
                  },
                },
              },
            ])
          : [],

        hasCollection(
          this.db,
          'savingsTransactions'
        )
          ? this.db.savingsTransactions.aggregate([
              {
                $match: {
                  tenantId,
                  type: 'withdrawal',
                },
              },
              {
                $group: {
                  _id: null,
                  total: {
                    $sum:
                      '$amount',
                  },
                },
              },
            ])
          : [],

        this.db.savingsAccounts.aggregate([
          {
            $match: {
              tenantId,
            },
          },
          {
            $group: {
              _id: null,
              total: {
                $sum:
                  '$balance',
              },
            },
          },
        ]),
      ]);

    const depositTotal =
      aggregateTotal(
        deposits
      );

    const withdrawalTotal =
      aggregateTotal(
        withdrawals
      );

    const balanceTotal =
      aggregateTotal(
        balances
      );

    return {
      accounts,

      deposits:
        depositTotal,

      withdrawals:
        withdrawalTotal,

      netSavingsFlow:
        depositTotal -
        withdrawalTotal,

      balances:
        balanceTotal,

      averageBalance:
        accounts > 0
          ? balanceTotal /
            accounts
          : 0,
    };
  }

  /**
   * ==========================================================================
   * Mobile Money Analytics
   * ==========================================================================
   */

  async getMobileMoneyMetrics(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    const [
      settlements,
      transactions,
      pending,
      failed,
      transactionVolume,
    ] =
      await Promise.all([
        hasCollection(
          this.db,
          'mobileMoneySettlements'
        )
          ? this.db.mobileMoneySettlements.count({
              tenantId,
            })
          : 0,

        hasCollection(
          this.db,
          'mobileMoneyTransactions'
        )
          ? this.db.mobileMoneyTransactions.count({
              tenantId,
            })
          : 0,

        hasCollection(
          this.db,
          'mobileMoneyTransactions'
        )
          ? this.db.mobileMoneyTransactions.count({
              tenantId,
              status: 'pending',
            })
          : 0,

        hasCollection(
          this.db,
          'mobileMoneyTransactions'
        )
          ? this.db.mobileMoneyTransactions.count({
              tenantId,
              status: 'failed',
            })
          : 0,

        hasCollection(
          this.db,
          'mobileMoneyTransactions'
        )
          ? this.db.mobileMoneyTransactions.aggregate([
              {
                $match: {
                  tenantId,
                  status: {
                    $in: [
                      'completed',
                      'successful',
                      'success',
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  total: {
                    $sum:
                      '$amount',
                  },
                },
              },
            ])
          : [],
      ]);

    return {
      settlements,

      transactions,

      pending,

      failed,

      transactionVolume:
        aggregateTotal(
          transactionVolume
        ),

      failureRate:
        percentage(
          failed,
          transactions
        ),
    };
  }

  /**
   * ==========================================================================
   * Fraud Analytics
   * ==========================================================================
   */

  async getFraudMetrics(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    const [
      alerts,
      openAlerts,
      cases,
      openCases,
    ] =
      await Promise.all([
        hasCollection(
          this.db,
          'fraudAlerts'
        )
          ? this.db.fraudAlerts.count({
              tenantId,
            })
          : 0,

        hasCollection(
          this.db,
          'fraudAlerts'
        )
          ? this.db.fraudAlerts.count({
              tenantId,
              status: 'open',
            })
          : 0,

        hasCollection(
          this.db,
          'fraudCases'
        )
          ? this.db.fraudCases.count({
              tenantId,
            })
          : 0,

        hasCollection(
          this.db,
          'fraudCases'
        )
          ? this.db.fraudCases.count({
              tenantId,
              status: 'open',
            })
          : 0,
      ]);

    return {
      alerts,

      openAlerts,

      cases,

      openCases,

      riskLevel:
        this.classifyRiskLevel(
          openAlerts,
          this.config
            .riskThresholds
            .fraudAlerts
        ),
    };
  }

  /**
   * ==========================================================================
   * AML Analytics
   * ==========================================================================
   */

  async getAMLAnalytics(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    const [
      alerts,
      openAlerts,
      cases,
      openCases,
      closedCases,
    ] =
      await Promise.all([
        hasCollection(
          this.db,
          'amlAlerts'
        )
          ? this.db.amlAlerts.count({
              tenantId,
            })
          : 0,

        hasCollection(
          this.db,
          'amlAlerts'
        )
          ? this.db.amlAlerts.count({
              tenantId,
              status: 'open',
            })
          : 0,

        hasCollection(
          this.db,
          'amlCases'
        )
          ? this.db.amlCases.count({
              tenantId,
            })
          : 0,

        hasCollection(
          this.db,
          'amlCases'
        )
          ? this.db.amlCases.count({
              tenantId,
              status: 'open',
            })
          : 0,

        hasCollection(
          this.db,
          'amlCases'
        )
          ? this.db.amlCases.count({
              tenantId,
              status: 'closed',
            })
          : 0,
      ]);

    return {
      alerts,

      openAlerts,

      cases,

      openCases,

      closedCases,

      caseClosureRate:
        percentage(
          closedCases,
          cases
        ),

      riskLevel:
        this.classifyRiskLevel(
          openCases,
          this.config
            .riskThresholds
            .amlOpenCases
        ),
    };
  }

  /**
   * ==========================================================================
   * KYC Analytics
   * ==========================================================================
   */

  async getKYCMetrics(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    if (
      !hasCollection(
        this.db,
        'kycProfiles'
      )
    ) {
      return this.sectionUnavailable(
        'kycProfiles'
      );
    }

    const [
      total,
      verified,
      pending,
      rejected,
    ] =
      await Promise.all([
        this.db.kycProfiles.count({
          tenantId,
        }),

        this.db.kycProfiles.count({
          tenantId,
          status: 'verified',
        }),

        this.db.kycProfiles.count({
          tenantId,
          status: 'pending',
        }),

        this.db.kycProfiles.count({
          tenantId,
          status: 'rejected',
        }),
      ]);

    return {
      total,

      verified,

      pending,

      rejected,

      verificationRate:
        percentage(
          verified,
          total
        ),

      rejectionRate:
        percentage(
          rejected,
          total
        ),

      riskLevel:
        this.classifyRiskLevel(
          pending,
          this.config
            .riskThresholds
            .kycPending
        ),
    };
  }

  /**
   * ==========================================================================
   * Subscription Analytics
   * ==========================================================================
   */

  async getSubscriptionMetrics(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    let subscription =
      null;

    if (
      this.subscriptionService &&
      typeof this
        .subscriptionService
        .getActiveSubscription ===
        'function'
    ) {
      try {
        subscription =
          await this.subscriptionService
            .getActiveSubscription(
              tenantId
            );
      } catch (error) {
        this.logError(
          'Subscription metrics unavailable',
          error,
          {
            tenantId,
          }
        );
      }
    }

    const invoices =
      hasCollection(
        this.db,
        'invoices'
      )
        ? await this.db.invoices.count({
            tenantId,
          })
        : 0;

    const paidInvoices =
      hasCollection(
        this.db,
        'invoices'
      )
        ? await this.db.invoices.count({
            tenantId,
            status: 'paid',
          })
        : 0;

    const overdueInvoices =
      hasCollection(
        this.db,
        'invoices'
      )
        ? await this.db.invoices.count({
            tenantId,
            status: 'overdue',
          })
        : 0;

    return {
      subscription,

      invoices,

      paidInvoices,

      overdueInvoices,

      collectionRate:
        percentage(
          paidInvoices,
          invoices
        ),

      billingRisk:
        overdueInvoices > 0
          ? 'medium'
          : 'low',
    };
  }

  /**
   * ==========================================================================
   * Compliance Analytics
   * ==========================================================================
   */

  async getComplianceMetrics(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    const [
      reports,
      pendingReports,
      submittedReports,
      failedReports,
    ] =
      await Promise.all([
        hasCollection(
          this.db,
          'regulatoryReports'
        )
          ? this.db.regulatoryReports.count({
              tenantId,
            })
          : 0,

        hasCollection(
          this.db,
          'regulatoryReports'
        )
          ? this.db.regulatoryReports.count({
              tenantId,
              status: 'pending',
            })
          : 0,

        hasCollection(
          this.db,
          'regulatoryReports'
        )
          ? this.db.regulatoryReports.count({
              tenantId,
              status: 'submitted',
            })
          : 0,

        hasCollection(
          this.db,
          'regulatoryReports'
        )
          ? this.db.regulatoryReports.count({
              tenantId,
              status: 'failed',
            })
          : 0,
      ]);

    return {
      reports,

      pendingReports,

      submittedReports,

      failedReports,

      submissionRate:
        percentage(
          submittedReports,
          reports
        ),

      complianceStatus:
        failedReports > 0
          ? 'attention_required'
          : pendingReports > 0
            ? 'pending'
            : 'healthy',
    };
  }

  /**
   * ==========================================================================
   * System Analytics
   * ==========================================================================
   */

  async getSystemMetrics() {
    const memory =
      process.memoryUsage();

    const cpu =
      process.cpuUsage();

    return {
      uptime:
        process.uptime(),

      memory: {
        rss:
          toNumber(
            memory.rss
          ),

        heapTotal:
          toNumber(
            memory.heapTotal
          ),

        heapUsed:
          toNumber(
            memory.heapUsed
          ),

        external:
          toNumber(
            memory.external
          ),

        arrayBuffers:
          toNumber(
            memory.arrayBuffers
          ),
      },

      cpu: {
        user:
          toNumber(
            cpu.user
          ),

        system:
          toNumber(
            cpu.system
          ),
      },

      nodeVersion:
        process.version,

      platform:
        process.platform,

      environment:
        process.env.NODE_ENV ||
        'development',
    };
  }

  /**
   * ==========================================================================
   * Dashboard Health
   * ==========================================================================
   */

  calculateDashboardHealth(
    sections
  ) {
    const sectionNames =
      Object.keys(
        sections
      );

    const unavailable =
      sectionNames.filter(
        (name) =>
          sections[name] &&
          sections[name]
            .available === false
      );

    const degraded =
      sectionNames.filter(
        (name) =>
          sections[name] &&
          sections[name]
            .degraded === true
      );

    let status =
      'healthy';

    if (
      unavailable.length >
      0
    ) {
      status =
        'degraded';
    }

    if (
      degraded.length >
      0
    ) {
      status =
        'degraded';
    }

    return {
      status,

      healthySections:
        sectionNames.length -
        unavailable.length -
        degraded.length,

      degradedSections:
        degraded,

      unavailableSections:
        unavailable,

      totalSections:
        sectionNames.length,
    };
  }

  /**
   * ==========================================================================
   * Snapshots
   * ==========================================================================
   */

  async createSnapshot(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    const dashboard =
      await this.getDashboard(
        tenantId,
        {
          forceRefresh: true,
        }
      );

    if (
      !hasCollection(
        this.db,
        'dashboardSnapshots'
      )
    ) {
      throw new Error(
        'Dashboard snapshot repository is unavailable.'
      );
    }

    const snapshot = {
      id:
        crypto.randomUUID(),

      tenantId,

      dashboard,

      version:
        this.config
          .dashboardVersion,

      createdAt:
        new Date(),
    };

    await this.db
      .dashboardSnapshots
      .create(
        snapshot
      );

    await this.audit(
      tenantId,
      'EXECUTIVE_DASHBOARD_SNAPSHOT_CREATED',
      {
        snapshotId:
          snapshot.id,
      }
    );

    this.emit(
      'dashboard.snapshot.created',
      snapshot
    );

    return snapshot;
  }

  async getSnapshots(
    tenantId,
    limit =
      this.config
        .snapshotLimit
  ) {
    this.assertTenantId(
      tenantId
    );

    if (
      !hasCollection(
        this.db,
        'dashboardSnapshots'
      )
    ) {
      return [];
    }

    const safeLimit =
      Math.min(
        Math.max(
          Number(limit) ||
            DEFAULT_SNAPSHOT_LIMIT,
          1
        ),
        this.config
          .maxSnapshotLimit
      );

    return this.db
      .dashboardSnapshots
      .find(
        {
          tenantId,
        },
        {
          sort: {
            createdAt: -1,
          },

          limit:
            safeLimit,
        }
      );
  }

  /**
   * ==========================================================================
   * Snapshot Cleanup
   * ==========================================================================
   */

  async cleanupExpiredSnapshots() {
    if (
      !hasCollection(
        this.db,
        'dashboardSnapshots'
      )
    ) {
      return 0;
    }

    const cutoff =
      daysAgo(
        this.config
          .snapshotRetentionDays
      );

    const snapshots =
      await this.db
        .dashboardSnapshots
        .find({
          createdAt: {
            $lt:
              cutoff,
          },
        });

    let deleted =
      0;

    for (const snapshot of snapshots) {
      try {
        if (
          typeof this.db
            .dashboardSnapshots
            .delete ===
          'function'
        ) {
          await this.db
            .dashboardSnapshots
            .delete(
              snapshot.id
            );

          deleted += 1;
        }
      } catch (error) {
        this.logError(
          'Dashboard snapshot cleanup failed',
          error,
          {
            snapshotId:
              snapshot.id,
          }
        );
      }
    }

    return deleted;
  }

  /**
   * ==========================================================================
   * Refresh
   * ==========================================================================
   */

  async refreshDashboard(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    const cacheKey =
      buildCacheKey(
        tenantId
      );

    if (this.cache) {
      await this.safeCacheDelete(
        cacheKey
      );
    }

    await this.audit(
      tenantId,
      'EXECUTIVE_DASHBOARD_REFRESHED'
    );

    return this.getDashboard(
      tenantId,
      {
        forceRefresh: true,
      }
    );
  }

  /**
   * ==========================================================================
   * Queue Refresh
   * ==========================================================================
   */

  async scheduleRefresh(
    tenantId,
    options = {}
  ) {
    this.assertTenantId(
      tenantId
    );

    if (
      !this.queueService ||
      typeof this.queueService
        .enqueue !== 'function'
    ) {
      return this.refreshDashboard(
        tenantId
      );
    }

    return this.queueService.enqueue(
      'executive-dashboard-refresh',
      {
        tenantId,
        requestId:
          options.requestId ||
          crypto.randomUUID(),
      },
      {
        delay:
          Math.max(
            Number(
              options.delay || 0
            ),
            0
          ),
      }
    );
  }

  /**
   * ==========================================================================
   * Export
   * ==========================================================================
   */

  async exportDashboard(
    tenantId,
    options = {}
  ) {
    this.assertTenantId(
      tenantId
    );

    const dashboard =
      await this.getDashboard(
        tenantId,
        options
      );

    const exportPayload = {
      metadata: {
        service:
          SERVICE_NAME,

        version:
          this.config
            .dashboardVersion,

        tenantId,

        exportedAt:
          new Date(),

        requestId:
          options.requestId ||
          null,
      },

      dashboard,
    };

    const serialized =
      JSON.stringify(
        exportPayload,
        null,
        2
      );

    await this.audit(
      tenantId,
      'EXECUTIVE_DASHBOARD_EXPORTED',
      {
        format:
          options.format ||
          'json',
        size:
          Buffer.byteLength(
            serialized,
            'utf8'
          ),
      }
    );

    return serialized;
  }

  /**
   * ==========================================================================
   * Risk Helpers
   * ==========================================================================
   */

  classifyRiskLevel(
    value,
    threshold
  ) {
    const numericValue =
      toNumber(value);

    const numericThreshold =
      Math.max(
        toNumber(threshold, 1),
        1
      );

    if (
      numericValue >=
      numericThreshold * 2
    ) {
      return 'high';
    }

    if (
      numericValue >=
      numericThreshold
    ) {
      return 'medium';
    }

    return 'low';
  }

  classifyPortfolioHealth(
    overdueBalance,
    totalPortfolio
  ) {
    const overdueRatio =
      ratio(
        overdueBalance,
        totalPortfolio
      );

    if (
      overdueRatio >=
      this.config
        .riskThresholds
        .overdueLoanRatio
    ) {
      return 'attention_required';
    }

    if (
      overdueRatio >=
      this.config
        .riskThresholds
        .overdueLoanRatio /
        2
    ) {
      return 'watch';
    }

    return 'healthy';
  }

  /**
   * ==========================================================================
   * Section Isolation
   * ==========================================================================
   */

  async safeSection(
    name,
    handler
  ) {
    try {
      return await handler();
    } catch (error) {
      this.logError(
        `Dashboard section failed: ${name}`,
        error,
        {
          section:
            name,
        }
      );

      if (
        !this.config
          .failSoft
      ) {
        throw error;
      }

      return {
        available: false,

        degraded: true,

        section: name,

        error:
          'SECTION_UNAVAILABLE',
      };
    }
  }

  sectionUnavailable(
    section
  ) {
    return {
      available: false,

      degraded: true,

      section,

      error:
        'DATA_SOURCE_UNAVAILABLE',
    };
  }

  /**
   * ==========================================================================
   * Tenant Isolation
   * ==========================================================================
   */

  assertTenantId(
    tenantId
  ) {
    if (
      tenantId === undefined ||
      tenantId === null ||
      tenantId === ''
    ) {
      throw new TypeError(
        'tenantId is required.'
      );
    }
  }

  /**
   * ==========================================================================
   * Cache Helpers
   * ==========================================================================
   */

  async safeCacheGet(
    key
  ) {
    try {
      if (
        !this.cache ||
        typeof this.cache
          .get !== 'function'
      ) {
        return null;
      }

      return await this.cache.get(
        key
      );
    } catch (error) {
      this.logError(
        'Dashboard cache read failed',
        error,
        {
          key,
        }
      );

      return null;
    }
  }

  async safeCacheSet(
    key,
    value,
    ttl
  ) {
    try {
      if (
        !this.cache ||
        typeof this.cache
          .set !== 'function'
      ) {
        return;
      }

      await this.cache.set(
        key,
        value,
        ttl
      );
    } catch (error) {
      this.logError(
        'Dashboard cache write failed',
        error,
        {
          key,
        }
      );
    }
  }

  async safeCacheDelete(
    key
  ) {
    try {
      if (
        !this.cache ||
        typeof this.cache
          .del !== 'function'
      ) {
        return;
      }

      await this.cache.del(
        key
      );
    } catch (error) {
      this.logError(
        'Dashboard cache deletion failed',
        error,
        {
          key,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * Metrics
   * ==========================================================================
   */

  async recordMetric(
    name,
    value,
    labels = {}
  ) {
    if (
      !this.config
        .enableMetrics ||
      !this.metricsService
    ) {
      return;
    }

    try {
      if (
        typeof this.metricsService
          .increment ===
        'function'
      ) {
        await this.metricsService.increment(
          name,
          value,
          labels
        );

        return;
      }

      if (
        typeof this.metricsService
          .record ===
        'function'
      ) {
        await this.metricsService.record(
          name,
          value,
          labels
        );
      }
    } catch (error) {
      this.logError(
        'Dashboard metrics recording failed',
        error,
        {
          metric:
            name,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * Timeout
   * ==========================================================================
   */

  withTimeout(
    promise,
    timeoutMs,
    message
  ) {
    const timeout =
      Math.max(
        Number(timeoutMs) ||
          DEFAULT_TIMEOUT_MS,
        1
      );

    return Promise.race([
      promise,

      new Promise(
        (_, reject) => {
          const timer =
            setTimeout(
              () => {
                reject(
                  new Error(
                    message ||
                      'Operation timed out.'
                  )
                );
              },
              timeout
            );

          if (
            typeof timer
              .unref ===
            'function'
          ) {
            timer.unref();
          }
        }
      ),
    ]);
  }

  /**
   * ==========================================================================
   * Logging
   * ==========================================================================
   */

  logError(
    message,
    error,
    context = {}
  ) {
    try {
      if (
        this.logger &&
        typeof this.logger
          .error ===
        'function'
      ) {
        this.logger.error(
          message,
          {
            service:
              SERVICE_NAME,

            ...context,

            error: {
              name:
                error?.name,

              message:
                error?.message,

              code:
                error?.code,

              stack:
                error?.stack,
            },
          }
        );
      }
    } catch (_) {
      // Logging must never crash dashboard processing.
    }
  }

  /**
   * ==========================================================================
   * Audit
   * ==========================================================================
   */

  async audit(
    tenantId,
    action,
    payload = {}
  ) {
    if (
      !this.config
        .enableAudit ||
      !this.auditService
    ) {
      return;
    }

    try {
      if (
        typeof this.auditService
          .log !==
        'function'
      ) {
        return;
      }

      await this.auditService.log(
        {
          tenantId,

          action,

          payload,

          service:
            SERVICE_NAME,

          timestamp:
            new Date(),
        }
      );
    } catch (error) {
      this.logError(
        'Dashboard audit failed',
        error,
        {
          tenantId,
          action,
        }
      );
    }
  }
}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
  ExecutiveDashboardService;