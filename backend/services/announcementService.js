/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Announcement Service
 * ============================================================================
 *
 * File:
 *   backend/services/announcementService.js
 *
 * Purpose:
 *   Enterprise application service for announcements.
 *
 * Responsibilities:
 *   - Multi-tenant isolation
 *   - Platform-wide announcements
 *   - Role-aware audience visibility
 *   - User/group/tenant targeting
 *   - Publication lifecycle
 *   - Scheduling
 *   - Expiration
 *   - Read state
 *   - View tracking
 *   - Acknowledgement
 *   - Dismissal
 *   - Pagination
 *   - Search
 *   - Audit integration
 *   - Soft deletion/restoration
 *
 * Security principles:
 *   - Never trust a tenant ID supplied by an untrusted client.
 *   - Authenticated tenant context is authoritative.
 *   - Platform announcements are represented by tenantId = null.
 *   - Visibility is always evaluated server-side.
 *   - User interaction state is scoped to the authenticated user.
 *   - Audit failures are not silently swallowed.
 *
 * ============================================================================
 */

'use strict';

const mongoose = require('mongoose');

const Announcement =
  require('../models/Announcement');

const AnnouncementRead =
  require('../models/AnnouncementRead');

const {
  recordAnnouncementAudit,
} = require('./announcementAuditService');

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

const MAX_SEARCH_LENGTH = 200;

const PRIORITY_RANK = Object.freeze({
  low: 1,
  normal: 2,
  high: 3,
  urgent: 4,
  critical: 5,
});

const ADMIN_ROLES = Object.freeze([
  'super_admin',
  'system_admin',
  'platform_admin',
  'tenant_admin',
  'admin',
]);

/* ============================================================================
 * ERROR HELPERS
 * ========================================================================== */

function createServiceError(
  message,
  statusCode = 400,
  code = 'ANNOUNCEMENT_ERROR',
) {
  const error = new Error(message);

  error.statusCode = statusCode;
  error.code = code;

  return error;
}

/* ============================================================================
 * NORMALIZATION HELPERS
 * ========================================================================== */

function objectId(value) {
  if (
    !value ||
    !mongoose.Types.ObjectId.isValid(value)
  ) {
    return null;
  }

  return new mongoose.Types.ObjectId(value);
}

function requireObjectId(
  value,
  fieldName,
) {
  const id = objectId(value);

  if (!id) {
    throw createServiceError(
      `${fieldName} must be a valid identifier.`,
      400,
      'INVALID_ID',
    );
  }

  return id;
}

