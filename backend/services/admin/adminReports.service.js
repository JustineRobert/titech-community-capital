'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Reports Service
 * ============================================================================
 *
 * File:
 *   backend/services/admin/adminReports.service.js
 *
 * Purpose:
 *   Canonical production reporting engine for TITech Community Capital.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Generate tenant-scoped administrative reports.
 * - Generate executive / board-ready summaries.
 * - Generate financial transaction reports.
 * - Generate savings portfolio reports.
 * - Generate loan portfolio and risk reports.
 * - Generate member / KYC / AML reports.
 * - Generate fraud and compliance reports.
 * - Support deterministic CSV and JSON exports.
 * - Enforce tenant isolation.
 * - Validate report filters.
 * - Prevent sensitive secrets from being exported.
 * - Keep reporting stateless; persistence/scheduling belongs to a dedicated
 *   report-job module when such a model exists.
 *
 * Architectural Rules
 * ----------------------------------------------------------------------------
 * 1. Tenant isolation is mandatory.
 * 2. Reports are read-only.
 * 3. Authoritative financial models remain the source of truth.
 * 4. No direct financial mutation is permitted.
 * 5. Report generation must not trust client-provided calculated totals.
 * 6. CSV/JSON export must use sanitized report rows.
 * 7. Report limits are bounded to prevent accidental memory exhaustion.
 * 8. No guessed Report/ReportJob repository interface is introduced.
 * 9. ACFOS terminology is replaced with TITech Community Capital.
 * 10. Authorization/RBAC remains the controller/middleware responsibility.
 *
 * Current project model notes
 * ----------------------------------------------------------------------------
 * - Transaction.tenantId  => ObjectId
 * - Contribution.tenantId => ObjectId
 * - Member.tenantId       => String
 * - Savings.tenantId      => String
 * - Loan.tenantId         => String
 * - FraudLog.tenantId     => String
 * - ComplianceLog.tenantId=> String
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const logger = require('../../utils/logger');

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

const SERVICE_NAME =
  'AdminReportsService';

const SERVICE_VERSION =
  '2026.1';

const DEFAULT_DAYS =
  30;

const MAX_DAYS =
  3660;

const DEFAULT_LIMIT =
  5000;

const MAX_LIMIT =
  50000;

const MAX_EXPORT_ROWS =
  50000;

/**
 * ============================================================================
 * REPORT TYPES
 * ============================================================================
 */

const REPORT_TYPES = Object.freeze({
  EXECUTIVE:
    'executive',

  TRANSACTIONS:
    'transactions',

  SAVINGS:
    'savings',

  CONTRIBUTIONS:
    'contributions',

  LOANS:
    'loans',

  MEMBERS:
    'members',

  RISK:
    'risk',

  COMPLIANCE:
    'compliance',

  FRAUD:
    'fraud',

  AUDIT:
    'audit',
});

/**
 * ============================================================================
 * VALID ENUMS
 * ============================================================================
 */

const TRANSACTION_STATUSES =
  Object.freeze([
    'PENDING',
    'PROCESSING',
    'SUCCESS',
    'FAILED',
    'CANCELLED',
    'EXPIRED',
    'REVERSED',
    'SETTLED',
  ]);

const TRANSACTION_TYPES =
  Object.freeze([
    'DEPOSIT',
    'WITHDRAWAL',
    'LOAN_DISBURSEMENT',
    'LOAN_REPAYMENT',
    'CONTRIBUTION',
    'SETTLEMENT',
    'TRANSFER',
    'REFUND',
  ]);

const TRANSACTION_PROVIDERS =
  Object.freeze([
    'mtn_momo',
    'airtel_money',
    'bank',
    'cash',
    'internal',
  ]);

const MEMBER_STATUSES =
  Object.freeze([
    'PENDING',
    'ACTIVE',
    'DORMANT',
    'SUSPENDED',
    'EXITED',
    'DECEASED',
  ]);

const KYC_STATUSES =
  Object.freeze([
    'PENDING',
    'VERIFIED',
    'REJECTED',
  ]);

const LOAN_STATUSES =
  Object.freeze([
    'draft',
    'submitted',
    'under_review',
    'approved',
    'rejected',
    'disbursed',
    'active',
    'completed',
    'defaulted',
    'written_off',
    'recovered',
    'restructured',
    'cancelled',
  ]);

const FRAUD_DECISIONS =
  Object.freeze([
    'ALLOW',
    'STEP_UP',
    'BLOCK',
  ]);

/**
 * ============================================================================
 * ERROR
 * ============================================================================
 */

class AdminReportsError extends Error {
  constructor(
    message,
    {
      code = 'ADMIN_REPORTS_ERROR',
      statusCode = 500,
      details = null,
      cause = null,
    } = {},
  ) {
    super(message);

    this.name =
      'AdminReportsError';

    this.code =
      code;

    this.statusCode =
      statusCode;

    this.details =
      details;

    this.cause =
      cause;
  }
}

/**
 * ============================================================================
 * HELPERS
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

  const result =
    String(value).trim();

  return result ||
    fallback;
}

function normalizeArray(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return [];
  }

  const source =
    Array.isArray(value)
      ? value
      : String(value).split(',');

  return source
    .map((item) =>
      normalizeString(item),
    )
    .filter(Boolean);
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

function toObjectId(
  value,
  field = 'id',
) {
  const normalized =
    normalizeString(value);

  if (!normalized) {
    throw new AdminReportsError(
      `${field} is required.`,
      {
        code:
          `${String(field).toUpperCase()}_REQUIRED`,
        statusCode: 400,
      },
    );
  }

  if (
    !mongoose.Types.ObjectId.isValid(
      normalized,
    )
  ) {
    throw new AdminReportsError(
      `${field} is not a valid MongoDB ObjectId.`,
      {
        code:
          `INVALID_${String(
            field,
          ).toUpperCase()}`,
        statusCode: 400,
      },
    );
  }

  return new mongoose.Types.ObjectId(
    normalized,
  );
}

function normalizeTenant(
  tenantId,
) {
  return normalizeString(
    tenantId,
  );
}

function parseDate(
  value,
  field,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const result =
    value instanceof Date
      ? new Date(
          value.getTime(),
        )
      : new Date(value);

  if (
    Number.isNaN(
      result.getTime(),
    )
  ) {
    throw new AdminReportsError(
      `Invalid ${field}.`,
      {
        code:
          `INVALID_${String(
            field,
          ).toUpperCase()}`,
        statusCode: 400,
      },
    );
  }

  return result;
}

function normalizeRange(
  options = {},
) {
  const now =
    new Date();

  const daysRaw =
    Number(
      options.days ||
        DEFAULT_DAYS,
    );

  const days =
    Number.isInteger(
      daysRaw,
    ) && daysRaw > 0
      ? Math.min(
          daysRaw,
          MAX_DAYS,
        )
      : DEFAULT_DAYS;

  const from =
    parseDate(
      options.from,
      'from',
    ) ||
    new Date(
      now.getTime() -
        days *
          24 *
          60 *
          60 *
          1000,
    );

  const to =
    parseDate(
      options.to,
      'to',
    ) ||
    now;

  if (from > to) {
    throw new AdminReportsError(
      '`from` cannot be later than `to`.',
      {
        code:
          'INVALID_DATE_RANGE',
        statusCode: 400,
      },
    );
  }

  return {
    from,
    to,
  };
}

function numberValue(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  if (
    typeof value ===
    'object' &&
    typeof value.toString ===
      'function'
  ) {
    const parsed =
      Number(
        value.toString(),
      );

    return Number.isFinite(
      parsed,
    )
      ? parsed
      : 0;
  }

  const parsed =
    Number(value);

  return Number.isFinite(
    parsed,
  )
    ? parsed
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
      numberValue(value) *
        factor,
    ) / factor
  );
}

function percent(
  numerator,
  denominator,
) {
  const denominatorValue =
    numberValue(denominator);

  if (
    denominatorValue === 0
  ) {
    return 0;
  }

  return round(
    (
      numberValue(
        numerator,
      ) /
      denominatorValue
    ) * 100,
  );
}

function first(
  rows,
) {
  return (
    Array.isArray(rows) &&
    rows.length
      ? rows[0]
      : null
  );
}

function serializeId(
  value,
) {
  if (!value) {
    return null;
  }

  return String(value);
}

/**
 * ============================================================================
 * SENSITIVE DATA PROTECTION
 * ============================================================================
 */

