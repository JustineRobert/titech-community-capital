'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Announcement Constants
 * ============================================================================
 *
 * File:
 *   backend/constants/announcementConstants.js
 *
 * Purpose:
 *   Centralized, immutable constants for the TITech Community Capital
 *   announcement domain.
 *
 * Architectural role:
 *
 *   Announcement Controller
 *          ↓
 *   Announcement Service
 *          ↓
 *   Announcement Model
 *          ↓
 *   Announcement Constants
 *
 * Responsibilities:
 *   - Announcement lifecycle states
 *   - Announcement visibility/audience
 *   - Announcement priority
 *   - Announcement categories
 *   - Publication modes
 *   - Delivery channels
 *   - Read/unread states
 *   - Scheduling constraints
 *   - Validation limits
 *   - Pagination defaults
 *   - Idempotency defaults
 *   - Retention defaults
 *   - Sort/order constants
 *   - Audit event names
 *   - Error codes
 *   - API contract metadata
 *
 * Design principles:
 *   - Single source of truth
 *   - Object.freeze() for runtime immutability
 *   - Explicit machine-readable values
 *   - Human-readable labels separated from persisted values
 *   - Safe defaults
 *   - Backward-compatible aliases where useful
 *   - No business logic in this file
 *
 * IMPORTANT:
 *   Persisted enum values should not be casually renamed once released.
 *   Changing a persisted value can break existing database records,
 *   analytics, filters, indexes, reporting and integrations.
 *
 * ============================================================================
 */

// ============================================================================
// Domain Metadata
// ============================================================================

const ANNOUNCEMENT_DOMAIN = 'announcement';

const ANNOUNCEMENT_RESOURCE = 'announcements';

const ANNOUNCEMENT_API_VERSION = 'v1';

const ANNOUNCEMENT_CONSTANTS_VERSION = '1.0.0';

const ANNOUNCEMENT_BRAND = 'TITech Community Capital';

// ============================================================================
// Lifecycle Statuses
// ============================================================================

/**
 * Canonical announcement lifecycle states.
 *
 * Typical lifecycle:
 *
 * draft
 *   ↓
 * scheduled
 *   ↓
 * published
 *   ↓
 * archived
 *
 * draft → cancelled
 * scheduled → cancelled
 */
const ANNOUNCEMENT_STATUS = Object.freeze({
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
  CANCELLED: 'cancelled',
});

// Backward-compatible alias.
const ANNOUNCEMENT_STATUSES = ANNOUNCEMENT_STATUS;

/**
 * Persistable lifecycle values.
 */
const ANNOUNCEMENT_STATUS_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_STATUS)
);

/**
 * Human-readable lifecycle labels.
 */
const ANNOUNCEMENT_STATUS_LABELS = Object.freeze({
  [ANNOUNCEMENT_STATUS.DRAFT]: 'Draft',
  [ANNOUNCEMENT_STATUS.SCHEDULED]: 'Scheduled',
  [ANNOUNCEMENT_STATUS.PUBLISHED]: 'Published',
  [ANNOUNCEMENT_STATUS.ARCHIVED]: 'Archived',
  [ANNOUNCEMENT_STATUS.CANCELLED]: 'Cancelled',
});

// ============================================================================
// Announcement Categories
// ============================================================================

const ANNOUNCEMENT_CATEGORY = Object.freeze({
  GENERAL: 'general',
  SYSTEM: 'system',
  PLATFORM: 'platform',
  MAINTENANCE: 'maintenance',
  SECURITY: 'security',
  COMPLIANCE: 'compliance',
  FINANCIAL: 'financial',
  SAVINGS: 'savings',
  LOAN: 'loan',
  PAYMENT: 'payment',
  CONTRIBUTION: 'contribution',
  GROUP: 'group',
  BILLING: 'billing',
  PRODUCT: 'product',
  FEATURE: 'feature',
  SERVICE_UPDATE: 'service_update',
  POLICY: 'policy',
  LEGAL: 'legal',
  EMERGENCY: 'emergency',
});

// Backward-compatible alias.
const ANNOUNCEMENT_CATEGORIES = ANNOUNCEMENT_CATEGORY;

const ANNOUNCEMENT_CATEGORY_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_CATEGORY)
);