function normalizeRoles(
  roles = [],
) {
  if (!Array.isArray(roles)) {
    return [];
  }

  return [
    ...new Set(
      roles
        .map((role) =>
          String(role)
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  ];
}

function normalizeIds(
  values = [],
) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map(objectId)
    .filter(Boolean);
}

function normalizeSearch(
  search,
) {
  return String(search || '')
    .trim()
    .slice(0, MAX_SEARCH_LENGTH);
}

function normalizePage(
  page,
) {
  const value =
    Number.parseInt(page, 10);

  return Number.isFinite(value) &&
    value > 0
    ? value
    : 1;
}

function normalizeLimit(
  limit,
) {
  const value =
    Number.parseInt(limit, 10);

  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(
    MAX_PAGE_SIZE,
    value,
  );
}

function getContextUserId(
  context,
) {
  return objectId(
    context?.userId,
  );
}

function getContextTenantId(
  context,
) {
  return objectId(
    context?.tenantId,
  );
}

function getContextRoles(
  context,
) {
  return normalizeRoles(
    context?.roles || [],
  );
}

function getContextGroupIds(
  context,
) {
  return normalizeIds(
    context?.groupIds || [],
  );
}

function assertAuthenticatedContext(
  context,
) {
  const userId =
    getContextUserId(context);

  if (!userId) {
    throw createServiceError(
      'Authenticated user context is required.',
      401,
      'UNAUTHORIZED',
    );
  }

  return userId;
}

function isPrivilegedRole(
  context,
) {
  const roles =
    getContextRoles(context);

  return ADMIN_ROLES.some(
    (role) =>
      roles.includes(role),
  );
}

/* ============================================================================
 * REQUEST / AUDIT HELPERS
 * ========================================================================== */

function buildAuditRequest(
  request,
) {
  return {
    requestId:
      request?.id ||
      request?.requestId ||
      null,

    correlationId:
      request?.correlationId ||
      request?.headers?.[
        'x-correlation-id'
      ] ||
      null,

    ip:
      request?.ip ||
      request?.headers?.[
        'x-forwarded-for'
      ] ||
      null,

    userAgent:
      typeof request?.get === 'function'
        ? request.get('user-agent')
        : request?.headers?.[
            'user-agent'
          ] || null,
  };
}

async function audit(
  params,
) {
  return recordAnnouncementAudit({
    ...params,
    ...buildAuditRequest(
      params.request,
    ),
  });
}

/* ============================================================================
 * TENANT FILTER
 * ========================================================================== */

/**
 * Tenant visibility model:
 *
 * 1. Tenant users can see:
 *      - announcements belonging to their tenant
 *      - platform-wide announcements
 *
 * 2. Platform users without tenant context can see:
 *      - platform-wide announcements only
 *
 * 3. A tenant announcement can never be exposed to another tenant.
 */
function buildTenantFilter(
  tenantId,
) {
  const tenantObjectId =
    objectId(tenantId);

  if (!tenantObjectId) {
    return {
      tenantId: null,
    };
  }

  return {
    $or: [
      {
        tenantId:
          tenantObjectId,
      },
      {
        tenantId: null,
      },
    ],
  };
}

/* ============================================================================
 * AUDIENCE FILTER
 * ========================================================================== */

function buildAudienceFilter({
  userId,
  roles = [],
  groupIds = [],
  tenantId,
}) {
  const normalizedRoles =
    normalizeRoles(roles);

  const userObjectId =
    objectId(userId);

  const tenantObjectId =
    objectId(tenantId);

  const groupObjectIds =
    normalizeIds(groupIds);

  const conditions = [
    {
      'audience.scope':
        'all_users',
    },

    {
      'audience.scope':
        'authenticated_users',
    },
  ];

  /**
   * Role-based audiences.
   *
   * The role must be explicitly included in
   * audience.roles. This prevents a generic
   * role-scoped announcement from becoming
   * visible merely because the scope matches.
   */
  const roleScopes = [
    'members',
    'admins',
    'tenant_admins',
    'support_staff',
    'loan_users',
    'savings_users',
    'community_users',
  ];

  if (
    normalizedRoles.length
  ) {
    for (
      const scope of roleScopes
    ) {
      conditions.push({
        'audience.scope':
          scope,

        'audience.roles': {
          $in:
            normalizedRoles,
        },
      });
    }
  }

  if (userObjectId) {
    conditions.push({
      'audience.scope':
        'specific_user',

      'audience.userIds':
        userObjectId,
    });
  }

  if (tenantObjectId) {
    conditions.push({
      'audience.scope':
        'specific_tenant',

      'audience.tenantIds':
        tenantObjectId,
    });
  }

  if (
    groupObjectIds.length
  ) {
    conditions.push({
      'audience.scope':
        'specific_group',

      'audience.groupIds': {
        $in:
          groupObjectIds,
      },
    });
  }

  return {
    $or: conditions,
  };
}

/* ============================================================================
 * PUBLICATION FILTER
 * ========================================================================== */

function buildPublishedFilter(
  now = new Date(),
) {
  return {
    status: 'published',

    $or: [
      {
        publishedAt: null,
      },
      {
        publishedAt: {
          $lte: now,
        },
      },
    ],

    $and: [
      {
        $or: [
          {
            expiresAt: null,
          },
          {
            expiresAt: {
              $gt: now,
            },
          },
        ],
      },
    ],
  };
}

/* ============================================================================
 * VISIBLE ANNOUNCEMENT FILTER
 * ========================================================================== */

function buildVisibleAnnouncementFilter({
  context,
  now = new Date(),
}) {
  const userId =
    assertAuthenticatedContext(
      context,
    );

  return {
    isDeleted: false,

    $and: [
      buildTenantFilter(
        context.tenantId,
      ),

      buildAudienceFilter({
        userId,

        roles:
          getContextRoles(
            context,
          ),

        groupIds:
          getContextGroupIds(
            context,
          ),

        tenantId:
          context.tenantId,
      }),

      buildPublishedFilter(now),
    ],
  };
}

/* ============================================================================
 * SORT
 * ========================================================================== */

function buildSortQuery(
  sort,
) {
  switch (sort) {
    case 'oldest':
      return {
        publishedAt: 1,
        _id: 1,
      };

    case 'priority':
      /**
       * MongoDB string sorting does not represent
       * business priority correctly.
       *
       * Therefore priority sorting is implemented
       * through an aggregation rank in listAnnouncements.
       */
      return {
        _id: -1,
      };

    case 'newest':
    default:
      return {
        publishedAt: -1,
        _id: -1,
      };
  }
}

/* ============================================================================
 * STATE MAPPING
 * ========================================================================== */

function mapAnnouncementState(
  announcement,
  state,
) {
  return {
    ...announcement,

    id:
      String(
        announcement._id,
      ),

    isRead:
      Boolean(
        state?.isRead,
      ),

    readAt:
      state?.readAt ||
      null,

    isDismissed:
      Boolean(
        state?.isDismissed,
      ),

    dismissedAt:
      state?.dismissedAt ||
      null,

    isAcknowledged:
      Boolean(
        state?.isAcknowledged,
      ),

    acknowledgedAt:
      state?.acknowledgedAt ||
      null,

    firstViewedAt:
      state?.firstViewedAt ||
      null,

    lastViewedAt:
      state?.lastViewedAt ||
      null,

    viewCount:
      Number(
        state?.viewCount || 0,
      ),

    lastAction:
      state?.lastAction ||
      null,
  };
}

/* ============================================================================
 * LIST ANNOUNCEMENTS
 * ========================================================================== */

async function listAnnouncements({
  context,
  page = 1,
  limit = DEFAULT_PAGE_SIZE,
  search = '',
  filter = 'all',
  sort = 'newest',
}) {
  const userId =
    assertAuthenticatedContext(
      context,
    );

  const safePage =
    normalizePage(page);

  const safeLimit =
    normalizeLimit(limit);

  const skip =
    (safePage - 1) *
    safeLimit;

  const normalizedSearch =
    normalizeSearch(search);

  const now =
    new Date();

  const filterQuery =
    buildVisibleAnnouncementFilter({
      context,
      now,
    });

  const andConditions =
    filterQuery.$and;

  /* ------------------------------------------------------------------------
   * SEARCH
   * ---------------------------------------------------------------------- */

  if (normalizedSearch) {
    andConditions.push({
      $text: {
        $search:
          normalizedSearch,
      },
    });
  }

  /* ------------------------------------------------------------------------
   * FILTERS
   * ---------------------------------------------------------------------- */

  switch (filter) {
    case 'unread':
      /**
       * Unread means:
       *   - no read-state row, OR
       *   - state exists but isRead=false
       *
       * Dismissed announcements are excluded.
       */
      andConditions.push({
        $or: [
          {
            _id: {
              $nin:
                await getDismissedAnnouncementIds(
                  userId,
                ),
            },
          },
        ],
      });

      andConditions.push({
        _id: {
          $nin:
            await getReadAnnouncementIds(
              userId,
            ),
        },
      });

      break;

    case 'important':
      andConditions.push({
        priority: {
          $in: [
            'high',
            'urgent',
            'critical',
          ],
        },
      });
      break;

    case 'security':
      andConditions.push({
        type: 'security',
      });
      break;

    case 'savings':
      andConditions.push({
        type: 'savings',
      });
      break;

    case 'loan':
      andConditions.push({
        type: 'loan',
      });
      break;

    case 'support':
      andConditions.push({
        type: 'support',
      });
      break;

    case 'community':
      andConditions.push({
        type: 'community',
      });
      break;

    case 'acknowledged':
      andConditions.push({
        _id: {
          $in:
            await getAcknowledgedAnnouncementIds(
              userId,
            ),
        },
      });
      break;

    case 'dismissed':
      andConditions.push({
        _id: {
          $in:
            await getDismissedAnnouncementIds(
              userId,
            ),
        },
      });
      break;

    case 'all':
    default:
      break;
  }

  /* ------------------------------------------------------------------------
   * DATABASE QUERY
   * ---------------------------------------------------------------------- */

  let rows;
  let total;

  if (sort === 'priority') {
    const pipeline = [
      {
        $match:
          filterQuery,
      },

      {
        $addFields: {
          __priorityRank: {
            $switch: {
              branches: [
                {
                  case: {
                    $eq: [
                      '$priority',
                      'critical',
                    ],
                  },
                  then: 5,
                },
                {
                  case: {
                    $eq: [
                      '$priority',
                      'urgent',
                    ],
                  },
                  then: 4,
                },
                {
                  case: {
                    $eq: [
                      '$priority',
                      'high',
                    ],
                  },
                  then: 3,
                },
                {
                  case: {
                    $eq: [
                      '$priority',
                      'normal',
                    ],
                  },
                  then: 2,
                },
                {
                  case: {
                    $eq: [
                      '$priority',
                      'low',
                    ],
                  },
                  then: 1,
                },
              ],
              default: 0,
            },
          },
        },
      },

      {
        $sort: {
          __priorityRank: -1,
          publishedAt: -1,
          _id: -1,
        },
      },

      {
        $facet: {
          rows: [
            {
              $skip: skip,
            },
            {
              $limit: safeLimit,
            },
          ],

          total: [
            {
              $count: 'count',
            },
          ],
        },
      },
    ];

    const result =
      await Announcement.aggregate(
        pipeline,
      );

    rows =
      result?.[0]?.rows ||
      [];

    total =
      result?.[0]?.total?.[0]?.count ||
      0;
  } else {
    const [
      queryRows,
      count,
    ] = await Promise.all([
      Announcement
        .find(filterQuery)
        .sort(
          buildSortQuery(sort),
        )
        .skip(skip)
        .limit(safeLimit)
        .lean(),

      Announcement.countDocuments(
        filterQuery,
      ),
    ]);

    rows =
      queryRows;

    total =
      count;
  }

  /* ------------------------------------------------------------------------
   * READ STATE
   * ---------------------------------------------------------------------- */

  const announcementIds =
    rows.map(
      (row) => row._id,
    );

  const readStates =
    announcementIds.length
      ? await AnnouncementRead
          .find({
            userId,

            announcementId: {
              $in:
                announcementIds,
            },
          })
          .select(
            [
              'announcementId',
              'tenantId',
              'isRead',
              'readAt',
              'isDismissed',
              'dismissedAt',
              'isAcknowledged',
              'acknowledgedAt',
              'firstViewedAt',
              'lastViewedAt',
              'viewCount',
              'lastAction',
            ].join(' '),
          )
          .lean()
      : [];

  const stateMap =
    new Map(
      readStates.map(
        (state) => [
          String(
            state.announcementId,
          ),
          state,
        ],
      ),
    );

  const data =
    rows.map((row) =>
      mapAnnouncementState(
        row,
        stateMap.get(
          String(row._id),
        ),
      ),
    );

  return {
    data,

    pagination: {
      page: safePage,

      limit: safeLimit,

      total,

      totalPages:
        total > 0
          ? Math.ceil(
              total /
                safeLimit,
            )
          : 0,

      hasNextPage:
        safePage *
          safeLimit <
        total,

      hasPreviousPage:
        safePage > 1,
    },
  };
}

/* ============================================================================
 * USER STATE QUERIES
 * ========================================================================== */

async function getReadStateIds({
  userId,
  field,
}) {
  const userObjectId =
    requireObjectId(
      userId,
      'userId',
    );

  const filter = {
    userId:
      userObjectId,

    [field]: true,
  };

  const rows =
    await AnnouncementRead
      .find(filter)
      .select(
        'announcementId',
      )
      .lean();

  return rows.map(
    (row) =>
      row.announcementId,
  );
}

async function getReadAnnouncementIds(
  userId,
) {
  return getReadStateIds({
    userId,
    field: 'isRead',
  });
}

async function getDismissedAnnouncementIds(
  userId,
) {
  return getReadStateIds({
    userId,
    field: 'isDismissed',
  });
}

async function getAcknowledgedAnnouncementIds(
  userId,
) {
  return getReadStateIds({
    userId,
    field: 'isAcknowledged',
  });
}

/* ============================================================================
 * UNREAD COUNT
 * ========================================================================== */

async function getUnreadCount(
  context,
) {
  const userId =
    assertAuthenticatedContext(
      context,
    );

  const visibleFilter =
    buildVisibleAnnouncementFilter({
      context,
      now: new Date(),
    });

  /**
   * Use aggregation rather than listAnnouncements().
   *
   * The previous implementation limited the list to
   * 100 records, which meant unread counts could never
   * exceed 100.
   */
  const result =
    await Announcement.aggregate([
      {
        $match:
          visibleFilter,
      },

      {
        $lookup: {
          from:
            'announcement_reads',

          let: {
            announcementId:
              '$_id',
          },

          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $eq: [
                        '$announcementId',
                        '$$announcementId',
                      ],
                    },
                    {
                      $eq: [
                        '$userId',
                        userId,
                      ],
                    },
                  ],
                },
              },
            },

            {
              $project: {
                isRead: 1,
                isDismissed: 1,
              },
            },

            {
              $limit: 1,
            },
          ],

          as:
            'userState',
        },
      },

      {
        $unwind: {
          path:
            '$userState',

          preserveNullAndEmptyArrays:
            true,
        },
      },

      {
        $match: {
          $or: [
            {
              userState: {
                $exists: false,
              },
            },

            {
              'userState.isRead':
                false,
            },

            {
              'userState.isRead':
                {
                  $exists: false,
                },
            },
          ],

          'userState.isDismissed': {
            $ne: true,
          },
        },
      },

      {
        $count:
          'count',
      },
    ]);

  const count =
    result?.[0]?.count ||
    0;

  const totalVisible =
    await Announcement.countDocuments(
      visibleFilter,
    );

  return {
    count,

    totalVisible,
  };
}

