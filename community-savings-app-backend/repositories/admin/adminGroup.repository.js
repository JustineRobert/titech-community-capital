'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Group Repository
 * ============================================================================
 *
 * File:
 *   backend/repositories/admin/adminGroup.repository.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical persistence/data-access layer for administrative group operations
 * within TITech Community Capital.
 *
 * IMPORTANT TENANT-SAFETY RULE
 * ----------------------------------------------------------------------------
 * The current Group model does not expose a tenantId discriminator.
 *
 * Because TITech is being evolved into a multi-tenant SaaS/Community Finance
 * Operating System, this repository MUST NOT perform tenant-scoped Group
 * queries against an unscoped collection.
 *
 * Therefore:
 *
 *   - Tenant-scoped methods fail closed when Group.tenantId is unavailable.
 *   - No global group count is returned as a tenant count.
 *   - No cross-tenant group lookup is permitted.
 *   - No "best guess" relationship is used as a security boundary.
 *
 * After Group.tenantId is introduced, tenant-scoped operations automatically
 * become available through the same repository contract.
 *
 * Repository boundary
 * ----------------------------------------------------------------------------
 * ✓ MongoDB / Mongoose access
 * ✓ Tenant scoping
 * ✓ Safe projections
 * ✓ Search
 * ✓ Pagination
 * ✓ Membership lookups
 * ✓ Group statistics
 * ✓ Group activity primitives
 *
 * ✗ RBAC
 * ✗ Controller logic
 * ✗ Financial mutations
 * ✗ Loan approval
 * ✗ Fraud decisions
 * ✗ HTTP responses
 * ✗ Cross-tenant inference
 *
 * All branding uses TITech Community Capital.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const Group = require('../../models/Group');

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const REPOSITORY_NAME =
  'AdminGroupRepository';

const REPOSITORY_VERSION =
  '2026.1';

const DEFAULT_PAGE_SIZE =
  25;

const MAX_PAGE_SIZE =
  100;

const MAX_SEARCH_LENGTH =
  120;

/**
 * ============================================================================
 * DOMAIN CONSTANTS
 * ============================================================================
 *
 * These are only used for filtering when the corresponding fields exist in
 * the real Group schema.
 * ============================================================================
 */

const POSSIBLE_GROUP_STATUSES =
  Object.freeze([
    'active',
    'inactive',
    'suspended',
    'pending',
    'closed',
    'archived',
  ]);

const POSSIBLE_GROUP_TYPES =
  Object.freeze([
    'savings',
    'vsla',
    'sacco',
    'cooperative',
    'community',
    'investment',
    'loan',
  ]);

/**
 * ============================================================================
 * SAFE PROJECTION
 * ============================================================================
 *
 * We build projection dynamically against the schema so this repository does
 * not break when optional Group fields are absent.
 * ============================================================================
 */

const SAFE_GROUP_FIELDS =
  Object.freeze([
    '_id',

    'name',
    'groupName',
    'description',

    'type',
    'groupType',

    'status',

    'createdBy',

    'administrator',
    'admin',

    'members',
    'memberRoles',

    'memberCount',

    'createdAt',
    'updatedAt',

    'settings',

    'currency',

    'country',

    'location',

    'meetingSchedule',

    'contributionFrequency',

    'contributionAmount',

    'joinDate',

    'lastActivityAt',
  ]);

/**
 * ============================================================================
 * ERROR
 * ============================================================================
 */

