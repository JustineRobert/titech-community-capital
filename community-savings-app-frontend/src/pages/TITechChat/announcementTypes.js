/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise TITechChat Announcement Type Contracts
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat/announcementTypes.js
 *
 * Version:
 *   3.0.0
 *
 * Purpose:
 *   Canonical runtime-safe type contracts, validators, normalizers and
 *   factory helpers for the TITechChat announcement subsystem.
 *
 * Architectural position:
 *   This module is the TYPE / CONTRACT boundary for announcements.
 *
 *   It intentionally does NOT:
 *     - perform API requests;
 *     - access Redux;
 *     - manipulate browser storage;
 *     - render React components;
 *     - contain presentation logic;
 *     - contain authentication secrets;
 *     - contain backend-specific implementation details.
 *
 * Responsibilities:
 *   - Define canonical announcement shapes.
 *   - Normalize API / Redux / legacy payloads.
 *   - Validate announcement records defensively.
 *   - Normalize announcement status, priority and category values.
 *   - Normalize pagination metadata.
 *   - Normalize announcement recipients / targeting metadata.
 *   - Normalize read / acknowledgement state.
 *   - Provide safe factory helpers for new records.
 *   - Prevent malformed external data from propagating into the UI.
 *   - Preserve forward compatibility with backend evolution.
 *
 * Design principles:
 *   - TITech branding consistency.
 *   - Runtime defensive programming.
 *   - No unsafe assumptions about API payloads.
 *   - Stable identifiers.
 *   - Immutable normalized output.
 *   - Graceful handling of null / undefined values.
 *   - Backward compatibility with common legacy field names.
 *   - Explicit distinction between display state and persisted state.
 *
 * Important:
 *   These contracts are client-side validation and normalization helpers.
 *   They are NOT a substitute for authoritative server-side validation,
 *   authorization, auditing, or regulatory controls.
 *
 * ============================================================================
 */

'use strict';

/* ============================================================================
 * ENUMS
 * ========================================================================== */

/**
 * Announcement lifecycle status.
 */
export const ANNOUNCEMENT_STATUS = Object.freeze({
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
  EXPIRED: 'expired',
});

/**
 * Announcement priority.
 */
export const ANNOUNCEMENT_PRIORITY = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  CRITICAL: 'critical',
});

/**
 * Announcement category.
 *
 * Keep these values intentionally stable because they may be persisted by
 * the backend or used by analytics, filters and audit records.
 */
export const ANNOUNCEMENT_CATEGORY = Object.freeze({
  GENERAL: 'general',
  SYSTEM: 'system',
  SECURITY: 'security',
  MAINTENANCE: 'maintenance',
  SERVICE: 'service',
  SAVINGS: 'savings',
  LOAN: 'loan',
  TRANSACTION: 'transaction',
  PAYMENT: 'payment',
  COMPLIANCE: 'compliance',
  KYC: 'kyc',
  COMMUNITY: 'community',
  SUPPORT: 'support',
  POLICY: 'policy',
  PROMOTION: 'promotion',
});

/**
 * Announcement audience.
 */
export const ANNOUNCEMENT_AUDIENCE = Object.freeze({
  ALL_USERS: 'all_users',
  TENANT: 'tenant',
  GROUP: 'group',
  ROLE: 'role',
  USER: 'user',
  ADMINISTRATORS: 'administrators',
  STAFF: 'staff',
  MEMBERS: 'members',
  CUSTOM: 'custom',
});

/**
 * Announcement delivery channel.
 */
export const ANNOUNCEMENT_CHANNEL = Object.freeze({
  IN_APP: 'in_app',
  PUSH: 'push',
  EMAIL: 'email',
  SMS: 'sms',
  SYSTEM: 'system',
});

/**
 * Announcement severity.
 *
 * Severity is intentionally separate from priority. Priority describes
 * delivery / ordering preference while severity describes the nature of
 * the event.
 */
export const ANNOUNCEMENT_SEVERITY = Object.freeze({
  INFO: 'info',
  NOTICE: 'notice',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
});

/**
 * Announcement action types.
 */
export const ANNOUNCEMENT_ACTION = Object.freeze({
  NONE: 'none',
  OPEN: 'open',
  ROUTE: 'route',
  EXTERNAL: 'external',
  DISMISS: 'dismiss',
});