/* ============================================================================
 * GET VISIBLE ANNOUNCEMENT
 * ========================================================================== */

async function getVisibleAnnouncement({
  announcementId,
  context,
}) {
  assertAuthenticatedContext(
    context,
  );

  const _id =
    objectId(
      announcementId,
    );

  if (!_id) {
    return null;
  }

  return Announcement.findOne({
    _id,

    ...buildVisibleAnnouncementFilter({
      context,
      now: new Date(),
    }),
  }).lean();
}

/* ============================================================================
 * GET VISIBLE ANNOUNCEMENT WITH STATE
 * ========================================================================== */

async function getVisibleAnnouncementWithState({
  announcementId,
  context,
}) {
  const announcement =
    await getVisibleAnnouncement({
      announcementId,
      context,
    });

  if (!announcement) {
    return null;
  }

  const userId =
    assertAuthenticatedContext(
      context,
    );

  const state =
    await AnnouncementRead
      .findOne({
        announcementId:
          announcement._id,

        userId,
      })
      .lean();

  return mapAnnouncementState(
    announcement,
    state,
  );
}

/* ============================================================================
 * UPSERT USER STATE
 * ========================================================================== */

async function upsertAnnouncementState({
  announcementId,
  context,
  update,
  setOnInsert = {},
}) {
  const userId =
    assertAuthenticatedContext(
      context,
    );

  const tenantId =
    getContextTenantId(
      context,
    );

  return AnnouncementRead
    .findOneAndUpdate(
      {
        announcementId,

        userId,
      },

      {
        $set: {
          tenantId,

          ...update,
        },

        $setOnInsert: {
          firstViewedAt:
            new Date(),

          ...setOnInsert,
        },
      },

      {
        upsert: true,

        new: true,

        setDefaultsOnInsert:
          true,
      },
    );
}

