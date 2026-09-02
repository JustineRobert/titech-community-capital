'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin User Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/admin/adminUser.repository.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical persistence/data-access layer for administrative user management
 * and user analytics within TITech Community Capital.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Tenant-scoped user queries
 * - Secure user lookup
 * - Administrative user listing
 * - Deterministic cursor pagination
 * - User status / role / verification filtering
 * - KYC / AML filtering
 * - Security-state reporting
 * - Login/activity reporting
 * - Administrative user counts
 * - User aggregation/statistics
 * - Safe existence checks
 *
 * Explicit repository boundary
 * ----------------------------------------------------------------------------
 * This repository:
 *
 * ✓ Reads/writes ONLY the User model where appropriate
 * ✓ Always applies tenant scoping for tenant operations
 * ✓ Excludes password/token/MFA-secret fields from normal projections
 * ✓ Uses explicit field projections
 * ✓ Uses MongoDB aggregation for statistics
 * ✓ Supports deterministic pagination
 * ✓ Supports dependency injection for tests
 *
 * This repository MUST NOT:
 *
 * ✗ Authorize an administrator
 * ✗ Decide whether an admin operation is permitted
 * ✗ Approve loans
 * ✗ Perform fraud decisions
 * ✗ Mutate financial balances
 * ✗ Send email/SMS
 * ✗ Issue access tokens
 * ✗ Implement HTTP concerns
 * ✗ Contain controller logic
 *
 * The service layer owns business rules.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const User = require('../../models/User');

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const REPOSITORY_NAME =
  'AdminUserRepository';

const REPOSITORY_VERSION =
  '2026.1';

const DEFAULT_PAGE_SIZE =
  25;

const MAX_PAGE_SIZE =
  100;

const MAX_SEARCH_LENGTH =
  120;

const SUPPORTED_ROLES =
  Object.freeze([
    'user',
    'admin',
    'group_admin',
  ]);

const SUPPORTED_STATUSES =
  Object.freeze([
    'pending',
    'active',
    'disabled',
    'suspended',
    'locked',
  ]);

const SUPPORTED_KYC_STATUSES =
  Object.freeze([
    'pending',
    'approved',
    'rejected',
    'expired',
  ]);

const SUPPORTED_AML_RISK_RATINGS =
  Object.freeze([
    'low',
    'medium',
    'high',
    'critical',
  ]);

/**
 * ============================================================================
 * SAFE PROJECTIONS
 * ============================================================================
 *
 * The User model contains:
 *
 * - password
 * - passwordHistory
 * - resetPasswordToken
 * - verificationToken
 * - MFA secret
 * - MFA backup codes
 *
 * These fields are NEVER included in normal repository projections.
 *
 * Security-state fields such as failedLoginAttempts/lockUntil are available
 * only through an explicitly administrative security projection.
 * ============================================================================
 */

const SAFE_USER_PROJECTION = Object.freeze({
  _id: 1,

  name: 1,

  email: 1,

  phone: 1,

  role: 1,

  status: 1,

  isActive: 1,

  isVerified: 1,

  tenantId: 1,

  profile: 1,

  'kyc.level': 1,
  'kyc.status': 1,
  'kyc.verifiedAt': 1,
  'kyc.verifiedBy': 1,

  'aml.riskRating': 1,
  'aml.score': 1,
  'aml.lastScreenedAt': 1,

  'mfa.enabled': 1,

  'mobileMoney.provider': 1,
  'mobileMoney.verified': 1,

  referralCode: 1,

  bonus: 1,

  'referrals.totalReferrals': 1,
  'referrals.totalBonusEarned': 1,

  lastLogin: 1,

  'security.lastPasswordChange': 1,
  'security.lastLoginAt': 1,

  'sessionMetrics.activeSessions': 1,
  'sessionMetrics.lastRefreshAt': 1,

  createdAt: 1,
  updatedAt: 1,
});

const ADMIN_SECURITY_PROJECTION = Object.freeze({
  ...SAFE_USER_PROJECTION,

  failedLoginAttempts: 1,

  lockUntil: 1,

  'security.lastLoginIp': 1,
  'security.lastLoginUserAgent': 1,
});

