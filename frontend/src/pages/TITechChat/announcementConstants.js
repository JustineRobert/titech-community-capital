/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise TITechChat Announcement System
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat/announcementConstants.js
 *
 * Version:
 *   4.0.0
 *
 * Purpose:
 *   Centralized, immutable constants, contracts, normalization helpers and
 *   frontend configuration for the TITechChat announcement subsystem.
 *
 * Responsibilities:
 *   - Define announcement types, categories and audiences.
 *   - Define priority, severity and lifecycle states.
 *   - Define supported announcement actions.
 *   - Define filters, sorting and query defaults.
 *   - Define UI, drawer, refresh, retry and cache policies.
 *   - Define storage, event, API and accessibility contracts.
 *   - Normalize malformed or unexpected backend values safely.
 *   - Provide announcement visibility/actionability helpers.
 *   - Provide deterministic priority/status/severity ranking.
 *   - Provide defensive query and announcement normalization.
 *   - Centralize user-facing labels and error messages.
 *   - Prevent duplicated magic strings throughout TITechChat.
 *
 * Design Principles:
 *   - Single source of truth.
 *   - Immutable public configuration.
 *   - Backend/API agnostic.
 *   - Redux-friendly.
 *   - React/Vite compatible.
 *   - SSR-safe where practical.
 *   - Defensive against malformed backend payloads.
 *   - Accessibility-first.
 *   - Offline-aware.
 *   - Multi-tenant aware.
 *   - Financial-platform appropriate.
 *   - No ACFOS terminology.
 *
 * IMPORTANT:
 *   These values are frontend contracts. Any value exchanged with the backend
 *   must remain compatible with the authoritative backend announcement API.
 *
 * Branding:
 *   TITech Community Capital
 *   TITech
 *   TITechChat
 *
 * ============================================================================
 */

'use strict';

/* ============================================================================
 * SYSTEM IDENTITY
 * ========================================================================== */

export const ANNOUNCEMENT_SYSTEM = Object.freeze({
  PRODUCT_NAME: 'TITech Community Capital',
  PRODUCT_SHORT_NAME: 'TITech',
  MODULE_NAME: 'TITechChat',
  FEATURE_NAME: 'Announcements',

  SYSTEM_ID: 'titech-chat-announcements',

  VERSION: '4.0.0',

  API_CONTRACT_VERSION: '1',

  DEFAULT_LANGUAGE: 'en',

  DEFAULT_TIME_ZONE: 'Africa/Kampala',

  STORAGE_NAMESPACE:
    'titech:chat:announcements',

  EVENT_NAMESPACE:
    'titech:announcement',
});

/* ============================================================================
 * ANNOUNCEMENT TYPES
 * ========================================================================== */

export const ANNOUNCEMENT_TYPES = Object.freeze({
  SYSTEM: 'system',
  PLATFORM: 'platform',
  SERVICE: 'service',
  SECURITY: 'security',
  MAINTENANCE: 'maintenance',
  FEATURE: 'feature',
  PRODUCT: 'product',
  FINANCIAL: 'financial',
  SAVINGS: 'savings',
  LOAN: 'loan',
  SUPPORT: 'support',
  COMMUNITY: 'community',
  COMPLIANCE: 'compliance',
  REGULATORY: 'regulatory',
  PROMOTIONAL: 'promotional',
  GENERAL: 'general',
});

/* ============================================================================
 * ANNOUNCEMENT CATEGORIES
 * ========================================================================== */

export const ANNOUNCEMENT_CATEGORIES = Object.freeze({
  IMPORTANT: 'important',
  INFORMATION: 'information',
  UPDATE: 'update',
  ALERT: 'alert',
  NOTICE: 'notice',
  REMINDER: 'reminder',
  OUTAGE: 'outage',
  MAINTENANCE: 'maintenance',
  SECURITY: 'security',
  FEATURE: 'feature',
  FINANCE: 'finance',
  COMMUNITY: 'community',
  GENERAL: 'general',
});

/* ============================================================================
 * PRIORITY
 * ========================================================================== */

export const ANNOUNCEMENT_PRIORITIES = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
  CRITICAL: 'critical',
});

/* ============================================================================
 * SEVERITY
 * ========================================================================== */

export const ANNOUNCEMENT_SEVERITIES = Object.freeze({
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
});

/* ============================================================================
 * PUBLICATION / LIFECYCLE STATUS
 * ========================================================================== */

export const ANNOUNCEMENT_STATUS = Object.freeze({
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
  EXPIRED: 'expired',
  DELETED: 'deleted',
});

/* ============================================================================
 * AUDIENCE SCOPES
 * ========================================================================== */

export const ANNOUNCEMENT_AUDIENCES = Object.freeze({
  ALL_USERS: 'all_users',
  AUTHENTICATED_USERS: 'authenticated_users',
  MEMBERS: 'members',
  ADMINS: 'admins',
  TENANT_ADMINS: 'tenant_admins',
  SUPPORT_STAFF: 'support_staff',
  LOAN_USERS: 'loan_users',
  SAVINGS_USERS: 'savings_users',
  COMMUNITY_USERS: 'community_users',
  SPECIFIC_TENANT: 'specific_tenant',
  SPECIFIC_GROUP: 'specific_group',
  SPECIFIC_USER: 'specific_user',
});

/* ============================================================================
 * ACTION TYPES
 * ========================================================================== */

export const ANNOUNCEMENT_ACTIONS = Object.freeze({
  NONE: 'none',
  VIEW: 'view',
  OPEN: 'open',
  READ: 'read',
  ACKNOWLEDGE: 'acknowledge',
  DISMISS: 'dismiss',
  RETRY: 'retry',
  CONTACT_SUPPORT: 'contact_support',
  VIEW_SAVINGS: 'view_savings',
  VIEW_LOANS: 'view_loans',
  VIEW_TRANSACTIONS: 'view_transactions',
  VIEW_PROFILE: 'view_profile',
  VIEW_DOCUMENT: 'view_document',
  EXTERNAL_LINK: 'external_link',
});

/* ============================================================================
 * FILTER VALUES
 * ========================================================================== */

export const ANNOUNCEMENT_FILTERS = Object.freeze({
  ALL: 'all',
  UNREAD: 'unread',
  READ: 'read',
  IMPORTANT: 'important',
  URGENT: 'urgent',
  SECURITY: 'security',
  SYSTEM: 'system',
  SERVICE: 'service',
  SAVINGS: 'savings',
  LOAN: 'loan',
  SUPPORT: 'support',
  COMMUNITY: 'community',
});

/* ============================================================================
 * SORT OPTIONS
 * ========================================================================== */

export const ANNOUNCEMENT_SORT = Object.freeze({
  NEWEST: 'newest',
  OLDEST: 'oldest',
  PRIORITY: 'priority',
  UNREAD_FIRST: 'unread_first',
});

/* ============================================================================
 * DEFAULT QUERY PARAMETERS
 * ========================================================================== */

export const ANNOUNCEMENT_QUERY_DEFAULTS = Object.freeze({
  PAGE: 1,
  LIMIT: 20,
  MAX_LIMIT: 100,

  FILTER: ANNOUNCEMENT_FILTERS.ALL,
  SORT: ANNOUNCEMENT_SORT.NEWEST,

  STATUS: ANNOUNCEMENT_STATUS.PUBLISHED,

  INCLUDE_READ: true,
  INCLUDE_EXPIRED: false,

  SEARCH: '',

  TYPE: null,
  CATEGORY: null,
  PRIORITY: null,
  SEVERITY: null,
  AUDIENCE: null,

  TENANT_ID: null,
  GROUP_ID: null,
  USER_ID: null,
});