/* ============================================================================
 * MARK READ
 * ========================================================================== */

async function markAnnouncementRead({
  announcementId,
  context,
  request,
}) {
  const announcement =
    await getVisibleAnnouncement({
      announcementId,
      context,
    });

  if (!announcement) {
    throw createServiceError(
      'Announcement not found.',
      404,
      'ANNOUNCEMENT_NOT_FOUND',
    );
  }

  const now =
    new Date();

  const state =
    await upsertAnnouncementState({
      announcementId:
        announcement._id,

      context,

      update: {
        isRead: true,

        readAt: now,

        lastViewedAt: now,

        lastAction: 'read',
      },

      setOnInsert: {
        firstViewedAt: now,
      },
    });

  await audit({
    announcementId:
      announcement._id,

    tenantId:
      announcement.tenantId,

    actorUserId:
      context.userId,

    actorRole:
      getContextRoles(
        context,
      )[0] || null,

    action: 'read',

    request,
  });

  return state;
}

/* ============================================================================
 * MARK VIEWED
 * ========================================================================== */

async function markAnnouncementViewed({
  announcementId,
  context,
  request,
}) {
  const announcement =
    await getVisibleAnnouncement({
      announcementId,
      context,
    });

  if (!announcement) {
    throw createServiceError(
      'Announcement not found.',
      404,
      'ANNOUNCEMENT_NOT_FOUND',
    );
  }

  const now =
    new Date();

  const state =
    await upsertAnnouncementState({
      announcementId:
        announcement._id,

      context,

      update: {
        lastViewedAt: now,

        lastAction: 'viewed',

        $inc: {
          viewCount: 1,
        },
      },

      setOnInsert: {
        firstViewedAt: now,
      },
    });

  /**
   * NOTE:
   * Mongoose does not interpret nested $inc
   * inside $set. Re-read and increment explicitly
   * when required by the existing schema.
   */
  await AnnouncementRead
    .findOneAndUpdate(
      {
        announcementId:
          announcement._id,

        userId:
          context.userId,
      },
      {
        $inc: {
          viewCount: 1,
        },
      },
      {
        new: true,
      },
    );

  await audit({
    announcementId:
      announcement._id,

    tenantId:
      announcement.tenantId,

    actorUserId:
      context.userId,

    actorRole:
      getContextRoles(
        context,
      )[0] || null,

    action: 'viewed',

    request,
  });

  return state;
}

