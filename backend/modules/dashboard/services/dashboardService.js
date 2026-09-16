/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/modules/dashboard/services/dashboardService.js
 *
 * Purpose:
 *   Enterprise read-only dashboard analytics service.
 *
 * Responsibilities:
 *   - Tenant-scoped executive metrics
 *   - Portfolio analytics
 *   - Savings analytics
 *   - Loan analytics
 *   - Risk analytics
 *   - Fraud/compliance monitoring
 *   - Revenue intelligence
 *   - Executive summary
 *   - Board/CEO snapshot
 *   - Dashboard chart datasets
 *
 * Architectural rules:
 *   - READ ONLY
 *   - Never mutates financial state
 *   - Never creates ledger entries
 *   - Never modifies balances
 *   - Never approves loans
 *   - Never calls payment providers
 *   - Never bypasses the canonical transaction service
 *   - Every business query is tenant-scoped
 *   - Monetary aggregation uses MongoDB Decimal128 conversion
 *   - Sensitive fields are never returned
 *
 * The dashboard is an analytics/read-model boundary, not another accounting
 * engine.
 *
 * =============================================================================
 */

import { createRequire } from 'node:module';

import logger from '../../../utils/logger.js';

const require = createRequire(import.meta.url);

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const SERVICE_NAME = 'dashboard-service';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const DEFAULT_CHART_PERIOD = '12m';

const CHART_PERIODS = Object.freeze({
  '7d': {
    unit: 'day',
    value: 7,
  },

  '30d': {
    unit: 'day',
    value: 30,
  },

  '90d': {
    unit: 'day',
    value: 90,
  },

  '6m': {
    unit: 'month',
    value: 6,
  },

  '12m': {
    unit: 'month',
    value: 12,
  },

  '24m': {
    unit: 'month',
    value: 24,
  },
});

const REVENUE_PERIODS = Object.freeze([
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
]);

const LOAN_ACTIVE_STATUSES = Object.freeze([
  'active',
  'approved',
  'disbursed',
]);

const LOAN_DEFAULT_STATUSES = Object.freeze([
  'defaulted',
  'default',
  'overdue',
]);

const LOAN_COMPLETED_STATUSES = Object.freeze([
  'completed',
  'closed',
  'paid',
]);

const TRANSACTION_SUCCESS_STATUSES = Object.freeze([
  'completed',
  'successful',
  'success',
  'posted',
  'settled',
]);

const TRANSACTION_FAILURE_STATUSES = Object.freeze([
  'failed',
  'failure',
  'reversed',
  'cancelled',
  'canceled',
]);

const FRAUD_EVENT_NAMES = Object.freeze([
  'fraud',
  'fraud_alert',
  'fraud_detected',
  'suspicious',
  'suspicious_activity',
  'transaction_flagged',
]);

const COMPLIANCE_EVENT_NAMES = Object.freeze([
  'compliance',
  'compliance_alert',
  'kyc',
  'aml',
  'aml_alert',
  'kyc_alert',
]);

/**
 * Candidate model paths.
 *
 * The service uses createRequire() as a narrow compatibility bridge because
 * parts of the repository are still transitioning from CommonJS to ESM.
 *
 * Once all domain models are canonical ESM, these can be converted to native
 * imports without changing service behavior.
 */
const MODEL_CANDIDATES = Object.freeze({
  User: [
    '../../../models/User.js',
    '../../../models/User',
  ],

  Group: [
    '../../../models/Group.js',
    '../../../models/Group',
  ],

  Member: [
    '../../../models/Member.js',
    '../../../models/Member',
  ],

  Savings: [
    '../../../models/Savings.js',
    '../../../models/Savings',
  ],

  Contribution: [
    '../../../models/Contribution.js',
    '../../../models/Contribution',
  ],

  Transaction: [
    '../../../modules/transaction/transaction.model.js',
    '../../../modules/transaction/transaction.model',
    '../../../models/Transaction.js',
    '../../../models/Transaction',
  ],

  Loan: [
    '../../../models/Loan.js',
    '../../../models/Loan',
  ],

  LoanAudit: [
    '../../../models/LoanAudit.js',
    '../../../models/LoanAudit',
  ],

  FraudAlert: [
    '../../../models/FraudAlert.js',
    '../../../models/FraudAlert',
    '../../../models/Fraud.js',
    '../../../models/Fraud',
  ],

  ComplianceAlert: [
    '../../../models/ComplianceAlert.js',
    '../../../models/ComplianceAlert',
    '../../../models/Compliance.js',
    '../../../models/Compliance',
  ],

  Revenue: [
    '../../../models/Revenue.js',
    '../../../models/Revenue',
  ],

  Expense: [
    '../../../models/Expense.js',
    '../../../models/Expense',
  ],
});

/**
 * =============================================================================
 * Model registry
 * =============================================================================
 */

const modelCache = new Map();

/**
 * Resolve a model without making module-loading failures fatal for optional
 * dashboard integrations.
 */
const resolveModel = (name, {
  required = false,
} = {}) => {
  if (modelCache.has(name)) {
    return modelCache.get(name);
  }

  const candidates = MODEL_CANDIDATES[name] ?? [];

  for (const candidate of candidates) {
    try {
      const loaded = require(candidate);

      const model =
        loaded?.default ??
        loaded?.[name] ??
        loaded;

      if (
        model &&
        typeof model.aggregate === 'function' &&
        typeof model.find === 'function'
      ) {
        modelCache.set(name, model);
        return model;
      }
    } catch {
      // Candidate does not exist or cannot be loaded yet.
    }
  }

  if (required) {
    const error = new Error(
      `Required dashboard model "${name}" could not be resolved.`,
    );

    error.code = 'DASHBOARD_MODEL_UNAVAILABLE';
    error.statusCode = 503;

    throw error;
  }

  modelCache.set(name, null);
  return null;
};

/**
 * =============================================================================
 * Generic safety helpers
 * =============================================================================
 */

const assertTenantId = (tenantId) => {
  if (
    tenantId === undefined ||
    tenantId === null ||
    String(tenantId).trim() === ''
  ) {
    const error = new Error(
      'Tenant ID is required for dashboard analytics.',
    );

    error.code = 'DASHBOARD_TENANT_REQUIRED';
    error.statusCode = 400;

    throw error;
  }

  return String(tenantId).trim();
};

const normalizePagination = (options = {}) => {
  const requestedPage = Number(options.page ?? DEFAULT_PAGE);
  const requestedLimit = Number(options.limit ?? DEFAULT_LIMIT);

  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage >= 1
      ? requestedPage
      : DEFAULT_PAGE;

  const limit =
    Number.isSafeInteger(requestedLimit) &&
    requestedLimit >= 1
      ? Math.min(requestedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const normalizeDate = (value) => {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const date = value instanceof Date
    ? value
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    const error = new Error(
      `Invalid date value: ${String(value)}`,
    );

    error.code = 'DASHBOARD_INVALID_DATE';
    error.statusCode = 400;

    throw error;
  }

  return date;
};

const startOfDay = (date) => {
  const result = new Date(date);

  result.setHours(
    0,
    0,
    0,
    0,
  );

  return result;
};

const endOfDay = (date) => {
  const result = new Date(date);

  result.setHours(
    23,
    59,
    59,
    999,
  );

  return result;
};

const safeNumber = (value, fallback = 0) => {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
};

const toPlainObject = (value) => {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value.toObject === 'function'
  ) {
    return value.toObject();
  }

  return value;
};