class AdminGroupRepositoryError extends Error {
  constructor(
    message,
    {
      code =
        'ADMIN_GROUP_REPOSITORY_ERROR',

      cause =
        null,

      details =
        null,
    } = {},
  ) {
    super(message);

    this.name =
      'AdminGroupRepositoryError';

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
    throw new AdminGroupRepositoryError(
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
    throw new AdminGroupRepositoryError(
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
    throw new AdminGroupRepositoryError(
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
  const number =
    Number(value);

  return Number.isFinite(
    number,
  )
    ? number
    : 0;
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

class AdminGroupRepository {
  constructor({
    GroupModel =
      Group,
  } = {}) {
    this.Group =
      GroupModel;
  }

  /**
   * ==========================================================================
   * SCHEMA CAPABILITY INSPECTION
   * ==========================================================================
   */

  hasPath(
    path,
  ) {
    return Boolean(
      this.Group?.schema?.path(
        path,
      ),
    );
  }

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

  getNamePath() {
    return this.resolveFirstPath([
      'name',
      'groupName',
    ]);
  }

  getTypePath() {
    return this.resolveFirstPath([
      'type',
      'groupType',
    ]);
  }

  getCreatorPath() {
    return this.resolveFirstPath([
      'createdBy',
      'creator',
    ]);
  }

  getAdministratorPath() {
    return this.resolveFirstPath([
      'administrator',
      'admin',
    ]);
  }

  getMembersPath() {
    return this.resolveFirstPath([
      'members',
    ]);
  }

  getMemberRolesPath() {
    return this.resolveFirstPath([
      'memberRoles',
    ]);
  }

  getStatusPath() {
    return this.resolveFirstPath([
      'status',
    ]);
  }

  getMemberCountPath() {
    return this.resolveFirstPath([
      'memberCount',
    ]);
  }

  /**
   * ==========================================================================
   * TENANT CAPABILITY
   * ==========================================================================
   */

  supportsTenantIsolation() {
    return this.hasPath(
      'tenantId',
    );
  }

  assertTenantIsolationAvailable() {
    if (
      !this.supportsTenantIsolation()
    ) {
      throw new AdminGroupRepositoryError(
        'Tenant-scoped Group operations are unavailable because the current Group model has no tenantId field. TITech will not perform an unsafe global Group query.',
        {
          code:
            'GROUP_TENANT_SCOPE_UNAVAILABLE',

          details: {
            model:
              'Group',

            requiredField:
              'tenantId',

            repository:
              REPOSITORY_NAME,
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
        toObjectId(
          tenantId,
          'tenantId',
        ),
    };
  }

  /**
   * ==========================================================================
   * SAFE PROJECTION
   * ==========================================================================
   */

  getSafeProjection() {
    const projection =
      {};

    for (
      const field of
      SAFE_GROUP_FIELDS
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
   * FILTER BUILDER
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
          this.getNamePath(),

          'description',

          this.getTypePath(),
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

    const statusPath =
      this.getStatusPath();

    if (
      statusPath &&
      options.status
    ) {
      const statuses =
        normalizeArray(
          options.statuses ||
            options.status,
        );

      const valid =
        statuses.filter(
          (status) =>
            POSSIBLE_GROUP_STATUSES.includes(
              status,
            ),
        );

      if (
        valid.length
      ) {
        filter[
          statusPath
        ] =
          valid.length ===
          1
            ? valid[0]
            : {
                $in:
                  valid,
              };
      }
    }

    const typePath =
      this.getTypePath();

    if (
      typePath &&
      (
        options.type ||
        options.groupType
      )
    ) {
      const types =
        normalizeArray(
          options.types ||
            options.type ||
            options.groupType,
        );

      const valid =
        types.filter(
          (type) =>
            POSSIBLE_GROUP_TYPES.includes(
              type,
            ),
        );

      if (
        valid.length
      ) {
        filter[
          typePath
        ] =
          valid.length ===
          1
            ? valid[0]
            : {
                $in:
                  valid,
              };
      }
    }

    const creatorPath =
      this.getCreatorPath();

    if (
      creatorPath &&
      options.createdBy
    ) {
      filter[
        creatorPath
      ] =
        toObjectId(
          options.createdBy,
          'createdBy',
        );
    }

    const adminPath =
      this.getAdministratorPath();

    if (
      adminPath &&
      options.administrator
    ) {
      filter[
        adminPath
      ] =
        toObjectId(
          options.administrator,
          'administrator',
        );
    }

    const membersPath =
      this.getMembersPath();

    if (
      membersPath &&
      options.memberId
    ) {
      filter[
        membersPath
      ] =
        toObjectId(
          options.memberId,
          'memberId',
        );
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
      options.updatedFrom ||
      options.updatedTo
    ) {
      const from =
        normalizeDate(
          options.updatedFrom,
          'updatedFrom',
        );

      const to =
        normalizeDate(
          options.updatedTo,
          'updatedTo',
        );

      filter.updatedAt =
        {};

      if (from) {
        filter.updatedAt.$gte =
          from;
      }

      if (to) {
        filter.updatedAt.$lte =
          to;
      }

      this.assertDateRange(
        filter.updatedAt,
      );
    }

    return filter;
  }

  assertDateRange(
    range,
  ) {
    if (
      !range?.$gte ||
      !range?.$lte
    ) {
      return;
    }

    if (
      range.$gte >
      range.$lte
    ) {
      throw new AdminGroupRepositoryError(
        '`from` cannot be later than `to`.',
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
    groupId,
  ) {
    const group =
      await this.Group
        .findOne({
          ...this.buildTenantFilter(
            tenantId,
          ),

          _id:
            toObjectId(
              groupId,
              'groupId',
            ),
        })
        .select(
          this.getSafeProjection(),
        )
        .lean();

    return group ||
      null;
  }

  /**
   * ==========================================================================
   * EXISTS
   * ==========================================================================
   */

  async exists(
    tenantId,
    groupId,
  ) {
    const result =
      await this.Group.exists({
        ...this.buildTenantFilter(
          tenantId,
        ),

        _id:
          toObjectId(
            groupId,
            'groupId',
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

    return this.Group.countDocuments(
      filter,
    );
  }

  /**
   * ==========================================================================
   * LIST / PAGINATION
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

    const groups =
      await this.Group
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
      groups.length >
      limit;

    const items =
      hasNextPage
        ? groups.slice(
            0,
            limit,
          )
        : groups;

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

    return this.Group
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
        limit,
      )
      .lean();
  }

  /**
   * ==========================================================================
   * GROUPS BY ADMINISTRATOR
   * ==========================================================================
   */

  async findByAdministrator(
    tenantId,
    administratorId,
    options = {},
  ) {
    const adminPath =
      this.getAdministratorPath();

    if (!adminPath) {
      throw new AdminGroupRepositoryError(
        'The current Group model does not expose an administrator field.',
        {
          code:
            'GROUP_ADMINISTRATOR_FIELD_UNAVAILABLE',
        },
      );
    }

    return this.findMany(
      tenantId,
      {
        ...options,

        administrator:
          administratorId,
      },
    );
  }

  /**
   * ==========================================================================
   * GROUPS CREATED BY USER
   * ==========================================================================
   */

  async findByCreator(
    tenantId,
    creatorId,
    options = {},
  ) {
    const creatorPath =
      this.getCreatorPath();

    if (!creatorPath) {
      throw new AdminGroupRepositoryError(
        'The current Group model does not expose a creator field.',
        {
          code:
            'GROUP_CREATOR_FIELD_UNAVAILABLE',
        },
      );
    }

    return this.findMany(
      tenantId,
      {
        ...options,

        createdBy:
          creatorId,
      },
    );
  }

  /**
   * ==========================================================================
   * MEMBER GROUP LOOKUP
   * ==========================================================================
   */

  async findByMember(
    tenantId,
    memberId,
    options = {},
  ) {
    const membersPath =
      this.getMembersPath();

    if (!membersPath) {
      throw new AdminGroupRepositoryError(
        'The current Group model does not expose a members field.',
        {
          code:
            'GROUP_MEMBERS_FIELD_UNAVAILABLE',
        },
      );
    }

    return this.findMany(
      tenantId,
      {
        ...options,

        memberId,
      },
    );
  }

  /**
   * ==========================================================================
   * GROUP STATISTICS
   * ==========================================================================
   */

  async getStatistics(
    tenantId,
  ) {
    const tenantMatch =
      this.buildTenantFilter(
        tenantId,
      );

    const statusPath =
      this.getStatusPath();

    const typePath =
      this.getTypePath();

    const membersPath =
      this.getMembersPath();

    const groups =
      await this.Group.aggregate([
        {
          $match:
            tenantMatch,
        },

        {
          $group: {
            _id:
              null,

            total:
              {
                $sum: 1,
              },

            totalMembers:
              membersPath
                ? {
                    $sum: {
                      $size: {
                        $ifNull: [
                          `$${membersPath}`,
                          [],
                        ],
                      },
                    },
                  }
                : {
                    $sum: 0,
                  },
          },
        },
      ]);

    const status =
      statusPath
        ? await this.Group.aggregate([
            {
              $match:
                tenantMatch,
            },

            {
              $group: {
                _id:
                  `$${statusPath}`,

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
          ])
        : [];

    const types =
      typePath
        ? await this.Group.aggregate([
            {
              $match:
                tenantMatch,
            },

            {
              $group: {
                _id:
                  `$${typePath}`,

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
          ])
        : [];

    const result =
      groups[0] || {
        total:
          0,

        totalMembers:
          0,
      };

    return {
      totalGroups:
        safeNumber(
          result.total,
        ),

      totalMembers:
        safeNumber(
          result.totalMembers,
        ),

      averageMembersPerGroup:
        result.total
          ? (
              safeNumber(
                result.totalMembers,
              ) /
              safeNumber(
                result.total,
              )
            )
          : 0,

      byStatus:
        status.map(
          (row) => ({
            value:
              row._id,

            count:
              safeNumber(
                row.count,
              ),
          }),
        ),

      byType:
        types.map(
          (row) => ({
            value:
              row._id,

            count:
              safeNumber(
                row.count,
              ),
          }),
        ),

      tenantScoped:
        true,

      dataSource:
        'Group',
    };
  }

  /**
   * ==========================================================================
   * MEMBER COUNTS / DISTRIBUTION
   * ==========================================================================
   */

  async getMemberDistribution(
    tenantId,
  ) {
    const tenantMatch =
      this.buildTenantFilter(
        tenantId,
      );

    const membersPath =
      this.getMembersPath();

    if (!membersPath) {
      return {
        available:
          false,

        reason:
          'The current Group model has no members array field.',
      };
    }

    const distribution =
      await this.Group.aggregate([
        {
          $match:
            tenantMatch,
        },

        {
          $project: {
            groupId:
              '$_id',

            memberCount: {
              $size: {
                $ifNull: [
                  `$${membersPath}`,
                  [],
                ],
              },
            },
          },
        },

        {
          $bucket: {
            groupBy:
              '$memberCount',

            boundaries: [
              0,
              5,
              10,
              20,
              50,
              100,
              250,
              500,
            ],

            default:
              '500+',

            output: {
              groups:
                {
                  $sum: 1,
                },

              members:
                {
                  $sum:
                    '$memberCount',
                },
            },
          },
        },
      ]);

    return {
      available:
        true,

      distribution,
    };
  }

  /**
   * ==========================================================================
   * RECENTLY CREATED GROUPS
   * ==========================================================================
   */

  async findRecentlyCreated(
    tenantId,
    {
      days = 30,
      limit =
        DEFAULT_PAGE_SIZE,
    } = {},
  ) {
    const end =
      new Date();

    const start =
      new Date(
        end.getTime() -
          Number(days) *
            24 *
            60 *
            60 *
            1000,
      );

    const safeLimit =
      normalizeLimit(
        limit,
      );

    return this.Group
      .find({
        ...this.buildTenantFilter(
          tenantId,
        ),

        createdAt: {
          $gte:
            start,

          $lte:
            end,
        },
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
        safeLimit,
      )
      .lean();
  }

  /**
   * ==========================================================================
   * RECENTLY UPDATED GROUPS
   * ==========================================================================
   */

  async findRecentlyUpdated(
    tenantId,
    {
      days = 30,
      limit =
        DEFAULT_PAGE_SIZE,
    } = {},
  ) {
    const end =
      new Date();

    const start =
      new Date(
        end.getTime() -
          Number(days) *
            24 *
            60 *
            60 *
            1000,
      );

    const safeLimit =
      normalizeLimit(
        limit,
      );

    return this.Group
      .find({
        ...this.buildTenantFilter(
          tenantId,
        ),

        updatedAt: {
          $gte:
            start,

          $lte:
            end,
        },
      })
      .select(
        this.getSafeProjection(),
      )
      .sort({
        updatedAt:
          -1,

        _id:
          -1,
      })
      .limit(
        safeLimit,
      )
      .lean();
  }

  /**
   * ==========================================================================
   * GROUP GROWTH
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
    const resolvedTo =
      normalizeDate(
        to,
        'to',
      ) ||
      new Date();

    const resolvedFrom =
      normalizeDate(
        from,
        'from',
      ) ||
      new Date(
        resolvedTo.getTime() -
          Number(days) *
            24 *
            60 *
            60 *
            1000,
      );

    if (
      resolvedFrom >
      resolvedTo
    ) {
      throw new AdminGroupRepositoryError(
        '`from` cannot be later than `to`.',
        {
          code:
            'INVALID_DATE_RANGE',
        },
      );
    }

    return this.Group.aggregate([
      {
        $match: {
          ...this.buildTenantFilter(
            tenantId,
          ),

          createdAt: {
            $gte:
              resolvedFrom,

            $lte:
              resolvedTo,
          },
        },
      },

      {
        $group: {
          _id:
            this.dateBucketExpression(
              '$createdAt',
              granularity,
            ),

          groups:
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

  /**
   * ==========================================================================
   * GROUP ACTIVITY
   * ==========================================================================
   *
   * The current Group schema does not necessarily expose an activity/event
   * stream. This method reports only fields that actually exist.
   * ==========================================================================
   */

  async getActivity(
    tenantId,
    {
      days = 30,
      limit =
        DEFAULT_PAGE_SIZE,
    } = {},
  ) {
    const limitValue =
      normalizeLimit(
        limit,
      );

    const since =
      new Date(
        Date.now() -
          Number(days) *
            24 *
            60 *
            60 *
            1000,
      );

    const activityDatePath =
      this.resolveFirstPath([
        'lastActivityAt',
        'updatedAt',
      ]);

    if (
      !activityDatePath
    ) {
      return {
        available:
          false,

        reason:
          'The current Group model exposes no activity timestamp field.',
      };
    }

    const groups =
      await this.Group
        .find({
          ...this.buildTenantFilter(
            tenantId,
          ),

          [activityDatePath]: {
            $gte:
              since,
          },
        })
        .select(
          this.getSafeProjection(),
        )
        .sort({
          [activityDatePath]:
            -1,

          _id:
            -1,
        })
        .limit(
          limitValue,
        )
        .lean();

    return {
      available:
        true,

      activityField:
        activityDatePath,

      items:
        groups,
    };
  }

  /**
   * ==========================================================================
   * ADMIN GROUP DASHBOARD DATASET
   * ==========================================================================
   */

  async getDashboardSummary(
    tenantId,
    options = {},
  ) {
    const [
      statistics,
      memberDistribution,
      growth,
      recentlyCreated,
      recentlyUpdated,
    ] =
      await Promise.all([
        this.getStatistics(
          tenantId,
        ),

        this.getMemberDistribution(
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

        this.findRecentlyCreated(
          tenantId,
          {
            days:
              options.days ||
              30,

            limit:
              options.limit ||
              10,
          },
        ),

        this.findRecentlyUpdated(
          tenantId,
          {
            days:
              options.days ||
              30,

            limit:
              options.limit ||
              10,
          },
        ),
      ]);

    return {
      tenantId:
        String(tenantId),

      statistics,

      memberDistribution,

      growth,

      recentlyCreated,

      recentlyUpdated,

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
      throw new AdminGroupRepositoryError(
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
              String(cursor),
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
        AdminGroupRepositoryError
      ) {
        throw error;
      }

      throw new AdminGroupRepositoryError(
        'Invalid group pagination cursor.',
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
   * MODEL CAPABILITIES
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

          field:
            this.hasPath(
              'tenantId',
            )
              ? 'tenantId'
              : null,

          failClosed:
            true,
        },

      schemaFields: {
        name:
          this.getNamePath(),

        type:
          this.getTypePath(),

        creator:
          this.getCreatorPath(),

        administrator:
          this.getAdministratorPath(),

        members:
          this.getMembersPath(),

        memberRoles:
          this.getMemberRolesPath(),

        status:
          this.getStatusPath(),

        memberCount:
          this.getMemberCountPath(),
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
        this.Group &&
          this.Group.db &&
          this.Group.db.readyState ===
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
          : 'blocked_until_group_tenantId_is_implemented',

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

const adminGroupRepository =
  new AdminGroupRepository();

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  adminGroupRepository;

module.exports.AdminGroupRepository =
  AdminGroupRepository;

module.exports.AdminGroupRepositoryError =
  AdminGroupRepositoryError;

module.exports.REPOSITORY_NAME =
  REPOSITORY_NAME;

module.exports.REPOSITORY_VERSION =
  REPOSITORY_VERSION;

module.exports.POSSIBLE_GROUP_STATUSES =
  POSSIBLE_GROUP_STATUSES;

module.exports.POSSIBLE_GROUP_TYPES =
  POSSIBLE_GROUP_TYPES;