/* ============================================================================
 * ACKNOWLEDGE
 * ========================================================================== */

async function acknowledgeAnnouncement({
  announcementId,
  context,
  request,
}) {
  const announcement =
    await getVisibleAnnouncement({
      announcementId,
      context,
    });

  if (!announcement) {
    throw createServiceError(
      'Announcement not found.',
      404,
      'ANNOUNCEMENT_NOT_FOUND',
    );
  }

  if (
    !announcement.requiresAcknowledgement
  ) {
    throw createServiceError(
      'This announcement does not require acknowledgement.',
      400,
      'ACKNOWLEDGEMENT_NOT_REQUIRED',
    );
  }

  const now =
    new Date();

  const state =
    await upsertAnnouncementState({
      announcementId:
        announcement._id,

      context,

      update: {
        isRead: true,

        readAt: now,

        isAcknowledged: true,

        acknowledgedAt: now,

        lastViewedAt: now,

        lastAction:
          'acknowledged',
      },

      setOnInsert: {
        firstViewedAt: now,
      },
    });

  await audit({
    announcementId:
      announcement._id,

    tenantId:
      announcement.tenantId,

    actorUserId:
      context.userId,

    actorRole:
      getContextRoles(
        context,
      )[0] || null,

    action:
      'acknowledged',

    request,
  });

  return state;
}

/* ============================================================================
 * DISMISS
 * ========================================================================== */

async function dismissAnnouncement({
  announcementId,
  context,
  request,
}) {
  const announcement =
    await getVisibleAnnouncement({
      announcementId,
      context,
    });

  if (!announcement) {
    throw createServiceError(
      'Announcement not found.',
      404,
      'ANNOUNCEMENT_NOT_FOUND',
    );
  }

  if (
    !announcement.allowDismiss
  ) {
    throw createServiceError(
      'This announcement cannot be dismissed.',
      400,
      'DISMISS_NOT_ALLOWED',
    );
  }

  const now =
    new Date();

  const state =
    await upsertAnnouncementState({
      announcementId:
        announcement._id,

      context,

      update: {
        isDismissed: true,

        dismissedAt: now,

        lastAction:
          'dismissed',
      },
    });

  await audit({
    announcementId:
      announcement._id,

    tenantId:
      announcement.tenantId,

    actorUserId:
      context.userId,

    actorRole:
      getContextRoles(
        context,
      )[0] || null,

    action:
      'dismissed',

    request,
  });

  return state;
}

/* ============================================================================
 * ADMIN TENANT VALIDATION
 * ========================================================================== */

/**
 * Resolve the tenant to use when creating an announcement.
 *
 * Security rule:
 *
 * - Tenant administrators may ONLY create announcements
 *   for their own tenant.
 *
 * - Platform administrators may explicitly create:
 *      tenant-scoped announcements
 *   or
 *      platform-wide announcements.
 *
 * - A non-platform administrator cannot silently
 *   convert a tenant announcement into a platform
 *   announcement.
 */