/**
 * Convert an aggregation Decimal128 or number/string result into a stable
 * string representation.
 *
 * Financial API payloads should prefer strings for exact monetary values.
 */
const decimalToString = (value) => {
  if (
    value === null ||
    value === undefined
  ) {
    return '0.00';
  }

  if (
    typeof value === 'object' &&
    typeof value.toString === 'function'
  ) {
    return value.toString();
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return '0.00';
  }

  return numeric.toFixed(2);
};

const decimalExpression = (
  field,
  fallback = 0,
) => ({
  $convert: {
    input: {
      $ifNull: [
        `$${field}`,
        fallback,
      ],
    },
    to: 'decimal',
    onError: 0,
    onNull: 0,
  },
});

const coalesceDateExpression = () => ({
  $ifNull: [
    '$createdAt',
    {
      $ifNull: [
        '$date',
        {
          $ifNull: [
            '$transactionDate',
            {
              $ifNull: [
                '$occurredAt',
                '$updatedAt',
              ],
            },
          ],
        },
      ],
    },
  ],
});

const normalizeStatus = (status) =>
  typeof status === 'string'
    ? status.trim().toLowerCase()
    : '';

const normalizeText = (value) =>
  typeof value === 'string'
    ? value.trim()
    : '';

const getArray = (value) =>
  Array.isArray(value)
    ? value
    : [];

/**
 * =============================================================================
 * Logging / timing
 * =============================================================================
 */

const logTiming = (
  operation,
  startedAt,
  metadata = {},
) => {
  const executionTimeMs =
    Math.max(
      0,
      Date.now() - startedAt,
    );

  /**
   * Keep routine dashboard requests out of noisy logs while retaining slow
   * query visibility.
   */
  const slowThresholdMs = Number(
    process.env.DASHBOARD_SLOW_QUERY_MS ?? 750,
  );

  if (
    executionTimeMs >= slowThresholdMs
  ) {
    logger.warn(
      {
        service: SERVICE_NAME,
        operation,
        executionTimeMs,
        ...metadata,
      },
      '[DashboardService] Slow dashboard operation',
    );
  } else {
    logger.debug(
      {
        service: SERVICE_NAME,
        operation,
        executionTimeMs,
        ...metadata,
      },
      '[DashboardService] Dashboard operation completed',
    );
  }

  return executionTimeMs;
};

/**
 * =============================================================================
 * Tenant query helpers
 * =============================================================================
 */

const tenantMatch = (
  tenantId,
  extra = {},
) => ({
  tenantId: assertTenantId(tenantId),
  ...extra,
});

/**
 * Count documents safely.
 */
const countDocumentsSafe = async (
  model,
  filter,
) => {
  if (!model) {
    return 0;
  }

  if (
    typeof model.countDocuments !== 'function'
  ) {
    const rows =
      await model
        .find(filter)
        .select({ _id: 1 })
        .lean();

    return rows.length;
  }

  return model.countDocuments(filter);
};

/**
 * Aggregate safely.
 */
const aggregateSafe = async (
  model,
  pipeline,
) => {
  if (!model) {
    return [];
  }

  return model.aggregate(
    pipeline,
  );
};

/**
 * =============================================================================
 * Core metrics
 * =============================================================================
 */

const getMemberAndGroupMetrics = async (
  tenantId,
) => {
  const User = resolveModel('User');
  const Member = resolveModel('Member');
  const Group = resolveModel('Group');

  const memberModel =
    Member ?? User;

  const [
    activeMembers,
    totalMembers,
    activeGroups,
    totalGroups,
  ] = await Promise.all([
    countDocumentsSafe(
      memberModel,
      tenantMatch(
        tenantId,
        {
          $or: [
            {
              status: {
                $in: [
                  'active',
                  'ACTIVE',
                ],
              },
            },
            {
              isActive: true,
            },
          ],
        },
      ),
    ),

    countDocumentsSafe(
      memberModel,
      tenantMatch(
        tenantId,
      ),
    ),

    countDocumentsSafe(
      Group,
      tenantMatch(
        tenantId,
        {
          $or: [
            {
              status: {
                $in: [
                  'active',
                  'ACTIVE',
                ],
              },
            },
            {
              isActive: true,
            },
          ],
        },
      ),
    ),

    countDocumentsSafe(
      Group,
      tenantMatch(
        tenantId,
      ),
    ),
  ]);

  return {
    activeMembers,
    totalMembers,
    activeGroups,
    totalGroups,
  };
};

