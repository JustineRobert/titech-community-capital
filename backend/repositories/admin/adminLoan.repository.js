'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Loan Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/admin/adminLoan.repository.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical persistence/data-access layer for administrative loan portfolio,
 * risk, arrears, collections, repayment and lending analytics.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 * Repository responsibilities:
 *
 *   ✓ Tenant-scoped MongoDB/Mongoose queries
 *   ✓ Loan lookup
 *   ✓ Loan search
 *   ✓ Deterministic pagination
 *   ✓ Portfolio aggregation
 *   ✓ Status distribution
 *   ✓ Risk distribution
 *   ✓ Arrears / delinquency analysis
 *   ✓ Repayment performance
 *   ✓ Recovery / write-off reporting
 *   ✓ Loan growth trends
 *   ✓ Recent loan activity
 *   ✓ Approval / disbursement analytics
 *
 * Repository MUST NOT:
 *
 *   ✗ Authorize administrators
 *   ✗ Approve or reject loans
 *   ✗ Recalculate a financial balance
 *   ✗ Mutate loan balances
 *   ✗ Make credit decisions
 *   ✗ Perform collections
 *   ✗ Post accounting entries
 *   ✗ Execute payments
 *   ✗ Send notifications
 *   ✗ Return HTTP responses
 *
 * Business rules belong in:
 *
 *   adminLoan.service.js
 *   loan services
 *   risk services
 *   collections services
 *   accounting/ledger services
 *
 * Security
 * ----------------------------------------------------------------------------
 * Every tenant-scoped query MUST include tenantId.
 *
 * The repository intentionally fails closed when the supplied Loan model does
 * not expose tenantId. A global loan query would represent a critical
 * cross-tenant data-isolation vulnerability.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All ACFOS references have been replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const Loan = require('../../models/Loan');

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const REPOSITORY_NAME =
  'AdminLoanRepository';

const REPOSITORY_VERSION =
  '2026.1';

const DEFAULT_PAGE_SIZE =
  25;

const MAX_PAGE_SIZE =
  100;

const MAX_SEARCH_LENGTH =
  120;

const MAX_AGGREGATE_BUCKETS =
  100;

/**
 * ============================================================================
 * LOAN STATUS CATALOGUE
 * ============================================================================
 *
 * These values reflect the production roadmap's intended lending lifecycle.
 * The repository only applies them where they are actually supported by the
 * current query.
 * ============================================================================
 */

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

/**
 * ============================================================================
 * RISK BANDS
 * ============================================================================
 */

const RISK_BANDS =
  Object.freeze([
    'LOW',
    'MEDIUM',
    'HIGH',
  ]);

/**
 * ============================================================================
 * ERROR
 * ============================================================================
 */

class AdminLoanRepositoryError extends Error {
  constructor(
    message,
    {
      code =
        'ADMIN_LOAN_REPOSITORY_ERROR',

      cause =
        null,

      details =
        null,
    } = {},
  ) {
    super(message);

    this.name =
      'AdminLoanRepositoryError';

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
 * NORMALIZATION HELPERS
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

function normalizeArray(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return [];
  }

  const values =
    Array.isArray(value)
      ? value
      : String(value).split(',');

  return [
    ...new Set(
      values
        .map((item) =>
          normalizeString(item),
        )
        .filter(Boolean),
    ),
  ];
}

function normalizeLimit(
  value,
  fallback =
    DEFAULT_PAGE_SIZE,
) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    return fallback;
  }

  return Math.min(
    parsed,
    MAX_PAGE_SIZE,
  );
}

function normalizeBoolean(
  value,
  fallback = null,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  if (
    value === true ||
    value === false
  ) {
    return value;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    normalized === 'true' ||
    normalized === '1'
  ) {
    return true;
  }

  if (
    normalized === 'false' ||
    normalized === '0'
  ) {
    return false;
  }

  return fallback;
}