function resolveAnnouncementTenantId({
  payload,
  context,
}) {
  const contextTenantId =
    getContextTenantId(
      context,
    );

  const roles =
    getContextRoles(context);

  const isPlatformAdmin =
    roles.includes(
      'super_admin',
    ) ||
    roles.includes(
      'system_admin',
    ) ||
    roles.includes(
      'platform_admin',
    );

  const requestedTenantId =
    payload &&
    Object.prototype.hasOwnProperty.call(
      payload,
      'tenantId',
    )
      ? objectId(
          payload.tenantId,
        )
      : undefined;

  if (
    requestedTenantId === undefined
  ) {
    if (contextTenantId) {
      return contextTenantId;
    }

    if (isPlatformAdmin) {
      return null;
    }

    throw createServiceError(
      'A tenant context is required.',
      400,
      'TENANT_CONTEXT_REQUIRED',
    );
  }

  /**
   * Explicit null means platform-wide.
   */
  if (
    requestedTenantId === null
  ) {
    if (!isPlatformAdmin) {
      throw createServiceError(
        'Only platform administrators may create platform-wide announcements.',
        403,
        'PLATFORM_ANNOUNCEMENT_FORBIDDEN',
      );
    }

    return null;
  }

  /**
   * Tenant administrators cannot
   * write into another tenant.
   */
  if (
    !isPlatformAdmin &&
    (
      !contextTenantId ||
      String(
        requestedTenantId,
      ) !==
        String(
          contextTenantId,
        )
    )
  ) {
    throw createServiceError(
      'You are not authorized to create an announcement for this tenant.',
      403,
      'TENANT_ACCESS_DENIED',
    );
  }

  return requestedTenantId;
}

/* ============================================================================
 * CREATE
 * ========================================================================== */

async function createAnnouncement({
  payload = {},
  context,
  request,
}) {
  const userId =
    assertAuthenticatedContext(
      context,
    );

  if (
    !payload.title ||
    !String(
      payload.title,
    ).trim()
  ) {
    throw createServiceError(
      'Announcement title is required.',
      400,
      'TITLE_REQUIRED',
    );
  }

  if (
    !payload.body ||
    !String(
      payload.body,
    ).trim()
  ) {
    throw createServiceError(
      'Announcement body is required.',
      400,
      'BODY_REQUIRED',
    );
  }

  const tenantId =
    resolveAnnouncementTenantId({
      payload,
      context,
    });

  /**
   * Never spread tenantId, createdBy or
   * ownership fields directly from an
   * untrusted payload.
   */
  const announcementPayload = {
    title:
      payload.title,

    summary:
      payload.summary,

    body:
      payload.body,

    slug:
      payload.slug,

    type:
      payload.type,

    category:
      payload.category,

    priority:
      payload.priority,

    severity:
      payload.severity,

    status:
      payload.status,

    publishedAt:
      payload.publishedAt,

    scheduledAt:
      payload.scheduledAt,

    expiresAt:
      payload.expiresAt,

    audience:
      payload.audience,

    isPinned:
      payload.isPinned,

    requiresAcknowledgement:
      payload.requiresAcknowledgement,

    allowDismiss:
      payload.allowDismiss,

    action:
      payload.action,

    imageUrl:
      payload.imageUrl,

    icon:
      payload.icon,

    metadata:
      payload.metadata,

    tenantId,

    createdBy:
      userId,

    updatedBy:
      userId,
  };

  const announcement =
    await Announcement.create(
      announcementPayload,
    );

  await audit({
    announcementId:
      announcement._id,

    tenantId:
      announcement.tenantId,

    actorUserId:
      userId,

    actorRole:
      getContextRoles(
        context,
      )[0] || null,

    action:
      'created',

    request,
  });

  return announcement;
}

/* ============================================================================
 * UPDATE
 * ========================================================================== */

async function updateAnnouncement({
  announcementId,
  payload = {},
  context,
  request,
}) {
  const id =
    requireObjectId(
      announcementId,
      'announcementId',
    );

  const userId =
    assertAuthenticatedContext(
      context,
    );

  const existing =
    await getAnnouncementForAdmin({
      announcementId: id,
      context,
    });

  if (!existing) {
    throw createServiceError(
      'Announcement not found.',
      404,
      'ANNOUNCEMENT_NOT_FOUND',
    );
  }

  /**
   * Tenant ownership cannot be changed
   * through a normal update.
   */
  const allowedFields = [
    'title',
    'summary',
    'body',
    'slug',
    'type',
    'category',
    'priority',
    'severity',
    'audience',
    'isPinned',
    'requiresAcknowledgement',
    'allowDismiss',
    'action',
    'imageUrl',
    'icon',
    'metadata',
    'expiresAt',
  ];

  const update = {};

  for (
    const field of allowedFields
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        payload,
        field,
      )
    ) {
      update[field] =
        payload[field];
    }
  }

  if (
    !Object.keys(update).length
  ) {
    throw createServiceError(
      'No valid announcement fields were supplied for update.',
      400,
      'NO_UPDATE_FIELDS',
    );
  }

  update.updatedBy =
    userId;

  update.$inc = {
    version: 1,
  };

  const updated =
    await Announcement.findOneAndUpdate(
      {
        _id: id,

        isDeleted: false,

        ...buildAdminTenantFilter(
          context,
        ),
      },
      update,
      {
        new: true,

        runValidators: true,
      },
    );

  if (!updated) {
    throw createServiceError(
      'Announcement not found.',
      404,
      'ANNOUNCEMENT_NOT_FOUND',
    );
  }

  await audit({
    announcementId:
      updated._id,

    tenantId:
      updated.tenantId,

    actorUserId:
      userId,

    actorRole:
      getContextRoles(
        context,
      )[0] || null,

    action:
      'updated',

    request,

    metadata: {
      version:
        updated.version,
    },
  });

  return updated;
}

/* ============================================================================
 * ADMIN TENANT FILTER
 * ========================================================================== */