const getSavingsMetrics = async (
  tenantId,
) => {
  const Savings = resolveModel('Savings');
  const Contribution =
    resolveModel('Contribution');

  const savingsPipeline = [
    {
      $match: tenantMatch(
        tenantId,
      ),
    },

    {
      $group: {
        _id: null,
        totalRecords: {
          $sum: 1,
        },

        totalSavings: {
          $sum: decimalExpression(
            'amount',
          ),
        },

        totalBalance: {
          $sum: decimalExpression(
            'balance',
          ),
        },

        activeSavingsPlans: {
          $sum: {
            $cond: [
              {
                $in: [
                  {
                    $toLower: {
                      $ifNull: [
                        '$status',
                        '',
                      ],
                    },
                  },
                  [
                    'active',
                    'open',
                    'running',
                  ],
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ];

  const contributionPipeline = [
    {
      $match: tenantMatch(
        tenantId,
      ),
    },

    {
      $group: {
        _id: null,
        contributionCount: {
          $sum: 1,
        },

        contributionVolume: {
          $sum: decimalExpression(
            'amount',
          ),
        },
      },
    },
  ];

  const [
    savingsRows,
    contributionRows,
  ] = await Promise.all([
    aggregateSafe(
      Savings,
      savingsPipeline,
    ),
    aggregateSafe(
      Contribution,
      contributionPipeline,
    ),
  ]);

  const savings = savingsRows[0] ?? {};
  const contributions =
    contributionRows[0] ?? {};

  return {
    totalSavings: decimalToString(
      savings.totalBalance ??
        savings.totalSavings ??
        0,
    ),

    savingsRecordCount:
      safeNumber(
        savings.totalRecords,
      ),

    activeSavingsPlans:
      safeNumber(
        savings.activeSavingsPlans,
      ),

    contributionCount:
      safeNumber(
        contributions.contributionCount,
      ),

    contributionVolume:
      decimalToString(
        contributions.contributionVolume,
      ),
  };
};

const getLoanMetrics = async (
  tenantId,
) => {
  const Loan = resolveModel('Loan');

  if (!Loan) {
    return {
      loanCount: 0,
      loanPortfolio: '0.00',
      activeLoanCount: 0,
      activeLoanPortfolio: '0.00',
      defaultedLoanCount: 0,
      defaultedPortfolio: '0.00',
      completedLoanCount: 0,
      completedLoanPortfolio: '0.00',
      repaymentVolume: '0.00',
    };
  }

  const pipeline = [
    {
      $match: tenantMatch(
        tenantId,
      ),
    },

    {
      $addFields: {
        normalizedStatus: {
          $toLower: {
            $ifNull: [
              '$status',
              '',
            ],
          },
        },

        normalizedAmount:
          decimalExpression(
            'amount',
          ),

        normalizedRepayment:
          decimalExpression(
            'repaidAmount',
          ),
      },
    },

    {
      $group: {
        _id: null,

        loanCount: {
          $sum: 1,
        },

        loanPortfolio: {
          $sum:
            '$normalizedAmount',
        },

        activeLoanCount: {
          $sum: {
            $cond: [
              {
                $in: [
                  '$normalizedStatus',
                  LOAN_ACTIVE_STATUSES,
                ],
              },
              1,
              0,
            ],
          },
        },

        activeLoanPortfolio: {
          $sum: {
            $cond: [
              {
                $in: [
                  '$normalizedStatus',
                  LOAN_ACTIVE_STATUSES,
                ],
              },
              '$normalizedAmount',
              0,
            ],
          },
        },

        defaultedLoanCount: {
          $sum: {
            $cond: [
              {
                $in: [
                  '$normalizedStatus',
                  LOAN_DEFAULT_STATUSES,
                ],
              },
              1,
              0,
            ],
          },
        },

        defaultedPortfolio: {
          $sum: {
            $cond: [
              {
                $in: [
                  '$normalizedStatus',
                  LOAN_DEFAULT_STATUSES,
                ],
              },
              '$normalizedAmount',
              0,
            ],
          },
        },

        completedLoanCount: {
          $sum: {
            $cond: [
              {
                $in: [
                  '$normalizedStatus',
                  LOAN_COMPLETED_STATUSES,
                ],
              },
              1,
              0,
            ],
          },
        },

        completedLoanPortfolio: {
          $sum: {
            $cond: [
              {
                $in: [
                  '$normalizedStatus',
                  LOAN_COMPLETED_STATUSES,
                ],
              },
              '$normalizedAmount',
              0,
            ],
          },
        },

        repaymentVolume: {
          $sum:
            '$normalizedRepayment',
        },
      },
    },
  ];

  const rows =
    await aggregateSafe(
      Loan,
      pipeline,
    );

  const result = rows[0] ?? {};

  return {
    loanCount:
      safeNumber(result.loanCount),

    loanPortfolio:
      decimalToString(
        result.loanPortfolio,
      ),

    activeLoanCount:
      safeNumber(
        result.activeLoanCount,
      ),

    activeLoanPortfolio:
      decimalToString(
        result.activeLoanPortfolio,
      ),

    defaultedLoanCount:
      safeNumber(
        result.defaultedLoanCount,
      ),

    defaultedPortfolio:
      decimalToString(
        result.defaultedPortfolio,
      ),

    completedLoanCount:
      safeNumber(
        result.completedLoanCount,
      ),

    completedLoanPortfolio:
      decimalToString(
        result.completedLoanPortfolio,
      ),

    repaymentVolume:
      decimalToString(
        result.repaymentVolume,
      ),
  };
};

const getTransactionMetrics = async (
  tenantId,
) => {
  const Transaction =
    resolveModel(
      'Transaction',
    );

  if (!Transaction) {
    return {
      transactionCount: 0,
      totalTransactionVolume: '0.00',
      successfulTransactionVolume: '0.00',
      failedTransactionCount: 0,
      mobileMoneyVolume: '0.00',
    };
  }

  const pipeline = [
    {
      $match: tenantMatch(
        tenantId,
      ),
    },

    {
      $addFields: {
        normalizedStatus: {
          $toLower: {
            $ifNull: [
              '$status',
              '',
            ],
          },
        },

        normalizedType: {
          $toLower: {
            $ifNull: [
              '$type',
              '',
            ],
          },
        },

        normalizedProvider: {
          $toLower: {
            $ifNull: [
              '$provider',
              {
                $ifNull: [
                  '$paymentMethod',
                  '',
                ],
              },
            ],
          },
        },

        normalizedAmount:
          decimalExpression(
            'amount',
          ),
      },
    },

    {
      $group: {
        _id: null,

        transactionCount: {
          $sum: 1,
        },

        totalTransactionVolume: {
          $sum:
            '$normalizedAmount',
        },

        successfulTransactionVolume: {
          $sum: {
            $cond: [
              {
                $in: [
                  '$normalizedStatus',
                  TRANSACTION_SUCCESS_STATUSES,
                ],
              },
              '$normalizedAmount',
              0,
            ],
          },
        },

        failedTransactionCount: {
          $sum: {
            $cond: [
              {
                $in: [
                  '$normalizedStatus',
                  TRANSACTION_FAILURE_STATUSES,
                ],
              },
              1,
              0,
            ],
          },
        },

        mobileMoneyVolume: {
          $sum: {
            $cond: [
              {
                $or: [
                  {
                    $regexMatch: {
                      input:
                        '$normalizedType',
                      regex:
                        'momo|mobile.?money|mobile_money|mpesa|airtel',
                    },
                  },
                  {
                    $regexMatch: {
                      input:
                        '$normalizedProvider',
                      regex:
                        'momo|mobile.?money|mpesa|airtel',
                    },
                  },
                ],
              },
              '$normalizedAmount',
              0,
            ],
          },
        },
      },
    },
  ];

  const rows =
    await aggregateSafe(
      Transaction,
      pipeline,
    );

  const result =
    rows[0] ?? {};

  return {
    transactionCount:
      safeNumber(
        result.transactionCount,
      ),

    totalTransactionVolume:
      decimalToString(
        result.totalTransactionVolume,
      ),

    successfulTransactionVolume:
      decimalToString(
        result.successfulTransactionVolume,
      ),

    failedTransactionCount:
      safeNumber(
        result.failedTransactionCount,
      ),

    mobileMoneyVolume:
      decimalToString(
        result.mobileMoneyVolume,
      ),
  };
};

/**
 * =============================================================================
 * Public service
 * =============================================================================
 */

class DashboardService {
  /**
   * ===========================================================================
   * Executive metrics
   * ===========================================================================
   */
  static async getMetrics(
    tenantId,
  ) {
    const startedAt = Date.now();

    const normalizedTenantId =
      assertTenantId(
        tenantId,
      );

    const [
      memberMetrics,
      savingsMetrics,
      loanMetrics,
      transactionMetrics,
    ] = await Promise.all([
      getMemberAndGroupMetrics(
        normalizedTenantId,
      ),

      getSavingsMetrics(
        normalizedTenantId,
      ),

      getLoanMetrics(
        normalizedTenantId,
      ),

      getTransactionMetrics(
        normalizedTenantId,
      ),
    ]);

    /**
     * In a savings/community-finance environment:
     *
     *   - savings represent customer/member liabilities
     *   - loan portfolio represents deployed assets
     *
     * Actual accounting totals should come from the authoritative accounting
     * read model once available. These derived values are therefore presented
     * as operational dashboard estimates rather than ledger truth.
     */
    const totalSavings =
      Number(
        savingsMetrics.totalSavings,
      ) || 0;

    const loanPortfolio =
      Number(
        loanMetrics.loanPortfolio,
      ) || 0;

    const estimatedAssets =
      loanPortfolio;

    const estimatedLiabilities =
      totalSavings;

    const recoveryRate =
      loanMetrics.loanPortfolio !==
        '0.00'
        ? (
            (
              Number(
                loanMetrics.repaymentVolume,
              ) /
              Number(
                loanMetrics.loanPortfolio,
              )
            ) *
            100
          )
        : 0;

    const defaultRate =
      loanMetrics.loanCount > 0
        ? (
            (
              loanMetrics.defaultedLoanCount /
              loanMetrics.loanCount
            ) *
            100
          )
        : 0;

    const result = {
      totalAssets:
        estimatedAssets.toFixed(2),

      totalLiabilities:
        estimatedLiabilities.toFixed(2),

      totalSavings:
        savingsMetrics.totalSavings,

      loanPortfolio:
        loanMetrics.loanPortfolio,

      revenue: '0.00',

      expenses: '0.00',

      profit: '0.00',

      activeMembers:
        memberMetrics.activeMembers,

      activeGroups:
        memberMetrics.activeGroups,

      recoveryRate:
        Number(
          recoveryRate.toFixed(2),
        ),

      defaultRate:
        Number(
          defaultRate.toFixed(2),
        ),

      mobileMoneyVolume:
        transactionMetrics.mobileMoneyVolume,

      /**
       * Additional operational metrics.
       */
      totalMembers:
        memberMetrics.totalMembers,

      totalGroups:
        memberMetrics.totalGroups,

      activeLoans:
        loanMetrics.activeLoanCount,

      defaultedLoans:
        loanMetrics.defaultedLoanCount,

      completedLoans:
        loanMetrics.completedLoanCount,

      activeLoanPortfolio:
        loanMetrics.activeLoanPortfolio,

      savingsPlans:
        savingsMetrics.activeSavingsPlans,

      contributionCount:
        savingsMetrics.contributionCount,

      contributionVolume:
        savingsMetrics.contributionVolume,

      transactionCount:
        transactionMetrics.transactionCount,

      transactionVolume:
        transactionMetrics.totalTransactionVolume,

      successfulTransactionVolume:
        transactionMetrics.successfulTransactionVolume,

      failedTransactionCount:
        transactionMetrics.failedTransactionCount,

      /**
       * Data quality/authority hints.
       */
      analyticsMode:
        'operational_read_model',

      financialAuthority:
        'canonical_financial_services_and_ledger',
    };

    logTiming(
      'getMetrics',
      startedAt,
      {
        tenantId:
          normalizedTenantId,
      },
    );

    return result;
  }

  /**
   * ===========================================================================
   * Dashboard charts
   * ===========================================================================
   */
  static async getCharts(
    tenantId,
    period = DEFAULT_CHART_PERIOD,
  ) {
    const startedAt = Date.now();

    const normalizedTenantId =
      assertTenantId(
        tenantId,
      );

    const normalizedPeriod =
      normalizeText(period) ||
      DEFAULT_CHART_PERIOD;

    const periodConfig =
      CHART_PERIODS[
        normalizedPeriod
      ];

    if (!periodConfig) {
      const error = new Error(
        `Unsupported chart period: ${normalizedPeriod}`,
      );

      error.code =
        'DASHBOARD_INVALID_CHART_PERIOD';

      error.statusCode = 400;

      throw error;
    }

    const Transaction =
      resolveModel('Transaction');

    const Contribution =
      resolveModel('Contribution');

    const Loan =
      resolveModel('Loan');

    /**
     * Use a single calendar start date for all datasets.
     */
    const now = new Date();

    const startDate =
      new Date(now);

    if (
      periodConfig.unit ===
      'day'
    ) {
      startDate.setDate(
        startDate.getDate() -
          periodConfig.value +
          1,
      );
    } else {
      startDate.setMonth(
        startDate.getMonth() -
          periodConfig.value +
          1,
      );
      startDate.setDate(1);
    }

    const matchDate = {
      $gte: startDate,
      $lte: now,
    };

    const buildTimeSeries =
      async (
        model,
        amountField = 'amount',
        extraMatch = {},
      ) => {
        if (!model) {
          return [];
        }

        return model.aggregate([
          {
            $match: tenantMatch(
              normalizedTenantId,
              {
                ...extraMatch,
                $expr: {
                  $and: [
                    {
                      $gte: [
                        coalesceDateExpression(),
                        matchDate.$gte,
                      ],
                    },
                    {
                      $lte: [
                        coalesceDateExpression(),
                        matchDate.$lte,
                      ],
                    },
                  ],
                },
              },
            ),
          },

          {
            $group: {
              _id: {
                $dateToString: {
                  format:
                    periodConfig.unit ===
                    'day'
                      ? '%Y-%m-%d'
                      : '%Y-%m',
                  date:
                    coalesceDateExpression(),
                },
              },

              value: {
                $sum:
                  decimalExpression(
                    amountField,
                  ),
              },

              count: {
                $sum: 1,
              },
            },
          },

          {
            $sort: {
              _id: 1,
            },
          },
        ]);
      };

    const [
      portfolioRows,
      revenueRows,
      savingsRows,
      loanRows,
    ] = await Promise.all([
      buildTimeSeries(
        Transaction,
        'amount',
        {
          status: {
            $in:
              TRANSACTION_SUCCESS_STATUSES,
          },
        },
      ),

      /**
       * Revenue is queried from the dedicated revenue model when present.
       * If it is not present, the chart returns an empty series rather than
       * pretending transaction volume is revenue.
       */
      buildTimeSeries(
        resolveModel('Revenue'),
        'amount',
      ),

      buildTimeSeries(
        Contribution,
        'amount',
      ),

      buildTimeSeries(
        Loan,
        'amount',
        {
          status: {
            $in: [
              ...LOAN_ACTIVE_STATUSES,
              ...LOAN_COMPLETED_STATUSES,
            ],
          },
        },
      ),
    ]);

    const normalizeSeries =
      (rows) =>
        getArray(rows).map(
          (row) => ({
            period: row._id,
            value:
              decimalToString(
                row.value,
              ),
            count:
              safeNumber(
                row.count,
              ),
          }),
        );

    const portfolioHistory =
      normalizeSeries(
        portfolioRows,
      );

    const revenueHistory =
      normalizeSeries(
        revenueRows,
      );

    const savingsHistory =
      normalizeSeries(
        savingsRows,
      );

    const loanHistory =
      normalizeSeries(
        loanRows,
      );

    /**
     * Recharts-friendly datasets for the existing frontend.
     */
    const periodKeys = new Set([
      ...portfolioHistory.map(
        (item) => item.period,
      ),
      ...revenueHistory.map(
        (item) => item.period,
      ),
      ...savingsHistory.map(
        (item) => item.period,
      ),
      ...loanHistory.map(
        (item) => item.period,
      ),
    ]);

    const portfolioMap =
      new Map(
        portfolioHistory.map(
          (item) => [
            item.period,
            item,
          ],
        ),
      );

    const revenueMap =
      new Map(
        revenueHistory.map(
          (item) => [
            item.period,
            item,
          ],
        ),
      );

    const savingsMap =
      new Map(
        savingsHistory.map(
          (item) => [
            item.period,
            item,
          ],
        ),
      );

    const loanMap =
      new Map(
        loanHistory.map(
          (item) => [
            item.period,
            item,
          ],
        ),
      );

    const timeline = [
      ...periodKeys,
    ]
      .sort()
      .map(
        (periodKey) => ({
          period: periodKey,

          portfolio:
            portfolioMap.get(
              periodKey,
            )?.value ??
            '0.00',

          revenue:
            revenueMap.get(
              periodKey,
            )?.value ??
            '0.00',

          savings:
            savingsMap.get(
              periodKey,
            )?.value ??
            '0.00',

          loans:
            loanMap.get(
              periodKey,
            )?.value ??
            '0.00',
        }),
      );

    const result = {
      period: normalizedPeriod,

      portfolioHistory,

      revenueHistory,

      savingsBreakdown:
        savingsHistory,

      loanPerformance:
        loanHistory,

      timeline,
    };

    logTiming(
      'getCharts',
      startedAt,
      {
        tenantId:
          normalizedTenantId,
        period:
          normalizedPeriod,
      },
    );

    return result;
  }

  /**
   * ===========================================================================
   * Fraud alerts
   * ===========================================================================
   */
  static async getFraudAlerts(
    tenantId,
    options = {},
  ) {
    const startedAt = Date.now();

    const normalizedTenantId =
      assertTenantId(
        tenantId,
      );

    const {
      page,
      limit,
      skip,
    } = normalizePagination(
      options,
    );

    const FraudAlert =
      resolveModel(
        'FraudAlert',
      );

    const LoanAudit =
      resolveModel('LoanAudit');

    let items = [];
    let total = 0;

    if (FraudAlert) {
      const filter =
        tenantMatch(
          normalizedTenantId,
        );

      total =
        await countDocumentsSafe(
          FraudAlert,
          filter,
        );

      items =
        await FraudAlert.find(
          filter,
        )
          .sort({
            createdAt: -1,
            _id: -1,
          })
          .skip(skip)
          .limit(limit)
          .lean();
    } else if (LoanAudit) {
      const filter =
        tenantMatch(
          normalizedTenantId,
          {
            eventType: {
              $in:
                FRAUD_EVENT_NAMES,
            },
          },
        );

      total =
        await countDocumentsSafe(
          LoanAudit,
          filter,
        );

      items =
        await LoanAudit.find(
          filter,
        )
          .sort({
            createdAt: -1,
            _id: -1,
          })
          .skip(skip)
          .limit(limit)
          .lean();
    }

    const safeItems =
      getArray(items).map(
        (item) => ({
          id:
            item._id
              ? String(item._id)
              : null,

          type:
            normalizeText(
              item.type ??
                item.alertType ??
                item.eventType,
            ) ||
            'fraud',

          severity:
            normalizeText(
              item.severity ??
                item.riskLevel,
            ) ||
            'unknown',

          status:
            normalizeText(
              item.status,
            ) ||
            'open',

          score:
            item.score ??
            item.riskScore ??
            null,

          amount:
            decimalToString(
              item.amount,
            ),

          currency:
            normalizeText(
              item.currency,
            ) ||
            'UGX',

          createdAt:
            item.createdAt ??
            item.occurredAt ??
            null,

          reference:
            normalizeText(
              item.transactionId ??
                item.reference ??
                item.correlationId,
            ) ||
            null,
        }),
      );

    const totalPages =
      limit > 0
        ? Math.ceil(
            total / limit,
          )
        : 0;

    logTiming(
      'getFraudAlerts',
      startedAt,
      {
        tenantId:
          normalizedTenantId,
        page,
        limit,
      },
    );

    return {
      items: safeItems,

      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage:
          page < totalPages,
        hasPreviousPage:
          page > 1,
      },
    };
  }

  /**
   * ===========================================================================
   * Compliance alerts
   * ===========================================================================
   */
  static async getComplianceAlerts(
    tenantId,
    options = {},
  ) {
    const startedAt = Date.now();

    const normalizedTenantId =
      assertTenantId(
        tenantId,
      );

    const {
      page,
      limit,
      skip,
    } = normalizePagination(
      options,
    );

    const ComplianceAlert =
      resolveModel(
        'ComplianceAlert',
      );

    const LoanAudit =
      resolveModel('LoanAudit');

    let items = [];
    let total = 0;

    if (ComplianceAlert) {
      const filter =
        tenantMatch(
          normalizedTenantId,
        );

      total =
        await countDocumentsSafe(
          ComplianceAlert,
          filter,
        );

      items =
        await ComplianceAlert.find(
          filter,
        )
          .sort({
            createdAt: -1,
            _id: -1,
          })
          .skip(skip)
          .limit(limit)
          .lean();
    } else if (LoanAudit) {
      const filter =
        tenantMatch(
          normalizedTenantId,
          {
            eventType: {
              $in:
                COMPLIANCE_EVENT_NAMES,
            },
          },
        );

      total =
        await countDocumentsSafe(
          LoanAudit,
          filter,
        );

      items =
        await LoanAudit.find(
          filter,
        )
          .sort({
            createdAt: -1,
            _id: -1,
          })
          .skip(skip)
          .limit(limit)
          .lean();
    }

    const safeItems =
      getArray(items).map(
        (item) => ({
          id:
            item._id
              ? String(item._id)
              : null,

          type:
            normalizeText(
              item.type ??
                item.alertType ??
                item.eventType,
            ) ||
            'compliance',

          severity:
            normalizeText(
              item.severity ??
                item.riskLevel,
            ) ||
            'unknown',

          status:
            normalizeText(
              item.status,
            ) ||
            'open',

          category:
            normalizeText(
              item.category ??
                item.complianceType,
            ) ||
            null,

          score:
            item.score ??
            item.riskScore ??
            null,

          createdAt:
            item.createdAt ??
            item.occurredAt ??
            null,
        }),
      );

    const totalPages =
      limit > 0
        ? Math.ceil(
            total / limit,
          )
        : 0;

    logTiming(
      'getComplianceAlerts',
      startedAt,
      {
        tenantId:
          normalizedTenantId,
        page,
        limit,
      },
    );

    return {
      items: safeItems,

      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage:
          page < totalPages,
        hasPreviousPage:
          page > 1,
      },
    };
  }

  /**
   * ===========================================================================
   * Revenue trend
   * ===========================================================================
   */
  static async getRevenueTrend(
    tenantId,
    options = {},
  ) {
    const startedAt = Date.now();

    const normalizedTenantId =
      assertTenantId(
        tenantId,
      );

    const period =
      normalizeText(
        options.period,
      ) || 'monthly';

    if (
      !REVENUE_PERIODS.includes(
        period,
      )
    ) {
      const error = new Error(
        `Unsupported revenue period: ${period}`,
      );

      error.code =
        'DASHBOARD_INVALID_REVENUE_PERIOD';

      error.statusCode = 400;

      throw error;
    }

    const Revenue =
      resolveModel('Revenue');

    /**
     * Never substitute transaction volume for actual revenue.
     *
     * If the dedicated revenue model has not yet been normalized, this service
     * returns an empty dataset and explicitly marks the result as unavailable.
     */
    if (!Revenue) {
      return {
        period,
        startDate:
          options.startDate ??
          null,
        endDate:
          options.endDate ??
          null,
        currency: 'UGX',
        available: false,
        data: [],
        totals: {
          revenue: '0.00',
          count: 0,
        },
        source:
          'dedicated_revenue_model_unavailable',
      };
    }

    const startDate =
      normalizeDate(
        options.startDate,
      );

    const endDate =
      normalizeDate(
        options.endDate,
      );

    const match = {
      tenantId:
        normalizedTenantId,
    };

    if (startDate) {
      match.$or = [
        {
          createdAt: {
            $gte: startDate,
            ...(endDate
              ? {
                  $lte:
                    endDate,
                }
              : {}),
          },
        },
        {
          date: {
            $gte: startDate,
            ...(endDate
              ? {
                  $lte:
                    endDate,
                }
              : {}),
          },
        },
      ];
    }

    const periodFormat =
      period === 'daily'
        ? '%Y-%m-%d'
        : period === 'weekly'
          ? '%G-W%V'
          : period === 'monthly'
            ? '%Y-%m'
            : period === 'quarterly'
              ? null
              : '%Y';

    const groupId =
      periodFormat
        ? {
            period: {
              $dateToString: {
                format:
                  periodFormat,
                date:
                  coalesceDateExpression(),
              },
            },
          }
        : {
            year: {
              $year:
                coalesceDateExpression(),
            },
            quarter: {
              $ceil: {
                $divide: [
                  {
                    $month:
                      coalesceDateExpression(),
                  },
                  3,
                ],
              },
            },
          };

    const rows =
      await Revenue.aggregate([
        {
          $match: match,
        },

        {
          $group: {
            _id: groupId,

            revenue: {
              $sum:
                decimalExpression(
                  'amount',
                ),
            },

            count: {
              $sum: 1,
            },
          },
        },

        {
          $sort: {
            '_id.period': 1,
            '_id.year': 1,
            '_id.quarter': 1,
          },
        },
      ]);

    const data =
      rows.map(
        (row) => {
          let label =
            row._id?.period;

          if (
            !label &&
            row._id?.year
          ) {
            label =
              `${row._id.year}-Q${row._id.quarter}`;
          }

          return {
            period:
              label ?? 'unknown',
            revenue:
              decimalToString(
                row.revenue,
              ),
            count:
              safeNumber(
                row.count,
              ),
          };
        },
      );

    const totalRevenue =
      data.reduce(
        (sum, item) =>
          sum +
          (
            Number(
              item.revenue,
            ) || 0
          ),
        0,
      );

    const totalCount =
      data.reduce(
        (sum, item) =>
          sum +
          safeNumber(
            item.count,
          ),
        0,
      );

    logTiming(
      'getRevenueTrend',
      startedAt,
      {
        tenantId:
          normalizedTenantId,
        period,
      },
    );

    return {
      period,
      startDate:
        startDate?.toISOString() ??
        null,
      endDate:
        endDate?.toISOString() ??
        null,
      currency:
        'UGX',
      available: true,
      data,
      totals: {
        revenue:
          totalRevenue.toFixed(2),
        count:
          totalCount,
      },
      source:
        'dedicated_revenue_model',
    };
  }

  /**
   * ===========================================================================
   * Portfolio overview
   * ===========================================================================
   */
  static async getPortfolioOverview(
    tenantId,
  ) {
    const startedAt = Date.now();

    const normalizedTenantId =
      assertTenantId(
        tenantId,
      );

    const [
      loanMetrics,
      transactionMetrics,
      savingsMetrics,
    ] = await Promise.all([
      getLoanMetrics(
        normalizedTenantId,
      ),

      getTransactionMetrics(
        normalizedTenantId,
      ),

      getSavingsMetrics(
        normalizedTenantId,
      ),
    ]);

    const portfolio =
      Number(
        loanMetrics.loanPortfolio,
      ) || 0;

    const activePortfolio =
      Number(
        loanMetrics.activeLoanPortfolio,
      ) || 0;

    const defaultedPortfolio =
      Number(
        loanMetrics.defaultedPortfolio,
      ) || 0;

    const outstandingEstimate =
      Math.max(
        0,
        activePortfolio -
          (
            Number(
              loanMetrics.repaymentVolume,
            ) || 0
          ),
      );

    logTiming(
      'getPortfolioOverview',
      startedAt,
      {
        tenantId:
          normalizedTenantId,
      },
    );

    return {
      currency: 'UGX',

      grossLoanPortfolio:
        portfolio.toFixed(2),

      activeLoanPortfolio:
        activePortfolio.toFixed(2),

      defaultedPortfolio:
        defaultedPortfolio.toFixed(2),

      outstandingEstimate:
        outstandingEstimate.toFixed(2),

      totalLoans:
        loanMetrics.loanCount,

      activeLoans:
        loanMetrics.activeLoanCount,

      defaultedLoans:
        loanMetrics.defaultedLoanCount,

      completedLoans:
        loanMetrics.completedLoanCount,

      repaymentVolume:
        loanMetrics.repaymentVolume,

      transactionVolume:
        transactionMetrics.totalTransactionVolume,

      savingsBalance:
        savingsMetrics.totalSavings,
    };
  }

  /**
   * ===========================================================================
   * Savings analytics
   * ===========================================================================
   */
  static async getSavingsAnalytics(
    tenantId,
  ) {
    const startedAt = Date.now();

    const normalizedTenantId =
      assertTenantId(
        tenantId,
      );

    const Savings =
      resolveModel('Savings');

    const Contribution =
      resolveModel(
        'Contribution',
      );

    const result = {
      currency: 'UGX',

      totalSavings:
        '0.00',

      activePlans: 0,

      completedPlans: 0,

      contributionCount: 0,

      contributionVolume:
        '0.00',

      averageContribution:
        '0.00',

      byStatus: [],
    };

    if (Savings) {
      const rows =
        await Savings.aggregate([
          {
            $match:
              tenantMatch(
                normalizedTenantId,
              ),
          },

          {
            $group: {
              _id: {
                $toLower: {
                  $ifNull: [
                    '$status',
                    'unknown',
                  ],
                },
              },

              count: {
                $sum: 1,
              },

              amount: {
                $sum:
                  decimalExpression(
                    'balance',
                    {
                      $ifNull: [
                        '$amount',
                        0,
                      ],
                    },
                  ),
              },
            },
          },

          {
            $sort: {
              count: -1,
            },
          },
        ]);

      result.byStatus =
        rows.map(
          (row) => ({
            status:
              row._id ||
              'unknown',

            count:
              safeNumber(
                row.count,
              ),

            amount:
              decimalToString(
                row.amount,
              ),
          }),
        );

      for (const row of rows) {
        const status =
          normalizeStatus(
            row._id,
          );

        if (
          [
            'active',
            'open',
            'running',
          ].includes(status)
        ) {
          result.activePlans +=
            safeNumber(
              row.count,
            );
        }

        if (
          [
            'completed',
            'closed',
            'matured',
          ].includes(status)
        ) {
          result.completedPlans +=
            safeNumber(
              row.count,
            );
        }

        result.totalSavings =
          (
            Number(
              result.totalSavings,
            ) +
            (
              Number(
                decimalToString(
                  row.amount,
                ),
              ) || 0
            )
          ).toFixed(2);
      }
    }

    if (Contribution) {
      const rows =
        await Contribution.aggregate([
          {
            $match:
              tenantMatch(
                normalizedTenantId,
              ),
          },

          {
            $group: {
              _id: null,

              count: {
                $sum: 1,
              },

              volume: {
                $sum:
                  decimalExpression(
                    'amount',
                  ),
              },
            },
          },
        ]);

      const contribution =
        rows[0] ?? {};

      result.contributionCount =
        safeNumber(
          contribution.count,
        );

      result.contributionVolume =
        decimalToString(
          contribution.volume,
        );

      result.averageContribution =
        result.contributionCount > 0
          ? (
              (
                Number(
                  result.contributionVolume,
                ) || 0
              ) /
              result.contributionCount
            ).toFixed(2)
          : '0.00';
    }

    logTiming(
      'getSavingsAnalytics',
      startedAt,
      {
        tenantId:
          normalizedTenantId,
      },
    );

    return result;
  }

  /**
   * ===========================================================================
   * Loan analytics
   * ===========================================================================
   */
  static async getLoanAnalytics(
    tenantId,
  ) {
    const startedAt = Date.now();

    const normalizedTenantId =
      assertTenantId(
        tenantId,
      );

    const Loan =
      resolveModel('Loan');

    if (!Loan) {
      return {
        currency: 'UGX',
        totalLoans: 0,
        totalPortfolio: '0.00',
        activeLoans: 0,
        activePortfolio: '0.00',
        pendingLoans: 0,
        defaultedLoans: 0,
        defaultedPortfolio: '0.00',
        completedLoans: 0,
        recoveryRate: 0,
        defaultRate: 0,
        byStatus: [],
      };
    }

    const rows =
      await Loan.aggregate([
        {
          $match:
            tenantMatch(
              normalizedTenantId,
            ),
        },

        {
          $group: {
            _id: {
              $toLower: {
                $ifNull: [
                  '$status',
                  'unknown',
                ],
              },
            },

            count: {
              $sum: 1,
            },

            amount: {
              $sum:
                decimalExpression(
                  'amount',
                ),
            },

            repaidAmount: {
              $sum:
                decimalExpression(
                  'repaidAmount',
                ),
            },
          },
        },

        {
          $sort: {
            count: -1,
          },
        },
      ]);

    let totalLoans = 0;
    let totalPortfolio = 0;
    let activeLoans = 0;
    let activePortfolio = 0;
    let pendingLoans = 0;
    let defaultedLoans = 0;
    let defaultedPortfolio = 0;
    let completedLoans = 0;
    let repaymentVolume = 0;

    const byStatus =
      rows.map(
        (row) => {
          const status =
            normalizeStatus(
              row._id,
            );

          const count =
            safeNumber(
              row.count,
            );

          const amount =
            Number(
              decimalToString(
                row.amount,
              ),
            ) || 0;

          const repaid =
            Number(
              decimalToString(
                row.repaidAmount,
              ),
            ) || 0;

          totalLoans +=
            count;

          totalPortfolio +=
            amount;

          repaymentVolume +=
            repaid;

          if (
            LOAN_ACTIVE_STATUSES.includes(
              status,
            )
          ) {
            activeLoans +=
              count;

            activePortfolio +=
              amount;
          }

          if (
            [
              'pending',
              'requested',
              'submitted',
            ].includes(status)
          ) {
            pendingLoans +=
              count;
          }

          if (
            LOAN_DEFAULT_STATUSES.includes(
              status,
            )
          ) {
            defaultedLoans +=
              count;

            defaultedPortfolio +=
              amount;
          }

          if (
            LOAN_COMPLETED_STATUSES.includes(
              status,
            )
          ) {
            completedLoans +=
              count;
          }

          return {
            status:
              status ||
              'unknown',

            count,

            amount:
              amount.toFixed(2),

            repaidAmount:
              repaid.toFixed(2),
          };
        },
      );

    const recoveryRate =
      totalPortfolio > 0
        ? (
            repaymentVolume /
            totalPortfolio
          ) *
          100
        : 0;

    const defaultRate =
      totalLoans > 0
        ? (
            defaultedLoans /
            totalLoans
          ) *
          100
        : 0;

    logTiming(
      'getLoanAnalytics',
      startedAt,
      {
        tenantId:
          normalizedTenantId,
      },
    );

    return {
      currency: 'UGX',

      totalLoans,

      totalPortfolio:
        totalPortfolio.toFixed(2),

      activeLoans,

      activePortfolio:
        activePortfolio.toFixed(2),

      pendingLoans,

      defaultedLoans,

      defaultedPortfolio:
        defaultedPortfolio.toFixed(2),

      completedLoans,

      repaymentVolume:
        repaymentVolume.toFixed(2),

      recoveryRate:
        Number(
          recoveryRate.toFixed(2),
        ),

      defaultRate:
        Number(
          defaultRate.toFixed(2),
        ),

      byStatus,
    };
  }

  /**
   * ===========================================================================
   * Risk analytics
   * ===========================================================================
   */
  static async getRiskAnalytics(
    tenantId,
  ) {
    const startedAt = Date.now();

    const normalizedTenantId =
      assertTenantId(
        tenantId,
      );

    const Loan =
      resolveModel('Loan');

    const LoanAudit =
      resolveModel(
        'LoanAudit',
      );

    let totalLoans = 0;
    let defaultedLoans = 0;
    let overdueLoans = 0;

    let highRiskCount = 0;
    let mediumRiskCount = 0;
    let lowRiskCount = 0;

    if (Loan) {
      const rows =
        await Loan.aggregate([
          {
            $match:
              tenantMatch(
                normalizedTenantId,
              ),
          },

          {
            $addFields: {
              statusNormalized: {
                $toLower: {
                  $ifNull: [
                    '$status',
                    '',
                  ],
                },
              },

              riskNormalized: {
                $toLower: {
                  $ifNull: [
                    '$riskLevel',
                    {
                      $ifNull: [
                        '$riskCategory',
                        '',
                      ],
                    },
                  ],
                },
              },
            },
          },

          {
            $group: {
              _id: null,

              totalLoans: {
                $sum: 1,
              },

              defaultedLoans: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        '$statusNormalized',
                        LOAN_DEFAULT_STATUSES,
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              overdueLoans: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        '$statusNormalized',
                        [
                          'overdue',
                          'late',
                          'delinquent',
                        ],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              highRiskCount: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        '$riskNormalized',
                        [
                          'high',
                          'critical',
                          'severe',
                        ],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              mediumRiskCount: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        '$riskNormalized',
                        [
                          'medium',
                          'moderate',
                        ],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              lowRiskCount: {
                $sum: {
                  $cond: [
                    {
                      $in: [
                        '$riskNormalized',
                        [
                          'low',
                        ],
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]);

      const result =
        rows[0] ?? {};

      totalLoans =
        safeNumber(
          result.totalLoans,
        );

      defaultedLoans =
        safeNumber(
          result.defaultedLoans,
        );

      overdueLoans =
        safeNumber(
          result.overdueLoans,
        );

      highRiskCount =
        safeNumber(
          result.highRiskCount,
        );

      mediumRiskCount =
        safeNumber(
          result.mediumRiskCount,
        );

      lowRiskCount =
        safeNumber(
          result.lowRiskCount,
        );
    }

    let riskEvents = 0;

    if (LoanAudit) {
      riskEvents =
        await countDocumentsSafe(
          LoanAudit,
          tenantMatch(
            normalizedTenantId,
            {
              eventType: {
                $in: [
                  ...FRAUD_EVENT_NAMES,
                  ...COMPLIANCE_EVENT_NAMES,
                  'risk',
                  'risk_assessment',
                ],
              },
            },
          ),
        );
    }

    const totalRiskRated =
      highRiskCount +
      mediumRiskCount +
      lowRiskCount;

    const highRiskRate =
      totalRiskRated > 0
        ? (
            highRiskCount /
            totalRiskRated
          ) *
          100
        : 0;

    const portfolioDefaultRate =
      totalLoans > 0
        ? (
            defaultedLoans /
            totalLoans
          ) *
          100
        : 0;

    logTiming(
      'getRiskAnalytics',
      startedAt,
      {
        tenantId:
          normalizedTenantId,
      },
    );

    return {
      totalLoans,

      defaultedLoans,

      overdueLoans,

      highRiskCount,

      mediumRiskCount,

      lowRiskCount,

      highRiskRate:
        Number(
          highRiskRate.toFixed(2),
        ),

      portfolioDefaultRate:
        Number(
          portfolioDefaultRate.toFixed(2),
        ),

      riskEvents,

      /**
       * Human-readable risk posture for executive UI.
       */
      riskPosture:
        highRiskRate >= 20
          ? 'critical'
          : highRiskRate >= 10
            ? 'elevated'
            : highRiskRate >= 5
              ? 'watch'
              : 'normal',
    };
  }

  /**
   * ===========================================================================
   * Executive summary
   * ===========================================================================
   */
  static async getExecutiveSummary(
    tenantId,
  ) {
    const startedAt = Date.now();

    const normalizedTenantId =
      assertTenantId(
        tenantId,
      );

    const [
      metrics,
      portfolio,
      loanAnalytics,
      risk,
    ] = await Promise.all([
      this.getMetrics(
        normalizedTenantId,
      ),

      this.getPortfolioOverview(
        normalizedTenantId,
      ),

      this.getLoanAnalytics(
        normalizedTenantId,
      ),

      this.getRiskAnalytics(
        normalizedTenantId,
      ),
    ]);

    const returnOnPortfolio =
      Number(
        portfolio.grossLoanPortfolio,
      ) > 0
        ? (
            (
              Number(
                metrics.revenue,
              ) || 0
            ) /
            Number(
              portfolio.grossLoanPortfolio,
            )
          ) *
          100
        : 0;

    logTiming(
      'getExecutiveSummary',
      startedAt,
      {
        tenantId:
          normalizedTenantId,
      },
    );

    return {
      generatedAt:
        new Date().toISOString(),

      tenantId:
        normalizedTenantId,

      headlineMetrics: {
        assets:
          metrics.totalAssets,

        liabilities:
          metrics.totalLiabilities,

        savings:
          metrics.totalSavings,

        loanPortfolio:
          metrics.loanPortfolio,

        revenue:
          metrics.revenue,

        expenses:
          metrics.expenses,

        profit:
          metrics.profit,

        activeMembers:
          metrics.activeMembers,

        activeGroups:
          metrics.activeGroups,
      },

      portfolio: {
        grossLoanPortfolio:
          portfolio.grossLoanPortfolio,

        activeLoanPortfolio:
          portfolio.activeLoanPortfolio,

        defaultedPortfolio:
          portfolio.defaultedPortfolio,

        repaymentVolume:
          portfolio.repaymentVolume,

        recoveryRate:
          loanAnalytics.recoveryRate,

        defaultRate:
          loanAnalytics.defaultRate,
      },

      risk: {
        posture:
          risk.riskPosture,

        highRiskCount:
          risk.highRiskCount,

        mediumRiskCount:
          risk.mediumRiskCount,

        lowRiskCount:
          risk.lowRiskCount,

        overdueLoans:
          risk.overdueLoans,

        defaultedLoans:
          risk.defaultedLoans,

        highRiskRate:
          risk.highRiskRate,
      },

      operatingScale: {
        totalMembers:
          metrics.totalMembers,

        activeMembers:
          metrics.activeMembers,

        totalGroups:
          metrics.totalGroups,

        activeGroups:
          metrics.activeGroups,

        transactions:
          metrics.transactionCount,
      },

      performance: {
        returnOnPortfolio:
          Number(
            returnOnPortfolio.toFixed(2),
          ),
      },

      /**
       * Strategic dashboard state.
       *
       * These are derived from current operational values and are not
       * accounting assertions.
       */
      strategicFlags: {
        portfolioGrowthReady:
          metrics.activeGroups > 0 &&
          metrics.activeMembers > 0,

        repaymentWatch:
          loanAnalytics.defaultRate >= 5,

        riskWatch:
          risk.riskPosture !== 'normal',

        digitalPaymentsAdoption:
          Number(
            metrics.mobileMoneyVolume,
          ) > 0,

        dataQuality:
          'operational',
      },
    };
  }

  /**
   * ===========================================================================
   * Board / CEO snapshot
   * ===========================================================================
   */
  static async getSnapshot(
    tenantId,
  ) {
    const startedAt = Date.now();

    const normalizedTenantId =
      assertTenantId(
        tenantId,
      );

    const [
      summary,
      charts,
      fraudAlerts,
      complianceAlerts,
    ] = await Promise.all([
      this.getExecutiveSummary(
        normalizedTenantId,
      ),

      this.getCharts(
        normalizedTenantId,
        '12m',
      ),

      this.getFraudAlerts(
        normalizedTenantId,
        {
          page: 1,
          limit: 5,
        },
      ),

      this.getComplianceAlerts(
        normalizedTenantId,
        {
          page: 1,
          limit: 5,
        },
      ),
    ]);

    const criticalFraudAlerts =
      fraudAlerts.items.filter(
        (item) =>
          [
            'critical',
            'high',
          ].includes(
            normalizeStatus(
              item.severity,
            ),
          ),
      ).length;

    const criticalComplianceAlerts =
      complianceAlerts.items.filter(
        (item) =>
          [
            'critical',
            'high',
          ].includes(
            normalizeStatus(
              item.severity,
            ),
          ),
      ).length;

    logTiming(
      'getSnapshot',
      startedAt,
      {
        tenantId:
          normalizedTenantId,
      },
    );

    return {
      generatedAt:
        new Date().toISOString(),

      period:
        '12m',

      summary,

      charts,

      alerts: {
        fraud: {
          total:
            fraudAlerts.pagination
              .total,

          critical:
            criticalFraudAlerts,

          items:
            fraudAlerts.items,
        },

        compliance: {
          total:
            complianceAlerts
              .pagination
              .total,

          critical:
            criticalComplianceAlerts,

          items:
            complianceAlerts.items,
        },
      },

      boardSignals: {
        overallRisk:
          summary.risk.posture,

        portfolioDefaultRate:
          summary.portfolio
            .defaultRate,

        loanRecoveryRate:
          summary.portfolio
            .recoveryRate,

        operationalScale:
          summary.operatingScale,

        immediateAttention:
          criticalFraudAlerts +
            criticalComplianceAlerts,
      },

      dataAuthority: {
        analytics:
          'dashboard-read-model',

        accounting:
          'canonical-financial-ledger',

        transactions:
          'canonical-transaction-service',

        compliance:
          'configured-compliance-models',
      },
    };
  }
}

/**
 * =============================================================================
 * Service diagnostics / export contract
 * =============================================================================
 */

/**
 * Expose a lightweight capability report for health diagnostics and tests.
 */
export const getDashboardServiceCapabilities =
  () => ({
    service:
      SERVICE_NAME,

    models: Object.fromEntries(
      Object.keys(
        MODEL_CANDIDATES,
      ).map(
        (name) => [
          name,
          Boolean(
            resolveModel(
              name,
            ),
          ),
        ],
      ),
    ),

    methods: [
      'getMetrics',
      'getCharts',
      'getFraudAlerts',
      'getComplianceAlerts',
      'getRevenueTrend',
      'getPortfolioOverview',
      'getSavingsAnalytics',
      'getLoanAnalytics',
      'getRiskAnalytics',
      'getExecutiveSummary',
      'getSnapshot',
    ],
  });

/**
 * Explicit named export.
 */
export {
  DashboardService,
};

/**
 * Canonical default export.
 */
export default DashboardService;