const ANNOUNCEMENT_CATEGORY_LABELS = Object.freeze({
  [ANNOUNCEMENT_CATEGORY.GENERAL]: 'General',
  [ANNOUNCEMENT_CATEGORY.SYSTEM]: 'System',
  [ANNOUNCEMENT_CATEGORY.PLATFORM]: 'Platform',
  [ANNOUNCEMENT_CATEGORY.MAINTENANCE]: 'Maintenance',
  [ANNOUNCEMENT_CATEGORY.SECURITY]: 'Security',
  [ANNOUNCEMENT_CATEGORY.COMPLIANCE]: 'Compliance',
  [ANNOUNCEMENT_CATEGORY.FINANCIAL]: 'Financial',
  [ANNOUNCEMENT_CATEGORY.SAVINGS]: 'Savings',
  [ANNOUNCEMENT_CATEGORY.LOAN]: 'Loan',
  [ANNOUNCEMENT_CATEGORY.PAYMENT]: 'Payment',
  [ANNOUNCEMENT_CATEGORY.CONTRIBUTION]: 'Contribution',
  [ANNOUNCEMENT_CATEGORY.GROUP]: 'Group',
  [ANNOUNCEMENT_CATEGORY.BILLING]: 'Billing',
  [ANNOUNCEMENT_CATEGORY.PRODUCT]: 'Product',
  [ANNOUNCEMENT_CATEGORY.FEATURE]: 'Feature',
  [ANNOUNCEMENT_CATEGORY.SERVICE_UPDATE]: 'Service Update',
  [ANNOUNCEMENT_CATEGORY.POLICY]: 'Policy',
  [ANNOUNCEMENT_CATEGORY.LEGAL]: 'Legal',
  [ANNOUNCEMENT_CATEGORY.EMERGENCY]: 'Emergency',
});

// ============================================================================
// Priority
// ============================================================================

const ANNOUNCEMENT_PRIORITY = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
  CRITICAL: 'critical',
});

const ANNOUNCEMENT_PRIORITIES = ANNOUNCEMENT_PRIORITY;

const ANNOUNCEMENT_PRIORITY_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_PRIORITY)
);

const ANNOUNCEMENT_PRIORITY_LABELS = Object.freeze({
  [ANNOUNCEMENT_PRIORITY.LOW]: 'Low',
  [ANNOUNCEMENT_PRIORITY.NORMAL]: 'Normal',
  [ANNOUNCEMENT_PRIORITY.HIGH]: 'High',
  [ANNOUNCEMENT_PRIORITY.URGENT]: 'Urgent',
  [ANNOUNCEMENT_PRIORITY.CRITICAL]: 'Critical',
});

/**
 * Numeric ranking useful for ordering/filtering without persisting the rank.
 */
const ANNOUNCEMENT_PRIORITY_RANK = Object.freeze({
  [ANNOUNCEMENT_PRIORITY.LOW]: 10,
  [ANNOUNCEMENT_PRIORITY.NORMAL]: 20,
  [ANNOUNCEMENT_PRIORITY.HIGH]: 30,
  [ANNOUNCEMENT_PRIORITY.URGENT]: 40,
  [ANNOUNCEMENT_PRIORITY.CRITICAL]: 50,
});

// ============================================================================
// Visibility / Audience
// ============================================================================

const ANNOUNCEMENT_AUDIENCE = Object.freeze({
  ALL_USERS: 'all_users',
  AUTHENTICATED_USERS: 'authenticated_users',
  TENANT_USERS: 'tenant_users',
  TENANT_ADMINS: 'tenant_admins',
  GROUP_MEMBERS: 'group_members',
  PLATFORM_ADMINS: 'platform_admins',
  SUPPORT_USERS: 'support_users',
  CUSTOM: 'custom',
});

const ANNOUNCEMENT_AUDIENCES = ANNOUNCEMENT_AUDIENCE;

const ANNOUNCEMENT_AUDIENCE_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_AUDIENCE)
);

const ANNOUNCEMENT_AUDIENCE_LABELS = Object.freeze({
  [ANNOUNCEMENT_AUDIENCE.ALL_USERS]: 'All Users',
  [ANNOUNCEMENT_AUDIENCE.AUTHENTICATED_USERS]:
    'Authenticated Users',
  [ANNOUNCEMENT_AUDIENCE.TENANT_USERS]: 'Tenant Users',
  [ANNOUNCEMENT_AUDIENCE.TENANT_ADMINS]: 'Tenant Administrators',
  [ANNOUNCEMENT_AUDIENCE.GROUP_MEMBERS]: 'Group Members',
  [ANNOUNCEMENT_AUDIENCE.PLATFORM_ADMINS]:
    'Platform Administrators',
  [ANNOUNCEMENT_AUDIENCE.SUPPORT_USERS]: 'Support Users',
  [ANNOUNCEMENT_AUDIENCE.CUSTOM]: 'Custom Audience',
});

// ============================================================================
// Publication Modes
// ============================================================================

const ANNOUNCEMENT_PUBLICATION_MODE = Object.freeze({
  IMMEDIATE: 'immediate',
  SCHEDULED: 'scheduled',
  MANUAL: 'manual',
});

const ANNOUNCEMENT_PUBLICATION_MODES =
  ANNOUNCEMENT_PUBLICATION_MODE;

const ANNOUNCEMENT_PUBLICATION_MODE_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_PUBLICATION_MODE)
);