/* ============================================================================
 * UI LIMITS
 * ========================================================================== */

export const ANNOUNCEMENT_UI_LIMITS = Object.freeze({
  DRAWER_PREVIEW_COUNT: 5,

  CENTER_PAGE_SIZE: 20,

  MAX_TITLE_LENGTH: 160,

  MAX_SUMMARY_LENGTH: 300,

  MAX_BODY_LENGTH: 10000,

  MAX_ACTION_LABEL_LENGTH: 100,

  MAX_TAG_LENGTH: 50,

  MAX_VISIBLE_TAGS: 5,

  MAX_ACTIONS: 3,

  MAX_SEARCH_LENGTH: 120,

  MAX_PAGE: 10000,

  TOAST_DURATION_MS: 5000,

  SUCCESS_MESSAGE_DURATION_MS: 2500,

  ERROR_MESSAGE_DURATION_MS: 5000,

  DEBOUNCE_SEARCH_MS: 300,

  AUTO_REFRESH_INTERVAL_MS: 60000,

  REQUEST_TIMEOUT_MS: 15000,

  ANNOUNCEMENT_STALE_AFTER_MS: 120000,
});

/* ============================================================================
 * RESPONSIVE / DRAWER CONFIGURATION
 * ========================================================================== */

export const ANNOUNCEMENT_DRAWER = Object.freeze({
  DEFAULT_WIDTH: 420,

  MOBILE_BREAKPOINT_PX: 768,

  MAX_WIDTH_PX: 520,

  MIN_WIDTH_PX: 320,

  OVERLAY_ENABLED: true,

  CLOSE_ON_OVERLAY_CLICK: true,

  CLOSE_ON_ESCAPE: true,

  TRAP_FOCUS: true,

  RESTORE_FOCUS_ON_CLOSE: true,

  BODY_SCROLL_LOCK: true,

  FOCUS_SELECTOR:
    '[data-announcement-item], button, a, input, [tabindex]:not([tabindex="-1"])',
});

/* ============================================================================
 * REFRESH CONFIGURATION
 * ========================================================================== */

export const ANNOUNCEMENT_REFRESH = Object.freeze({
  ENABLED: true,

  INTERVAL_MS:
    ANNOUNCEMENT_UI_LIMITS.AUTO_REFRESH_INTERVAL_MS,

  REFRESH_ON_WINDOW_FOCUS: true,

  REFRESH_ON_VISIBILITY_CHANGE: true,

  REFRESH_ON_RECONNECT: true,

  MAX_CONSECUTIVE_FAILURES: 3,

  PAUSE_WHEN_HIDDEN: true,

  PAUSE_WHEN_OFFLINE: true,
});

/* ============================================================================
 * RETRY CONFIGURATION
 * ========================================================================== */

export const ANNOUNCEMENT_RETRY = Object.freeze({
  MAX_ATTEMPTS: 3,

  BASE_DELAY_MS: 500,

  MAX_DELAY_MS: 5000,

  BACKOFF_MULTIPLIER: 2,

  JITTER_ENABLED: true,

  RETRYABLE_HTTP_STATUS_CODES: Object.freeze([
    408,
    425,
    429,
    500,
    502,
    503,
    504,
  ]),
});

/* ============================================================================
 * CACHE CONFIGURATION
 * ========================================================================== */

export const ANNOUNCEMENT_CACHE = Object.freeze({
  ENABLED: true,

  TTL_MS: 60000,

  MAX_ITEMS: 500,

  STORAGE_KEY:
    'titech:chat:announcements',

  VERSION: 2,

  INVALIDATE_ON_LOGOUT: true,

  INVALIDATE_ON_TENANT_CHANGE: true,

  PERSIST_READ_STATE: true,

  PERSIST_DISMISSED_STATE: true,

  PERSIST_ACKNOWLEDGEMENT_STATE: true,
});

/* ============================================================================
 * LOCAL STORAGE KEYS
 * ========================================================================== */

export const ANNOUNCEMENT_STORAGE_KEYS = Object.freeze({
  DISMISSED:
    'titech:chat:announcements:dismissed',

  READ:
    'titech:chat:announcements:read',

  ACKNOWLEDGED:
    'titech:chat:announcements:acknowledged',

  PREFERENCES:
    'titech:chat:announcements:preferences',

  LAST_SYNC:
    'titech:chat:announcements:last-sync',

  CACHE:
    'titech:chat:announcements',

  CACHE_VERSION:
    'titech:chat:announcements:cache-version',
});

/* ============================================================================
 * EVENT NAMES
 * ========================================================================== */

export const ANNOUNCEMENT_EVENTS = Object.freeze({
  LOADED:
    'titech:announcement:loaded',

  CREATED:
    'titech:announcement:created',

  UPDATED:
    'titech:announcement:updated',

  PUBLISHED:
    'titech:announcement:published',

  READ:
    'titech:announcement:read',

  UNREAD:
    'titech:announcement:unread',

  DISMISSED:
    'titech:announcement:dismissed',

  UNDISMISSED:
    'titech:announcement:undismissed',

  ACKNOWLEDGED:
    'titech:announcement:acknowledged',

  ARCHIVED:
    'titech:announcement:archived',

  EXPIRED:
    'titech:announcement:expired',

  FAILED:
    'titech:announcement:failed',

  REFRESHED:
    'titech:announcement:refreshed',

  RETRY:
    'titech:announcement:retry',

  OPENED:
    'titech:announcement:opened',

  CLOSED:
    'titech:announcement:closed',

  ACTION_EXECUTED:
    'titech:announcement:action-executed',
});

/* ============================================================================
 * API CONTRACT VALUES
 * ========================================================================== */

export const ANNOUNCEMENT_API = Object.freeze({
  DEFAULT_TIMEOUT_MS:
    ANNOUNCEMENT_UI_LIMITS.REQUEST_TIMEOUT_MS,

  DEFAULT_PAGE:
    ANNOUNCEMENT_QUERY_DEFAULTS.PAGE,

  DEFAULT_LIMIT:
    ANNOUNCEMENT_QUERY_DEFAULTS.LIMIT,

  MAX_LIMIT:
    ANNOUNCEMENT_QUERY_DEFAULTS.MAX_LIMIT,

  IDEMPOTENCY_HEADER:
    'Idempotency-Key',

  REQUEST_ID_HEADER:
    'X-Request-ID',

  TENANT_ID_HEADER:
    'X-Tenant-ID',

  CLIENT_VERSION_HEADER:
    'X-TITech-Client-Version',

  CLIENT_MODULE_HEADER:
    'X-TITech-Client-Module',

  CONTRACT_VERSION_HEADER:
    'X-TITech-Announcement-Contract',

  ACCEPT_HEADER:
    'application/json',

  CONTENT_TYPE_HEADER:
    'Content-Type',

  JSON_CONTENT_TYPE:
    'application/json',

  DEFAULT_RETRY_AFTER_MS: 1000,
});

/* ============================================================================
 * ACCESSIBILITY
 * ========================================================================== */