function normalizeNumber(
  value,
  fallback = null,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return fallback;
  }

  const parsed =
    Number(value);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : fallback;
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
    throw new AdminLoanRepositoryError(
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

function toObjectId(
  value,
  fieldName = 'id',
) {
  const normalized =
    normalizeString(value);

  if (!normalized) {
    throw new AdminLoanRepositoryError(
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
    throw new AdminLoanRepositoryError(
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
      safeNumber(value) *
        factor,
    ) / factor
  );
}

function percent(
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

function first(
  rows,
) {
  return Array.isArray(rows) &&
    rows.length
    ? rows[0]
    : null;
}

function serializeId(
  value,
) {
  return value
    ? String(value)
    : null;
}

/**
 * ============================================================================
 * REPOSITORY
 * ============================================================================
 */

class AdminLoanRepository {
  constructor({
    LoanModel =
      Loan,
  } = {}) {
    this.Loan =
      LoanModel;
  }

  /**
   * ==========================================================================
   * SCHEMA CAPABILITY / TENANT SAFETY
   * ==========================================================================
   */

  hasPath(
    path,
  ) {
    return Boolean(
      this.Loan?.schema?.path(
        path,
      ),
    );
  }

  supportsTenantIsolation() {
    return this.hasPath(
      'tenantId',
    );
  }

  assertTenantIsolationAvailable() {
    if (
      !this.supportsTenantIsolation()
    ) {
      throw new AdminLoanRepositoryError(
        'Tenant-scoped Loan operations are unavailable because the current Loan model does not expose tenantId. TITech will not execute an unsafe global loan query.',
        {
          code:
            'LOAN_TENANT_SCOPE_UNAVAILABLE',

          details: {
            model:
              'Loan',

            requiredField:
              'tenantId',
          },
        },
      );
    }
  }

  buildTenantFilter(
    tenantId,
  ) {
    this.assertTenantIsolationAvailable();

    return {
      tenantId:
        normalizeString(
          tenantId,
        ),
    };
  }

  /**
   * ==========================================================================
   * SAFE PROJECTION
   * ==========================================================================
   *
   * Projection is constructed dynamically so repository tests can inject a
   * compatible model while the real Loan schema evolves.
   * ==========================================================================
   */

  getSafeProjection() {
    const candidates =
      [
        '_id',

        'tenantId',

        'user',
        'member',
        'group',

        'loanNumber',

        'amount',
        'principalAmount',

        'interestRate',
        'interestAmount',

        'totalRepayable',

        'amountDue',
        'amountRepaid',

        'outstandingBalance',

        'amountRecovered',
        'writtenOffAmount',

        'status',

        'purpose',

        'riskScore',
        'creditScore',

        'daysPastDue',

        'currency',

        'term',
        'repaymentFrequency',

        'createdAt',
        'submittedAt',
        'approvedAt',
        'disbursedAt',

        'firstRepaymentDate',
        'lastRepaymentDate',

        'nextPaymentDate',

        'maturityDate',

        'closedAt',

        'createdBy',
        'approvedBy',

        'rejectionReason',

        'defaultReason',

        'restructureCount',

        'collateralValue',

        'guaranteeValue',

        'repaymentProgress',

        'collectionStage',
      ];

    const projection =
      {};

    for (
      const field of
      candidates
    ) {
      if (
        this.hasPath(
          field,
        )
      ) {
        projection[field] =
          1;
      }
    }

    return projection;
  }

  /**
   * ==========================================================================
   * PATH RESOLUTION
   * ==========================================================================
   */

  resolveFirstPath(
    candidates,
  ) {
    for (
      const candidate of
      candidates
    ) {
      if (
        this.hasPath(
          candidate,
        )
      ) {
        return candidate;
      }
    }

    return null;
  }

  getPrincipalPath() {
    return this.resolveFirstPath([
      'principalAmount',
      'amount',
    ]);
  }

  getOutstandingPath() {
    return this.resolveFirstPath([
      'outstandingBalance',
    ]);
  }

  getAmountDuePath() {
    return this.resolveFirstPath([
      'amountDue',
      'totalRepayable',
    ]);
  }

  getAmountRepaidPath() {
    return this.resolveFirstPath([
      'amountRepaid',
    ]);
  }

  getRecoveredPath() {
    return this.resolveFirstPath([
      'amountRecovered',
    ]);
  }

  getWrittenOffPath() {
    return this.resolveFirstPath([
      'writtenOffAmount',
    ]);
  }

  getRiskScorePath() {
    return this.resolveFirstPath([
      'riskScore',
      'score',
    ]);
  }

  getCreditScorePath() {
    return this.resolveFirstPath([
      'creditScore',
    ]);
  }

  getStatusPath() {
    return this.resolveFirstPath([
      'status',
    ]);
  }

  getUserPath() {
    return this.resolveFirstPath([
      'user',
      'userId',
    ]);
  }

  getMemberPath() {
    return this.resolveFirstPath([
      'member',
      'memberId',
    ]);
  }

  getGroupPath() {
    return this.resolveFirstPath([
      'group',
      'groupId',
    ]);
  }

  /**
   * ==========================================================================
   * SEARCH / FILTER
   * ==========================================================================
   */

  buildFilter(
    tenantId,
    options = {},
  ) {
    const filter = {
      ...this.buildTenantFilter(
        tenantId,
      ),
    };

    const search =
      normalizeString(
        options.search,
      );

    if (search) {
      const safeSearch =
        this.escapeRegex(
          search.slice(
            0,
            MAX_SEARCH_LENGTH,
          ),
        );

      const searchPaths =
        [
          this.hasPath(
            'loanNumber',
          )
            ? 'loanNumber'
            : null,

          this.hasPath(
            'purpose',
          )
            ? 'purpose'
            : null,

          this.hasPath(
            'status',
          )
            ? 'status'
            : null,
        ].filter(Boolean);

      if (
        searchPaths.length
      ) {
        filter.$or =
          searchPaths.map(
            (path) => ({
              [path]: {
                $regex:
                  safeSearch,

                $options:
                  'i',
              },
            }),
          );
      }
    }

    this.applyEnumFilter(
      filter,
      'status',
      options.status ||
        options.statuses,
      LOAN_STATUSES,
    );

    this.applyReferenceFilter(
      filter,
      this.getUserPath(),
      options.userId,
      'userId',
    );

    this.applyReferenceFilter(
      filter,
      this.getMemberPath(),
      options.memberId,
      'memberId',
    );

    this.applyReferenceFilter(
      filter,
      this.getGroupPath(),
      options.groupId,
      'groupId',
    );

    const purpose =
      normalizeString(
        options.purpose,
      );

    if (
      purpose &&
      this.hasPath(
        'purpose',
      )
    ) {
      filter.purpose =
        purpose;
    }

    const currency =
      normalizeString(
        options.currency,
      );

    if (
      currency &&
      this.hasPath(
        'currency',
      )
    ) {
      filter.currency =
        currency;
    }

    this.applyNumberRange(
      filter,
      this.getRiskScorePath(),
      options.minRiskScore,
      options.maxRiskScore,
      'riskScore',
    );

    this.applyNumberRange(
      filter,
      this.getCreditScorePath(),
      options.minCreditScore,
      options.maxCreditScore,
      'creditScore',
    );

    this.applyNumberRange(
      filter,
      'daysPastDue',
      options.minDaysPastDue,
      options.maxDaysPastDue,
      'daysPastDue',
    );

    this.applyDateRange(
      filter,
      'createdAt',
      options.createdFrom,
      options.createdTo,
    );

    this.applyDateRange(
      filter,
      'approvedAt',
      options.approvedFrom,
      options.approvedTo,
    );

    this.applyDateRange(
      filter,
      'disbursedAt',
      options.disbursedFrom,
      options.disbursedTo,
    );

    this.applyDateRange(
      filter,
      'maturityDate',
      options.maturityFrom,
      options.maturityTo,
    );

    if (
      options.activeOnly
    ) {
      filter.status = {
        $in: [
          'approved',
          'disbursed',
          'active',
        ].filter(
          (status) =>
            LOAN_STATUSES.includes(
              status,
            ),
        ),
      };
    }

    if (
      options.overdueOnly
    ) {
      filter.daysPastDue = {
        $gt:
          0,
      };
    }

    if (
      options.highRiskOnly
    ) {
      const riskPath =
        this.getRiskScorePath();

      if (
        riskPath
      ) {
        filter[riskPath] = {
          $gte:
            80,
        };
      }
    }

    if (
      options.defaultedOnly
    ) {
      filter.status = {
        $in: [
          'defaulted',
          'written_off',
        ],
      };
    }

    return filter;
  }

  applyEnumFilter(
    filter,
    path,
    value,
    allowed,
  ) {
    if (
      !this.hasPath(
        path,
      )
    ) {
      return;
    }

    const values =
      normalizeArray(
        value,
      );

    if (
      values.length ===
      0
    ) {
      return;
    }

    const valid =
      values.filter(
        (item) =>
          allowed.includes(
            item,
          ),
      );

    if (
      valid.length ===
      0
    ) {
      throw new AdminLoanRepositoryError(
        `No valid ${path} values were supplied.`,
        {
          code:
            'INVALID_LOAN_FILTER',

          details: {
            path,

            allowed,
          },
        },
      );
    }

    filter[path] =
      valid.length ===
      1
        ? valid[0]
        : {
            $in:
              valid,
          };
  }

  applyReferenceFilter(
    filter,
    path,
    value,
    fieldName,
  ) {
    if (
      !path ||
      !value
    ) {
      return;
    }

    filter[path] =
      toObjectId(
        value,
        fieldName,
      );
  }

  applyNumberRange(
    filter,
    path,
    min,
    max,
    fieldName,
  ) {
    if (
      !path
    ) {
      return;
    }

    const minimum =
      normalizeNumber(
        min,
      );

    const maximum =
      normalizeNumber(
        max,
      );

    if (
      minimum ===
        null &&
      maximum ===
        null
    ) {
      return;
    }

    filter[path] =
      {};

    if (
      minimum !==
      null
    ) {
      filter[path].$gte =
        minimum;
    }

    if (
      maximum !==
      null
    ) {
      filter[path].$lte =
        maximum;
    }

    if (
      minimum !==
        null &&
      maximum !==
        null &&
      minimum >
        maximum
    ) {
      throw new AdminLoanRepositoryError(
        `Invalid ${fieldName} range.`,
        {
          code:
            'INVALID_NUMBER_RANGE',
        },
      );
    }
  }

  applyDateRange(
    filter,
    path,
    from,
    to,
  ) {
    if (
      !this.hasPath(
        path,
      )
    ) {
      return;
    }

    if (
      !from &&
      !to
    ) {
      return;
    }

    const start =
      normalizeDate(
        from,
        `${path}From`,
      );

    const end =
      normalizeDate(
        to,
        `${path}To`,
      );

    if (
      start &&
      end &&
      start >
        end
    ) {
      throw new AdminLoanRepositoryError(
        `Invalid ${path} date range.`,
        {
          code:
            'INVALID_DATE_RANGE',
        },
      );
    }

    filter[path] =
      {};

    if (start) {
      filter[path].$gte =
        start;
    }

    if (end) {
      filter[path].$lte =
        end;
    }
  }

  escapeRegex(
    value,
  ) {
    return String(value).replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );
  }

  /**
   * ==========================================================================
   * FIND ONE
   * ==========================================================================
   */

  async findById(
    tenantId,
    loanId,
  ) {
    return this.Loan
      .findOne({
        ...this.buildTenantFilter(
          tenantId,
        ),

        _id:
          toObjectId(
            loanId,
            'loanId',
          ),
      })
      .select(
        this.getSafeProjection(),
      )
      .lean();
  }

  /**
   * ==========================================================================
   * EXISTENCE
   * ==========================================================================
   */

  async exists(
    tenantId,
    loanId,
  ) {
    const result =
      await this.Loan.exists({
        ...this.buildTenantFilter(
          tenantId,
        ),

        _id:
          toObjectId(
            loanId,
            'loanId',
          ),
      });

    return Boolean(
      result,
    );
  }

  /**
   * ==========================================================================
   * COUNT
   * ==========================================================================
   */

  async count(
    tenantId,
    options = {},
  ) {
    return this.Loan.countDocuments(
      this.buildFilter(
        tenantId,
        options,
      ),
    );
  }

  /**
   * ==========================================================================
   * PAGINATED SEARCH
   * ==========================================================================
   */

  async findPage(
    tenantId,
    options = {},
  ) {
    const limit =
      normalizeLimit(
        options.limit,
      );

    const filter =
      this.buildFilter(
        tenantId,
        options,
      );

    if (
      options.cursor
    ) {
      const cursor =
        this.decodeCursor(
          options.cursor,
        );

      filter.$or = [
        {
          createdAt: {
            $lt:
              cursor.createdAt,
          },
        },

        {
          createdAt:
            cursor.createdAt,

          _id: {
            $lt:
              cursor.id,
          },
        },
      ];
    }

    const documents =
      await this.Loan
        .find(
          filter,
        )
        .select(
          this.getSafeProjection(),
        )
        .sort({
          createdAt:
            -1,

          _id:
            -1,
        })
        .limit(
          limit + 1,
        )
        .lean();

    const hasNextPage =
      documents.length >
      limit;

    const items =
      hasNextPage
        ? documents.slice(
            0,
            limit,
          )
        : documents;

    const last =
      items[
        items.length - 1
      ];

    return {
      items,

      pagination: {
        limit,

        hasNextPage,

        nextCursor:
          hasNextPage &&
          last
            ? this.encodeCursor(
                last,
              )
            : null,
      },
    };
  }

  /**
   * ==========================================================================
   * SIMPLE LIST
   * ==========================================================================
   */

  async findMany(
    tenantId,
    options = {},
  ) {
    const filter =
      this.buildFilter(
        tenantId,
        options,
      );

    return this.Loan
      .find(
        filter,
      )
      .select(
        this.getSafeProjection(),
      )
      .sort({
        createdAt:
          -1,

        _id:
          -1,
      })
      .limit(
        normalizeLimit(
          options.limit,
        ),
      )
      .lean();
  }

  /**
   * ==========================================================================
   * PORTFOLIO SUMMARY
   * ==========================================================================
   */

  async getPortfolioSummary(
    tenantId,
    options = {},
  ) {
    const filter =
      this.buildFilter(
        tenantId,
        options,
      );

    const principalPath =
      this.getPrincipalPath();

    const outstandingPath =
      this.getOutstandingPath();

    const duePath =
      this.getAmountDuePath();

    const repaidPath =
      this.getAmountRepaidPath();

    const recoveredPath =
      this.getRecoveredPath();

    const writtenOffPath =
      this.getWrittenOffPath();

    const pipeline =
      {
        $group: {
          _id:
            null,

          totalLoans:
            {
              $sum:
                1,
            },
        },
      };

    if (
      principalPath
    ) {
      pipeline.$group.totalPrincipal =
        {
          $sum:
            `$${principalPath}`,
        };
    }

    if (
      outstandingPath
    ) {
      pipeline.$group.outstandingBalance =
        {
          $sum:
            `$${outstandingPath}`,
        };
    }

    if (
      duePath
    ) {
      pipeline.$group.amountDue =
        {
          $sum:
            `$${duePath}`,
        };
    }

    if (
      repaidPath
    ) {
      pipeline.$group.amountRepaid =
        {
          $sum:
            `$${repaidPath}`,
        };
    }

    if (
      recoveredPath
    ) {
      pipeline.$group.amountRecovered =
        {
          $sum:
            `$${recoveredPath}`,
        };
    }

    if (
      writtenOffPath
    ) {
      pipeline.$group.writtenOffAmount =
        {
          $sum:
            `$${writtenOffPath}`,
        };
    }

    if (
      this.hasPath(
        'status',
      )
    ) {
      pipeline.$group.activeLoans =
        {
          $sum: {
            $cond: [
              {
                $in: [
                  '$status',
                  [
                    'approved',
                    'disbursed',
                    'active',
                    'restructured',
                  ],
                ],
              },

              1,

              0,
            ],
          },
        };

      pipeline.$group.defaultedLoans =
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
        };

      pipeline.$group.completedLoans =
        {
          $sum: {
            $cond: [
              {
                $eq: [
                  '$status',
                  'completed',
                ],
              },

              1,

              0,
            ],
          },
        };
    }

    const rows =
      await this.Loan.aggregate([
        {
          $match:
            filter,
        },

        pipeline,
      ]);

    const result =
      first(rows) || {};

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

      amountRecovered:
        round(
          result.amountRecovered,
        ),

      writtenOffAmount:
        round(
          result.writtenOffAmount,
        ),

      activeLoans:
        safeNumber(
          result.activeLoans,
        ),

      defaultedLoans:
        safeNumber(
          result.defaultedLoans,
        ),

      completedLoans:
        safeNumber(
          result.completedLoans,
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

      recoveryRate:
        percent(
          result.amountRecovered,
          result.writtenOffAmount,
        ),

      defaultRate:
        percent(
          result.defaultedLoans,
          result.totalLoans,
        ),

      nplRatio:
        percent(
          this.negativeSafeNumber(
            result.defaultedOutstanding,
          ),
          result.outstandingBalance,
        ),
    };
  }

  /**
   * ==========================================================================
   * STATUS DISTRIBUTION
   * ==========================================================================
   */

  async getStatusDistribution(
    tenantId,
    options = {},
  ) {
    const filter =
      this.buildFilter(
        tenantId,
        options,
      );

    const principalPath =
      this.getPrincipalPath();

    const outstandingPath =
      this.getOutstandingPath();

    const rows =
      await this.Loan.aggregate([
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
                $sum:
                  1,
              },

            principal:
              principalPath
                ? {
                    $sum:
                      `$${principalPath}`,
                  }
                : {
                    $sum:
                      0,
                  },

            outstanding:
              outstandingPath
                ? {
                    $sum:
                      `$${outstandingPath}`,
                  }
                : {
                    $sum:
                      0,
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
            MAX_AGGREGATE_BUCKETS,
        },
      ]);

    return rows.map(
      (row) => ({
        status:
          row._id,

        count:
          safeNumber(
            row.count,
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

  /**
   * ==========================================================================
   * RISK DISTRIBUTION
   * ==========================================================================
   */

  async getRiskDistribution(
    tenantId,
  ) {
    const filter =
      this.buildTenantFilter(
        tenantId,
      );

    const riskPath =
      this.getRiskScorePath();

    const creditPath =
      this.getCreditScorePath();

    const rows =
      await this.Loan.aggregate([
        {
          $match:
            filter,
        },

        {
          $group: {
            _id: riskPath
              ? {
                  $switch: {
                    branches: [
                      {
                        case: {
                          $gte: [
                            `$${riskPath}`,
                            80,
                          ],
                        },

                        then:
                          RISK_BANDS.HIGH,
                      },

                      {
                        case: {
                          $gte: [
                            `$${riskPath}`,
                            60,
                          ],
                        },

                        then:
                          RISK_BANDS.MEDIUM,
                      },
                    ],

                    default:
                      RISK_BANDS.LOW,
                  },
                }
              : 'UNAVAILABLE',

            count:
              {
                $sum:
                  1,
              },

            outstanding:
              this.getAggregateSumExpression(
                outstandingPath,
              ),

            averageRiskScore:
              riskPath
                ? {
                    $avg:
                      `$${riskPath}`,
                  }
                : {
                    $avg:
                      null,
                  },

            averageCreditScore:
              creditPath
                ? {
                    $avg:
                      `$${creditPath}`,
                  }
                : {
                    $avg:
                      null,
                  },
          },
        },

        {
          $sort: {
            count:
              -1,
          },
        },
      ]);

    return rows.map(
      (row) => ({
        riskBand:
          row._id,

        count:
          safeNumber(
            row.count,
          ),

        outstanding:
          round(
            row.outstanding,
          ),

        averageRiskScore:
          round(
            row.averageRiskScore,
          ),

        averageCreditScore:
          round(
            row.averageCreditScore,
          ),
      }),
    );
  }

  /**
   * ==========================================================================
   * ARREARS / DELINQUENCY
   * ==========================================================================
   */

  async getArrearsSummary(
    tenantId,
    options = {},
  ) {
    const filter =
      this.buildFilter(
        tenantId,
        options,
      );

    if (
      !this.hasPath(
        'daysPastDue',
      )
    ) {
      return {
        available:
          false,

        reason:
          'The current Loan model does not expose daysPastDue.',
      };
    }

    const outstandingPath =
      this.getOutstandingPath();

    const duePath =
      this.getAmountDuePath();

    const rows =
      await this.Loan.aggregate([
        {
          $match:
            filter,
        },

        {
          $group: {
            _id: {
              $switch: {
                branches: [
                  {
                    case: {
                      $lte: [
                        '$daysPastDue',
                        0,
                      ],
                    },

                    then:
                      'CURRENT',
                  },

                  {
                    case: {
                      $lte: [
                        '$daysPastDue',
                        30,
                      ],
                    },

                    then:
                      '1_30_DAYS',
                  },

                  {
                    case: {
                      $lte: [
                        '$daysPastDue',
                        60,
                      ],
                    },

                    then:
                      '31_60_DAYS',
                  },

                  {
                    case: {
                      $lte: [
                        '$daysPastDue',
                        90,
                      ],
                    },

                    then:
                      '61_90_DAYS',
                  },
                ],

                default:
                  '90_PLUS_DAYS',
              },
            },

            count:
              {
                $sum:
                  1,
              },

            outstanding:
              outstandingPath
                ? {
                    $sum:
                      `$${outstandingPath}`,
                  }
                : {
                    $sum:
                      0,
                  },

            amountDue:
              duePath
                ? {
                    $sum:
                      `$${duePath}`,
                  }
                : {
                    $sum:
                      0,
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
      available:
        true,

      buckets:
        rows.map(
          (row) => ({
            bucket:
              row._id,

            count:
              safeNumber(
                row.count,
              ),

            outstanding:
              round(
                row.outstanding,
              ),

            amountDue:
              round(
                row.amountDue,
              ),
          }),
        ),
    };
  }

  /**
   * ==========================================================================
   * APPROVAL FUNNEL
   * ==========================================================================
   */

  async getApprovalFunnel(
    tenantId,
    options = {},
  ) {
    const filter =
      this.buildFilter(
        tenantId,
        options,
      );

    if (
      !this.hasPath(
        'status',
      )
    ) {
      return {
        available:
          false,

        reason:
          'The current Loan model does not expose status.',
      };
    }

    const rows =
      await this.Loan.aggregate([
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
                $sum:
                  1,
              },
          },
        },
      ]);

    const byStatus =
      {};

    rows.forEach(
      (row) => {
        byStatus[
          row._id
        ] =
          safeNumber(
            row.count,
          );
      },
    );

    return {
      available:
        true,

      draft:
        byStatus.draft ||
        0,

      submitted:
        byStatus.submitted ||
        0,

      underReview:
        byStatus.under_review ||
        0,

      approved:
        byStatus.approved ||
        0,

      rejected:
        byStatus.rejected ||
        0,

      disbursed:
        byStatus.disbursed ||
        0,

      active:
        byStatus.active ||
        0,

      completed:
        byStatus.completed ||
        0,

      defaulted:
        byStatus.defaulted ||
        0,

      writtenOff:
        byStatus.written_off ||
        0,

      recovered:
        byStatus.recovered ||
        0,

      cancelled:
        byStatus.cancelled ||
        0,
    };
  }

  /**
   * ==========================================================================
   * REPAYMENT PERFORMANCE
   * ==========================================================================
   */

  async getRepaymentPerformance(
    tenantId,
    options = {},
  ) {
    const filter =
      this.buildFilter(
        tenantId,
        options,
      );

    const principalPath =
      this.getPrincipalPath();

    const duePath =
      this.getAmountDuePath();

    const repaidPath =
      this.getAmountRepaidPath();

    const outstandingPath =
      this.getOutstandingPath();

    if (
      !repaidPath &&
      !duePath &&
      !principalPath
    ) {
      return {
        available:
          false,

        reason:
          'The current Loan model lacks the required repayment amount fields.',
      };
    }

    const rows =
      await this.Loan.aggregate([
        {
          $match:
            filter,
        },

        {
          $group: {
            _id:
              null,

            principal:
              principalPath
                ? {
                    $sum:
                      `$${principalPath}`,
                  }
                : {
                    $sum:
                      0,
                  },

            due:
              duePath
                ? {
                    $sum:
                      `$${duePath}`,
                  }
                : {
                    $sum:
                      0,
                  },

            repaid:
              repaidPath
                ? {
                    $sum:
                      `$${repaidPath}`,
                  }
                : {
                    $sum:
                      0,
                  },

            outstanding:
              outstandingPath
                ? {
                    $sum:
                      `$${outstandingPath}`,
                  }
                : {
                    $sum:
                      0,
                  },
          },
        },
      ]);

    const result =
      first(rows) || {};

    return {
      available:
        true,

      principal:
        round(
          result.principal,
        ),

      due:
        round(
          result.due,
        ),

      repaid:
        round(
          result.repaid,
        ),

      outstanding:
        round(
          result.outstanding,
        ),

      repaymentRate:
        percent(
          result.repaid,
          result.principal,
        ),

      collectionRate:
        percent(
          result.repaid,
          result.due,
        ),
    };
  }

  /**
   * ==========================================================================
   * RECOVERY / WRITE-OFF
   * ==========================================================================
   */

  async getRecoverySummary(
    tenantId,
    options = {},
  ) {
    const filter =
      this.buildFilter(
        tenantId,
        options,
      );

    const recoveredPath =
      this.getRecoveredPath();

    const writtenOffPath =
      this.getWrittenOffPath();

    if (
      !recoveredPath &&
      !writtenOffPath
    ) {
      return {
        available:
          false,

        reason:
          'The current Loan model does not expose recovery or write-off amounts.',
      };
    }

    const rows =
      await this.Loan.aggregate([
        {
          $match:
            filter,
        },

        {
          $group: {
            _id:
              null,

            recovered:
              recoveredPath
                ? {
                    $sum:
                      `$${recoveredPath}`,
                  }
                : {
                    $sum:
                      0,
                  },

            writtenOff:
              writtenOffPath
                ? {
                    $sum:
                      `$${writtenOffPath}`,
                  }
                : {
                    $sum:
                      0,
                  },

            recoveredLoans:
              {
                $sum: {
                  $cond: [
                    recoveredPath
                      ? {
                          $gt: [
                            `$${recoveredPath}`,
                            0,
                          ],
                        }
                      : false,

                    1,

                    0,
                  ],
                },
              },

            writtenOffLoans:
              {
                $sum: {
                  $cond: [
                    writtenOffPath
                      ? {
                          $gt: [
                            `$${writtenOffPath}`,
                            0,
                          ],
                        }
                      : false,

                    1,

                    0,
                  },
                },
              },
          },
        },
      ]);

    const result =
      first(rows) || {};

    return {
      available:
        true,

      recovered:
        round(
          result.recovered,
        ),

      writtenOff:
        round(
          result.writtenOff,
        ),

      recoveredLoans:
        safeNumber(
          result.recoveredLoans,
        ),

      writtenOffLoans:
        safeNumber(
          result.writtenOffLoans,
        ),

      recoveryRate:
        percent(
          result.recovered,
          result.writtenOff,
        ),
    };
  }

  /**
   * ==========================================================================
   * PORTFOLIO TRENDS
   * ==========================================================================
   */

  async getGrowth(
    tenantId,
    {
      from = null,
      to = null,
      days = 30,
      granularity =
        'day',
    } = {},
  ) {
    const range =
      this.buildDateRange({
        from,
        to,
        days,
      });

    const expression =
      this.dateBucketExpression(
        '$createdAt',
        granularity,
      );

    const principalPath =
      this.getPrincipalPath();

    const outstandingPath =
      this.getOutstandingPath();

    return this.Loan.aggregate([
      {
        $match: {
          ...this.buildTenantFilter(
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
            expression,

          loans:
            {
              $sum:
                1,
            },

          principal:
            principalPath
              ? {
                  $sum:
                    `$${principalPath}`,
                }
              : {
                  $sum:
                    0,
                },

          outstanding:
            outstandingPath
              ? {
                  $sum:
                    `$${outstandingPath}`,
                }
              : {
                  $sum:
                    0,
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
   * APPROVED / DISBURSED TRENDS
   * ==========================================================================
   */

  async getDisbursementTrend(
    tenantId,
    {
      from = null,
      to = null,
      days = 30,
      granularity =
        'day',
    } = {},
  ) {
    const range =
      this.buildDateRange({
        from,
        to,
        days,
      });

    if (
      !this.hasPath(
        'disbursedAt',
      )
    ) {
      return {
        available:
          false,

        reason:
          'The current Loan model does not expose disbursedAt.',
      };
    }

    const expression =
      this.dateBucketExpression(
        '$disbursedAt',
        granularity,
      );

    const principalPath =
      this.getPrincipalPath();

    return {
      available:
        true,

      data:
        await this.Loan.aggregate([
          {
            $match: {
              ...this.buildTenantFilter(
                tenantId,
              ),

              disbursedAt: {
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
                expression,

              loans:
                {
                  $sum:
                    1,
                },

              amount:
                principalPath
                  ? {
                      $sum:
                        `$${principalPath}`,
                    }
                  : {
                      $sum:
                        0,
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
    };
  }

  /**
   * ==========================================================================
   * RECENT LOANS
   * ==========================================================================
   */

  async findRecent(
    tenantId,
    {
      limit =
        DEFAULT_PAGE_SIZE,

      days = null,
    } = {},
  ) {
    const filter =
      this.buildTenantFilter(
        tenantId,
      );

    if (
      days !== null
    ) {
      filter.createdAt = {
        $gte:
          new Date(
            Date.now() -
              Number(days) *
                24 *
                60 *
                60 *
                1000,
          ),
      };
    }

    return this.Loan
      .find(
        filter,
      )
      .select(
        this.getSafeProjection(),
      )
      .sort({
        createdAt:
          -1,

        _id:
          -1,
      })
      .limit(
        normalizeLimit(
          limit,
        ),
      )
      .lean();
  }

  /**
   * ==========================================================================
   * RECENTLY DISBURSED
   * ==========================================================================
   */

  async findRecentlyDisbursed(
    tenantId,
    {
      limit =
        DEFAULT_PAGE_SIZE,
      days = 30,
    } = {},
  ) {
    if (
      !this.hasPath(
        'disbursedAt',
      )
    ) {
      return [];
    }

    const since =
      new Date(
        Date.now() -
          Number(days) *
            24 *
            60 *
            60 *
            1000,
      );

    return this.Loan
      .find({
        ...this.buildTenantFilter(
          tenantId,
        ),

        disbursedAt: {
          $gte:
            since,
        },
      })
      .select(
        this.getSafeProjection(),
      )
      .sort({
        disbursedAt:
          -1,

        _id:
          -1,
      })
      .limit(
        normalizeLimit(
          limit,
        ),
      )
      .lean();
  }

  /**
   * ==========================================================================
   * OVERDUE LOANS
   * ==========================================================================
   */

  async findOverdue(
    tenantId,
    {
      minDaysPastDue =
        1,

      limit =
        DEFAULT_PAGE_SIZE,
    } = {},
  ) {
    if (
      !this.hasPath(
        'daysPastDue',
      )
    ) {
      return {
        available:
          false,

        items: [],
      };
    }

    return {
      available:
        true,

      items:
        await this.Loan
          .find({
            ...this.buildTenantFilter(
              tenantId,
            ),

            daysPastDue: {
              $gte:
                Math.max(
                  1,
                  Number(
                    minDaysPastDue,
                  ),
                ),
            },

            status: {
              $nin: [
                'completed',
                'cancelled',
              ],
            },
          })
          .select(
            this.getSafeProjection(),
          )
          .sort({
            daysPastDue:
              -1,

            createdAt:
              1,

            _id:
              1,
          })
          .limit(
            normalizeLimit(
              limit,
            ),
          )
          .lean(),
    };
  }

  /**
   * ==========================================================================
   * DEFAULTED LOANS
   * ==========================================================================
   */

  async findDefaulted(
    tenantId,
    {
      limit =
        DEFAULT_PAGE_SIZE,
    } = {},
  ) {
    return this.findMany(
      tenantId,
      {
        statuses: [
          'defaulted',
          'written_off',
        ],

        limit,
      },
    );
  }

  /**
   * ==========================================================================
   * HIGH-RISK LOANS
   * ==========================================================================
   */

  async findHighRisk(
    tenantId,
    {
      threshold =
        80,

      limit =
        DEFAULT_PAGE_SIZE,
    } = {},
  ) {
    const riskPath =
      this.getRiskScorePath();

    if (
      !riskPath
    ) {
      return {
        available:
          false,

        items: [],
      };
    }

    return {
      available:
        true,

      items:
        await this.Loan
          .find({
            ...this.buildTenantFilter(
              tenantId,
            ),

            [riskPath]: {
              $gte:
                Number(
                  threshold,
                ),
            },
          })
          .select(
            this.getSafeProjection(),
          )
          .sort({
            [riskPath]:
              -1,

            outstandingBalance:
              -1,

            createdAt:
              -1,
          })
          .limit(
            normalizeLimit(
              limit,
            ),
          )
          .lean(),
    };
  }

  /**
   * ==========================================================================
   * LOAN BY MEMBER
   * ==========================================================================
   */

  async findByMember(
    tenantId,
    memberId,
    options = {},
  ) {
    const memberPath =
      this.getMemberPath();

    if (
      !memberPath
    ) {
      throw new AdminLoanRepositoryError(
        'The Loan model does not expose a member reference.',
        {
          code:
            'LOAN_MEMBER_REFERENCE_UNAVAILABLE',
        },
      );
    }

    const filter = {
      ...this.buildTenantFilter(
        tenantId,
      ),

      [memberPath]:
        toObjectId(
          memberId,
          'memberId',
        ),
    };

    return this.Loan
      .find(
        filter,
      )
      .select(
        this.getSafeProjection(),
      )
      .sort({
        createdAt:
          -1,

        _id:
          -1,
      })
      .limit(
        normalizeLimit(
          options.limit,
        ),
      )
      .lean();
  }

  /**
   * ==========================================================================
   * LOANS BY USER
   * ==========================================================================
   */

  async findByUser(
    tenantId,
    userId,
    options = {},
  ) {
    const userPath =
      this.getUserPath();

    if (
      !userPath
    ) {
      throw new AdminLoanRepositoryError(
        'The Loan model does not expose a user reference.',
        {
          code:
            'LOAN_USER_REFERENCE_UNAVAILABLE',
        },
      );
    }

    return this.Loan
      .find({
        ...this.buildTenantFilter(
          tenantId,
        ),

        [userPath]:
          toObjectId(
            userId,
            'userId',
          ),
      })
      .select(
        this.getSafeProjection(),
      )
      .sort({
        createdAt:
          -1,

        _id:
          -1,
      })
      .limit(
        normalizeLimit(
          options.limit,
        ),
      )
      .lean();
  }

  /**
   * ==========================================================================
   * GROUP PORTFOLIO
   * ==========================================================================
   */

  async findByGroup(
    tenantId,
    groupId,
    options = {},
  ) {
    const groupPath =
      this.getGroupPath();

    if (
      !groupPath
    ) {
      throw new AdminLoanRepositoryError(
        'The Loan model does not expose a group reference.',
        {
          code:
            'LOAN_GROUP_REFERENCE_UNAVAILABLE',
        },
      );
    }

    return this.Loan
      .find({
        ...this.buildTenantFilter(
          tenantId,
        ),

        [groupPath]:
          toObjectId(
            groupId,
            'groupId',
          ),
      })
      .select(
        this.getSafeProjection(),
      )
      .sort({
        createdAt:
          -1,

        _id:
          -1,
      })
      .limit(
        normalizeLimit(
          options.limit,
        ),
      )
      .lean();
  }

  /**
   * ==========================================================================
   * PORTFOLIO BY PURPOSE
   * ==========================================================================
   */

  async getPurposeDistribution(
    tenantId,
    options = {},
  ) {
    if (
      !this.hasPath(
        'purpose',
      )
    ) {
      return {
        available:
          false,

        items: [],
      };
    }

    const rows =
      await this.Loan.aggregate([
        {
          $match:
            this.buildFilter(
              tenantId,
              options,
            ),
        },

        {
          $group: {
            _id:
              '$purpose',

            count:
              {
                $sum:
                  1,
              },

            principal:
              this.getAggregateSumExpression(
                this.getPrincipalPath(),
              ),

            outstanding:
              this.getAggregateSumExpression(
                this.getOutstandingPath(),
              ),
          },
        },

        {
          $sort: {
            principal:
              -1,
          },
        },

        {
          $limit:
            MAX_AGGREGATE_BUCKETS,
        },
      ]);

    return {
      available:
        true,

      items:
        rows.map(
          (row) => ({
            purpose:
              row._id,

            count:
              safeNumber(
                row.count,
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
        ),
    };
  }

  /**
   * ==========================================================================
   * ADMIN LOAN DASHBOARD DATASET
   * ==========================================================================
   */

  async getDashboardSummary(
    tenantId,
    options = {},
  ) {
    const [
      portfolio,
      statuses,
      risk,
      arrears,
      repayment,
      recovery,
      funnel,
      growth,
      disbursement,
      recent,
    ] =
      await Promise.all([
        this.getPortfolioSummary(
          tenantId,
          options,
        ),

        this.getStatusDistribution(
          tenantId,
          options,
        ),

        this.getRiskDistribution(
          tenantId,
        ),

        this.getArrearsSummary(
          tenantId,
          options,
        ),

        this.getRepaymentPerformance(
          tenantId,
          options,
        ),

        this.getRecoverySummary(
          tenantId,
          options,
        ),

        this.getApprovalFunnel(
          tenantId,
          options,
        ),

        this.getGrowth(
          tenantId,
          {
            from:
              options.from,

            to:
              options.to,

            days:
              options.days ||
              30,

            granularity:
              options.granularity ||
              'day',
          },
        ),

        this.getDisbursementTrend(
          tenantId,
          {
            from:
              options.from,

            to:
              options.to,

            days:
              options.days ||
              30,

            granularity:
              options.granularity ||
              'day',
          },
        ),

        this.findRecent(
          tenantId,
          {
            limit:
              options.limit ||
              10,
          },
        ),
      ]);

    return {
      tenantId:
        String(
          tenantId,
        ),

      portfolio,

      statuses,

      risk,

      arrears,

      repayment,

      recovery,

      funnel,

      growth,

      disbursement,

      recent,

      generatedAt:
        new Date(),
    };
  }

  /**
   * ==========================================================================
   * CURSOR PAGINATION
   * ==========================================================================
   */

  encodeCursor(
    document,
  ) {
    const payload =
      JSON.stringify({
        createdAt:
          document.createdAt
            ? new Date(
                document.createdAt,
              ).toISOString()
            : null,

        id:
          document._id
            ? String(
                document._id,
              )
            : null,
      });

    return Buffer
      .from(
        payload,
      )
      .toString(
        'base64url',
      );
  }

  decodeCursor(
    cursor,
  ) {
    if (!cursor) {
      throw new AdminLoanRepositoryError(
        'Pagination cursor is required.',
        {
          code:
            'CURSOR_REQUIRED',
        },
      );
    }

    try {
      const parsed =
        JSON.parse(
          Buffer
            .from(
              String(cursor),
              'base64url',
            )
            .toString(
              'utf8',
            ),
        );

      const createdAt =
        normalizeDate(
          parsed.createdAt,
          'cursor.createdAt',
        );

      const id =
        toObjectId(
          parsed.id,
          'cursor.id',
        );

      if (
        !createdAt
      ) {
        throw new Error(
          'Cursor createdAt is missing.',
        );
      }

      return {
        createdAt,
        id,
      };
    } catch (error) {
      if (
        error instanceof
        AdminLoanRepositoryError
      ) {
        throw error;
      }

      throw new AdminLoanRepositoryError(
        'Invalid loan pagination cursor.',
        {
          code:
            'INVALID_CURSOR',

          cause:
            error,
        },
      );
    }
  }

  /**
   * ==========================================================================
   * DATE RANGE
   * ==========================================================================
   */

  buildDateRange(
    {
      from = null,
      to = null,
      days = 30,
    } = {},
  ) {
    const resolvedTo =
      normalizeDate(
        to,
        'to',
      ) ||
      new Date();

    const parsedDays =
      Number(days);

    const safeDays =
      Number.isInteger(
        parsedDays,
      ) &&
      parsedDays > 0
        ? Math.min(
            parsedDays,
            3660,
          )
        : 30;

    const resolvedFrom =
      normalizeDate(
        from,
        'from',
      ) ||
      new Date(
        resolvedTo.getTime() -
          safeDays *
            24 *
            60 *
            60 *
            1000,
      );

    if (
      resolvedFrom >
      resolvedTo
    ) {
      throw new AdminLoanRepositoryError(
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

  /**
   * ==========================================================================
   * DATE BUCKET
   * ==========================================================================
   */

  dateBucketExpression(
    field,
    granularity,
  ) {
    switch (
      granularity
    ) {
      case 'hour':
        return {
          $dateToString: {
            format:
              '%Y-%m-%dT%H:00:00.000Z',

            date:
              field,
          },
        };

      case 'week':
        return {
          $dateToString: {
            format:
              '%G-W%V',

            date:
              field,
          },
        };

      case 'month':
        return {
          $dateToString: {
            format:
              '%Y-%m',

            date:
              field,
          },
        };

      case 'day':
      default:
        return {
          $dateToString: {
            format:
              '%Y-%m-%d',

            date:
              field,
          },
        };
    }
  }

  /**
   * ==========================================================================
   * AGGREGATION HELPERS
   * ==========================================================================
   */

  getAggregateSumExpression(
    path,
  ) {
    return path
      ? {
          $sum:
            `$${path}`,
        }
      : {
          $sum:
            0,
        };
  }

  negativeSafeNumber(
    value,
  ) {
    const number =
      safeNumber(
        value,
      );

    return number < 0
      ? 0
      : number;
  }

  /**
   * ==========================================================================
   * CAPABILITIES
   * ==========================================================================
   */

  getCapabilities() {
    return {
      repository:
        REPOSITORY_NAME,

      version:
        REPOSITORY_VERSION,

      tenantIsolation:
        {
          supported:
            this.supportsTenantIsolation(),

          failClosed:
            true,
        },

      loanPaths: {
        tenantId:
          this.hasPath(
            'tenantId',
          ),

        principal:
          this.getPrincipalPath(),

        outstanding:
          this.getOutstandingPath(),

        amountDue:
          this.getAmountDuePath(),

        amountRepaid:
          this.getAmountRepaidPath(),

        recovered:
          this.getRecoveredPath(),

        writtenOff:
          this.getWrittenOffPath(),

        riskScore:
          this.getRiskScorePath(),

        creditScore:
          this.getCreditScorePath(),

        daysPastDue:
          this.hasPath(
            'daysPastDue',
          ),

        disbursedAt:
          this.hasPath(
            'disbursedAt',
          ),
      },

      timestamp:
        new Date(),
    };
  }

  /**
   * ==========================================================================
   * HEALTH
   * ==========================================================================
   */

  async health() {
    const databaseConnected =
      Boolean(
        this.Loan &&
          this.Loan.db &&
          this.Loan.db.readyState ===
            1,
      );

    const tenantIsolation =
      this.supportsTenantIsolation();

    return {
      repository:
        REPOSITORY_NAME,

      version:
        REPOSITORY_VERSION,

      healthy:
        databaseConnected &&
        tenantIsolation,

      databaseConnected,

      tenantIsolation,

      tenantSafety:
        tenantIsolation
          ? 'available'
          : 'blocked_until_loan_tenantId_is_implemented',

      timestamp:
        new Date(),
    };
  }
}

/**
 * ============================================================================
 * SINGLETON
 * ============================================================================
 */

const adminLoanRepository =
  new AdminLoanRepository();

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  adminLoanRepository;

module.exports.AdminLoanRepository =
  AdminLoanRepository;

module.exports.AdminLoanRepositoryError =
  AdminLoanRepositoryError;

module.exports.REPOSITORY_NAME =
  REPOSITORY_NAME;

module.exports.REPOSITORY_VERSION =
  REPOSITORY_VERSION;

module.exports.LOAN_STATUSES =
  LOAN_STATUSES;

module.exports.RISK_BANDS =
  RISK_BANDS;