// ============================================================================
// Delivery Channels
// ============================================================================

const ANNOUNCEMENT_CHANNEL = Object.freeze({
  IN_APP: 'in_app',
  EMAIL: 'email',
  PUSH: 'push',
  SMS: 'sms',
  WEB: 'web',
});

const ANNOUNCEMENT_CHANNELS = ANNOUNCEMENT_CHANNEL;

const ANNOUNCEMENT_CHANNEL_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_CHANNEL)
);

// ============================================================================
// Notification / Read State
// ============================================================================

const ANNOUNCEMENT_READ_STATE = Object.freeze({
  UNREAD: 'unread',
  READ: 'read',
});

const ANNOUNCEMENT_READ_STATES = ANNOUNCEMENT_READ_STATE;

const ANNOUNCEMENT_READ_STATE_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_READ_STATE)
);

// ============================================================================
// Acknowledgement
// ============================================================================

const ANNOUNCEMENT_ACKNOWLEDGEMENT = Object.freeze({
  NOT_REQUIRED: 'not_required',
  REQUIRED: 'required',
  ACKNOWLEDGED: 'acknowledged',
  EXPIRED: 'expired',
});

const ANNOUNCEMENT_ACKNOWLEDGEMENT_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_ACKNOWLEDGEMENT)
);

// ============================================================================
// Targeting Types
// ============================================================================

const ANNOUNCEMENT_TARGET_TYPE = Object.freeze({
  ALL: 'all',
  USER: 'user',
  USERS: 'users',
  TENANT: 'tenant',
  TENANTS: 'tenants',
  GROUP: 'group',
  GROUPS: 'groups',
  ROLE: 'role',
  ROLES: 'roles',
  CUSTOM: 'custom',
});

const ANNOUNCEMENT_TARGET_TYPES = ANNOUNCEMENT_TARGET_TYPE;

const ANNOUNCEMENT_TARGET_TYPE_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_TARGET_TYPE)
);

// ============================================================================
// Sort Fields
// ============================================================================

const ANNOUNCEMENT_SORT_FIELD = Object.freeze({
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
  PUBLISHED_AT: 'publishedAt',
  SCHEDULED_AT: 'scheduledAt',
  PRIORITY: 'priority',
  TITLE: 'title',
  STATUS: 'status',
  CATEGORY: 'category',
});

const ANNOUNCEMENT_SORT_FIELDS = ANNOUNCEMENT_SORT_FIELD;

const ANNOUNCEMENT_SORT_FIELD_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_SORT_FIELD)
);

// ============================================================================
// Sort Directions
// ============================================================================

const ANNOUNCEMENT_SORT_DIRECTION = Object.freeze({
  ASC: 'asc',
  DESC: 'desc',
});

const ANNOUNCEMENT_SORT_DIRECTIONS =
  ANNOUNCEMENT_SORT_DIRECTION;

const ANNOUNCEMENT_SORT_DIRECTION_VALUES = Object.freeze(
  Object.values(ANNOUNCEMENT_SORT_DIRECTION)
);

// ============================================================================
// Default Sorting
// ============================================================================

const ANNOUNCEMENT_DEFAULT_SORT = Object.freeze({
  FIELD: ANNOUNCEMENT_SORT_FIELD.PUBLISHED_AT,
  DIRECTION: ANNOUNCEMENT_SORT_DIRECTION.DESC,
});

// ============================================================================
// Pagination
// ============================================================================

const ANNOUNCEMENT_PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MIN_LIMIT: 1,
  MAX_LIMIT: 100,
  MAX_OFFSET: 1_000_000,
});

/**
 * Cursor pagination defaults for high-volume tenants.
 */
const ANNOUNCEMENT_CURSOR_PAGINATION = Object.freeze({
  DEFAULT_LIMIT: 20,
  MIN_LIMIT: 1,
  MAX_LIMIT: 100,
});

// ============================================================================
// Content Limits
// ============================================================================

const ANNOUNCEMENT_LIMITS = Object.freeze({
  TITLE_MIN_LENGTH: 1,
  TITLE_MAX_LENGTH: 200,

  SUMMARY_MIN_LENGTH: 0,
  SUMMARY_MAX_LENGTH: 500,

  CONTENT_MIN_LENGTH: 1,
  CONTENT_MAX_LENGTH: 100_000,

  CATEGORY_MAX_LENGTH: 50,

  CTA_LABEL_MAX_LENGTH: 100,
  CTA_URL_MAX_LENGTH: 2_048,

  IMAGE_URL_MAX_LENGTH: 2_048,

  MAX_TAGS: 20,
  MAX_TAG_LENGTH: 50,

  MAX_AUDIENCE_USER_IDS: 10_000,
  MAX_AUDIENCE_GROUP_IDS: 1_000,
  MAX_AUDIENCE_TENANT_IDS: 1_000,
});