export const ANNOUNCEMENT_ACCESSIBILITY = Object.freeze({
  LIVE_REGION_POLITENESS: 'polite',

  ASSERTIVE_LIVE_REGION_POLITENESS:
    'assertive',

  DRAWER_ROLE: 'dialog',

  CENTER_ROLE: 'main',

  LIST_ROLE: 'list',

  ITEM_ROLE: 'listitem',

  CLOSE_BUTTON_LABEL:
    'Close announcements',

  OPEN_BUTTON_LABEL:
    'Open announcements',

  MARK_READ_LABEL:
    'Mark announcement as read',

  MARK_UNREAD_LABEL:
    'Mark announcement as unread',

  DISMISS_LABEL:
    'Dismiss announcement',

  ACKNOWLEDGE_LABEL:
    'Acknowledge announcement',

  RETRY_LABEL:
    'Retry loading announcements',

  REFRESH_LABEL:
    'Refresh announcements',

  LOAD_MORE_LABEL:
    'Load more announcements',

  SEARCH_LABEL:
    'Search announcements',

  CLEAR_SEARCH_LABEL:
    'Clear announcement search',

  LOADING_MESSAGE:
    'Loading announcements.',

  EMPTY_MESSAGE:
    'There are no announcements to display.',

  ERROR_MESSAGE:
    'Unable to load announcements.',

  NEW_ANNOUNCEMENT_MESSAGE:
    'New announcement available.',

  MARKED_READ_MESSAGE:
    'Announcement marked as read.',

  MARKED_UNREAD_MESSAGE:
    'Announcement marked as unread.',

  DISMISSED_MESSAGE:
    'Announcement dismissed.',

  ACKNOWLEDGED_MESSAGE:
    'Announcement acknowledged.',

  FOCUS_FIRST_ITEM_ON_OPEN: true,

  FOCUS_DRAWER_ON_OPEN: true,

  RESTORE_FOCUS_ON_CLOSE: true,

  RESPECT_REDUCED_MOTION: true,
});

/* ============================================================================
 * DISPLAY LABELS
 * ========================================================================== */

export const ANNOUNCEMENT_LABELS = Object.freeze({
  TITLE: 'Announcements',

  SUBTITLE:
    'Important updates and information from TITech Community Capital.',

  ALL: 'All',

  UNREAD: 'Unread',

  READ: 'Read',

  IMPORTANT: 'Important',

  URGENT: 'Urgent',

  SECURITY: 'Security',

  SYSTEM: 'System',

  SERVICE: 'Service',

  SAVINGS: 'Savings',

  LOANS: 'Loans',

  SUPPORT: 'Support',

  COMMUNITY: 'Community',

  VIEW_ALL: 'View all announcements',

  MARK_ALL_READ: 'Mark all as read',

  MARK_READ: 'Mark as read',

  MARK_UNREAD: 'Mark as unread',

  DISMISS: 'Dismiss',

  ACKNOWLEDGE: 'Acknowledge',

  CLOSE: 'Close',

  RETRY: 'Retry',

  LOAD_MORE: 'Load more',

  REFRESH: 'Refresh',

  SEARCH: 'Search announcements',

  CLEAR_SEARCH: 'Clear search',

  NO_RESULTS:
    'No announcements match your search.',

  NO_UNREAD:
    'You have no unread announcements.',

  LAST_UPDATED: 'Last updated',

  PUBLISHED: 'Published',

  EFFECTIVE: 'Effective',

  EXPIRES: 'Expires',

  PRIORITY: 'Priority',

  TYPE: 'Type',

  CATEGORY: 'Category',

  SEVERITY: 'Severity',

  AUDIENCE: 'Audience',

  REQUIRED_ACTION: 'Action required',

  PINNED: 'Pinned',

  ACKNOWLEDGED: 'Acknowledged',

  READ: 'Read',

  UNREAD: 'Unread',
});

/* ============================================================================
 * TYPE LABEL MAP
 * ========================================================================== */

export const ANNOUNCEMENT_TYPE_LABELS = Object.freeze({
  [ANNOUNCEMENT_TYPES.SYSTEM]:
    'System',

  [ANNOUNCEMENT_TYPES.PLATFORM]:
    'Platform',

  [ANNOUNCEMENT_TYPES.SERVICE]:
    'Service',

  [ANNOUNCEMENT_TYPES.SECURITY]:
    'Security',

  [ANNOUNCEMENT_TYPES.MAINTENANCE]:
    'Maintenance',

  [ANNOUNCEMENT_TYPES.FEATURE]:
    'Feature',

  [ANNOUNCEMENT_TYPES.PRODUCT]:
    'Product',

  [ANNOUNCEMENT_TYPES.FINANCIAL]:
    'Financial',

  [ANNOUNCEMENT_TYPES.SAVINGS]:
    'Savings',

  [ANNOUNCEMENT_TYPES.LOAN]:
    'Loans',

  [ANNOUNCEMENT_TYPES.SUPPORT]:
    'Support',

  [ANNOUNCEMENT_TYPES.COMMUNITY]:
    'Community',

  [ANNOUNCEMENT_TYPES.COMPLIANCE]:
    'Compliance',

  [ANNOUNCEMENT_TYPES.REGULATORY]:
    'Regulatory',

  [ANNOUNCEMENT_TYPES.PROMOTIONAL]:
    'Promotional',

  [ANNOUNCEMENT_TYPES.GENERAL]:
    'General',
});

/* ============================================================================
 * CATEGORY LABEL MAP
 * ========================================================================== */

export const ANNOUNCEMENT_CATEGORY_LABELS = Object.freeze({
  [ANNOUNCEMENT_CATEGORIES.IMPORTANT]:
    'Important',

  [ANNOUNCEMENT_CATEGORIES.INFORMATION]:
    'Information',

  [ANNOUNCEMENT_CATEGORIES.UPDATE]:
    'Update',

  [ANNOUNCEMENT_CATEGORIES.ALERT]:
    'Alert',

  [ANNOUNCEMENT_CATEGORIES.NOTICE]:
    'Notice',

  [ANNOUNCEMENT_CATEGORIES.REMINDER]:
    'Reminder',

  [ANNOUNCEMENT_CATEGORIES.OUTAGE]:
    'Outage',

  [ANNOUNCEMENT_CATEGORIES.MAINTENANCE]:
    'Maintenance',

  [ANNOUNCEMENT_CATEGORIES.SECURITY]:
    'Security',

  [ANNOUNCEMENT_CATEGORIES.FEATURE]:
    'Feature',

  [ANNOUNCEMENT_CATEGORIES.FINANCE]:
    'Finance',

  [ANNOUNCEMENT_CATEGORIES.COMMUNITY]:
    'Community',

  [ANNOUNCEMENT_CATEGORIES.GENERAL]:
    'General',
});

/* ============================================================================
 * PRIORITY LABEL MAP
 * ========================================================================== */

export const ANNOUNCEMENT_PRIORITY_LABELS = Object.freeze({
  [ANNOUNCEMENT_PRIORITIES.LOW]:
    'Low',

  [ANNOUNCEMENT_PRIORITIES.NORMAL]:
    'Normal',

  [ANNOUNCEMENT_PRIORITIES.HIGH]:
    'High',

  [ANNOUNCEMENT_PRIORITIES.URGENT]:
    'Urgent',

  [ANNOUNCEMENT_PRIORITIES.CRITICAL]:
    'Critical',
});

/* ============================================================================
 * STATUS LABEL MAP
 * ========================================================================== */