function buildAdminTenantFilter(
  context,
) {
  const roles =
    getContextRoles(context);

  const isPlatformAdmin =
    roles.includes(
      'super_admin',
    ) ||
    roles.includes(
      'system_admin',
    ) ||
    roles.includes(
      'platform_admin',
    );

  if (isPlatformAdmin) {
    return {};
  }

  const tenantId =
    getContextTenantId(
      context,
    );

  if (!tenantId) {
    return {
      _id: null,
    };
  }

  return {
    tenantId,
  };
}

/* ============================================================================
 * GET ADMIN ANNOUNCEMENT
 * ========================================================================== */

async function getAnnouncementForAdmin({
  announcementId,
  context,
}) {
  const id =
    objectId(
      announcementId,
    );

  if (!id) {
    return null;
  }

  return Announcement.findOne({
    _id: id,

    ...buildAdminTenantFilter(
      context,
    ),
  });
}

/* ============================================================================
 * PUBLISH
 * ========================================================================== */

async function publishAnnouncement({
  announcementId,
  context,
  request,
}) {
  const id =
    requireObjectId(
      announcementId,
      'announcementId',
    );

  const userId =
    assertAuthenticatedContext(
      context,
    );

  const announcement =
    await getAnnouncementForAdmin({
      announcementId: id,
      context,
    });

  if (!announcement) {
    throw createServiceError(
      'Announcement not found.',
      404,
      'ANNOUNCEMENT_NOT_FOUND',
    );
  }

  if (
    announcement.isDeleted
  ) {
    throw createServiceError(
      'Deleted announcements cannot be published.',
      400,
      'ANNOUNCEMENT_DELETED',
    );
  }

  const now =
    new Date();

  announcement.status =
    'published';

  announcement.publishedAt =
    announcement.publishedAt ||
    now;

  announcement.publishedBy =
    userId;

  announcement.updatedBy =
    userId;

  announcement.version += 1;

  await announcement.save();

  await audit({
    announcementId:
      announcement._id,

    tenantId:
      announcement.tenantId,

    actorUserId:
      userId,

    actorRole:
      getContextRoles(
        context,
      )[0] || null,

    action:
      'published',

    request,

    metadata: {
      publishedAt:
        announcement.publishedAt,
    },
  });

  return announcement;
}

/* ============================================================================
 * SCHEDULE
 * ========================================================================== */

async function scheduleAnnouncement({
  announcementId,
  scheduledAt,
  context,
  request,
}) {
  const id =
    requireObjectId(
      announcementId,
      'announcementId',
    );

  const userId =
    assertAuthenticatedContext(
      context,
    );

  const scheduleDate =
    new Date(
      scheduledAt,
    );

  if (
    Number.isNaN(
      scheduleDate.getTime(),
    )
  ) {
    throw createServiceError(
      'scheduledAt must be a valid date.',
      400,
      'INVALID_SCHEDULE_DATE',
    );
  }

  if (
    scheduleDate <= new Date()
  ) {
    throw createServiceError(
      'scheduledAt must be in the future.',
      400,
      'INVALID_SCHEDULE_TIME',
    );
  }

  const announcement =
    await getAnnouncementForAdmin({
      announcementId: id,
      context,
    });

  if (!announcement) {
    throw createServiceError(
      'Announcement not found.',
      404,
      'ANNOUNCEMENT_NOT_FOUND',
    );
  }

  if (
    announcement.isDeleted
  ) {
    throw createServiceError(
      'Deleted announcements cannot be scheduled.',
      400,
      'ANNOUNCEMENT_DELETED',
    );
  }

  announcement.status =
    'scheduled';

  announcement.scheduledAt =
    scheduleDate;

  announcement.updatedBy =
    userId;

  announcement.version += 1;

  await announcement.save();

  await audit({
    announcementId:
      announcement._id,

    tenantId:
      announcement.tenantId,

    actorUserId:
      userId,

    actorRole:
      getContextRoles(
        context,
      )[0] || null,

    action:
      'scheduled',

    request,

    metadata: {
      scheduledAt:
        scheduleDate,
    },
  });

  return announcement;
}

/* ============================================================================
 * ARCHIVE
 * ========================================================================== */

async function archiveAnnouncement({
  announcementId,
  context,
  request,
}) {
  return changeLifecycleStatus({
    announcementId,

    status:
      'archived',

    auditAction:
      'archived',

    context,

    request,
  });
}

/* ============================================================================
 * SOFT DELETE
 * ========================================================================== */

async function deleteAnnouncement({
  announcementId,
  context,
  request,
}) {
  const id =
    requireObjectId(
      announcementId,
      'announcementId',
    );

  const userId =
    assertAuthenticatedContext(
      context,
    );

  const announcement =
    await getAnnouncementForAdmin({
      announcementId: id,
      context,
    });

  if (!announcement) {
    throw createServiceError(
      'Announcement not found.',
      404,
      'ANNOUNCEMENT_NOT_FOUND',
    );
  }

  const now =
    new Date();

  announcement.status =
    'deleted';

  announcement.isDeleted =
    true;

  announcement.deletedAt =
    now;

  announcement.deletedBy =
    userId;

  announcement.updatedBy =
    userId;

  announcement.version += 1;

  await announcement.save();

  await audit({
    announcementId:
      announcement._id,

    tenantId:
      announcement.tenantId,

    actorUserId:
      userId,

    actorRole:
      getContextRoles(
        context,
      )[0] || null,

    action:
      'deleted',

    request,

    metadata: {
      deletedAt: now,
    },
  });

  return announcement;
}