// ============================================================================
// Scheduling
// ============================================================================

const ANNOUNCEMENT_SCHEDULING = Object.freeze({
  MIN_FUTURE_OFFSET_MS: 1_000,

  /**
   * Maximum allowed scheduling horizon.
   * 365 days is intentionally conservative and can be overridden by a
   * service-level configuration where appropriate.
   */
  MAX_SCHEDULE_HORIZON_MS:
    365 * 24 * 60 * 60 * 1000,

  /**
   * Grace interval used by schedulers to determine whether a scheduled
   * announcement is ready for publication.
   */
  SCHEDULER_GRACE_MS: 30_000,
});

// ============================================================================
// Retention
// ============================================================================

const ANNOUNCEMENT_RETENTION = Object.freeze({
  DEFAULT_RETENTION_DAYS: 365,
  MIN_RETENTION_DAYS: 1,
  MAX_RETENTION_DAYS: 3_650,
});

// ============================================================================
// Idempotency
// ============================================================================

const ANNOUNCEMENT_IDEMPOTENCY = Object.freeze({
  DEFAULT_TTL_SECONDS: 24 * 60 * 60,
  MIN_TTL_SECONDS: 60,
  MAX_TTL_SECONDS: 7 * 24 * 60 * 60,

  HEADER_NAME: 'Idempotency-Key',

  MAX_KEY_LENGTH: 255,
});

// ============================================================================
// API Query Limits
// ============================================================================

const ANNOUNCEMENT_QUERY_LIMITS = Object.freeze({
  MAX_SEARCH_LENGTH: 200,
  MAX_FILTER_VALUES: 100,
  MAX_DATE_RANGE_DAYS: 3_650,
});

// ============================================================================
// Audit Events
// ============================================================================

const ANNOUNCEMENT_AUDIT_EVENT = Object.freeze({
  CREATED: 'announcement.created',
  UPDATED: 'announcement.updated',
  SCHEDULED: 'announcement.scheduled',
  PUBLISHED: 'announcement.published',
  ARCHIVED: 'announcement.archived',
  CANCELLED: 'announcement.cancelled',
  DELETED: 'announcement.deleted',

  READ: 'announcement.read',
  UNREAD: 'announcement.unread',
  MARK_ALL_READ: 'announcement.mark_all_read',

  ACKNOWLEDGED: 'announcement.acknowledged',

  DELIVERY_STARTED: 'announcement.delivery_started',
  DELIVERY_COMPLETED: 'announcement.delivery_completed',
  DELIVERY_FAILED: 'announcement.delivery_failed',

  TARGETING_UPDATED: 'announcement.targeting_updated',

  EXPORT_REQUESTED: 'announcement.export_requested',
});

const ANNOUNCEMENT_AUDIT_EVENTS =
  ANNOUNCEMENT_AUDIT_EVENT;

// ============================================================================
// Domain Events
// ============================================================================

const ANNOUNCEMENT_EVENT = Object.freeze({
  CREATED: 'announcement.created',
  UPDATED: 'announcement.updated',
  SCHEDULED: 'announcement.scheduled',
  PUBLISHED: 'announcement.published',
  ARCHIVED: 'announcement.archived',
  CANCELLED: 'announcement.cancelled',

  READ: 'announcement.read',
  UNREAD: 'announcement.unread',
  MARK_ALL_READ: 'announcement.mark_all_read',

  ACKNOWLEDGED: 'announcement.acknowledged',
});

// ============================================================================
// Queue Job Names
// ============================================================================

const ANNOUNCEMENT_JOB = Object.freeze({
  PUBLISH_SCHEDULED: 'announcement.publish_scheduled',
  SEND_EMAIL: 'announcement.send_email',
  SEND_PUSH: 'announcement.send_push',
  SEND_SMS: 'announcement.send_sms',
  PROCESS_DELIVERY: 'announcement.process_delivery',
  RETRY_DELIVERY: 'announcement.retry_delivery',
  CLEANUP_EXPIRED: 'announcement.cleanup_expired',
});

// ============================================================================
// Delivery Status
// ============================================================================

const ANNOUNCEMENT_DELIVERY_STATUS = Object.freeze({
  PENDING: 'pending',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
});

const ANNOUNCEMENT_DELIVERY_STATUSES =
  ANNOUNCEMENT_DELIVERY_STATUS;

const ANNOUNCEMENT_DELIVERY_STATUS_VALUES =
  Object.freeze(
    Object.values(ANNOUNCEMENT_DELIVERY_STATUS)
  );

// ============================================================================
// Error Codes
// ============================================================================