export const ANNOUNCEMENT_STATUS_LABELS = Object.freeze({
  [ANNOUNCEMENT_STATUS.DRAFT]:
    'Draft',

  [ANNOUNCEMENT_STATUS.SCHEDULED]:
    'Scheduled',

  [ANNOUNCEMENT_STATUS.PUBLISHED]:
    'Published',

  [ANNOUNCEMENT_STATUS.ARCHIVED]:
    'Archived',

  [ANNOUNCEMENT_STATUS.EXPIRED]:
    'Expired',

  [ANNOUNCEMENT_STATUS.DELETED]:
    'Deleted',
});

/* ============================================================================
 * SEVERITY LABEL MAP
 * ========================================================================== */

export const ANNOUNCEMENT_SEVERITY_LABELS = Object.freeze({
  [ANNOUNCEMENT_SEVERITIES.INFO]:
    'Information',

  [ANNOUNCEMENT_SEVERITIES.SUCCESS]:
    'Success',

  [ANNOUNCEMENT_SEVERITIES.WARNING]:
    'Warning',

  [ANNOUNCEMENT_SEVERITIES.ERROR]:
    'Error',

  [ANNOUNCEMENT_SEVERITIES.CRITICAL]:
    'Critical',
});

/* ============================================================================
 * AUDIENCE LABEL MAP
 * ========================================================================== */

export const ANNOUNCEMENT_AUDIENCE_LABELS = Object.freeze({
  [ANNOUNCEMENT_AUDIENCES.ALL_USERS]:
    'All users',

  [ANNOUNCEMENT_AUDIENCES.AUTHENTICATED_USERS]:
    'Authenticated users',

  [ANNOUNCEMENT_AUDIENCES.MEMBERS]:
    'Members',

  [ANNOUNCEMENT_AUDIENCES.ADMINS]:
    'Administrators',

  [ANNOUNCEMENT_AUDIENCES.TENANT_ADMINS]:
    'Tenant administrators',

  [ANNOUNCEMENT_AUDIENCES.SUPPORT_STAFF]:
    'Support staff',

  [ANNOUNCEMENT_AUDIENCES.LOAN_USERS]:
    'Loan users',

  [ANNOUNCEMENT_AUDIENCES.SAVINGS_USERS]:
    'Savings users',

  [ANNOUNCEMENT_AUDIENCES.COMMUNITY_USERS]:
    'Community users',

  [ANNOUNCEMENT_AUDIENCES.SPECIFIC_TENANT]:
    'Specific tenant',

  [ANNOUNCEMENT_AUDIENCES.SPECIFIC_GROUP]:
    'Specific group',

  [ANNOUNCEMENT_AUDIENCES.SPECIFIC_USER]:
    'Specific user',
});

/* ============================================================================
 * ACTION LABEL MAP
 * ========================================================================== */

export const ANNOUNCEMENT_ACTION_LABELS = Object.freeze({
  [ANNOUNCEMENT_ACTIONS.NONE]:
    'No action',

  [ANNOUNCEMENT_ACTIONS.VIEW]:
    'View',

  [ANNOUNCEMENT_ACTIONS.OPEN]:
    'Open',

  [ANNOUNCEMENT_ACTIONS.READ]:
    'Read',

  [ANNOUNCEMENT_ACTIONS.ACKNOWLEDGE]:
    'Acknowledge',

  [ANNOUNCEMENT_ACTIONS.DISMISS]:
    'Dismiss',

  [ANNOUNCEMENT_ACTIONS.RETRY]:
    'Retry',

  [ANNOUNCEMENT_ACTIONS.CONTACT_SUPPORT]:
    'Contact support',

  [ANNOUNCEMENT_ACTIONS.VIEW_SAVINGS]:
    'View savings',

  [ANNOUNCEMENT_ACTIONS.VIEW_LOANS]:
    'View loans',

  [ANNOUNCEMENT_ACTIONS.VIEW_TRANSACTIONS]:
    'View transactions',

  [ANNOUNCEMENT_ACTIONS.VIEW_PROFILE]:
    'View profile',

  [ANNOUNCEMENT_ACTIONS.VIEW_DOCUMENT]:
    'View document',

  [ANNOUNCEMENT_ACTIONS.EXTERNAL_LINK]:
    'Open external link',
});

/* ============================================================================
 * FILTER LABEL MAP
 * ========================================================================== */

export const ANNOUNCEMENT_FILTER_LABELS = Object.freeze({
  [ANNOUNCEMENT_FILTERS.ALL]:
    'All',

  [ANNOUNCEMENT_FILTERS.UNREAD]:
    'Unread',

  [ANNOUNCEMENT_FILTERS.READ]:
    'Read',

  [ANNOUNCEMENT_FILTERS.IMPORTANT]:
    'Important',

  [ANNOUNCEMENT_FILTERS.URGENT]:
    'Urgent',

  [ANNOUNCEMENT_FILTERS.SECURITY]:
    'Security',

  [ANNOUNCEMENT_FILTERS.SYSTEM]:
    'System',

  [ANNOUNCEMENT_FILTERS.SERVICE]:
    'Service',

  [ANNOUNCEMENT_FILTERS.SAVINGS]:
    'Savings',

  [ANNOUNCEMENT_FILTERS.LOAN]:
    'Loans',

  [ANNOUNCEMENT_FILTERS.SUPPORT]:
    'Support',

  [ANNOUNCEMENT_FILTERS.COMMUNITY]:
    'Community',
});

/* ============================================================================
 * SORT LABEL MAP
 * ========================================================================== */

export const ANNOUNCEMENT_SORT_LABELS = Object.freeze({
  [ANNOUNCEMENT_SORT.NEWEST]:
    'Newest first',

  [ANNOUNCEMENT_SORT.OLDEST]:
    'Oldest first',

  [ANNOUNCEMENT_SORT.PRIORITY]:
    'Priority',

  [ANNOUNCEMENT_SORT.UNREAD_FIRST]:
    'Unread first',
});

/* ============================================================================
 * DEFAULT ANNOUNCEMENT MODEL
 * ========================================================================== */

export const DEFAULT_ANNOUNCEMENT = Object.freeze({
  id: null,

  title: '',

  summary: '',

  body: '',

  type: ANNOUNCEMENT_TYPES.GENERAL,

  category:
    ANNOUNCEMENT_CATEGORIES.INFORMATION,

  priority:
    ANNOUNCEMENT_PRIORITIES.NORMAL,

  severity:
    ANNOUNCEMENT_SEVERITIES.INFO,

  status:
    ANNOUNCEMENT_STATUS.PUBLISHED,

  audience:
    ANNOUNCEMENT_AUDIENCES.AUTHENTICATED_USERS,

  isRead: false,

  isDismissed: false,

  isAcknowledged: false,

  isPinned: false,

  requiresAcknowledgement: false,

  action: ANNOUNCEMENT_ACTIONS.NONE,

  actionLabel: '',

  actionUrl: null,

  imageUrl: null,

  icon: null,

  tags: [],

  metadata: {},

  tenantId: null,

  groupId: null,

  createdAt: null,

  updatedAt: null,

  publishedAt: null,

  expiresAt: null,
});

/* ============================================================================
 * ENUM HELPERS
 * ========================================================================== */