const SENSITIVE_KEYS =
  Object.freeze([
    'password',
    'passwordhash',
    'token',
    'accesstoken',
    'refreshtoken',
    'authorization',
    'cookie',
    'secret',
    'apikey',
    'privatekey',
    'pin',
    'otp',
    'cvv',
    'cardnumber',
    'nationalid',
    'passportnumber',
  ]);

function isSensitiveKey(
  key,
) {
  const normalized =
    String(key)
      .replace(
        /[-_\s]/g,
        '',
      )
      .toLowerCase();

  return SENSITIVE_KEYS.some(
    (item) =>
      normalized.includes(
        item,
      ),
  );
}

function sanitize(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      sanitize,
    );
  }

  if (
    typeof value !==
    'object'
  ) {
    return value;
  }

  const result = {};

  for (
    const [key, item] of
    Object.entries(value)
  ) {
    if (
      isSensitiveKey(key)
    ) {
      result[key] =
        '[REDACTED]';

      continue;
    }

    result[key] =
      sanitize(item);
  }

  return result;
}

/**
 * ============================================================================
 * CSV
 * ============================================================================
 */

function csvValue(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    typeof value ===
    'object'
  ) {
    return JSON.stringify(
      sanitize(value),
    );
  }

  return String(value);
}

function escapeCsv(
  value,
) {
  const raw =
    csvValue(value);

  if (
    /[",\r\n]/.test(raw)
  ) {
    return `"${raw.replace(
      /"/g,
      '""',
    )}"`;
  }

  return raw;
}

function recordsToCsv(
  records,
) {
  if (
    !Array.isArray(records) ||
    records.length === 0
  ) {
    return '';
  }

  const keys = [
    ...new Set(
      records.flatMap(
        (record) =>
          Object.keys(
            record || {},
          ),
      ),
    ),
  ];

  const header =
    keys
      .map(escapeCsv)
      .join(',');

  const lines =
    records.map(
      (record) =>
        keys
          .map((key) =>
            escapeCsv(
              record?.[key],
            ),
          )
          .join(','),
    );

  return [
    header,
    ...lines,
  ].join('\r\n');
}

/**
 * ============================================================================
 * REPORT SERVICE
 * ============================================================================
 */

class AdminReportsService {
  constructor({
    loggerInstance =
      logger,
    models = {},
  } = {}) {
    this.logger =
      loggerInstance;

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
   * TENANT FILTERS
   * ==========================================================================
   */

  objectTenant(
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

  stringTenant(
    tenantId,
  ) {
    return {
      tenantId:
        normalizeTenant(
          tenantId,
        ),
    };
  }

  /**
   * ==========================================================================
   * REPORT REGISTRY
   * ==========================================================================
   */

  getReportDefinitions() {
    return [
      {
        id:
          REPORT_TYPES.EXECUTIVE,

        name:
          'Executive Management Report',

        description:
          'High-level operational, financial, savings, lending, risk and compliance summary.',

        sources: [
          'Transaction',
          'Contribution',
          'Savings',
          'Loan',
          'Member',
          'FraudLog',
          'ComplianceLog',
        ],
      },

      {
        id:
          REPORT_TYPES.TRANSACTIONS,

        name:
          'Transaction Report',

        description:
          'Tenant-scoped transaction activity and financial movement.',

        sources: [
          'Transaction',
        ],
      },

      {
        id:
          REPORT_TYPES.SAVINGS,

        name:
          'Savings Portfolio Report',

        description:
          'Savings accounts, balances, deposits, withdrawals and portfolio status.',

        sources: [
          'Savings',
        ],
      },

      {
        id:
          REPORT_TYPES.CONTRIBUTIONS,

        name:
          'Contribution Report',

        description:
          'Tenant-scoped community contribution activity.',

        sources: [
          'Contribution',
        ],
      },

      {
        id:
          REPORT_TYPES.LOANS,

        name:
          'Loan Portfolio Report',

        description:
          'Loan book, outstanding balances, repayments, risk and arrears.',

        sources: [
          'Loan',
        ],
      },

      {
        id:
          REPORT_TYPES.MEMBERS,

        name:
          'Member Report',

        description:
          'Member status, KYC, AML, risk and portfolio indicators.',

        sources: [
          'Member',
        ],
      },

      {
        id:
          REPORT_TYPES.RISK,

        name:
          'Risk Report',

        description:
          'Member, loan and fraud-risk indicators.',

        sources: [
          'Member',
          'Loan',
          'FraudLog',
        ],
      },

      {
        id:
          REPORT_TYPES.COMPLIANCE,

        name:
          'Compliance Report',

        description:
          'KYC/AML/sanctions and compliance-activity reporting.',

        sources: [
          'Member',
          'ComplianceLog',
        ],
      },

      {
        id:
          REPORT_TYPES.FRAUD,

        name:
          'Fraud Monitoring Report',

        description:
          'Fraud decisions, scoring and review workload.',

        sources: [
          'FraudLog',
        ],
      },

      {
        id:
          REPORT_TYPES.AUDIT,

        name:
          'Audit Activity Report',

        description:
          'Tenant-scoped administrative audit activity.',

        sources: [
          'AuditLog',
        ],
      },
    ];
  }

  /**
   * ==========================================================================
   * GENERIC REPORT DISPATCH
   * ==========================================================================
   */

  async generate(
    reportType,
    tenantId,
    options = {},
  ) {
    const normalizedType =
      normalizeString(
        reportType,
      );

    const validTypes =
      Object.values(
        REPORT_TYPES,
      );

    if (
      !validTypes.includes(
        normalizedType,
      )
    ) {
      throw new AdminReportsError(
        `Unsupported report type: ${normalizedType}.`,
        {
          code:
            'UNSUPPORTED_REPORT_TYPE',
          statusCode: 400,
          details: {
            supported:
              validTypes,
          },
        },
      );
    }

    const normalizedTenantId =
      normalizeTenant(
        tenantId,
      );

    if (!normalizedTenantId) {
      throw new AdminReportsError(
        'tenantId is required.',
        {
          code:
            'TENANT_ID_REQUIRED',
          statusCode: 400,
        },
      );
    }

    const range =
      normalizeRange(
        options,
      );

    const context = {
      tenantId:
        normalizedTenantId,

      range,

      options,
    };

    try {
      let result;

      switch (
        normalizedType
      ) {
        case REPORT_TYPES.EXECUTIVE:
          result =
            await this.generateExecutiveReport(
              context,
            );
          break;

        case REPORT_TYPES.TRANSACTIONS:
          result =
            await this.generateTransactionReport(
              context,
            );
          break;

        case REPORT_TYPES.SAVINGS:
          result =
            await this.generateSavingsReport(
              context,
            );
          break;

        case REPORT_TYPES.CONTRIBUTIONS:
          result =
            await this.generateContributionReport(
              context,
            );
          break;

        case REPORT_TYPES.LOANS:
          result =
            await this.generateLoanReport(
              context,
            );
          break;

        case REPORT_TYPES.MEMBERS:
          result =
            await this.generateMemberReport(
              context,
            );
          break;

        case REPORT_TYPES.RISK:
          result =
            await this.generateRiskReport(
              context,
            );
          break;

        case REPORT_TYPES.COMPLIANCE:
          result =
            await this.generateComplianceReport(
              context,
            );
          break;

        case REPORT_TYPES.FRAUD:
          result =
            await this.generateFraudReport(
              context,
            );
          break;

        case REPORT_TYPES.AUDIT:
          result =
            await this.generateAuditReport(
              context,
            );
          break;

        default:
          throw new AdminReportsError(
            'Unsupported report type.',
            {
              code:
                'UNSUPPORTED_REPORT_TYPE',
              statusCode: 400,
            },
          );
      }

      return {
        metadata: {
          service:
            SERVICE_NAME,

          version:
            SERVICE_VERSION,

          reportType:
            normalizedType,

          tenantId:
            normalizedTenantId,

          from:
            range.from,

          to:
            range.to,

          generatedAt:
            new Date(),

          currency:
            options.currency ||
            'UGX',

          source:
            'TITech Community Capital authoritative application models',
        },

        ...result,
      };
    } catch (error) {
      this.logError(
        'Admin report generation failed.',
        error,
        {
          reportType:
            normalizedType,

          tenantId:
            normalizedTenantId,
        },
      );

      throw this.wrapError(
        error,
        'REPORT_GENERATION_FAILED',
      );
    }
  }

  /**
   * ==========================================================================
   * EXECUTIVE REPORT
   * ==========================================================================
   */

  async generateExecutiveReport(
    {
      tenantId,
      range,
    },
  ) {
    const [
      memberSummary,
      savingsSummary,
      transactionSummary,
      contributionSummary,
      loanSummary,
      fraudSummary,
      complianceSummary,
    ] = await Promise.all([
      this.aggregateMemberSummary(
        tenantId,
      ),

      this.aggregateSavingsSummary(
        tenantId,
      ),

      this.aggregateTransactionSummary(
        tenantId,
        range,
      ),

      this.aggregateContributionSummary(
        tenantId,
        range,
      ),

      this.aggregateLoanSummary(
        tenantId,
      ),

      this.aggregateFraudSummary(
        tenantId,
        range,
      ),

      this.aggregateComplianceSummary(
        tenantId,
        range,
      ),
    ]);

    return {
      title:
        'TITech Community Capital Executive Management Report',

      summary: {
        members:
          memberSummary,

        savings:
          savingsSummary,

        transactions:
          transactionSummary,

        contributions:
          contributionSummary,

        loans:
          loanSummary,

        fraud:
          fraudSummary,

        compliance:
          complianceSummary,
      },

      kpis: {
        totalMembers:
          memberSummary.totalMembers,

        activeMembers:
          memberSummary.activeMembers,

        totalSavingsBalance:
          savingsSummary.totalBalance,

        transactionVolume:
          transactionSummary.totalAmount,

        transactionCount:
          transactionSummary.totalCount,

        contributions:
          contributionSummary.totalAmount,

        loanOutstanding:
          loanSummary.outstandingBalance,

        loanNplRatio:
          loanSummary.nplRatio,

        collectionRate:
          loanSummary.collectionRate,

        kycCompletionRate:
          memberSummary.kycCompletionRate,

        amlCompletionRate:
          memberSummary.amlCompletionRate,

        fraudAlerts:
          fraudSummary.alertCount,

        complianceFlags:
          complianceSummary.flagCount,
      },
    };
  }

  /**
   * ==========================================================================
   * MEMBER SUMMARY
   * ==========================================================================
   */

  async aggregateMemberSummary(
    tenantId,
  ) {
    const rows =
      await this.models.Member.aggregate([
        {
          $match:
            this.stringTenant(
              tenantId,
            ),
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

            fraudFlaggedMembers:
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

            blacklistedMembers:
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

            sharesBalance:
              {
                $sum:
                  '$sharesBalance',
              },

            fixedDepositBalance:
              {
                $sum:
                  '$fixedDepositBalance',
              },

            outstandingLoanBalance:
              {
                $sum:
                  '$outstandingLoanBalance',
              },
          },
        },
      ]);

    const result =
      first(rows) || {};

    return {
      totalMembers:
        numberValue(
          result.totalMembers,
        ),

      activeMembers:
        numberValue(
          result.activeMembers,
        ),

      dormantMembers:
        numberValue(
          result.dormantMembers,
        ),

      suspendedMembers:
        numberValue(
          result.suspendedMembers,
        ),

      kycVerified:
        numberValue(
          result.kycVerified,
        ),

      amlChecked:
        numberValue(
          result.amlChecked,
        ),

      sanctionsScreened:
        numberValue(
          result.sanctionsScreened,
        ),

      highRiskMembers:
        numberValue(
          result.highRiskMembers,
        ),

      fraudFlaggedMembers:
        numberValue(
          result.fraudFlaggedMembers,
        ),

      blacklistedMembers:
        numberValue(
          result.blacklistedMembers,
        ),

      savingsBalance:
        round(
          result.savingsBalance,
        ),

      sharesBalance:
        round(
          result.sharesBalance,
        ),

      fixedDepositBalance:
        round(
          result.fixedDepositBalance,
        ),

      outstandingLoanBalance:
        round(
          result.outstandingLoanBalance,
        ),

      kycCompletionRate:
        percent(
          result.kycVerified,
          result.totalMembers,
        ),

      amlCompletionRate:
        percent(
          result.amlChecked,
          result.totalMembers,
        ),

      sanctionsScreeningRate:
        percent(
          result.sanctionsScreened,
          result.totalMembers,
        ),
    };
  }

  /**
   * ==========================================================================
   * TRANSACTION SUMMARY
   * ==========================================================================
   */

  async aggregateTransactionSummary(
    tenantId,
    range,
  ) {
    const rows =
      await this.models.Transaction.aggregate([
        {
          $match: {
            ...this.objectTenant(
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

            credits:
              {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        '$flow',
                        'credit',
                      ],
                    },

                    '$amount',

                    0,
                  ],
                },
              },

            debits:
              {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        '$flow',
                        'debit',
                      ],
                    },

                    '$amount',

                    0,
                  ],
                },
              },
          },
        },
      ]);

    const result =
      first(rows) || {};

    return {
      totalCount:
        numberValue(
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

      successfulCount:
        numberValue(
          result.successfulCount,
        ),

      failedCount:
        numberValue(
          result.failedCount,
        ),

      successRate:
        percent(
          result.successfulCount,
          result.totalCount,
        ),

      failureRate:
        percent(
          result.failedCount,
          result.totalCount,
        ),

      credits:
        round(
          result.credits,
        ),

      debits:
        round(
          result.debits,
        ),
    };
  }

  /**
   * ==========================================================================
   * SAVINGS SUMMARY
   * ==========================================================================
   */

  async aggregateSavingsSummary(
    tenantId,
  ) {
    const rows =
      await this.models.Savings.aggregate([
        {
          $match:
            this.stringTenant(
              tenantId,
            ),
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

            totalDividends:
              {
                $sum:
                  '$totalDividendsEarned',
              },
          },
        },
      ]);

    const result =
      first(rows) || {};

    return {
      accounts:
        numberValue(
          result.accounts,
        ),

      activeAccounts:
        numberValue(
          result.activeAccounts,
        ),

      activeRate:
        percent(
          result.activeAccounts,
          result.accounts,
        ),

      totalBalance:
        round(
          result.totalBalance,
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

      totalDividends:
        round(
          result.totalDividends,
        ),
    };
  }

  /**
   * ==========================================================================
   * CONTRIBUTION SUMMARY
   * ==========================================================================
   */

  async aggregateContributionSummary(
    tenantId,
    range,
  ) {
    const rows =
      await this.models.Contribution.aggregate([
        {
          $match: {
            ...this.objectTenant(
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
          },
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
      ]);

    const result =
      first(rows) || {};

    return {
      totalCount:
        numberValue(
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
    };
  }

  /**
   * ==========================================================================
   * LOAN SUMMARY
   * ==========================================================================
   */

  async aggregateLoanSummary(
    tenantId,
  ) {
    const rows =
      await this.models.Loan.aggregate([
        {
          $match:
            this.stringTenant(
              tenantId,
            ),
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
      ]);

    const result =
      first(rows) || {};

    return {
      totalLoans:
        numberValue(
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
        numberValue(
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
        percent(
          result.amountRepaid,
          result.totalPrincipal,
        ),

      collectionRate:
        percent(
          result.amountRepaid,
          result.amountDue,
        ),

      nplRatio:
        percent(
          result.defaultedOutstanding,
          result.outstandingBalance,
        ),
    };
  }

  /**
   * ==========================================================================
   * TRANSACTION DETAIL REPORT
   * ==========================================================================
   */

  async generateTransactionReport(
    {
      tenantId,
      range,
      options,
    },
  ) {
    const limit =
      Math.min(
        normalizeLimit(
          options.limit,
          DEFAULT_LIMIT,
        ),
        MAX_EXPORT_ROWS,
      );

    const filter = {
      ...this.objectTenant(
        tenantId,
      ),

      createdAt: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    const statuses =
      normalizeArray(
        options.statuses ||
          options.status,
      );

    if (
      statuses.length
    ) {
      filter.status = {
        $in:
          statuses.filter(
            (item) =>
              TRANSACTION_STATUSES.includes(
                item,
              ),
          ),
      };
    }

    const transactionTypes =
      normalizeArray(
        options.transactionTypes ||
          options.transactionType,
      );

    if (
      transactionTypes.length
    ) {
      filter.transactionType = {
        $in:
          transactionTypes.filter(
            (item) =>
              TRANSACTION_TYPES.includes(
                item,
              ),
          ),
      };
    }

    const providers =
      normalizeArray(
        options.providers ||
          options.provider,
      );

    if (
      providers.length
    ) {
      filter.provider = {
        $in:
          providers.filter(
            (item) =>
              TRANSACTION_PROVIDERS.includes(
                item,
              ),
          ),
      };
    }

    const [
      summary,
      byType,
      byStatus,
      byProvider,
      byCurrency,
    ] = await Promise.all([
      this.models.Transaction.aggregate([
        {
          $match:
            filter,
        },

        {
          $group: {
            _id:
              null,

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
      ]),

      this.models.Transaction.aggregate([
        {
          $match:
            filter,
        },

        {
          $group: {
            _id:
              '$transactionType',

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
            amount: -1,
          },
        },
      ]),

      this.models.Transaction.aggregate([
        {
          $match:
            filter,
        },

        {
          $group: {
            _id:
              '$status',

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
            count: -1,
          },
        },
      ]),

      this.models.Transaction.aggregate([
        {
          $match:
            filter,
        },

        {
          $group: {
            _id:
              '$provider',

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
            amount: -1,
          },
        },
      ]),

      this.models.Transaction.aggregate([
        {
          $match:
            filter,
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
            amount: -1,
          },
        },
      ]),
    ]);

    const base =
      first(summary) || {};

    const rows =
      await this.models.Transaction
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
            'externalId',
            'providerReferenceId',
            'providerTransactionId',
            'settlementId',
            'reconciled',
            'accountingPosted',
            'createdAt',
            'updatedAt',
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

    const records =
      rows.map(
        (row) => ({
          id:
            serializeId(
              row._id,
            ),

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

          contributionId:
            serializeId(
              row.contributionId,
            ),

          transactionType:
            row.transactionType,

          flow:
            row.flow,

          provider:
            row.provider,

          amount:
            numberValue(
              row.amount,
            ),

          currency:
            row.currency,

          fees:
            numberValue(
              row.fees,
            ),

          netAmount:
            numberValue(
              row.netAmount,
            ),

          status:
            row.status,

          externalId:
            row.externalId,

          providerReferenceId:
            row.providerReferenceId,

          providerTransactionId:
            row.providerTransactionId,

          settlementId:
            row.settlementId,

          reconciled:
            row.reconciled,

          accountingPosted:
            row.accountingPosted,

          createdAt:
            row.createdAt,

          updatedAt:
            row.updatedAt,
        }),
      );

    return {
      reportType:
        REPORT_TYPES.TRANSACTIONS,

      summary: {
        count:
          numberValue(
            base.count,
          ),

        amount:
          round(
            base.amount,
          ),

        fees:
          round(
            base.fees,
          ),

        successRate:
          percent(
            base.successful,
            base.count,
          ),

        failureRate:
          percent(
            base.failed,
            base.count,
          ),
      },

      breakdowns: {
        byType:
          byType.map(
            (row) => ({
              transactionType:
                row._id,

              count:
                numberValue(
                  row.count,
                ),

              amount:
                round(
                  row.amount,
                ),
            }),
          ),

        byStatus:
          byStatus.map(
            (row) => ({
              status:
                row._id,

              count:
                numberValue(
                  row.count,
                ),

              amount:
                round(
                  row.amount,
                ),
            }),
          ),

        byProvider:
          byProvider.map(
            (row) => ({
              provider:
                row._id,

              count:
                numberValue(
                  row.count,
                ),

              amount:
                round(
                  row.amount,
                ),
            }),
          ),

        byCurrency:
          byCurrency.map(
            (row) => ({
              currency:
                row._id,

              count:
                numberValue(
                  row.count,
                ),

              amount:
                round(
                  row.amount,
                ),
            }),
          ),
      },

      records,
    };
  }

  /**
   * ==========================================================================
   * SAVINGS REPORT
   * ==========================================================================
   */

  async generateSavingsReport(
    {
      tenantId,
      range,
      options,
    },
  ) {
    const limit =
      Math.min(
        normalizeLimit(
          options.limit,
          DEFAULT_LIMIT,
        ),
        MAX_EXPORT_ROWS,
      );

    const filter = {
      ...this.stringTenant(
        tenantId,
      ),

      createdAt: {
        $lte:
          range.to,
      },
    };

    const statuses =
      normalizeArray(
        options.status ||
          options.statuses,
      );

    if (
      statuses.length
    ) {
      filter.status = {
        $in:
          statuses.slice(
            0,
            50,
          ),
      };
    }

    const summary =
      await this.models.Savings.aggregate([
        {
          $match:
            filter,
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

            deposits:
              {
                $sum:
                  '$totalDeposits',
              },

            withdrawals:
              {
                $sum:
                  '$totalWithdrawals',
              },

            netSavings:
              {
                $sum:
                  '$netSavings',
              },

            interest:
              {
                $sum:
                  '$accruedInterest',
              },
          },
        },
      ]);

    const records =
      await this.models.Savings
        .find(filter)
        .select(
          [
            '_id',
            'member',
            'account',
            'savingsType',
            'status',
            'currency',
            'balance',
            'availableBalance',
            'blockedBalance',
            'totalDeposits',
            'totalWithdrawals',
            'netSavings',
            'accruedInterest',
            'totalDividendsEarned',
            'interestRate',
            'maturityDate',
            'createdAt',
            'updatedAt',
          ].join(' '),
        )
        .sort({
          updatedAt:
            -1,

          _id:
            -1,
        })
        .limit(
          limit,
        )
        .lean();

    const base =
      first(summary) || {};

    return {
      reportType:
        REPORT_TYPES.SAVINGS,

      summary: {
        accounts:
          numberValue(
            base.accounts,
          ),

        activeAccounts:
          numberValue(
            base.activeAccounts,
          ),

        activeRate:
          percent(
            base.activeAccounts,
            base.accounts,
          ),

        totalBalance:
          round(
            base.totalBalance,
          ),

        availableBalance:
          round(
            base.availableBalance,
          ),

        blockedBalance:
          round(
            base.blockedBalance,
          ),

        deposits:
          round(
            base.deposits,
          ),

        withdrawals:
          round(
            base.withdrawals,
          ),

        netSavings:
          round(
            base.netSavings,
          ),

        interest:
          round(
            base.interest,
          ),
      },

      records:
        records.map(
          (row) => ({
            id:
              serializeId(
                row._id,
              ),

            memberId:
              serializeId(
                row.member,
              ),

            accountId:
              serializeId(
                row.account,
              ),

            savingsType:
              row.savingsType,

            status:
              row.status,

            currency:
              row.currency,

            balance:
              numberValue(
                row.balance,
              ),

            availableBalance:
              numberValue(
                row.availableBalance,
              ),

            blockedBalance:
              numberValue(
                row.blockedBalance,
              ),

            totalDeposits:
              numberValue(
                row.totalDeposits,
              ),

            totalWithdrawals:
              numberValue(
                row.totalWithdrawals,
              ),

            netSavings:
              numberValue(
                row.netSavings,
              ),

            accruedInterest:
              numberValue(
                row.accruedInterest,
              ),

            totalDividendsEarned:
              numberValue(
                row.totalDividendsEarned,
              ),

            interestRate:
              numberValue(
                row.interestRate,
              ),

            maturityDate:
              row.maturityDate,

            createdAt:
              row.createdAt,

            updatedAt:
              row.updatedAt,
          }),
        ),
    };
  }

  /**
   * ==========================================================================
   * CONTRIBUTION REPORT
   * ==========================================================================
   */

  async generateContributionReport(
    {
      tenantId,
      range,
      options,
    },
  ) {
    const limit =
      Math.min(
        normalizeLimit(
          options.limit,
          DEFAULT_LIMIT,
        ),
        MAX_EXPORT_ROWS,
      );

    const filter = {
      ...this.objectTenant(
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

    const currency =
      normalizeString(
        options.currency,
      );

    if (currency) {
      filter.currency =
        currency.toUpperCase();
    }

    const [
      summary,
      byCurrency,
      byGroup,
    ] = await Promise.all([
      this.models.Contribution.aggregate([
        {
          $match:
            filter,
        },

        {
          $group: {
            _id:
              null,

            count:
              {
                $sum: 1,
              },

            amount:
              {
                $sum:
                  '$amount',
              },

            average:
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
            filter,
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
            amount: -1,
          },
        },
      ]),

      this.models.Contribution.aggregate([
        {
          $match:
            filter,
        },

        {
          $group: {
            _id:
              '$groupId',

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
            amount: -1,
          },
        },
      ]),
    ]);

    const rows =
      await this.models.Contribution
        .find(filter)
        .select(
          [
            '_id',
            'groupId',
            'userId',
            'amount',
            'currency',
            'date',
            'reference',
            'createdAt',
            'updatedAt',
          ].join(' '),
        )
        .sort({
          date:
            -1,

          _id:
            -1,
        })
        .limit(
          limit,
        )
        .lean();

    const base =
      first(summary) || {};

    return {
      reportType:
        REPORT_TYPES.CONTRIBUTIONS,

      summary: {
        count:
          numberValue(
            base.count,
          ),

        amount:
          numberValue(
            base.amount,
          ),

        average:
          numberValue(
            base.average,
          ),
      },

      breakdowns: {
        byCurrency:
          byCurrency.map(
            (row) => ({
              currency:
                row._id,

              count:
                numberValue(
                  row.count,
                ),

              amount:
                numberValue(
                  row.amount,
                ),
            }),
          ),

        byGroup:
          byGroup.map(
            (row) => ({
              groupId:
                serializeId(
                  row._id,
                ),

              count:
                numberValue(
                  row.count,
                ),

              amount:
                numberValue(
                  row.amount,
                ),
            }),
          ),
      },

      records:
        rows.map(
          (row) => ({
            id:
              serializeId(
                row._id,
              ),

            groupId:
              serializeId(
                row.groupId,
              ),

            userId:
              serializeId(
                row.userId,
              ),

            amount:
              numberValue(
                row.amount,
              ),

            currency:
              row.currency,

            date:
              row.date,

            reference:
              row.reference,

            createdAt:
              row.createdAt,

            updatedAt:
              row.updatedAt,
          }),
        ),
    };
  }

  /**
   * ==========================================================================
   * LOAN REPORT
   * ==========================================================================
   */

  async generateLoanReport(
    {
      tenantId,
      range,
      options,
    },
  ) {
    const limit =
      Math.min(
        normalizeLimit(
          options.limit,
          DEFAULT_LIMIT,
        ),
        MAX_EXPORT_ROWS,
      );

    const filter = {
      ...this.stringTenant(
        tenantId,
      ),
    };

    const statuses =
      normalizeArray(
        options.statuses ||
          options.status,
      );

    if (
      statuses.length
    ) {
      filter.status = {
        $in:
          statuses.filter(
            (item) =>
              LOAN_STATUSES.includes(
                item,
              ),
          ),
      };
    }

    const [
      summary,
      byStatus,
    ] = await Promise.all([
      this.models.Loan.aggregate([
        {
          $match:
            filter,
        },

        {
          $group: {
            _id:
              null,

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

            due:
              {
                $sum:
                  '$amountDue',
              },

            repaid:
              {
                $sum:
                  '$amountRepaid',
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

            writtenOff:
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
            filter,
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
    ]);

    const rows =
      await this.models.Loan
        .find({
          ...filter,

          createdAt: {
            $lte:
              range.to,
          },
        })
        .select(
          [
            '_id',
            'user',
            'member',
            'group',
            'tenantId',
            'loanNumber',
            'amount',
            'principalAmount',
            'interestRate',
            'status',
            'riskScore',
            'creditScore',
            'outstandingBalance',
            'amountDue',
            'amountRepaid',
            'amountRecovered',
            'writtenOffAmount',
            'daysPastDue',
            'purpose',
            'createdAt',
            'approvedAt',
            'disbursedAt',
            'maturityDate',
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

    const base =
      first(summary) || {};

    return {
      reportType:
        REPORT_TYPES.LOANS,

      summary: {
        count:
          numberValue(
            base.count,
          ),

        principal:
          round(
            base.principal,
          ),

        outstanding:
          round(
            base.outstanding,
          ),

        due:
          round(
            base.due,
          ),

        repaid:
          round(
            base.repaid,
          ),

        repaymentRate:
          percent(
            base.repaid,
            base.principal,
          ),

        collectionRate:
          percent(
            base.repaid,
            base.due,
          ),

        nplRatio:
          percent(
            base.defaultedOutstanding,
            base.outstanding,
          ),

        amountRecovered:
          round(
            base.amountRecovered,
          ),

        writtenOff:
          round(
            base.writtenOff,
          ),
      },

      breakdowns: {
        byStatus:
          byStatus.map(
            (row) => ({
              status:
                row._id,

              count:
                numberValue(
                  row.count,
                ),

              principal:
                numberValue(
                  row.principal,
                ),

              outstanding:
                numberValue(
                  row.outstanding,
                ),
            }),
          ),
      },

      records:
        rows.map(
          (row) => ({
            id:
              serializeId(
                row._id,
              ),

            loanNumber:
              row.loanNumber,

            userId:
              serializeId(
                row.user,
              ),

            memberId:
              serializeId(
                row.member,
              ),

            groupId:
              serializeId(
                row.group,
              ),

            amount:
              numberValue(
                row.amount,
              ),

            principalAmount:
              numberValue(
                row.principalAmount,
              ),

            interestRate:
              numberValue(
                row.interestRate,
              ),

            status:
              row.status,

            riskScore:
              numberValue(
                row.riskScore,
              ),

            creditScore:
              numberValue(
                row.creditScore,
              ),

            outstandingBalance:
              numberValue(
                row.outstandingBalance,
              ),

            amountDue:
              numberValue(
                row.amountDue,
              ),

            amountRepaid:
              numberValue(
                row.amountRepaid,
              ),

            amountRecovered:
              numberValue(
                row.amountRecovered,
              ),

            writtenOffAmount:
              numberValue(
                row.writtenOffAmount,
              ),

            daysPastDue:
              numberValue(
                row.daysPastDue,
              ),

            purpose:
              row.purpose,

            createdAt:
              row.createdAt,

            approvedAt:
              row.approvedAt,

            disbursedAt:
              row.disbursedAt,

            maturityDate:
              row.maturityDate,
          }),
        ),
    };
  }

  /**
   * ==========================================================================
   * MEMBER REPORT
   * ==========================================================================
   */

  async generateMemberReport(
    {
      tenantId,
      range,
      options,
    },
  ) {
    const limit =
      Math.min(
        normalizeLimit(
          options.limit,
          DEFAULT_LIMIT,
        ),
        MAX_EXPORT_ROWS,
      );

    const filter = {
      ...this.stringTenant(
        tenantId,
      ),
    };

    const statuses =
      normalizeArray(
        options.statuses ||
          options.status,
      );

    if (
      statuses.length
    ) {
      filter.memberStatus = {
        $in:
          statuses.filter(
            (item) =>
              MEMBER_STATUSES.includes(
                item,
              ),
          ),
      };
    }

    const kycStatuses =
      normalizeArray(
        options.kycStatuses ||
          options.kycStatus,
      );

    if (
      kycStatuses.length
    ) {
      filter.kycStatus = {
        $in:
          kycStatuses.filter(
            (item) =>
              KYC_STATUSES.includes(
                item,
              ),
          ),
      };
    }

    const rows =
      await this.models.Member
        .find(filter)
        .select(
          [
            '_id',
            'memberNumber',
            'firstName',
            'lastName',
            'otherNames',
            'gender',
            'email',
            'phoneNumber',
            'memberStatus',
            'memberTier',
            'memberSegment',
            'joinedAt',
            'kycStatus',
            'kycVerified',
            'amlChecked',
            'sanctionsScreened',
            'creditScore',
            'riskScore',
            'fraudRiskScore',
            'fraudFlagged',
            'blacklisted',
            'savingsBalance',
            'sharesBalance',
            'fixedDepositBalance',
            'activeLoans',
            'outstandingLoanBalance',
            'memberHealthScore',
            'loanEligibilityScore',
            'lastLoginAt',
            'lastTransactionAt',
            'createdAt',
            'updatedAt',
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

    const joinedFilter = {
      ...this.stringTenant(
        tenantId,
      ),

      joinedAt: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    const growth =
      await this.models.Member.aggregate([
        {
          $match:
            joinedFilter,
        },

        {
          $group: {
            _id:
              {
                $dateToString: {
                  format:
                    '%Y-%m-%d',

                  date:
                    '$joinedAt',
                },
              },

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

    return {
      reportType:
        REPORT_TYPES.MEMBERS,

      summary: {
        recordsReturned:
          rows.length,

        newMembersInPeriod:
          growth.reduce(
            (
              total,
              row,
            ) =>
              total +
              numberValue(
                row.count,
              ),
            0,
          ),
      },

      growth,

      records:
        rows.map(
          (row) => ({
            id:
              serializeId(
                row._id,
              ),

            memberNumber:
              row.memberNumber,

            firstName:
              row.firstName,

            lastName:
              row.lastName,

            otherNames:
              row.otherNames,

            gender:
              row.gender,

            email:
              row.email,

            phoneNumber:
              row.phoneNumber,

            memberStatus:
              row.memberStatus,

            memberTier:
              row.memberTier,

            memberSegment:
              row.memberSegment,

            joinedAt:
              row.joinedAt,

            kycStatus:
              row.kycStatus,

            kycVerified:
              row.kycVerified,

            amlChecked:
              row.amlChecked,

            sanctionsScreened:
              row.sanctionsScreened,

            creditScore:
              row.creditScore,

            riskScore:
              row.riskScore,

            fraudRiskScore:
              row.fraudRiskScore,

            fraudFlagged:
              row.fraudFlagged,

            blacklisted:
              row.blacklisted,

            savingsBalance:
              row.savingsBalance,

            sharesBalance:
              row.sharesBalance,

            fixedDepositBalance:
              row.fixedDepositBalance,

            activeLoans:
              row.activeLoans,

            outstandingLoanBalance:
              row.outstandingLoanBalance,

            memberHealthScore:
              row.memberHealthScore,

            loanEligibilityScore:
              row.loanEligibilityScore,

            lastLoginAt:
              row.lastLoginAt,

            lastTransactionAt:
              row.lastTransactionAt,

            createdAt:
              row.createdAt,

            updatedAt:
              row.updatedAt,
          }),
        ),
    };
  }

  /**
   * ==========================================================================
   * RISK REPORT
   * ==========================================================================
   */

  async generateRiskReport(
    {
      tenantId,
      range,
    },
  ) {
    const [
      memberRisk,
      loanRisk,
      fraudRisk,
    ] = await Promise.all([
      this.models.Member.aggregate([
        {
          $match:
            this.stringTenant(
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

            fraudRisk:
              {
                $sum: {
                  $cond: [
                    {
                      $gte: [
                        '$fraudRiskScore',
                        0.8,
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
            this.stringTenant(
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

            averageRiskScore:
              {
                $avg:
                  '$riskScore',
              },

            outstanding:
              {
                $sum:
                  '$outstandingBalance',
              },
          },
        },
      ]),

      this.models.FraudLog.aggregate([
        {
          $match: {
            ...this.stringTenant(
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

            averageFraudScore:
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
      reportType:
        REPORT_TYPES.RISK,

      members: {
        total:
          numberValue(
            members.total,
          ),

        highRisk:
          numberValue(
            members.highRisk,
          ),

        fraudRisk:
          numberValue(
            members.fraudRisk,
          ),

        blacklisted:
          numberValue(
            members.blacklisted,
          ),

        averageRiskScore:
          round(
            members.averageRiskScore,
          ),
      },

      loans: {
        total:
          numberValue(
            loans.total,
          ),

        highRisk:
          numberValue(
            loans.highRisk,
          ),

        defaulted:
          numberValue(
            loans.defaulted,
          ),

        defaultRate:
          percent(
            loans.defaulted,
            loans.total,
          ),

        averageRiskScore:
          round(
            loans.averageRiskScore,
          ),

        outstanding:
          round(
            loans.outstanding,
          ),
      },

      fraud: {
        total:
          numberValue(
            fraud.total,
          ),

        blocked:
          numberValue(
            fraud.blocked,
          ),

        stepUp:
          numberValue(
            fraud.stepUp,
          ),

        blockRate:
          percent(
            fraud.blocked,
            fraud.total,
          ),

        averageFraudScore:
          round(
            fraud.averageFraudScore,
            4,
          ),
      },
    };
  }

  /**
   * ==========================================================================
   * FRAUD REPORT
   * ==========================================================================
   */

  async generateFraudReport(
    {
      tenantId,
      range,
      options,
    },
  ) {
    const limit =
      Math.min(
        normalizeLimit(
          options.limit,
          DEFAULT_LIMIT,
        ),
        MAX_EXPORT_ROWS,
      );

    const filter = {
      ...this.stringTenant(
        tenantId,
      ),

      createdAt: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    const decisions =
      normalizeArray(
        options.decisions ||
          options.decision,
      );

    if (
      decisions.length
    ) {
      filter.decision = {
        $in:
          decisions.filter(
            (item) =>
              FRAUD_DECISIONS.includes(
                item,
              ),
          ),
      };
    }

    const [
      summary,
      byDecision,
    ] = await Promise.all([
      this.models.FraudLog.aggregate([
        {
          $match:
            filter,
        },

        {
          $group: {
            _id:
              null,

            count:
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

            allowed:
              {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        '$decision',
                        'ALLOW',
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

      this.models.FraudLog.aggregate([
        {
          $match:
            filter,
        },

        {
          $group: {
            _id:
              '$decision',

            count:
              {
                $sum: 1,
              },

            averageScore:
              {
                $avg:
                  '$fraudScore',
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

    const rows =
      await this.models.FraudLog
        .find(filter)
        .select(
          [
            '_id',
            'userId',
            'transactionId',
            'fraudScore',
            'decision',
            'engine',
            'modelVersion',
            'reviewed',
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

    const base =
      first(summary) || {};

    return {
      reportType:
        REPORT_TYPES.FRAUD,

      summary: {
        count:
          numberValue(
            base.count,
          ),

        allowed:
          numberValue(
            base.allowed,
          ),

        stepUp:
          numberValue(
            base.stepUp,
          ),

        blocked:
          numberValue(
            base.blocked,
          ),

        blockRate:
          percent(
            base.blocked,
            base.count,
          ),

        averageScore:
          round(
            base.averageScore,
            4,
          ),
      },

      breakdown:
        byDecision.map(
          (row) => ({
            decision:
              row._id,

            count:
              numberValue(
                row.count,
              ),

            averageScore:
              round(
                row.averageScore,
                4,
              ),
          }),
        ),

      records:
        rows.map(
          (row) => ({
            id:
              serializeId(
                row._id,
              ),

            userId:
              serializeId(
                row.userId,
              ),

            transactionId:
              serializeId(
                row.transactionId,
              ),

            fraudScore:
              numberValue(
                row.fraudScore,
              ),

            decision:
              row.decision,

            engine:
              row.engine,

            modelVersion:
              row.modelVersion,

            reviewed:
              Boolean(
                row.reviewed,
              ),

            createdAt:
              row.createdAt,
          }),
        ),
    };
  }

  /**
   * ==========================================================================
   * COMPLIANCE REPORT
   * ==========================================================================
   */

  async generateComplianceReport(
    {
      tenantId,
      range,
      options,
    },
  ) {
    const [
      memberSummary,
      complianceSummary,
    ] = await Promise.all([
      this.models.Member.aggregate([
        {
          $match:
            this.stringTenant(
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
            ...this.stringTenant(
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
      first(memberSummary) || {};

    const logs =
      first(complianceSummary) || {};

    return {
      reportType:
        REPORT_TYPES.COMPLIANCE,

      memberCompliance: {
        totalMembers:
          numberValue(
            members.total,
          ),

        kycVerified:
          numberValue(
            members.kycVerified,
          ),

        amlChecked:
          numberValue(
            members.amlChecked,
          ),

        sanctionsScreened:
          numberValue(
            members.sanctionsScreened,
          ),

        blacklisted:
          numberValue(
            members.blacklisted,
          ),

        kycRate:
          percent(
            members.kycVerified,
            members.total,
          ),

        amlRate:
          percent(
            members.amlChecked,
            members.total,
          ),

        sanctionsScreeningRate:
          percent(
            members.sanctionsScreened,
            members.total,
          ),
      },

      activity: {
        total:
          numberValue(
            logs.total,
          ),

        flagged:
          numberValue(
            logs.flagged,
          ),

        unresolved:
          numberValue(
            logs.unresolved,
          ),

        resolved:
          numberValue(
            logs.resolved,
          ),

        flagRate:
          percent(
            logs.flagged,
            logs.total,
          ),

        resolutionRate:
          percent(
            logs.resolved,
            logs.flagged,
          ),
      },

      period:
        {
          from:
            range.from,

          to:
            range.to,
        },
    };
  }

  /**
   * ==========================================================================
   * AUDIT REPORT
   * ==========================================================================
   */

  async generateAuditReport(
    {
      tenantId,
      range,
      options,
    },
  ) {
    const limit =
      Math.min(
        normalizeLimit(
          options.limit,
          DEFAULT_LIMIT,
        ),
        MAX_EXPORT_ROWS,
      );

    const filter = {
      tenantId:
        toObjectId(
          tenantId,
          'tenantId',
        ),

      createdAt: {
        $gte:
          range.from,

        $lte:
          range.to,
      },
    };

    const action =
      normalizeString(
        options.action,
      );

    if (action) {
      filter.action =
        action;
    }

    const entityType =
      normalizeString(
        options.entityType,
      );

    if (entityType) {
      filter.entityType =
        entityType;
    }

    const [summary, rows] =
      await Promise.all([
        this.models.AuditLog.aggregate([
          {
            $match:
              filter,
          },

          {
            $group: {
              _id:
                null,

              total:
                {
                  $sum: 1,
                },
            },
          },
        ]),

        this.models.AuditLog
          .find(filter)
          .select(
            [
              '_id',
              'action',
              'userId',
              'tenantId',
              'entityType',
              'entityId',
              'metadata',
              'prevHash',
              'currentHash',
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
          .lean(),
      ]);

    const base =
      first(summary) || {};

    return {
      reportType:
        REPORT_TYPES.AUDIT,

      summary: {
        total:
          numberValue(
            base.total,
          ),
      },

      records:
        rows.map(
          (row) => ({
            id:
              serializeId(
                row._id,
              ),

            action:
              row.action,

            userId:
              serializeId(
                row.userId,
              ),

            tenantId:
              serializeId(
                row.tenantId,
              ),

            entityType:
              row.entityType,

            entityId:
              serializeId(
                row.entityId,
              ),

            metadata:
              sanitize(
                row.metadata ||
                  {},
              ),

            prevHash:
              row.prevHash,

            currentHash:
              row.currentHash,

            createdAt:
              row.createdAt,
          }),
        ),
    };
  }

  /**
   * ==========================================================================
   * EXPORT
   * ==========================================================================
   */

  async export(
    reportType,
    tenantId,
    {
      format = 'json',
      ...options
    } = {},
  ) {
    const normalizedFormat =
      normalizeString(
        format,
      )?.toLowerCase();

    if (
      ![
        'json',
        'csv',
      ].includes(
        normalizedFormat,
      )
    ) {
      throw new AdminReportsError(
        `Unsupported report export format: ${format}.`,
        {
          code:
            'UNSUPPORTED_EXPORT_FORMAT',
          statusCode: 400,
          details: {
            supported: [
              'json',
              'csv',
            ],
          },
        },
      );
    }

    const report =
      await this.generate(
        reportType,
        tenantId,
        options,
      );

    const records =
      Array.isArray(
        report.records,
      )
        ? report.records
        : this.flattenForExport(
            report,
          );

    const safeRecords =
      records.map(
        sanitize,
      );

    const filename =
      this.buildFilename(
        reportType,
        normalizedFormat,
      );

    if (
      normalizedFormat ===
      'csv'
    ) {
      return {
        format:
          'csv',

        filename,

        mimeType:
          'text/csv; charset=utf-8',

        content:
          recordsToCsv(
            safeRecords,
          ),

        rowCount:
          safeRecords.length,

        metadata:
          report.metadata,
      };
    }

    return {
      format:
        'json',

      filename,

      mimeType:
        'application/json; charset=utf-8',

      content:
        JSON.stringify(
          report,
          null,
          2,
        ),

      rowCount:
        safeRecords.length,

      metadata:
        report.metadata,
    };
  }

  /**
   * ==========================================================================
   * FLAT EXPORT FALLBACK
   * ==========================================================================
   *
   * Summary-only reports do not necessarily have "records". This produces a
   * compact single-record export suitable for CSV.
   * ==========================================================================
   */

  flattenForExport(
    report,
  ) {
    const rows = [];

    const flatten =
      (
        value,
        prefix = '',
      ) => {
        if (
          value ===
            null ||
          value ===
            undefined
        ) {
          return {
            [prefix]:
              value,
          };
        }

        if (
          Array.isArray(
            value,
          )
        ) {
          return {
            [prefix]:
              JSON.stringify(
                sanitize(
                  value,
                ),
              ),
          };
        }

        if (
          typeof value !==
          'object'
        ) {
          return {
            [prefix]:
              value,
          };
        }

        const result =
          {};

        for (
          const [
            key,
            child,
          ] of Object.entries(
            value,
          )
        ) {
          const nextPrefix =
            prefix
              ? `${prefix}.${key}`
              : key;

          Object.assign(
            result,
            flatten(
              child,
              nextPrefix,
            ),
          );
        }

        return result;
      };

    const flattened =
      flatten(
        {
          summary:
            report.summary,

          kpis:
            report.kpis,

          memberCompliance:
            report.memberCompliance,

          activity:
            report.activity,

          members:
            report.members,

          loans:
            report.loans,

          fraud:
            report.fraud,
        },
      );

    rows.push(flattened);

    return rows;
  }

  /**
   * ==========================================================================
   * FILENAME
   * ==========================================================================
   */

  buildFilename(
    reportType,
    format,
  ) {
    const timestamp =
      new Date()
        .toISOString()
        .replace(
          /[:.]/g,
          '-',
        );

    return [
      'titech',
      'community-capital',
      'report',
      reportType,
      timestamp,
      `.${format}`,
    ].join('');
  }

  /**
   * ==========================================================================
   * SCHEDULED-REPORT BOUNDARY
   * ==========================================================================
   *
   * This service deliberately does not create schedules/jobs because the
   * current project does not expose an authoritative ReportJob model.
   *
   * A future scheduler can call:
   *
   *   generate(...)
   *
   * or:
   *
   *   export(...)
   *
   * without changing the report logic.
   * ==========================================================================
   */

  getSchedulerContract() {
    return {
      service:
        SERVICE_NAME,

      supportedOperations: [
        'generate',
        'export',
      ],

      persistence:
        'external',

      recommendedFutureModel:
        'ReportJob',

      idempotencyRequired:
        true,
    };
  }

  /**
   * ==========================================================================
   * HEALTH
   * ==========================================================================
   */

  async health() {
    const checks = {};

    for (
      const [
        name,
        model,
      ] of Object.entries(
        this.models,
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
      service:
        SERVICE_NAME,

      version:
        SERVICE_VERSION,

      healthy,

      checks,

      timestamp:
        new Date(),
    };
  }

  /**
   * ==========================================================================
   * ERROR HANDLING
   * ==========================================================================
   */

  wrapError(
    error,
    code,
  ) {
    if (
      error instanceof
      AdminReportsError
    ) {
      return error;
    }

    return new AdminReportsError(
      error?.message ||
        'Report operation failed.',
      {
        code,

        cause:
          error,
      },
    );
  }

  logError(
    message,
    error,
    context = {},
  ) {
    try {
      if (
        this.logger &&
        typeof
          this.logger.error ===
          'function'
      ) {
        this.logger.error(
          message,
          {
            service:
              SERVICE_NAME,

            version:
              SERVICE_VERSION,

            ...context,

            error:
              error?.message,

            errorName:
              error?.name,
          },
        );
      }
    } catch {
      // Logging failure must never replace the original report error.
    }
  }
}

/**
 * ============================================================================
 * SINGLETON
 * ============================================================================
 */

const adminReportsService =
  new AdminReportsService();

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  adminReportsService;

module.exports.AdminReportsService =
  AdminReportsService;

module.exports.AdminReportsError =
  AdminReportsError;

module.exports.REPORT_TYPES =
  REPORT_TYPES;

module.exports.SERVICE_NAME =
  SERVICE_NAME;

module.exports.SERVICE_VERSION =
  SERVICE_VERSION;