const ANNOUNCEMENT_ERROR_CODE = Object.freeze({
  INVALID_ID: 'ANNOUNCEMENT_INVALID_ID',
  NOT_FOUND: 'ANNOUNCEMENT_NOT_FOUND',

  INVALID_STATUS: 'ANNOUNCEMENT_INVALID_STATUS',
  INVALID_CATEGORY: 'ANNOUNCEMENT_INVALID_CATEGORY',
  INVALID_PRIORITY: 'ANNOUNCEMENT_INVALID_PRIORITY',
  INVALID_AUDIENCE: 'ANNOUNCEMENT_INVALID_AUDIENCE',
  INVALID_CHANNEL: 'ANNOUNCEMENT_INVALID_CHANNEL',

  INVALID_DATE_RANGE: 'ANNOUNCEMENT_INVALID_DATE_RANGE',
  INVALID_SCHEDULE: 'ANNOUNCEMENT_INVALID_SCHEDULE',

  ALREADY_PUBLISHED: 'ANNOUNCEMENT_ALREADY_PUBLISHED',
  ALREADY_ARCHIVED: 'ANNOUNCEMENT_ALREADY_ARCHIVED',
  ALREADY_CANCELLED: 'ANNOUNCEMENT_ALREADY_CANCELLED',

  CANNOT_UPDATE_PUBLISHED:
    'ANNOUNCEMENT_CANNOT_UPDATE_PUBLISHED',

  CANNOT_CANCEL_PUBLISHED:
    'ANNOUNCEMENT_CANNOT_CANCEL_PUBLISHED',

  CANNOT_ARCHIVE_DRAFT:
    'ANNOUNCEMENT_CANNOT_ARCHIVE_DRAFT',

  CANNOT_PUBLISH_CANCELLED:
    'ANNOUNCEMENT_CANNOT_PUBLISH_CANCELLED',

  CANNOT_PUBLISH_ARCHIVED:
    'ANNOUNCEMENT_CANNOT_PUBLISH_ARCHIVED',

  TITLE_REQUIRED: 'ANNOUNCEMENT_TITLE_REQUIRED',
  CONTENT_REQUIRED: 'ANNOUNCEMENT_CONTENT_REQUIRED',

  TITLE_TOO_LONG: 'ANNOUNCEMENT_TITLE_TOO_LONG',
  CONTENT_TOO_LONG: 'ANNOUNCEMENT_CONTENT_TOO_LONG',

  INVALID_TARGET: 'ANNOUNCEMENT_INVALID_TARGET',
  TARGET_TOO_LARGE: 'ANNOUNCEMENT_TARGET_TOO_LARGE',

  UNAUTHORIZED: 'ANNOUNCEMENT_UNAUTHORIZED',
  FORBIDDEN: 'ANNOUNCEMENT_FORBIDDEN',

  IDEMPOTENCY_KEY_REQUIRED:
    'ANNOUNCEMENT_IDEMPOTENCY_KEY_REQUIRED',

  IDEMPOTENCY_CONFLICT:
    'ANNOUNCEMENT_IDEMPOTENCY_CONFLICT',

  RATE_LIMITED: 'ANNOUNCEMENT_RATE_LIMITED',

  DELIVERY_FAILED: 'ANNOUNCEMENT_DELIVERY_FAILED',
});

// ============================================================================
// HTTP Status Mapping
// ============================================================================

const ANNOUNCEMENT_HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,

  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,

  INTERNAL_SERVER_ERROR: 500,
});

// ============================================================================
// Rate Limits
// ============================================================================

const ANNOUNCEMENT_RATE_LIMIT = Object.freeze({
  LIST_WINDOW_MS: 60_000,
  LIST_MAX_REQUESTS: 120,

  READ_WINDOW_MS: 60_000,
  READ_MAX_REQUESTS: 180,

  MUTATION_WINDOW_MS: 60_000,
  MUTATION_MAX_REQUESTS: 30,

  BULK_WINDOW_MS: 60_000,
  BULK_MAX_REQUESTS: 10,
});

// ============================================================================
// Cache
// ============================================================================

const ANNOUNCEMENT_CACHE = Object.freeze({
  LIST_TTL_SECONDS: 30,
  DETAIL_TTL_SECONDS: 60,
  UNREAD_COUNT_TTL_SECONDS: 15,

  KEY_PREFIX: 'titech:announcements:',
});

// ============================================================================
// Search
// ============================================================================

const ANNOUNCEMENT_SEARCH = Object.freeze({
  MIN_QUERY_LENGTH: 1,
  MAX_QUERY_LENGTH: 200,

  DEFAULT_OPERATOR: 'and',

  OPERATORS: Object.freeze([
    'and',
    'or',
  ]),
});

// ============================================================================
// Supported Date Filters
// ============================================================================