/**
 * Read state.
 */
export const ANNOUNCEMENT_READ_STATE = Object.freeze({
  UNREAD: 'unread',
  READ: 'read',
  ACKNOWLEDGED: 'acknowledged',
});

/* ============================================================================
 * ENUM SETS
 * ========================================================================== */

const STATUS_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_STATUS),
);

const PRIORITY_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_PRIORITY),
);

const CATEGORY_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_CATEGORY),
);

const AUDIENCE_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_AUDIENCE),
);

const CHANNEL_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_CHANNEL),
);

const SEVERITY_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_SEVERITY),
);

const ACTION_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_ACTION),
);

const READ_STATE_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_READ_STATE),
);

/* ============================================================================
 * LIMITS
 * ========================================================================== */

export const ANNOUNCEMENT_LIMITS = Object.freeze({
  TITLE_MAX_LENGTH: 240,
  SUMMARY_MAX_LENGTH: 500,
  BODY_MAX_LENGTH: 100000,
  CATEGORY_MAX_LENGTH: 100,
  AUTHOR_NAME_MAX_LENGTH: 200,
  AUTHOR_ID_MAX_LENGTH: 200,
  TENANT_ID_MAX_LENGTH: 200,
  GROUP_ID_MAX_LENGTH: 200,
  TARGET_ID_MAX_LENGTH: 200,
  URL_MAX_LENGTH: 2048,
  ICON_MAX_LENGTH: 100,
  TAG_MAX_LENGTH: 100,
  MAX_TAGS: 20,
  MAX_TARGET_IDS: 500,
  MAX_CHANNELS: 10,
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
});

/* ============================================================================
 * TYPE HELPERS
 * ========================================================================== */

export function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