/**
 * Returns a normalized lowercase string.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAnnouncementValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(value)
    .trim()
    .toLowerCase();
}

/**
 * Resolves a value against an allowed constant collection.
 *
 * @param {unknown} value
 * @param {object} collection
 * @param {string} fallback
 * @returns {string}
 */
export function resolveAnnouncementEnum(
  value,
  collection,
  fallback,
) {
  const normalized =
    normalizeAnnouncementValue(value);

  const allowedValues =
    Object.values(collection);

  return allowedValues.includes(
    normalized,
  )
    ? normalized
    : fallback;
}

/* ============================================================================
 * NORMALIZATION HELPERS
 * ========================================================================== */

/**
 * Safely normalizes an announcement identifier.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeAnnouncementId(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  return normalized || null;
}

/**
 * Safely normalizes arbitrary announcement text.
 *
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
export function normalizeAnnouncementText(
  value,
  fallback = '',
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const normalized =
    String(value).trim();

  return normalized || fallback;
}

/**
 * Normalizes announcement priority.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAnnouncementPriority(
  value,
) {
  return resolveAnnouncementEnum(
    value,
    ANNOUNCEMENT_PRIORITIES,
    ANNOUNCEMENT_PRIORITIES.NORMAL,
  );
}

/**
 * Normalizes announcement severity.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAnnouncementSeverity(
  value,
) {
  return resolveAnnouncementEnum(
    value,
    ANNOUNCEMENT_SEVERITIES,
    ANNOUNCEMENT_SEVERITIES.INFO,
  );
}

/**
 * Normalizes announcement status.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAnnouncementStatus(
  value,
) {
  return resolveAnnouncementEnum(
    value,
    ANNOUNCEMENT_STATUS,
    ANNOUNCEMENT_STATUS.PUBLISHED,
  );
}

/**
 * Normalizes announcement type.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAnnouncementType(
  value,
) {
  return resolveAnnouncementEnum(
    value,
    ANNOUNCEMENT_TYPES,
    ANNOUNCEMENT_TYPES.GENERAL,
  );
}

/**
 * Normalizes announcement category.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAnnouncementCategory(
  value,
) {
  return resolveAnnouncementEnum(
    value,
    ANNOUNCEMENT_CATEGORIES,
    ANNOUNCEMENT_CATEGORIES.GENERAL,
  );
}

/**
 * Normalizes announcement audience.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAnnouncementAudience(
  value,
) {
  return resolveAnnouncementEnum(
    value,
    ANNOUNCEMENT_AUDIENCES,
    ANNOUNCEMENT_AUDIENCES.AUTHENTICATED_USERS,
  );
}

/**
 * Normalizes announcement action.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAnnouncementAction(
  value,
) {
  return resolveAnnouncementEnum(
    value,
    ANNOUNCEMENT_ACTIONS,
    ANNOUNCEMENT_ACTIONS.NONE,
  );
}

/**
 * Normalizes announcement filter.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAnnouncementFilter(
  value,
) {
  return resolveAnnouncementEnum(
    value,
    ANNOUNCEMENT_FILTERS,
    ANNOUNCEMENT_FILTERS.ALL,
  );
}

/**
 * Normalizes announcement sort order.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAnnouncementSort(
  value,
) {
  return resolveAnnouncementEnum(
    value,
    ANNOUNCEMENT_SORT,
    ANNOUNCEMENT_SORT.NEWEST,
  );
}

/* ============================================================================
 * ARRAY / OBJECT HELPERS
 * ========================================================================== */

/**
 * Safely normalizes a tag array.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeAnnouncementTags(
  value,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((tag) =>
          normalizeAnnouncementText(
            tag,
          ),
        )
        .filter(Boolean)
        .slice(
          0,
          ANNOUNCEMENT_UI_LIMITS.MAX_VISIBLE_TAGS,
        ),
    ),
  );
}

/**
 * Safely normalizes metadata.
 *
 * @param {unknown} value
 * @returns {object}
 */
export function normalizeAnnouncementMetadata(
  value,
) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return {};
  }

  return {
    ...value,
  };
}

/* ============================================================================
 * DATE HELPERS
 * ========================================================================== */

/**
 * Converts a potentially malformed date into a valid timestamp.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizeAnnouncementTimestamp(
  value,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const timestamp =
    new Date(value).getTime();

  return Number.isFinite(timestamp)
    ? timestamp
    : null;
}

/**
 * Determines whether a supplied date value is valid.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidAnnouncementDate(
  value,
) {
  return (
    normalizeAnnouncementTimestamp(
      value,
    ) !== null
  );
}

/**
 * Determines whether an announcement has expired.
 *
 * @param {object|null|undefined} announcement
 * @param {number} now
 * @returns {boolean}
 */
export function isAnnouncementExpired(
  announcement,
  now = Date.now(),
) {
  if (!announcement?.expiresAt) {
    return false;
  }

  const expiry =
    normalizeAnnouncementTimestamp(
      announcement.expiresAt,
    );

  if (expiry === null) {
    return false;
  }

  return expiry <= now;
}

/**
 * Determines whether an announcement is currently published.
 *
 * @param {object|null|undefined} announcement
 * @param {number} now
 * @returns {boolean}
 */
export function isAnnouncementPublished(
  announcement,
  now = Date.now(),
) {
  if (!announcement) {
    return false;
  }

  if (
    announcement.status !==
    ANNOUNCEMENT_STATUS.PUBLISHED
  ) {
    return false;
  }

  if (announcement.publishedAt) {
    const publishedAt =
      normalizeAnnouncementTimestamp(
        announcement.publishedAt,
      );

    if (
      publishedAt !== null &&
      publishedAt > now
    ) {
      return false;
    }
  }

  return !isAnnouncementExpired(
    announcement,
    now,
  );
}

/**
 * Determines whether an announcement is scheduled.
 *
 * @param {object|null|undefined} announcement
 * @param {number} now
 * @returns {boolean}
 */
export function isAnnouncementScheduled(
  announcement,
  now = Date.now(),
) {
  if (!announcement) {
    return false;
  }

  if (
    announcement.status !==
    ANNOUNCEMENT_STATUS.SCHEDULED
  ) {
    return false;
  }

  const publishedAt =
    normalizeAnnouncementTimestamp(
      announcement.publishedAt,
    );

  return (
    publishedAt !== null &&
    publishedAt > now
  );
}

/* ============================================================================
 * ANNOUNCEMENT NORMALIZATION
 * ========================================================================== */

/**
 * Normalizes an arbitrary backend announcement payload into the frontend
 * announcement contract.
 *
 * @param {unknown} input
 * @returns {object}
 */