const ANNOUNCEMENT_DATE_FILTER = Object.freeze({
  CREATED_FROM: 'createdFrom',
  CREATED_TO: 'createdTo',

  PUBLISHED_FROM: 'publishedFrom',
  PUBLISHED_TO: 'publishedTo',

  SCHEDULED_FROM: 'scheduledFrom',
  SCHEDULED_TO: 'scheduledTo',

  UPDATED_FROM: 'updatedFrom',
  UPDATED_TO: 'updatedTo',
});

// ============================================================================
// Lifecycle Transition Matrix
// ============================================================================

/**
 * Explicit state-transition map.
 *
 * This is a declarative contract. Enforcement belongs in the service/domain
 * layer.
 */
const ANNOUNCEMENT_ALLOWED_TRANSITIONS =
  Object.freeze({
    [ANNOUNCEMENT_STATUS.DRAFT]: Object.freeze([
      ANNOUNCEMENT_STATUS.SCHEDULED,
      ANNOUNCEMENT_STATUS.PUBLISHED,
      ANNOUNCEMENT_STATUS.CANCELLED,
    ]),

    [ANNOUNCEMENT_STATUS.SCHEDULED]: Object.freeze([
      ANNOUNCEMENT_STATUS.PUBLISHED,
      ANNOUNCEMENT_STATUS.CANCELLED,
      ANNOUNCEMENT_STATUS.DRAFT,
    ]),

    [ANNOUNCEMENT_STATUS.PUBLISHED]: Object.freeze([
      ANNOUNCEMENT_STATUS.ARCHIVED,
    ]),

    [ANNOUNCEMENT_STATUS.ARCHIVED]: Object.freeze([]),

    [ANNOUNCEMENT_STATUS.CANCELLED]: Object.freeze([]),
  });

/**
 * Check whether a transition is declared valid.
 *
 * This function does not mutate state or perform authorization.
 *
 * @param {string} fromStatus
 * @param {string} toStatus
 * @returns {boolean}
 */
function isValidAnnouncementTransition(
  fromStatus,
  toStatus
) {
  if (
    !ANNOUNCEMENT_STATUS_VALUES.includes(
      fromStatus
    )
  ) {
    return false;
  }

  const allowed =
    ANNOUNCEMENT_ALLOWED_TRANSITIONS[
      fromStatus
    ] || [];

  return allowed.includes(toStatus);
}

// ============================================================================
// Status Predicates
// ============================================================================

function isDraftAnnouncement(status) {
  return status === ANNOUNCEMENT_STATUS.DRAFT;
}

function isScheduledAnnouncement(status) {
  return status === ANNOUNCEMENT_STATUS.SCHEDULED;
}

function isPublishedAnnouncement(status) {
  return status === ANNOUNCEMENT_STATUS.PUBLISHED;
}

function isArchivedAnnouncement(status) {
  return status === ANNOUNCEMENT_STATUS.ARCHIVED;
}

function isCancelledAnnouncement(status) {
  return status === ANNOUNCEMENT_STATUS.CANCELLED;
}

function isTerminalAnnouncementStatus(status) {
  return (
    status === ANNOUNCEMENT_STATUS.ARCHIVED ||
    status === ANNOUNCEMENT_STATUS.CANCELLED
  );
}

// ============================================================================
// Validation Predicates
// ============================================================================

function isValidAnnouncementStatus(value) {
  return ANNOUNCEMENT_STATUS_VALUES.includes(value);
}

function isValidAnnouncementCategory(value) {
  return ANNOUNCEMENT_CATEGORY_VALUES.includes(value);
}

function isValidAnnouncementPriority(value) {
  return ANNOUNCEMENT_PRIORITY_VALUES.includes(value);
}

function isValidAnnouncementAudience(value) {
  return ANNOUNCEMENT_AUDIENCE_VALUES.includes(value);
}

function isValidAnnouncementPublicationMode(value) {
  return ANNOUNCEMENT_PUBLICATION_MODE_VALUES.includes(
    value
  );
}

function isValidAnnouncementChannel(value) {
  return ANNOUNCEMENT_CHANNEL_VALUES.includes(value);
}

function isValidAnnouncementReadState(value) {
  return ANNOUNCEMENT_READ_STATE_VALUES.includes(value);
}

function isValidAnnouncementTargetType(value) {
  return ANNOUNCEMENT_TARGET_TYPE_VALUES.includes(value);
}

function isValidAnnouncementSortField(value) {
  return ANNOUNCEMENT_SORT_FIELD_VALUES.includes(value);
}

function isValidAnnouncementSortDirection(value) {
  return ANNOUNCEMENT_SORT_DIRECTION_VALUES.includes(
    value
  );
}

function isValidAnnouncementDeliveryStatus(value) {
  return ANNOUNCEMENT_DELIVERY_STATUS_VALUES.includes(
    value
  );
}

// ============================================================================
// Default Values
// ============================================================================