export function isNonEmptyString(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

export function isValidDate(value) {
  if (!value) {
    return false;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  return !Number.isNaN(
    date.getTime(),
  );
}

export function toSafeString(
  value,
  fallback = '',
) {
  if (
    typeof value === 'string'
  ) {
    return value.trim();
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  return fallback;
}

function clampString(
  value,
  maxLength,
  fallback = '',
) {
  const normalized =
    toSafeString(
      value,
      fallback,
    );

  return normalized.length >
    maxLength
    ? normalized.slice(
        0,
        maxLength,
      )
    : normalized;
}

function normalizeArray(
  value,
) {
  if (Array.isArray(value)) {
    return value;
  }

  if (
    value === null ||
    value === undefined
  ) {
    return [];
  }

  return [value];
}

function uniqueStrings(
  values,
  maxLength,
) {
  const seen =
    new Set();

  return normalizeArray(values)
    .map((value) =>
      toSafeString(value),
    )
    .filter(Boolean)
    .filter((value) => {
      if (
        seen.has(value)
      ) {
        return false;
      }

      seen.add(value);

      return true;
    })
    .slice(
      0,
      maxLength,
    );
}

/* ============================================================================
 * ENUM NORMALIZERS
 * ========================================================================== */

function normalizeEnum(
  value,
  allowedValues,
  fallback,
) {
  const normalized =
    toSafeString(value)
      .toLowerCase()
      .replace(
        /\s+/g,
        '_',
      );

  return allowedValues.includes(
    normalized,
  )
    ? normalized
    : fallback;
}

export function normalizeAnnouncementStatus(
  value,
) {
  return normalizeEnum(
    value,
    STATUS_VALUES,
    ANNOUNCEMENT_STATUS.PUBLISHED,
  );
}

export function normalizeAnnouncementPriority(
  value,
) {
  return normalizeEnum(
    value,
    PRIORITY_VALUES,
    ANNOUNCEMENT_PRIORITY.NORMAL,
  );
}

export function normalizeAnnouncementCategory(
  value,
) {
  return normalizeEnum(
    value,
    CATEGORY_VALUES,
    ANNOUNCEMENT_CATEGORY.GENERAL,
  );
}

export function normalizeAnnouncementAudience(
  value,
) {
  return normalizeEnum(
    value,
    AUDIENCE_VALUES,
    ANNOUNCEMENT_AUDIENCE.ALL_USERS,
  );
}

export function normalizeAnnouncementSeverity(
  value,
) {
  return normalizeEnum(
    value,
    SEVERITY_VALUES,
    ANNOUNCEMENT_SEVERITY.INFO,
  );
}

export function normalizeAnnouncementAction(
  value,
) {
  return normalizeEnum(
    value,
    ACTION_VALUES,
    ANNOUNCEMENT_ACTION.NONE,
  );
}

export function normalizeReadState(
  value,
) {
  return normalizeEnum(
    value,
    READ_STATE_VALUES,
    ANNOUNCEMENT_READ_STATE.UNREAD,
  );
}

/* ============================================================================
 * DATE NORMALIZATION
 * ========================================================================== */

export function normalizeDateValue(
  value,
  fallback = null,
) {
  if (!value) {
    return fallback;
  }

  if (
    value instanceof Date
  ) {
    return isValidDate(value)
      ? value.toISOString()
      : fallback;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    const date =
      new Date(value);

    return isValidDate(date)
      ? date.toISOString()
      : fallback;
  }

  return fallback;
}

/* ============================================================================
 * ACTION NORMALIZATION
 * ========================================================================== */

export function normalizeAnnouncementActionConfig(
  value,
) {
  if (
    !isPlainObject(value)
  ) {
    return Object.freeze({
      type:
        ANNOUNCEMENT_ACTION.NONE,

      label:
        '',

      href:
        null,

      route:
        null,

      external:
        false,
    });
  }

  const type =
    normalizeAnnouncementAction(
      value.type ||
        value.actionType ||
        value.action,
    );

  const href =
    clampString(
      value.href ||
        value.url ||
        value.link,
      ANNOUNCEMENT_LIMITS.URL_MAX_LENGTH,
      '',
    );

  const route =
    clampString(
      value.route ||
        value.path,
      ANNOUNCEMENT_LIMITS.URL_MAX_LENGTH,
      '',
    );

  return Object.freeze({
    type,

    label:
      clampString(
        value.label ||
          value.text ||
          value.actionLabel,
        ANNOUNCEMENT_LIMITS.TITLE_MAX_LENGTH,
        '',
      ),

    href:
      href || null,

    route:
      route || null,

    external:
      Boolean(
        value.external ||
          type ===
            ANNOUNCEMENT_ACTION.EXTERNAL,
      ),
  });
}

/* ============================================================================
 * TARGETING NORMALIZATION
 * ========================================================================== */

export function normalizeAnnouncementTargeting(
  value,
) {
  const source =
    isPlainObject(value)
      ? value
      : {};

  return Object.freeze({
    audience:
      normalizeAnnouncementAudience(
        source.audience ||
          source.audienceType ||
          source.targetType,
      ),

    tenantId:
      clampString(
        source.tenantId ||
          source.organizationId ||
          source.orgId,
        ANNOUNCEMENT_LIMITS.TENANT_ID_MAX_LENGTH,
        '',
      ) || null,

    groupId:
      clampString(
        source.groupId ||
          source.communityId,
        ANNOUNCEMENT_LIMITS.GROUP_ID_MAX_LENGTH,
        '',
      ) || null,

    role:
      clampString(
        source.role ||
          source.targetRole,
        ANNOUNCEMENT_LIMITS.TARGET_ID_MAX_LENGTH,
        '',
      ) || null,

    userIds:
      uniqueStrings(
        source.userIds ||
          source.targetUserIds ||
          source.recipientIds,
        ANNOUNCEMENT_LIMITS.MAX_TARGET_IDS,
      ),

    groupIds:
      uniqueStrings(
        source.groupIds ||
          source.targetGroupIds,
        ANNOUNCEMENT_LIMITS.MAX_TARGET_IDS,
      ),

    roles:
      uniqueStrings(
        source.roles ||
          source.targetRoles,
        ANNOUNCEMENT_LIMITS.MAX_TARGET_IDS,
      ),

    customTargetIds:
      uniqueStrings(
        source.customTargetIds ||
          source.targets,
        ANNOUNCEMENT_LIMITS.MAX_TARGET_IDS,
      ),
  });
}

/* ============================================================================
 * CHANNEL NORMALIZATION
 * ========================================================================== */

export function normalizeAnnouncementChannels(
  value,
) {
  const values =
    normalizeArray(value);

  const normalized =
    values
      .map((item) =>
        normalizeEnum(
          item,
          CHANNEL_VALUES,
          null,
        ),
      )
      .filter(Boolean);

  return Object.freeze([
    ...new Set(normalized),
  ].slice(
    0,
    ANNOUNCEMENT_LIMITS.MAX_CHANNELS,
  ));
}

/* ============================================================================
 * AUTHOR NORMALIZATION
 * ========================================================================== */

export function normalizeAnnouncementAuthor(
  value,
) {
  const source =
    isPlainObject(value)
      ? value
      : {};

  const id =
    clampString(
      source.id ||
        source.userId ||
        source.authorId,
      ANNOUNCEMENT_LIMITS.AUTHOR_ID_MAX_LENGTH,
      '',
    );

  const name =
    clampString(
      source.name ||
        source.displayName ||
        source.fullName ||
        source.authorName,
      ANNOUNCEMENT_LIMITS.AUTHOR_NAME_MAX_LENGTH,
      '',
    );

  return Object.freeze({
    id:
      id || null,

    name:
      name || 'TITech Community Capital',

    email:
      clampString(
        source.email,
        ANNOUNCEMENT_LIMITS.AUTHOR_NAME_MAX_LENGTH,
        '',
      ) || null,

    role:
      clampString(
        source.role,
        ANNOUNCEMENT_LIMITS.TARGET_ID_MAX_LENGTH,
        '',
      ) || null,
  });
}

/* ============================================================================
 * READ / USER STATE
 * ========================================================================== */

export function normalizeAnnouncementUserState(
  value,
) {
  const source =
    isPlainObject(value)
      ? value
      : {};

  const acknowledgedAt =
    normalizeDateValue(
      source.acknowledgedAt,
    );

  const readAt =
    normalizeDateValue(
      source.readAt ||
        source.viewedAt,
    );

  const isAcknowledged =
    Boolean(
      source.isAcknowledged ||
        source.acknowledged ||
        acknowledgedAt,
    );

  const isRead =
    Boolean(
      source.isRead ||
        source.read ||
        readAt ||
        isAcknowledged,
    );

  return Object.freeze({
    isRead,

    isAcknowledged,

    readAt,

    acknowledgedAt,

    readState:
      isAcknowledged
        ? ANNOUNCEMENT_READ_STATE.ACKNOWLEDGED
        : isRead
          ? ANNOUNCEMENT_READ_STATE.READ
          : ANNOUNCEMENT_READ_STATE.UNREAD,
  });
}

/* ============================================================================
 * TAG NORMALIZATION
 * ========================================================================== */

export function normalizeAnnouncementTags(
  value,
) {
  return Object.freeze(
    uniqueStrings(
      value,
      ANNOUNCEMENT_LIMITS.MAX_TAGS,
    )
      .map((tag) =>
        clampString(
          tag,
          ANNOUNCEMENT_LIMITS.TAG_MAX_LENGTH,
        ),
      )
      .filter(Boolean),
  );
}

/* ============================================================================
 * ANNOUNCEMENT NORMALIZER
 * ========================================================================== */

/**
 * Normalize an announcement from an API, Redux store, legacy payload or
 * optimistic client record.
 *
 * The function accepts common alternate field names deliberately so that
 * backend evolution does not unnecessarily break the presentation layer.
 */
export function normalizeAnnouncement(
  input,
) {
  const source =
    isPlainObject(input)
      ? input
      : {};

  const id =
    toSafeString(
      source.id ||
        source._id ||
        source.announcementId ||
        source.uuid,
    );

  const title =
    clampString(
      source.title ||
        source.name ||
        source.subject,
      ANNOUNCEMENT_LIMITS.TITLE_MAX_LENGTH,
      'TITech Community Capital Announcement',
    );

  const body =
    clampString(
      source.body ||
        source.content ||
        source.message ||
        source.description,
      ANNOUNCEMENT_LIMITS.BODY_MAX_LENGTH,
      '',
    );

  const summary =
    clampString(
      source.summary ||
        source.excerpt ||
        source.preview ||
        body,
      ANNOUNCEMENT_LIMITS.SUMMARY_MAX_LENGTH,
      '',
    );

  const publishedAt =
    normalizeDateValue(
      source.publishedAt ||
        source.publishAt ||
        source.createdAt,
    );

  const scheduledAt =
    normalizeDateValue(
      source.scheduledAt ||
        source.publishAt,
    );

  const expiresAt =
    normalizeDateValue(
      source.expiresAt ||
        source.expiryDate ||
        source.expirationDate,
    );

  const createdAt =
    normalizeDateValue(
      source.createdAt,
    );

  const updatedAt =
    normalizeDateValue(
      source.updatedAt,
    );

  const status =
    normalizeAnnouncementStatus(
      source.status,
    );

  const priority =
    normalizeAnnouncementPriority(
      source.priority ||
        source.urgency,
    );

  const category =
    normalizeAnnouncementCategory(
      source.category ||
        source.type,
    );

  const severity =
    normalizeAnnouncementSeverity(
      source.severity,
    );

  const author =
    normalizeAnnouncementAuthor(
      source.author ||
        source.createdBy ||
        {
          id:
            source.authorId ||
            source.createdById,

          name:
            source.authorName ||
            source.createdByName,
        },
    );

  const targeting =
    normalizeAnnouncementTargeting(
      source.targeting ||
        source.audience ||
        source.recipients,
    );

  const channels =
    normalizeAnnouncementChannels(
      source.channels ||
        source.deliveryChannels ||
        source.channel ||
        ANNOUNCEMENT_CHANNEL.IN_APP,
    );

  const userState =
    normalizeAnnouncementUserState(
      source.userState ||
        source.user ||
        source.readState ||
        source,
    );

  const action =
    normalizeAnnouncementActionConfig(
      source.action ||
        source.cta ||
        {
          type:
            source.actionType,

          label:
            source.actionLabel,

          href:
            source.href ||
            source.url,

          route:
            source.route,
        },
    );

  const normalized = {
    id:
      id || null,

    slug:
      clampString(
        source.slug ||
          source.key ||
          id,
        ANNOUNCEMENT_LIMITS.TITLE_MAX_LENGTH,
        '',
      ) || null,

    title,

    summary,

    body,

    status,

    priority,

    category,

    severity,

    audience:
      targeting.audience,

    targeting,

    channels,

    action,

    icon:
      clampString(
        source.icon ||
          source.iconName,
        ANNOUNCEMENT_LIMITS.ICON_MAX_LENGTH,
        '',
      ) || null,

    tags:
      normalizeAnnouncementTags(
        source.tags,
      ),

    author,

    createdAt,

    updatedAt,

    publishedAt,

    scheduledAt,

    expiresAt,

    isPinned:
      Boolean(
        source.isPinned ||
          source.pinned ||
          source.sticky,
      ),

    isDismissible:
      source.isDismissible !==
        undefined
        ? Boolean(
            source.isDismissible,
          )
        : true,

    requiresAcknowledgement:
      Boolean(
        source.requiresAcknowledgement ||
          source.requiresAck ||
          source.acknowledgementRequired,
      ),

    userState,

    metadata:
      isPlainObject(
        source.metadata,
      )
        ? {
            ...source.metadata,
          }
        : {},

    /**
     * Compatibility fields intentionally retained at the normalized boundary.
     */
    tenantId:
      targeting.tenantId,

    groupId:
      targeting.groupId,
  };

  return Object.freeze(
    normalized,
  );
}

/* ============================================================================
 * ANNOUNCEMENT VALIDATION
 * ========================================================================== */

/**
 * Return a structured validation result rather than throwing.
 *
 * This is useful for defensive UI / Redux ingestion where malformed server
 * payloads should not crash the entire TITechChat application.
 */
export function validateAnnouncement(
  announcement,
) {
  const errors = [];
  const warnings = [];

  if (
    !isPlainObject(
      announcement,
    )
  ) {
    return {
      valid: false,
      errors: [
        'Announcement must be a plain object.',
      ],
      warnings: [],
    };
  }

  if (
    !isNonEmptyString(
      announcement.id,
    )
  ) {
    warnings.push(
      'Announcement has no stable identifier.',
    );
  }

  if (
    !isNonEmptyString(
      announcement.title,
    )
  ) {
    errors.push(
      'Announcement title is required.',
    );
  }

  if (
    !isNonEmptyString(
      announcement.body,
    ) &&
    !isNonEmptyString(
      announcement.summary,
    )
  ) {
    errors.push(
      'Announcement body or summary is required.',
    );
  }

  if (
    !STATUS_VALUES.includes(
      announcement.status,
    )
  ) {
    errors.push(
      'Announcement status is invalid.',
    );
  }

  if (
    !PRIORITY_VALUES.includes(
      announcement.priority,
    )
  ) {
    errors.push(
      'Announcement priority is invalid.',
    );
  }

  if (
    !CATEGORY_VALUES.includes(
      announcement.category,
    )
  ) {
    errors.push(
      'Announcement category is invalid.',
    );
  }

  if (
    announcement.publishedAt &&
    !isValidDate(
      announcement.publishedAt,
    )
  ) {
    errors.push(
      'Announcement publishedAt is invalid.',
    );
  }

  if (
    announcement.expiresAt &&
    !isValidDate(
      announcement.expiresAt,
    )
  ) {
    errors.push(
      'Announcement expiresAt is invalid.',
    );
  }

  if (
    announcement.tags?.length >
    ANNOUNCEMENT_LIMITS.MAX_TAGS
  ) {
    errors.push(
      'Announcement contains too many tags.',
    );
  }

  if (
    announcement.targeting?.userIds
      ?.length >
    ANNOUNCEMENT_LIMITS.MAX_TARGET_IDS
  ) {
    errors.push(
      'Announcement contains too many user targets.',
    );
  }

  return {
    valid:
      errors.length === 0,

    errors,

    warnings,
  };
}

/* ============================================================================
 * PAGINATION CONTRACT
 * ========================================================================== */

export function normalizeAnnouncementPagination(
  value,
) {
  const source =
    isPlainObject(value)
      ? value
      : {};

  const rawPage =
    Number(
      source.page ||
        source.currentPage ||
        ANNOUNCEMENT_LIMITS.DEFAULT_PAGE,
    );

  const rawPageSize =
    Number(
      source.pageSize ||
        source.limit ||
        source.perPage ||
        ANNOUNCEMENT_LIMITS.DEFAULT_PAGE_SIZE,
    );

  const rawTotal =
    Number(
      source.total ||
        source.totalCount ||
        0,
    );

  const page =
    Number.isFinite(rawPage)
      ? Math.max(
          1,
          Math.floor(rawPage),
        )
      : ANNOUNCEMENT_LIMITS.DEFAULT_PAGE;

  const pageSize =
    Number.isFinite(rawPageSize)
      ? Math.min(
          ANNOUNCEMENT_LIMITS.MAX_PAGE_SIZE,
          Math.max(
            1,
            Math.floor(rawPageSize),
          ),
        )
      : ANNOUNCEMENT_LIMITS.DEFAULT_PAGE_SIZE;

  const total =
    Number.isFinite(rawTotal)
      ? Math.max(
          0,
          Math.floor(rawTotal),
        )
      : 0;

  const totalPages =
    total === 0
      ? 0
      : Math.ceil(
          total / pageSize,
        );

  return Object.freeze({
    page,

    pageSize,

    total,

    totalPages,

    hasNextPage:
      totalPages > 0 &&
      page < totalPages,

    hasPreviousPage:
      page > 1,

    nextPage:
      page < totalPages
        ? page + 1
        : null,

    previousPage:
      page > 1
        ? page - 1
        : null,
  });
}

/* ============================================================================
 * LIST RESPONSE NORMALIZATION
 * ========================================================================== */

export function normalizeAnnouncementListResponse(
  value,
) {
  const source =
    isPlainObject(value)
      ? value
      : {};

  const items =
    source.items ||
    source.announcements ||
    source.data ||
    source.results ||
    [];

  const normalizedItems =
    normalizeArray(items)
      .map(
        normalizeAnnouncement,
      );

  const pagination =
    normalizeAnnouncementPagination(
      source.pagination ||
        source.meta ||
        source,
    );

  return Object.freeze({
    items:
      Object.freeze(
        normalizedItems,
      ),

    pagination,

    success:
      source.success !==
        undefined
        ? Boolean(
            source.success,
          )
        : true,

    message:
      toSafeString(
        source.message,
      ),

    requestId:
      toSafeString(
        source.requestId ||
          source.correlationId ||
          source.traceId,
      ) || null,
  });
}

/* ============================================================================
 * FACTORIES
 * ========================================================================== */

export function createAnnouncementDraft(
  overrides = {},
) {
  const now =
    new Date().toISOString();

  return normalizeAnnouncement({
    id:
      null,

    title:
      '',

    summary:
      '',

    body:
      '',

    status:
      ANNOUNCEMENT_STATUS.DRAFT,

    priority:
      ANNOUNCEMENT_PRIORITY.NORMAL,

    category:
      ANNOUNCEMENT_CATEGORY.GENERAL,

    severity:
      ANNOUNCEMENT_SEVERITY.INFO,

    audience:
      ANNOUNCEMENT_AUDIENCE.ALL_USERS,

    channels: [
      ANNOUNCEMENT_CHANNEL.IN_APP,
    ],

    targeting: {
      audience:
        ANNOUNCEMENT_AUDIENCE.ALL_USERS,

      tenantId:
        null,

      groupId:
        null,

      userIds: [],
    },

    action: {
      type:
        ANNOUNCEMENT_ACTION.NONE,
    },

    tags: [],

    author: {},

    createdAt:
      now,

    updatedAt:
      now,

    publishedAt:
      null,

    scheduledAt:
      null,

    expiresAt:
      null,

    isPinned:
      false,

    isDismissible:
      true,

    requiresAcknowledgement:
      false,

    userState: {
      isRead:
        false,

      isAcknowledged:
        false,
    },

    ...overrides,
  });
}

export function createAnnouncementFromApi(
  payload,
) {
  return normalizeAnnouncement(
    payload,
  );
}

/* ============================================================================
 * TYPE GUARDS
 * ========================================================================== */

export function isAnnouncement(
  value,
) {
  if (
    !isPlainObject(value)
  ) {
    return false;
  }

  return (
    isNonEmptyString(
      value.title,
    ) &&
    STATUS_VALUES.includes(
      value.status,
    ) &&
    PRIORITY_VALUES.includes(
      value.priority,
    ) &&
    CATEGORY_VALUES.includes(
      value.category,
    )
  );
}

export function isUnreadAnnouncement(
  value,
) {
  if (
    !isAnnouncement(value)
  ) {
    return false;
  }

  return (
    value.userState?.readState ===
      ANNOUNCEMENT_READ_STATE.UNREAD ||
    value.userState?.isRead === false
  );
}

export function isPublishedAnnouncement(
  value,
) {
  return (
    isAnnouncement(value) &&
    value.status ===
      ANNOUNCEMENT_STATUS.PUBLISHED
  );
}

/* ============================================================================
 * EXPORT CONTRACT
 * ========================================================================== */

export const ANNOUNCEMENT_TYPE_CONTRACT = Object.freeze({
  statuses:
    STATUS_VALUES,

  priorities:
    PRIORITY_VALUES,

  categories:
    CATEGORY_VALUES,

  audiences:
    AUDIENCE_VALUES,

  channels:
    CHANNEL_VALUES,

  severities:
    SEVERITY_VALUES,

  actions:
    ACTION_VALUES,

  readStates:
    READ_STATE_VALUES,

  limits:
    ANNOUNCEMENT_LIMITS,
});

/* ============================================================================
 * DEFAULT EXPORT
 * ========================================================================== */

export default Object.freeze({
  ANNOUNCEMENT_STATUS,

  ANNOUNCEMENT_PRIORITY,

  ANNOUNCEMENT_CATEGORY,

  ANNOUNCEMENT_AUDIENCE,

  ANNOUNCEMENT_CHANNEL,

  ANNOUNCEMENT_SEVERITY,

  ANNOUNCEMENT_ACTION,

  ANNOUNCEMENT_READ_STATE,

  ANNOUNCEMENT_LIMITS,

  ANNOUNCEMENT_TYPE_CONTRACT,

  normalizeAnnouncement,

  normalizeAnnouncementStatus,

  normalizeAnnouncementPriority,

  normalizeAnnouncementCategory,

  normalizeAnnouncementAudience,

  normalizeAnnouncementSeverity,

  normalizeAnnouncementAction,

  normalizeAnnouncementActionConfig,

  normalizeAnnouncementTargeting,

  normalizeAnnouncementChannels,

  normalizeAnnouncementAuthor,

  normalizeAnnouncementUserState,

  normalizeAnnouncementTags,

  normalizeAnnouncementPagination,

  normalizeAnnouncementListResponse,

  normalizeDateValue,

  validateAnnouncement,

  isAnnouncement,

  isUnreadAnnouncement,

  isPublishedAnnouncement,

  createAnnouncementDraft,

  createAnnouncementFromApi,
});