export function normalizeAnnouncement(
  input,
) {
  const source =
    input &&
    typeof input === 'object' &&
    !Array.isArray(input)
      ? input
      : {};

  const normalized =
    Object.freeze({
      ...DEFAULT_ANNOUNCEMENT,

      ...source,

      id: normalizeAnnouncementId(
        source.id ??
          source._id ??
          source.announcementId,
      ),

      title:
        normalizeAnnouncementText(
          source.title,
        ),

      summary:
        normalizeAnnouncementText(
          source.summary,
        ),

      body:
        normalizeAnnouncementText(
          source.body,
        ),

      type:
        normalizeAnnouncementType(
          source.type,
        ),

      category:
        normalizeAnnouncementCategory(
          source.category,
        ),

      priority:
        normalizeAnnouncementPriority(
          source.priority,
        ),

      severity:
        normalizeAnnouncementSeverity(
          source.severity,
        ),

      status:
        normalizeAnnouncementStatus(
          source.status,
        ),

      audience:
        normalizeAnnouncementAudience(
          source.audience,
        ),

      isRead:
        Boolean(source.isRead),

      isDismissed:
        Boolean(source.isDismissed),

      isAcknowledged:
        Boolean(source.isAcknowledged),

      isPinned:
        Boolean(source.isPinned),

      requiresAcknowledgement:
        Boolean(
          source.requiresAcknowledgement,
        ),

      action:
        normalizeAnnouncementAction(
          source.action,
        ),

      actionLabel:
        normalizeAnnouncementText(
          source.actionLabel,
        ),

      actionUrl:
        normalizeAnnouncementText(
          source.actionUrl,
          '',
        ) || null,

      imageUrl:
        normalizeAnnouncementText(
          source.imageUrl,
          '',
        ) || null,

      icon:
        normalizeAnnouncementText(
          source.icon,
          '',
        ) || null,

      tags:
        normalizeAnnouncementTags(
          source.tags,
        ),

      metadata:
        normalizeAnnouncementMetadata(
          source.metadata,
        ),

      tenantId:
        normalizeAnnouncementId(
          source.tenantId,
        ),

      groupId:
        normalizeAnnouncementId(
          source.groupId,
        ),

      createdAt:
        source.createdAt ?? null,

      updatedAt:
        source.updatedAt ?? null,

      publishedAt:
        source.publishedAt ?? null,

      expiresAt:
        source.expiresAt ?? null,
    });

  return normalized;
}

/* ============================================================================
 * VALIDATION HELPERS
 * ========================================================================== */

/**
 * Determines whether a value is a supported announcement type.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidAnnouncementType(
  value,
) {
  return Object.values(
    ANNOUNCEMENT_TYPES,
  ).includes(
    normalizeAnnouncementValue(value),
  );
}

/**
 * Determines whether a value is a supported announcement category.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidAnnouncementCategory(
  value,
) {
  return Object.values(
    ANNOUNCEMENT_CATEGORIES,
  ).includes(
    normalizeAnnouncementValue(value),
  );
}

/**
 * Determines whether a value is a supported priority.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidAnnouncementPriority(
  value,
) {
  return Object.values(
    ANNOUNCEMENT_PRIORITIES,
  ).includes(
    normalizeAnnouncementValue(value),
  );
}

/**
 * Determines whether a value is a supported severity.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidAnnouncementSeverity(
  value,
) {
  return Object.values(
    ANNOUNCEMENT_SEVERITIES,
  ).includes(
    normalizeAnnouncementValue(value),
  );
}

/**
 * Determines whether a value is a supported status.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidAnnouncementStatus(
  value,
) {
  return Object.values(
    ANNOUNCEMENT_STATUS,
  ).includes(
    normalizeAnnouncementValue(value),
  );
}

/**
 * Determines whether an announcement has a usable identifier.
 *
 * @param {object|null|undefined} announcement
 * @returns {boolean}
 */
export function hasAnnouncementId(
  announcement,
) {
  return Boolean(
    normalizeAnnouncementId(
      announcement?.id,
    ),
  );
}

/* ============================================================================
 * ACTIONABILITY / STATE HELPERS
 * ========================================================================== */

/**
 * Determines whether an announcement should be considered actionable.
 *
 * @param {object|null|undefined} announcement
 * @returns {boolean}
 */
export function isAnnouncementActionable(
  announcement,
) {
  if (!announcement) {
    return false;
  }

  return (
    normalizeAnnouncementAction(
      announcement.action,
    ) !== ANNOUNCEMENT_ACTIONS.NONE
  );
}

/**
 * Determines whether an announcement is high priority.
 *
 * @param {object|null|undefined} announcement
 * @returns {boolean}
 */
export function isHighPriorityAnnouncement(
  announcement,
) {
  if (!announcement) {
    return false;
  }

  return (
    getAnnouncementPriorityRank(
      announcement.priority,
    ) >=
    ANNOUNCEMENT_PRIORITY_RANK[
      ANNOUNCEMENT_PRIORITIES.HIGH
    ]
  );
}

/**
 * Determines whether an announcement is urgent or critical.
 *
 * @param {object|null|undefined} announcement
 * @returns {boolean}
 */
export function isUrgentAnnouncement(
  announcement,
) {
  if (!announcement) {
    return false;
  }

  return [
    ANNOUNCEMENT_PRIORITIES.URGENT,
    ANNOUNCEMENT_PRIORITIES.CRITICAL,
  ].includes(
    normalizeAnnouncementPriority(
      announcement.priority,
    ),
  );
}

/**
 * Determines whether an announcement requires acknowledgement.
 *
 * @param {object|null|undefined} announcement
 * @returns {boolean}
 */
export function requiresAnnouncementAcknowledgement(
  announcement,
) {
  return Boolean(
    announcement?.requiresAcknowledgement,
  );
}

/**
 * Determines whether an announcement is unread.
 *
 * @param {object|null|undefined} announcement
 * @returns {boolean}
 */
export function isAnnouncementUnread(
  announcement,
) {
  return Boolean(
    announcement &&
      !announcement.isRead,
  );
}

/**
 * Determines whether an announcement is dismissible.
 *
 * @param {object|null|undefined} announcement
 * @returns {boolean}
 */
export function isAnnouncementDismissible(
  announcement,
) {
  if (!announcement) {
    return false;
  }

  return !Boolean(
    announcement.isAcknowledged &&
      announcement.requiresAcknowledgement,
  );
}

/* ============================================================================
 * RANKING HELPERS
 * ========================================================================== */

export const ANNOUNCEMENT_PRIORITY_RANK = Object.freeze({
  [ANNOUNCEMENT_PRIORITIES.LOW]: 1,

  [ANNOUNCEMENT_PRIORITIES.NORMAL]: 2,

  [ANNOUNCEMENT_PRIORITIES.HIGH]: 3,

  [ANNOUNCEMENT_PRIORITIES.URGENT]: 4,

  [ANNOUNCEMENT_PRIORITIES.CRITICAL]: 5,
});

export const ANNOUNCEMENT_SEVERITY_RANK = Object.freeze({
  [ANNOUNCEMENT_SEVERITIES.INFO]: 1,

  [ANNOUNCEMENT_SEVERITIES.SUCCESS]: 2,

  [ANNOUNCEMENT_SEVERITIES.WARNING]: 3,

  [ANNOUNCEMENT_SEVERITIES.ERROR]: 4,

  [ANNOUNCEMENT_SEVERITIES.CRITICAL]: 5,
});

/**
 * Gets a deterministic priority rank.
 *
 * @param {unknown} priority
 * @returns {number}
 */
export function getAnnouncementPriorityRank(
  priority,
) {
  const normalized =
    normalizeAnnouncementPriority(
      priority,
    );

  return (
    ANNOUNCEMENT_PRIORITY_RANK[
      normalized
    ] ?? 0
  );
}

/**
 * Gets a deterministic severity rank.
 *
 * @param {unknown} severity
 * @returns {number}
 */
export function getAnnouncementSeverityRank(
  severity,
) {
  const normalized =
    normalizeAnnouncementSeverity(
      severity,
    );

  return (
    ANNOUNCEMENT_SEVERITY_RANK[
      normalized
    ] ?? 0
  );
}