/**
 * ============================================================================
 * ERROR
 * ============================================================================
 */

class AdminUserRepositoryError extends Error {
  constructor(
    message,
    {
      code =
        'ADMIN_USER_REPOSITORY_ERROR',

      cause =
        null,

      details =
        null,
    } = {},
  ) {
    super(message);

    this.name =
      'AdminUserRepositoryError';

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
 * NORMALIZATION
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

function normalizeSearch(
  value,
) {
  const normalized =
    normalizeString(value);

  if (!normalized) {
    return null;
  }

  return normalized.slice(
    0,
    MAX_SEARCH_LENGTH,
  );
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

function toObjectId(
  value,
  fieldName = 'id',
) {
  const normalized =
    normalizeString(value);

  if (!normalized) {
    throw new AdminUserRepositoryError(
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
    throw new AdminUserRepositoryError(
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
    throw new AdminUserRepositoryError(
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

/**
 * ============================================================================
 * REPOSITORY
 * ============================================================================
 */

class AdminUserRepository {
  constructor({
    UserModel =
      User,
  } = {}) {
    this.User =
      UserModel;
  }

  /**
   * ==========================================================================
   * TENANT FILTER
   * ==========================================================================
   */

  buildTenantFilter(
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

  /**
   * ==========================================================================
   * BASE PROJECTION
   * ==========================================================================
   */

  getSafeProjection({
    includeSecurity =
      false,
  } = {}) {
    return includeSecurity
      ? {
          ...ADMIN_SECURITY_PROJECTION,
        }
      : {
          ...SAFE_USER_PROJECTION,
        };
  }

  /**
   * ==========================================================================
   * USER FILTER BUILDER
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
      normalizeSearch(
        options.search,
      );

    if (search) {
      const escaped =
        this.escapeRegex(
          search,
        );

      filter.$or = [
        {
          name: {
            $regex:
              escaped,

            $options:
              'i',
          },
        },

        {
          email: {
            $regex:
              escaped,

            $options:
              'i',
          },
        },

        {
          phone: {
            $regex:
              escaped,

            $options:
              'i',
          },
        },

        {
          referralCode: {
            $regex:
              escaped,

            $options:
              'i',
          },
        },
      ];
    }

    this.applyArrayFilter(
      filter,
      'role',
      options.roles ||
        options.role,
      SUPPORTED_ROLES,
    );

    this.applyArrayFilter(
      filter,
      'status',
      options.statuses ||
        options.status,
      SUPPORTED_STATUSES,
    );

    this.applyBooleanFilter(
      filter,
      'isActive',
      options.isActive,
    );

    this.applyBooleanFilter(
      filter,
      'isVerified',
      options.isVerified,
    );

    this.applyArrayFilter(
      filter,
      'kyc.status',
      options.kycStatuses ||
        options.kycStatus,
      SUPPORTED_KYC_STATUSES,
    );

    this.applyArrayFilter(
      filter,
      'aml.riskRating',
      options.amlRiskRatings ||
        options.amlRiskRating,
      SUPPORTED_AML_RISK_RATINGS,
    );

    if (
      options.mfaEnabled !==
      undefined
    ) {
      const value =
        normalizeBoolean(
          options.mfaEnabled,
        );

      if (
        value !== null
      ) {
        filter[
          'mfa.enabled'
        ] =
          value;
      }
    }

    if (
      options.mobileMoneyVerified !==
      undefined
    ) {
      const value =
        normalizeBoolean(
          options.mobileMoneyVerified,
        );

      if (
        value !== null
      ) {
        filter[
          'mobileMoney.verified'
        ] =
          value;
      }
    }

    if (
      options.createdFrom ||
      options.createdTo
    ) {
      const from =
        normalizeDate(
          options.createdFrom,
          'createdFrom',
        );

      const to =
        normalizeDate(
          options.createdTo,
          'createdTo',
        );

      filter.createdAt =
        {};

      if (from) {
        filter.createdAt.$gte =
          from;
      }

      if (to) {
        filter.createdAt.$lte =
          to;
      }

      this.assertDateRange(
        filter.createdAt,
      );
    }

    if (
      options.lastLoginFrom ||
      options.lastLoginTo
    ) {
      const from =
        normalizeDate(
          options.lastLoginFrom,
          'lastLoginFrom',
        );

      const to =
        normalizeDate(
          options.lastLoginTo,
          'lastLoginTo',
        );

      filter.lastLogin =
        {};

      if (from) {
        filter.lastLogin.$gte =
          from;
      }

      if (to) {
        filter.lastLogin.$lte =
          to;
      }

      this.assertDateRange(
        filter.lastLogin,
      );
    }

    if (
      options.lockedOnly
    ) {
      filter.status =
        'locked';
    }

    if (
      options.highRiskOnly
    ) {
      filter[
        'aml.riskRating'
      ] = {
        $in: [
          'high',
          'critical',
        ],
      };
    }

    if (
      options.unverifiedOnly
    ) {
      filter.isVerified =
        false;
    }

    return filter;
  }

  applyArrayFilter(
    filter,
    field,
    value,
    allowed,
  ) {
    const values =
      normalizeArray(value);

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
      throw new AdminUserRepositoryError(
        `No valid values supplied for ${field}.`,
        {
          code:
            'INVALID_USER_FILTER',
          details: {
            field,
            allowed,
          },
        },
      );
    }

    filter[field] =
      valid.length ===
      1
        ? valid[0]
        : {
            $in:
              valid,
          };
  }

  applyBooleanFilter(
    filter,
    field,
    value,
  ) {
    if (
      value === undefined
    ) {
      return;
    }

    const normalized =
      normalizeBoolean(
        value,
      );

    if (
      normalized !==
      null
    ) {
      filter[field] =
        normalized;
    }
  }

  assertDateRange(
    range,
  ) {
    if (
      !range ||
      !range.$gte ||
      !range.$lte
    ) {
      return;
    }

    if (
      range.$gte >
      range.$lte
    ) {
      throw new AdminUserRepositoryError(
        'Invalid date range.',
        {
          code:
            'INVALID_DATE_RANGE',
        },
      );
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
   * FIND BY ID
   * ==========================================================================
   */

  async findById(
    tenantId,
    userId,
    options = {},
  ) {
    const filter = {
      ...this.buildTenantFilter(
        tenantId,
      ),

      _id:
        toObjectId(
          userId,
          'userId',
        ),
    };

    const projection =
      this.getSafeProjection(
        options,
      );

    const user =
      await this.User
        .findOne(
          filter,
        )
        .select(
          projection,
        )
        .lean();

    return user ||
      null;
  }

  /**
   * ==========================================================================
   * FIND BY EMAIL
   * ==========================================================================
   */

  async findByEmail(
    tenantId,
    email,
    options = {},
  ) {
    const normalizedEmail =
      normalizeString(
        email,
      )?.toLowerCase();

    if (
      !normalizedEmail
    ) {
      throw new AdminUserRepositoryError(
        'email is required.',
        {
          code:
            'EMAIL_REQUIRED',
        },
      );
    }

    const user =
      await this.User
        .findOne({
          ...this.buildTenantFilter(
            tenantId,
          ),

          email:
            normalizedEmail,
        })
        .select(
          this.getSafeProjection(
            options,
          ),
        )
        .lean();

    return user ||
      null;
  }

  /**
   * ==========================================================================
   * EXISTS
   * ==========================================================================
   */

  async exists(
    tenantId,
    userId,
  ) {
    const result =
      await this.User.exists({
        ...this.buildTenantFilter(
          tenantId,
        ),

        _id:
          toObjectId(
            userId,
            'userId',
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
    const filter =
      this.buildFilter(
        tenantId,
        options,
      );

    return this.User.countDocuments(
      filter,
    );
  }

  /**
   * ==========================================================================
   * PAGINATED USER SEARCH
   * ==========================================================================
   *
   * Cursor structure:
   *
   * {
   *   createdAt: ISO date,
   *   id: ObjectId string
   * }
   *
   * Ordering:
   *   createdAt DESC
   *   _id DESC
   *
   * The deterministic _id tie-breaker prevents missing/duplicate users when
   * multiple users have identical createdAt timestamps.
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

    const users =
      await this.User
        .find(
          filter,
        )
        .select(
          this.getSafeProjection(
            options,
          ),
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
      users.length >
      limit;

    const items =
      hasNextPage
        ? users.slice(
            0,
            limit,
          )
        : users;

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
    const limit =
      normalizeLimit(
        options.limit,
      );

    const filter =
      this.buildFilter(
        tenantId,
        options,
      );

    return this.User
      .find(
        filter,
      )
      .select(
        this.getSafeProjection(
          options,
        ),
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
   * ADMIN USERS
   * ==========================================================================
   */

  async findAdministrators(
    tenantId,
    options = {},
  ) {
    return this.findMany(
      tenantId,
      {
        ...options,

        roles:
          options.roles ||
          [
            'admin',
          ],
      },
    );
  }

  async countAdministrators(
    tenantId,
  ) {
    return this.count(
      tenantId,
      {
        role:
          'admin',
      },
    );
  }

  /**
   * ==========================================================================
   * GROUP ADMINS
   * ==========================================================================
   */

  async findGroupAdministrators(
    tenantId,
    options = {},
  ) {
    return this.findMany(
      tenantId,
      {
        ...options,

        roles:
          [
            'group_admin',
          ],
      },
    );
  }

  /**
   * ==========================================================================
   * ACTIVE USERS
   * ==========================================================================
   */

  async findActiveUsers(
    tenantId,
    options = {},
  ) {
    return this.findMany(
      tenantId,
      {
        ...options,

        status:
          'active',

        isActive:
          true,
      },
    );
  }

  /**
   * ==========================================================================
   * LOCKED USERS
   * ==========================================================================
   */

  async findLockedUsers(
    tenantId,
    options = {},
  ) {
    return this.findMany(
      tenantId,
      {
        ...options,

        status:
          'locked',

        includeSecurity:
          true,
      },
    );
  }

  /**
   * ==========================================================================
   * UNVERIFIED USERS
   * ==========================================================================
   */

  async findUnverifiedUsers(
    tenantId,
    options = {},
  ) {
    return this.findMany(
      tenantId,
      {
        ...options,

        isVerified:
          false,
      },
    );
  }

  /**
   * ==========================================================================
   * HIGH-RISK USERS
   * ==========================================================================
   */

  async findHighRiskUsers(
    tenantId,
    options = {},
  ) {
    return this.findMany(
      tenantId,
      {
        ...options,

        highRiskOnly:
          true,
      },
    );
  }

  /**
   * ==========================================================================
   * KYC PENDING USERS
   * ==========================================================================
   */

  async findKycPendingUsers(
    tenantId,
    options = {},
  ) {
    return this.findMany(
      tenantId,
      {
        ...options,

        kycStatus:
          'pending',
      },
    );
  }

  /**
   * ==========================================================================
   * AML HIGH / CRITICAL RISK
   * ==========================================================================
   */

  async findAmlRiskUsers(
    tenantId,
    options = {},
  ) {
    return this.findMany(
      tenantId,
      {
        ...options,

        amlRiskRatings: [
          'high',
          'critical',
        ],
      },
    );
  }

  /**
   * ==========================================================================
   * SECURITY USER DETAILS
   * ==========================================================================
   */

  async getSecurityProfile(
    tenantId,
    userId,
  ) {
    const user =
      await this.User
        .findOne({
          ...this.buildTenantFilter(
            tenantId,
          ),

          _id:
            toObjectId(
              userId,
              'userId',
            ),
        })
        .select(
          this.getSafeProjection({
            includeSecurity:
              true,
          }),
        )
        .lean();

    if (!user) {
      return null;
    }

    return {
      id:
        String(user._id),

      tenantId:
        user.tenantId
          ? String(
              user.tenantId,
            )
          : null,

      role:
        user.role,

      status:
        user.status,

      isActive:
        Boolean(
          user.isActive,
        ),

      isVerified:
        Boolean(
          user.isVerified,
        ),

      mfaEnabled:
        Boolean(
          user.mfa?.enabled,
        ),

      failedLoginAttempts:
        Number(
          user.failedLoginAttempts ||
            0,
        ),

      lockedUntil:
        user.lockUntil ||
        null,

      lastLogin:
        user.lastLogin ||
        null,

      lastLoginAt:
        user.security
          ?.lastLoginAt ||
        null,

      lastPasswordChange:
        user.security
          ?.lastPasswordChange ||
        null,

      activeSessions:
        Number(
          user.sessionMetrics
            ?.activeSessions ||
            0,
        ),

      lastRefreshAt:
        user.sessionMetrics
          ?.lastRefreshAt ||
        null,

      /**
       * Deliberately omit:
       * - password
       * - passwordHistory
       * - MFA secret
       * - MFA backup codes
       * - resetPasswordToken
       * - verificationToken
       */
    };
  }

  /**
   * ==========================================================================
   * USER STATISTICS
   * ==========================================================================
   */

  async getStatistics(
    tenantId,
  ) {
    const match =
      this.buildTenantFilter(
        tenantId,
      );

    const [
      overall,
      byRole,
      byStatus,
      byKycStatus,
      byAmlRisk,
      verification,
      mfa,
    ] =
      await Promise.all([
        this.User.aggregate([
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

              active:
                {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              '$status',
                              'active',
                            ],
                          },

                          {
                            $eq: [
                              '$isActive',
                              true,
                            ],
                          },
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              inactive:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$isActive',
                          false,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              verified:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$isVerified',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              locked:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$status',
                          'locked',
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              suspended:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$status',
                          'suspended',
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              mfaEnabled:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$mfa.enabled',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              activeSessions:
                {
                  $sum:
                    '$sessionMetrics.activeSessions',
                },
            },
          },
        ]),

        this.groupUserField(
          match,
          '$role',
        ),

        this.groupUserField(
          match,
          '$status',
        ),

        this.groupUserField(
          match,
          '$kyc.status',
        ),

        this.groupUserField(
          match,
          '$aml.riskRating',
        ),

        this.User.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$isVerified',

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

        this.User.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$mfa.enabled',

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
      ]);

    const result =
      overall[0] || {};

    return {
      totalUsers:
        Number(
          result.total ||
            0,
        ),

      activeUsers:
        Number(
          result.active ||
            0,
        ),

      inactiveUsers:
        Number(
          result.inactive ||
            0,
        ),

      verifiedUsers:
        Number(
          result.verified ||
            0,
        ),

      unverifiedUsers:
        Number(
          result.total ||
            0,
        ) -
        Number(
          result.verified ||
            0,
        ),

      lockedUsers:
        Number(
          result.locked ||
            0,
        ),

      suspendedUsers:
        Number(
          result.suspended ||
            0,
        ),

      mfaEnabledUsers:
        Number(
          result.mfaEnabled ||
            0,
        ),

      activeSessions:
        Number(
          result.activeSessions ||
            0,
        ),

      activeRate:
        this.percent(
          result.active,
          result.total,
        ),

      verificationRate:
        this.percent(
          result.verified,
          result.total,
        ),

      mfaEnrollmentRate:
        this.percent(
          result.mfaEnabled,
          result.total,
        ),

      byRole:
        this.normalizeGroupedRows(
          byRole,
        ),

      byStatus:
        this.normalizeGroupedRows(
          byStatus,
        ),

      byKycStatus:
        this.normalizeGroupedRows(
          byKycStatus,
        ),

      byAmlRisk:
        this.normalizeGroupedRows(
          byAmlRisk,
        ),

      verification:
        this.normalizeGroupedRows(
          verification,
        ),

      mfa:
        this.normalizeGroupedRows(
          mfa,
        ),
    };
  }

  async groupUserField(
    match,
    field,
  ) {
    return this.User.aggregate([
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
        },
      },

      {
        $sort: {
          count:
            -1,
        },
      },
    ]);
  }

  normalizeGroupedRows(
    rows,
  ) {
    return rows.map(
      (row) => ({
        value:
          row._id,

        count:
          Number(
            row.count ||
              0,
          ),
      }),
    );
  }

  /**
   * ==========================================================================
   * USER GROWTH
   * ==========================================================================
   */

  async getGrowth(
    tenantId,
    {
      from = null,
      to = null,
      days = 30,
      granularity = 'day',
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

    return this.User.aggregate([
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

          users:
            {
              $sum: 1,
            },

          verified:
            {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      '$isVerified',
                      true,
                    ],
                  },

                  1,

                  0,
                ],
              },
            },

          active:
            {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          '$status',
                          'active',
                        ],
                      },

                      {
                        $eq: [
                          '$isActive',
                          true,
                        ],
                      },
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
      throw new AdminUserRepositoryError(
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
   * USER ACTIVITY
   * ==========================================================================
   */

  async getRecentlyActiveUsers(
    tenantId,
    {
      days = 30,
      limit = DEFAULT_PAGE_SIZE,
    } = {},
  ) {
    const range =
      this.buildDateRange({
        days,
      });

    const safeLimit =
      normalizeLimit(
        limit,
      );

    return this.User
      .find({
        ...this.buildTenantFilter(
          tenantId,
        ),

        lastLogin: {
          $gte:
            range.from,

          $lte:
            range.to,
        },

        status:
          'active',

        isActive:
          true,
      })
      .select(
        this.getSafeProjection(),
      )
      .sort({
        lastLogin:
          -1,

        _id:
          -1,
      })
      .limit(
        safeLimit,
      )
      .lean();
  }

  async getDormantUsers(
    tenantId,
    {
      days = 90,
      limit = DEFAULT_PAGE_SIZE,
    } = {},
  ) {
    const range =
      this.buildDateRange({
        days,
      });

    const safeLimit =
      normalizeLimit(
        limit,
      );

    const filter = {
      ...this.buildTenantFilter(
        tenantId,
      ),

      $or: [
        {
          lastLogin:
            {
              $exists:
                false,
            },
        },

        {
          lastLogin:
            null,
        },

        {
          lastLogin:
            {
              $lt:
                range.from,
            },
        },
      ],

      status:
        'active',

      isActive:
        true,
    };

    return this.User
      .find(filter)
      .select(
        this.getSafeProjection(),
      )
      .sort({
        lastLogin:
          1,

        _id:
          1,
      })
      .limit(
        safeLimit,
      )
      .lean();
  }

  /**
   * ==========================================================================
   * SECURITY STATISTICS
   * ==========================================================================
   */

  async getSecurityStatistics(
    tenantId,
  ) {
    const match =
      this.buildTenantFilter(
        tenantId,
      );

    const [
      loginState,
      mfaState,
      passwordState,
      sessionState,
    ] =
      await Promise.all([
        this.User.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                null,

              locked:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$status',
                          'locked',
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              failedLoginActivity:
                {
                  $sum: {
                    $cond: [
                      {
                        $gt: [
                          '$failedLoginAttempts',
                          0,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              activeUsers:
                {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              '$status',
                              'active',
                            ],
                          },

                          {
                            $eq: [
                              '$isActive',
                              true,
                            ],
                          },
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

        this.User.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$mfa.enabled',

              count:
                {
                  $sum: 1,
                },
            },
          },
        ]),

        this.User.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                null,

              usersWithPasswordChange:
                {
                  $sum: {
                    $cond: [
                      {
                        $ne: [
                          '$security.lastPasswordChange',
                          null,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              total:
                {
                  $sum: 1,
                },
            },
          },
        ]),

        this.User.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                null,

              sessions:
                {
                  $sum:
                    '$sessionMetrics.activeSessions',
                },

              usersWithSessions:
                {
                  $sum: {
                    $cond: [
                      {
                        $gt: [
                          '$sessionMetrics.activeSessions',
                          0,
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

    const login =
      first(loginState) || {};

    const password =
      first(passwordState) || {};

    const sessions =
      first(sessionState) || {};

    return {
      login: {
        lockedUsers:
          Number(
            login.locked ||
              0,
          ),

        usersWithFailedLoginActivity:
          Number(
            login.failedLoginActivity ||
              0,
          ),

        activeUsers:
          Number(
            login.activeUsers ||
              0,
          ),
      },

      mfa: {
        byState:
          this.normalizeGroupedRows(
            mfaState,
          ),
      },

      password: {
        usersWithPasswordChange:
          Number(
            password.usersWithPasswordChange ||
              0,
          ),

        passwordChangeCoverage:
          this.percent(
            password.usersWithPasswordChange,
            password.total,
          ),
      },

      sessions: {
        activeSessions:
          Number(
            sessions.sessions ||
              0,
          ),

        usersWithSessions:
          Number(
            sessions.usersWithSessions ||
              0,
          ),
      },
    };
  }

  /**
   * ==========================================================================
   * KYC / AML DASHBOARD STATISTICS
   * ==========================================================================
   */

  async getComplianceStatistics(
    tenantId,
  ) {
    const match =
      this.buildTenantFilter(
        tenantId,
      );

    const [
      kyc,
      aml,
      sanctions,
      mobileMoney,
    ] =
      await Promise.all([
        this.User.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$kyc.status',

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

        this.User.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$aml.riskRating',

              count:
                {
                  $sum: 1,
                },

              averageScore:
                {
                  $avg:
                    '$aml.score',
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

        this.User.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                '$isVerified',

              count:
                {
                  $sum: 1,
                },
            },
          },
        ]),

        this.User.aggregate([
          {
            $match:
              match,
          },

          {
            $group: {
              _id:
                null,

              configured:
                {
                  $sum: {
                    $cond: [
                      {
                        $ne: [
                          '$mobileMoney.provider',
                          null,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              verified:
                {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          '$mobileMoney.verified',
                          true,
                        ],
                      },

                      1,

                      0,
                    ],
                  },
                },

              total:
                {
                  $sum: 1,
                },
            },
          },
        ]),
      ]);

    const mobile =
      first(mobileMoney) || {};

    return {
      kyc:
        this.normalizeGroupedRows(
          kyc,
        ),

      aml:
        aml.map(
          (row) => ({
            value:
              row._id,

            count:
              Number(
                row.count ||
                  0,
              ),

            averageScore:
              Number(
                row.averageScore ||
                  0,
              ),
          }),
        ),

      verification:
        this.normalizeGroupedRows(
          sanctions,
        ),

      mobileMoney: {
        configured:
          Number(
            mobile.configured ||
              0,
          ),

        verified:
          Number(
            mobile.verified ||
              0,
          ),

        verificationRate:
          this.percent(
            mobile.verified,
            mobile.configured,
          ),
      },
    };
  }

  /**
   * ==========================================================================
   * DISTINCT VALUES FOR ADMIN FILTERS
   * ==========================================================================
   */

  async getFilterOptions(
    tenantId,
  ) {
    const match =
      this.buildTenantFilter(
        tenantId,
      );

    const [
      roles,
      statuses,
      kycStatuses,
      amlRiskRatings,
    ] =
      await Promise.all([
        this.User.distinct(
          'role',
          match,
        ),

        this.User.distinct(
          'status',
          match,
        ),

        this.User.distinct(
          'kyc.status',
          match,
        ),

        this.User.distinct(
          'aml.riskRating',
          match,
        ),
      ]);

    return {
      roles:
        roles.filter(
          (value) =>
            SUPPORTED_ROLES.includes(
              value,
            ),
        ),

      statuses:
        statuses.filter(
          (value) =>
            SUPPORTED_STATUSES.includes(
              value,
            ),
        ),

      kycStatuses:
        kycStatuses.filter(
          (value) =>
            SUPPORTED_KYC_STATUSES.includes(
              value,
            ),
        ),

      amlRiskRatings:
        amlRiskRatings.filter(
          (value) =>
            SUPPORTED_AML_RISK_RATINGS.includes(
              value,
            ),
        ),
    };
  }

  /**
   * ==========================================================================
   * BULK USER LOOKUP
   * ==========================================================================
   *
   * This remains read-only. Bulk mutation belongs in a dedicated service and
   * must be protected by explicit authorization and audit logging.
   * ==========================================================================
   */

  async findByIds(
    tenantId,
    userIds,
    {
      includeSecurity =
        false,
    } = {},
  ) {
    const ids =
      Array.isArray(
        userIds,
      )
        ? userIds
            .filter(Boolean)
            .map(
              (id) =>
                toObjectId(
                  id,
                  'userId',
                ),
            )
        : [];

    if (
      ids.length ===
      0
    ) {
      return [];
    }

    return this.User
      .find({
        ...this.buildTenantFilter(
          tenantId,
        ),

        _id: {
          $in:
            ids,
        },
      })
      .select(
        this.getSafeProjection({
          includeSecurity,
        }),
      )
      .lean();
  }

  /**
   * ==========================================================================
   * TENANT USER COUNT
   * ==========================================================================
   */

  async countByTenant(
    tenantId,
  ) {
    return this.User.countDocuments(
      this.buildTenantFilter(
        tenantId,
      ),
    );
  }

  /**
   * ==========================================================================
   * DASHBOARD SUMMARY
   * ==========================================================================
   */

  async getDashboardSummary(
    tenantId,
    options = {},
  ) {
    const [
      statistics,
      security,
      compliance,
      growth,
    ] =
      await Promise.all([
        this.getStatistics(
          tenantId,
        ),

        this.getSecurityStatistics(
          tenantId,
        ),

        this.getComplianceStatistics(
          tenantId,
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
      ]);

    return {
      tenantId:
        String(tenantId),

      statistics,

      security,

      compliance,

      growth,

      generatedAt:
        new Date(),
    };
  }

  /**
   * ==========================================================================
   * CURSOR ENCODING
   * ==========================================================================
   */

  encodeCursor(
    user,
  ) {
    const payload =
      JSON.stringify({
        createdAt:
          user.createdAt
            ? new Date(
                user.createdAt,
              ).toISOString()
            : null,

        id:
          user._id
            ? String(
                user._id,
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
      throw new AdminUserRepositoryError(
        'Pagination cursor is required.',
        {
          code:
            'CURSOR_REQUIRED',
        },
      );
    }

    try {
      const payload =
        JSON.parse(
          Buffer
            .from(
              String(
                cursor,
              ),
              'base64url',
            )
            .toString(
              'utf8',
            ),
        );

      const createdAt =
        normalizeDate(
          payload.createdAt,
          'cursor.createdAt',
        );

      const id =
        toObjectId(
          payload.id,
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
        AdminUserRepositoryError
      ) {
        throw error;
      }

      throw new AdminUserRepositoryError(
        'Invalid user pagination cursor.',
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
   * HELPER METHODS
   * ==========================================================================
   */

  percent(
    numerator,
    denominator,
  ) {
    const top =
      Number(
        numerator || 0,
      );

    const bottom =
      Number(
        denominator || 0,
      );

    if (
      bottom === 0
    ) {
      return 0;
    }

    return Math.round(
      (
        top /
        bottom
      ) *
        10000,
    ) /
      100;
  }

  /**
   * ==========================================================================
   * HEALTH
   * ==========================================================================
   */

  async health() {
    const connected =
      Boolean(
        this.User &&
          this.User.db &&
          this.User.db.readyState ===
            1,
      );

    return {
      repository:
        REPOSITORY_NAME,

      version:
        REPOSITORY_VERSION,

      healthy:
        connected,

      model:
        'User',

      databaseConnected:
        connected,

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

const adminUserRepository =
  new AdminUserRepository();

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  adminUserRepository;

module.exports.AdminUserRepository =
  AdminUserRepository;

module.exports.AdminUserRepositoryError =
  AdminUserRepositoryError;

module.exports.REPOSITORY_NAME =
  REPOSITORY_NAME;

module.exports.REPOSITORY_VERSION =
  REPOSITORY_VERSION;

module.exports.SUPPORTED_ROLES =
  SUPPORTED_ROLES;

module.exports.SUPPORTED_STATUSES =
  SUPPORTED_STATUSES;

module.exports.SUPPORTED_KYC_STATUSES =
  SUPPORTED_KYC_STATUSES;

module.exports.SUPPORTED_AML_RISK_RATINGS =
  SUPPORTED_AML_RISK_RATINGS;