const ANNOUNCEMENT_DEFAULTS = Object.freeze({
  STATUS: ANNOUNCEMENT_STATUS.DRAFT,

  CATEGORY: ANNOUNCEMENT_CATEGORY.GENERAL,

  PRIORITY: ANNOUNCEMENT_PRIORITY.NORMAL,

  AUDIENCE: ANNOUNCEMENT_AUDIENCE.AUTHENTICATED_USERS,

  PUBLICATION_MODE:
    ANNOUNCEMENT_PUBLICATION_MODE.IMMEDIATE,

  CHANNEL: ANNOUNCEMENT_CHANNEL.IN_APP,

  READ_STATE: ANNOUNCEMENT_READ_STATE.UNREAD,

  ACKNOWLEDGEMENT:
    ANNOUNCEMENT_ACKNOWLEDGEMENT.NOT_REQUIRED,

  RETENTION_DAYS:
    ANNOUNCEMENT_RETENTION.DEFAULT_RETENTION_DAYS,

  SORT_FIELD:
    ANNOUNCEMENT_DEFAULT_SORT.FIELD,

  SORT_DIRECTION:
    ANNOUNCEMENT_DEFAULT_SORT.DIRECTION,

  PAGE:
    ANNOUNCEMENT_PAGINATION.DEFAULT_PAGE,

  LIMIT:
    ANNOUNCEMENT_PAGINATION.DEFAULT_LIMIT,
});

// ============================================================================
// API Contract
// ============================================================================

const ANNOUNCEMENT_API = Object.freeze({
  VERSION: ANNOUNCEMENT_API_VERSION,

  ENDPOINTS: Object.freeze({
    LIST: '/api/announcements',
    DETAIL: '/api/announcements/:announcementId',

    CREATE: '/api/announcements',
    UPDATE: '/api/announcements/:announcementId',

    PUBLISH:
      '/api/announcements/:announcementId/publish',

    SCHEDULE:
      '/api/announcements/:announcementId/schedule',

    ARCHIVE:
      '/api/announcements/:announcementId/archive',

    CANCEL:
      '/api/announcements/:announcementId/cancel',

    MARK_READ:
      '/api/announcements/:announcementId/read',

    MARK_UNREAD:
      '/api/announcements/:announcementId/unread',

    MARK_ALL_READ:
      '/api/announcements/read-all',

    UNREAD_COUNT:
      '/api/announcements/unread-count',

    AUDIT:
      '/api/announcements/:announcementId/audit',
  }),

  HEADERS: Object.freeze({
    IDEMPOTENCY_KEY:
      ANNOUNCEMENT_IDEMPOTENCY.HEADER_NAME,

    CORRELATION_ID: 'X-Correlation-ID',

    REQUEST_ID: 'X-Request-ID',
  }),
});

// ============================================================================
// Database / Index Recommendations
// ============================================================================

const ANNOUNCEMENT_INDEX_FIELDS = Object.freeze({
  STATUS: 'status',
  TENANT_ID: 'tenantId',
  CATEGORY: 'category',
  PRIORITY: 'priority',
  PUBLISHED_AT: 'publishedAt',
  SCHEDULED_AT: 'scheduledAt',
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
  AUDIENCE: 'audience',
});

/**
 * Recommended compound indexes for high-volume deployments.
 *
 * These are declarations for model/index design. The constants file does not
 * create database indexes itself.
 */
const ANNOUNCEMENT_RECOMMENDED_INDEXES =
  Object.freeze([
    Object.freeze({
      fields: {
        tenantId: 1,
        status: 1,
        publishedAt: -1,
      },
      name: 'announcement_tenant_status_publishedAt',
    }),

    Object.freeze({
      fields: {
        tenantId: 1,
        status: 1,
        scheduledAt: 1,
      },
      name: 'announcement_tenant_status_scheduledAt',
    }),

    Object.freeze({
      fields: {
        tenantId: 1,
        category: 1,
        publishedAt: -1,
      },
      name: 'announcement_tenant_category_publishedAt',
    }),

    Object.freeze({
      fields: {
        tenantId: 1,
        createdAt: -1,
      },
      name: 'announcement_tenant_createdAt',
    }),
  ]);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Freeze an object defensively.
 *
 * @param {object} value
 * @returns {object}
 */
function freeze(value) {
  return Object.freeze(value);
}

/**
 * Return a frozen copy of an array.
 *
 * @param {Array} values
 * @returns {Array}
 */
function freezeArray(values) {
  return Object.freeze([...values]);
}

// ============================================================================
// Export Contract
// ============================================================================