/* ============================================================================
 * VISIBILITY HELPERS
 * ========================================================================== */

/**
 * Determines whether an announcement should be visible in the normal
 * end-user announcement experience.
 *
 * @param {object|null|undefined} announcement
 * @param {number} now
 * @returns {boolean}
 */
export function isAnnouncementVisible(
  announcement,
  now = Date.now(),
) {
  if (!announcement) {
    return false;
  }

  if (
    announcement.status !==
    ANNOUNCEMENT_STATUS.PUBLISHED
  ) {
    return false;
  }

  if (
    announcement.isDismissed === true
  ) {
    return false;
  }

  return isAnnouncementPublished(
    announcement,
    now,
  );
}

/* ============================================================================
 * QUERY HELPERS
 * ========================================================================== */

/**
 * Safely normalizes a positive integer.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
export function normalizeAnnouncementInteger(
  value,
  fallback,
  minimum = 1,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const numeric =
    Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const integer =
    Math.floor(numeric);

  if (integer < minimum) {
    return fallback;
  }

  return Math.min(
    integer,
    maximum,
  );
}

/**
 * Creates a safe announcement query object.
 *
 * @param {object} overrides
 * @returns {object}
 */
export function createAnnouncementQuery(
  overrides = {},
) {
  const input =
    overrides &&
    typeof overrides === 'object' &&
    !Array.isArray(overrides)
      ? overrides
      : {};

  const page =
    normalizeAnnouncementInteger(
      input.page,
      ANNOUNCEMENT_QUERY_DEFAULTS.PAGE,
      1,
      ANNOUNCEMENT_UI_LIMITS.MAX_PAGE,
    );

  const limit =
    normalizeAnnouncementInteger(
      input.limit,
      ANNOUNCEMENT_QUERY_DEFAULTS.LIMIT,
      1,
      ANNOUNCEMENT_QUERY_DEFAULTS.MAX_LIMIT,
    );

  const search =
    typeof input.search === 'string'
      ? input.search
          .trim()
          .slice(
            0,
            ANNOUNCEMENT_UI_LIMITS
              .MAX_SEARCH_LENGTH,
          )
      : ANNOUNCEMENT_QUERY_DEFAULTS.SEARCH;

  return Object.freeze({
    ...ANNOUNCEMENT_QUERY_DEFAULTS,

    ...input,

    page,

    limit,

    filter:
      normalizeAnnouncementFilter(
        input.filter,
      ),

    sort:
      normalizeAnnouncementSort(
        input.sort,
      ),

    status:
      normalizeAnnouncementStatus(
        input.status,
      ),

    type:
      input.type === null ||
      input.type === undefined ||
      input.type === ''
        ? null
        : normalizeAnnouncementType(
            input.type,
          ),

    category:
      input.category === null ||
      input.category === undefined ||
      input.category === ''
        ? null
        : normalizeAnnouncementCategory(
            input.category,
          ),

    priority:
      input.priority === null ||
      input.priority === undefined ||
      input.priority === ''
        ? null
        : normalizeAnnouncementPriority(
            input.priority,
          ),

    severity:
      input.severity === null ||
      input.severity === undefined ||
      input.severity === ''
        ? null
        : normalizeAnnouncementSeverity(
            input.severity,
          ),

    audience:
      input.audience === null ||
      input.audience === undefined ||
      input.audience === ''
        ? null
        : normalizeAnnouncementAudience(
            input.audience,
          ),

    search,

    includeRead:
      Boolean(
        input.includeRead ??
          ANNOUNCEMENT_QUERY_DEFAULTS
            .INCLUDE_READ,
      ),

    includeExpired:
      Boolean(
        input.includeExpired ??
          ANNOUNCEMENT_QUERY_DEFAULTS
            .INCLUDE_EXPIRED,
      ),

    tenantId:
      normalizeAnnouncementId(
        input.tenantId,
      ),

    groupId:
      normalizeAnnouncementId(
        input.groupId,
      ),

    userId:
      normalizeAnnouncementId(
        input.userId,
      ),
  });
}

/* ============================================================================
 * ERROR CODES
 * ========================================================================== */

export const ANNOUNCEMENT_ERROR_CODES = Object.freeze({
  UNKNOWN:
    'ANNOUNCEMENT_UNKNOWN_ERROR',

  NETWORK:
    'ANNOUNCEMENT_NETWORK_ERROR',

  TIMEOUT:
    'ANNOUNCEMENT_TIMEOUT',

  UNAUTHORIZED:
    'ANNOUNCEMENT_UNAUTHORIZED',

  FORBIDDEN:
    'ANNOUNCEMENT_FORBIDDEN',

  NOT_FOUND:
    'ANNOUNCEMENT_NOT_FOUND',

  CONFLICT:
    'ANNOUNCEMENT_CONFLICT',

  VALIDATION:
    'ANNOUNCEMENT_VALIDATION_ERROR',

  SERVER:
    'ANNOUNCEMENT_SERVER_ERROR',

  RATE_LIMITED:
    'ANNOUNCEMENT_RATE_LIMITED',

  ABORTED:
    'ANNOUNCEMENT_REQUEST_ABORTED',

  OFFLINE:
    'ANNOUNCEMENT_OFFLINE',

  CACHE:
    'ANNOUNCEMENT_CACHE_ERROR',

  PARSE:
    'ANNOUNCEMENT_PARSE_ERROR',

  UNKNOWN_RESPONSE:
    'ANNOUNCEMENT_UNKNOWN_RESPONSE',
});

/* ============================================================================
 * USER-FACING ERROR MESSAGES
 * ========================================================================== */

export const ANNOUNCEMENT_ERROR_MESSAGES = Object.freeze({
  [ANNOUNCEMENT_ERROR_CODES.UNKNOWN]:
    'Something went wrong while processing announcements.',

  [ANNOUNCEMENT_ERROR_CODES.NETWORK]:
    'Unable to connect to the TITech announcement service.',

  [ANNOUNCEMENT_ERROR_CODES.TIMEOUT]:
    'The announcement request timed out. Please try again.',

  [ANNOUNCEMENT_ERROR_CODES.UNAUTHORIZED]:
    'Your session may have expired. Please sign in again.',

  [ANNOUNCEMENT_ERROR_CODES.FORBIDDEN]:
    'You are not authorized to access this announcement.',

  [ANNOUNCEMENT_ERROR_CODES.NOT_FOUND]:
    'The requested announcement could not be found.',

  [ANNOUNCEMENT_ERROR_CODES.CONFLICT]:
    'The announcement has changed. Please refresh and try again.',

  [ANNOUNCEMENT_ERROR_CODES.VALIDATION]:
    'The announcement request contains invalid information.',

  [ANNOUNCEMENT_ERROR_CODES.SERVER]:
    'The TITech announcement service is temporarily unavailable.',

  [ANNOUNCEMENT_ERROR_CODES.RATE_LIMITED]:
    'Too many requests. Please wait a moment and try again.',

  [ANNOUNCEMENT_ERROR_CODES.ABORTED]:
    'The announcement request was cancelled.',

  [ANNOUNCEMENT_ERROR_CODES.OFFLINE]:
    'You appear to be offline. Please check your connection.',

  [ANNOUNCEMENT_ERROR_CODES.CACHE]:
    'Cached announcements could not be loaded.',

  [ANNOUNCEMENT_ERROR_CODES.PARSE]:
    'The announcement response could not be processed.',

  [ANNOUNCEMENT_ERROR_CODES.UNKNOWN_RESPONSE]:
    'The announcement service returned an unexpected response.',
});