/* ============================================================================
 * RESTORE
 * ========================================================================== */

async function restoreAnnouncement({
  announcementId,
  context,
  request,
}) {
  const id =
    requireObjectId(
      announcementId,
      'announcementId',
    );

  const userId =
    assertAuthenticatedContext(
      context,
    );

  const announcement =
    await Announcement.findOne({
      _id: id,

      ...buildAdminTenantFilter(
        context,
      ),
    });

  if (!announcement) {
    throw createServiceError(
      'Announcement not found.',
      404,
      'ANNOUNCEMENT_NOT_FOUND',
    );
  }

  announcement.isDeleted =
    false;

  announcement.deletedAt =
    null;

  announcement.deletedBy =
    null;

  announcement.status =
    'draft';

  announcement.updatedBy =
    userId;

  announcement.version += 1;

  await announcement.save();

  await audit({
    announcementId:
      announcement._id,

    tenantId:
      announcement.tenantId,

    actorUserId:
      userId,

    actorRole:
      getContextRoles(
        context,
      )[0] || null,

    action:
      'restored',

    request,
  });

  return announcement;
}

/* ============================================================================
 * LIFECYCLE HELPER
 * ========================================================================== */

async function changeLifecycleStatus({
  announcementId,
  status,
  auditAction,
  context,
  request,
}) {
  const id =
    requireObjectId(
      announcementId,
      'announcementId',
    );

  const userId =
    assertAuthenticatedContext(
      context,
    );

  const announcement =
    await getAnnouncementForAdmin({
      announcementId: id,
      context,
    });

  if (!announcement) {
    throw createServiceError(
      'Announcement not found.',
      404,
      'ANNOUNCEMENT_NOT_FOUND',
    );
  }

  if (
    announcement.isDeleted
  ) {
    throw createServiceError(
      'Deleted announcements cannot be modified.',
      400,
      'ANNOUNCEMENT_DELETED',
    );
  }

  announcement.status =
    status;

  announcement.updatedBy =
    userId;

  announcement.version += 1;

  await announcement.save();

  await audit({
    announcementId:
      announcement._id,

    tenantId:
      announcement.tenantId,

    actorUserId:
      userId,

    actorRole:
      getContextRoles(
        context,
      )[0] || null,

    action:
      auditAction,

    request,
  });

  return announcement;
}

/* ============================================================================
 * EXPIRE SCHEDULED / PUBLISHED ANNOUNCEMENTS
 * ========================================================================== */

/**
 * Operational maintenance helper.
 *
 * Intended for:
 *   - cron
 *   - BullMQ worker
 *   - scheduled worker
 *   - administrative maintenance job
 *
 * This method intentionally does not require a user
 * context because it is an internal system operation.
 */
async function expireAnnouncements({
  now = new Date(),
} = {}) {
  const result =
    await Announcement.updateMany(
      {
        isDeleted: false,

        status: 'published',

        expiresAt: {
          $ne: null,

          $lte: now,
        },
      },
      {
        $set: {
          status: 'expired',
        },
        $inc: {
          version: 1,
        },
      },
    );

  return {
    matched:
      result.matchedCount ??
      result.n ??
      0,

    modified:
      result.modifiedCount ??
      result.nModified ??
      0,
  };
}

/* ============================================================================
 * PUBLISH SCHEDULED ANNOUNCEMENTS
 * ========================================================================== */

/**
 * Internal scheduler operation.
 *
 * Intended for a trusted background worker.
 */
async function publishScheduledAnnouncements({
  now = new Date(),
} = {}) {
  const candidates =
    await Announcement.find({
      isDeleted: false,

      status: 'scheduled',

      scheduledAt: {
        $ne: null,

        $lte: now,
      },
    }).limit(500);

  let published = 0;

  for (
    const announcement of candidates
  ) {
    announcement.status =
      'published';

    announcement.publishedAt =
      announcement.publishedAt ||
      now;

    announcement.scheduledAt =
      null;

    announcement.version += 1;

    await announcement.save();

    published += 1;

    /**
     * System-generated lifecycle events
     * deliberately use actorUserId = null.
     */
    await audit({
      announcementId:
        announcement._id,

      tenantId:
        announcement.tenantId,

      actorUserId:
        null,

      actorRole:
        'system',

      action:
        'published',

      request: null,

      metadata: {
        automated: true,
        publishedAt:
          announcement.publishedAt,
      },
    });
  }

  return {
    published,
  };
}

/* ============================================================================
 * EXPORTS
 * ========================================================================== */

module.exports = {
  listAnnouncements,

  getUnreadCount,

  getVisibleAnnouncement,

  getVisibleAnnouncementWithState,

  markAnnouncementRead,

  markAnnouncementViewed,

  acknowledgeAnnouncement,

  dismissAnnouncement,

  createAnnouncement,

  updateAnnouncement,

  publishAnnouncement,

  scheduleAnnouncement,

  archiveAnnouncement,

  deleteAnnouncement,

  restoreAnnouncement,

  expireAnnouncements,

  publishScheduledAnnouncements,
};