module.exports = Object.freeze({
  // Metadata
  ANNOUNCEMENT_DOMAIN,
  ANNOUNCEMENT_RESOURCE,
  ANNOUNCEMENT_API_VERSION,
  ANNOUNCEMENT_CONSTANTS_VERSION,
  ANNOUNCEMENT_BRAND,

  // Lifecycle
  ANNOUNCEMENT_STATUS,
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_STATUS_VALUES,
  ANNOUNCEMENT_STATUS_LABELS,

  // Categories
  ANNOUNCEMENT_CATEGORY,
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_CATEGORY_VALUES,
  ANNOUNCEMENT_CATEGORY_LABELS,

  // Priority
  ANNOUNCEMENT_PRIORITY,
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_PRIORITY_VALUES,
  ANNOUNCEMENT_PRIORITY_LABELS,
  ANNOUNCEMENT_PRIORITY_RANK,

  // Audience
  ANNOUNCEMENT_AUDIENCE,
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_AUDIENCE_VALUES,
  ANNOUNCEMENT_AUDIENCE_LABELS,

  // Publication
  ANNOUNCEMENT_PUBLICATION_MODE,
  ANNOUNCEMENT_PUBLICATION_MODES,
  ANNOUNCEMENT_PUBLICATION_MODE_VALUES,

  // Channels
  ANNOUNCEMENT_CHANNEL,
  ANNOUNCEMENT_CHANNELS,
  ANNOUNCEMENT_CHANNEL_VALUES,

  // Read state
  ANNOUNCEMENT_READ_STATE,
  ANNOUNCEMENT_READ_STATES,
  ANNOUNCEMENT_READ_STATE_VALUES,

  // Acknowledgement
  ANNOUNCEMENT_ACKNOWLEDGEMENT,
  ANNOUNCEMENT_ACKNOWLEDGEMENT_VALUES,

  // Targeting
  ANNOUNCEMENT_TARGET_TYPE,
  ANNOUNCEMENT_TARGET_TYPES,
  ANNOUNCEMENT_TARGET_TYPE_VALUES,

  // Sorting
  ANNOUNCEMENT_SORT_FIELD,
  ANNOUNCEMENT_SORT_FIELDS,
  ANNOUNCEMENT_SORT_FIELD_VALUES,
  ANNOUNCEMENT_SORT_DIRECTION,
  ANNOUNCEMENT_SORT_DIRECTIONS,
  ANNOUNCEMENT_SORT_DIRECTION_VALUES,
  ANNOUNCEMENT_DEFAULT_SORT,

  // Pagination
  ANNOUNCEMENT_PAGINATION,
  ANNOUNCEMENT_CURSOR_PAGINATION,

  // Limits
  ANNOUNCEMENT_LIMITS,
  ANNOUNCEMENT_QUERY_LIMITS,

  // Scheduling
  ANNOUNCEMENT_SCHEDULING,

  // Retention
  ANNOUNCEMENT_RETENTION,

  // Idempotency
  ANNOUNCEMENT_IDEMPOTENCY,

  // Audit/events/jobs
  ANNOUNCEMENT_AUDIT_EVENT,
  ANNOUNCEMENT_AUDIT_EVENTS,
  ANNOUNCEMENT_EVENT,
  ANNOUNCEMENT_JOB,

  // Delivery
  ANNOUNCEMENT_DELIVERY_STATUS,
  ANNOUNCEMENT_DELIVERY_STATUSES,
  ANNOUNCEMENT_DELIVERY_STATUS_VALUES,

  // Errors
  ANNOUNCEMENT_ERROR_CODE,

  // HTTP
  ANNOUNCEMENT_HTTP_STATUS,

  // Rate limiting
  ANNOUNCEMENT_RATE_LIMIT,

  // Cache
  ANNOUNCEMENT_CACHE,

  // Search
  ANNOUNCEMENT_SEARCH,

  // Date filtering
  ANNOUNCEMENT_DATE_FILTER,

  // Lifecycle rules
  ANNOUNCEMENT_ALLOWED_TRANSITIONS,

  // Defaults
  ANNOUNCEMENT_DEFAULTS,

  // API contract
  ANNOUNCEMENT_API,

  // Database/index metadata
  ANNOUNCEMENT_INDEX_FIELDS,
  ANNOUNCEMENT_RECOMMENDED_INDEXES,

  // Transition helper
  isValidAnnouncementTransition,

  // Status predicates
  isDraftAnnouncement,
  isScheduledAnnouncement,
  isPublishedAnnouncement,
  isArchivedAnnouncement,
  isCancelledAnnouncement,
  isTerminalAnnouncementStatus,

  // Validation predicates
  isValidAnnouncementStatus,
  isValidAnnouncementCategory,
  isValidAnnouncementPriority,
  isValidAnnouncementAudience,
  isValidAnnouncementPublicationMode,
  isValidAnnouncementChannel,
  isValidAnnouncementReadState,
  isValidAnnouncementTargetType,
  isValidAnnouncementSortField,
  isValidAnnouncementSortDirection,
  isValidAnnouncementDeliveryStatus,

  // Utilities
  freeze,
  freezeArray,
});