/* ============================================================================
 * FEATURE FLAGS
 * ========================================================================== */

export const ANNOUNCEMENT_FEATURES = Object.freeze({
  ENABLED: true,

  ENABLE_DRAWER: true,

  ENABLE_CENTER: true,

  ENABLE_DETAIL_VIEW: true,

  ENABLE_SEARCH: true,

  ENABLE_FILTERS: true,

  ENABLE_SORTING: true,

  ENABLE_PAGINATION: true,

  ENABLE_MARK_READ: true,

  ENABLE_MARK_ALL_READ: true,

  ENABLE_MARK_UNREAD: true,

  ENABLE_DISMISS: true,

  ENABLE_ACKNOWLEDGEMENT: true,

  ENABLE_PINNING: true,

  ENABLE_AUTO_REFRESH:
    ANNOUNCEMENT_REFRESH.ENABLED,

  ENABLE_OFFLINE_CACHE:
    ANNOUNCEMENT_CACHE.ENABLED,

  ENABLE_DEEP_LINKS: true,

  ENABLE_KEYBOARD_NAVIGATION: true,

  ENABLE_ACCESSIBILITY_ENHANCEMENTS: true,

  ENABLE_RETRY: true,

  ENABLE_REQUEST_CORRELATION: true,

  ENABLE_IDEMPOTENCY: true,
});

/* ============================================================================
 * DEEP-LINK CONFIGURATION
 * ========================================================================== */

export const ANNOUNCEMENT_ROUTES = Object.freeze({
  CENTER:
    '/chat/announcements',

  DRAWER:
    '/chat/announcements',

  DETAIL:
    '/chat/announcements/:announcementId',
});

/* ============================================================================
 * ANNOUNCEMENT TYPE GROUPS
 * ========================================================================== */

export const ANNOUNCEMENT_TYPE_GROUPS = Object.freeze({
  OPERATIONAL: Object.freeze([
    ANNOUNCEMENT_TYPES.SYSTEM,
    ANNOUNCEMENT_TYPES.PLATFORM,
    ANNOUNCEMENT_TYPES.SERVICE,
    ANNOUNCEMENT_TYPES.MAINTENANCE,
  ]),

  FINANCIAL: Object.freeze([
    ANNOUNCEMENT_TYPES.FINANCIAL,
    ANNOUNCEMENT_TYPES.SAVINGS,
    ANNOUNCEMENT_TYPES.LOAN,
  ]),

  SECURITY_AND_COMPLIANCE:
    Object.freeze([
      ANNOUNCEMENT_TYPES.SECURITY,
      ANNOUNCEMENT_TYPES.COMPLIANCE,
      ANNOUNCEMENT_TYPES.REGULATORY,
    ]),

  COMMUNITY: Object.freeze([
    ANNOUNCEMENT_TYPES.COMMUNITY,
    ANNOUNCEMENT_TYPES.SUPPORT,
  ]),

  PRODUCT: Object.freeze([
    ANNOUNCEMENT_TYPES.FEATURE,
    ANNOUNCEMENT_TYPES.PRODUCT,
  ]),
});

/* ============================================================================
 * DEVELOPMENT / DIAGNOSTIC SETTINGS
 * ========================================================================== */

export const ANNOUNCEMENT_DIAGNOSTICS = Object.freeze({
  ENABLED:
    typeof import.meta !== 'undefined' &&
    import.meta.env?.DEV === true,

  LOG_REQUESTS: false,

  LOG_STATE_TRANSITIONS: false,

  LOG_NORMALIZATION_WARNINGS: false,

  LOG_CACHE_OPERATIONS: false,

  LOG_RETRY_OPERATIONS: false,

  INCLUDE_STACK_TRACES: false,
});

/* ============================================================================
 * RUNTIME SAFETY
 * ========================================================================== */

/**
 * Determines whether browser storage is available.
 *
 * @returns {boolean}
 */
export function isAnnouncementStorageAvailable() {
  if (
    typeof window === 'undefined' ||
    typeof window.localStorage ===
      'undefined'
  ) {
    return false;
  }

  try {
    const key =
      '__titech_announcement_storage_test__';

    window.localStorage.setItem(
      key,
      '1',
    );

    window.localStorage.removeItem(
      key,
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Determines whether the browser is currently online.
 *
 * @returns {boolean}
 */
export function isAnnouncementOnline() {
  if (
    typeof navigator === 'undefined'
  ) {
    return true;
  }

  return navigator.onLine !== false;
}

/**
 * Determines whether reduced motion should be respected.
 *
 * @returns {boolean}
 */
export function shouldReduceAnnouncementMotion() {
  if (
    !ANNOUNCEMENT_ACCESSIBILITY
      .RESPECT_REDUCED_MOTION ||
    typeof window === 'undefined' ||
    typeof window.matchMedia !==
      'function'
  ) {
    return false;
  }

  return window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
}

/* ============================================================================
 * DEFAULT EXPORT CONTRACT
 * ========================================================================== */

const ANNOUNCEMENT_CONSTANTS = Object.freeze({
  ANNOUNCEMENT_SYSTEM,

  ANNOUNCEMENT_TYPES,

  ANNOUNCEMENT_CATEGORIES,

  ANNOUNCEMENT_PRIORITIES,

  ANNOUNCEMENT_SEVERITIES,

  ANNOUNCEMENT_STATUS,

  ANNOUNCEMENT_AUDIENCES,

  ANNOUNCEMENT_ACTIONS,

  ANNOUNCEMENT_FILTERS,

  ANNOUNCEMENT_SORT,

  ANNOUNCEMENT_QUERY_DEFAULTS,

  ANNOUNCEMENT_UI_LIMITS,

  ANNOUNCEMENT_DRAWER,

  ANNOUNCEMENT_REFRESH,

  ANNOUNCEMENT_RETRY,

  ANNOUNCEMENT_CACHE,

  ANNOUNCEMENT_STORAGE_KEYS,

  ANNOUNCEMENT_EVENTS,

  ANNOUNCEMENT_API,

  ANNOUNCEMENT_ACCESSIBILITY,

  ANNOUNCEMENT_LABELS,

  ANNOUNCEMENT_TYPE_LABELS,

  ANNOUNCEMENT_CATEGORY_LABELS,

  ANNOUNCEMENT_PRIORITY_LABELS,

  ANNOUNCEMENT_STATUS_LABELS,

  ANNOUNCEMENT_SEVERITY_LABELS,

  ANNOUNCEMENT_AUDIENCE_LABELS,

  ANNOUNCEMENT_ACTION_LABELS,

  ANNOUNCEMENT_FILTER_LABELS,

  ANNOUNCEMENT_SORT_LABELS,

  DEFAULT_ANNOUNCEMENT,

  ANNOUNCEMENT_ERROR_CODES,

  ANNOUNCEMENT_ERROR_MESSAGES,

  ANNOUNCEMENT_FEATURES,

  ANNOUNCEMENT_ROUTES,

  ANNOUNCEMENT_PRIORITY_RANK,

  ANNOUNCEMENT_SEVERITY_RANK,

  ANNOUNCEMENT_TYPE_GROUPS,

  ANNOUNCEMENT_DIAGNOSTICS,
});

export default ANNOUNCEMENT_CONSTANTS;