/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Announcement User State Model
 * ============================================================================
 *
 * File:
 *   backend/models/AnnouncementRead.js
 *
 * Version:
 *   2.0.0
 *
 * Purpose:
 *   Stores the per-user interaction state for TITech announcements.
 *
 * Responsibilities:
 *   - Track read/unread state
 *   - Track first/last viewing activity
 *   - Track dismissal
 *   - Track acknowledgement
 *   - Maintain per-user announcement history
 *   - Support tenant-aware querying
 *   - Support high-volume announcement workloads
 *   - Provide auditable interaction timestamps
 *
 * Architectural Role:
 *
 *   Announcement
 *        │
 *        ├── tenantId
 *        │
 *        └── announcementId
 *                 │
 *                 ▼
 *        AnnouncementRead
 *                 │
 *                 └── userId
 *
 * Design Principles:
 *   ✓ Multi-tenant aware
 *   ✓ User-scoped
 *   ✓ Auditable
 *   ✓ Idempotent-friendly
 *   ✓ High-volume query optimized
 *   ✓ MongoDB/Mongoose production ready
 *   ✓ Backward compatible with existing AnnouncementRead usage
 *   ✓ Safe for concurrent updates
 *
 * ============================================================================
 */

'use strict';

const mongoose = require('mongoose');

const {
  Schema,
} = mongoose;

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const ANNOUNCEMENT_ACTIONS = Object.freeze([
  'viewed',
  'read',
  'dismissed',
  'acknowledged',
  'unread',
]);

const MAX_LAST_ACTION_LENGTH = 100;

/* ============================================================================
 * SCHEMA
 * ========================================================================== */

const AnnouncementReadSchema = new Schema(
  {
    /**
     * ------------------------------------------------------------------------
     * Announcement Reference
     * ------------------------------------------------------------------------
     *
     * The announcement whose interaction state is being stored.
     */
    announcementId: {
      type: Schema.Types.ObjectId,
      ref: 'Announcement',
      required: true,
      immutable: true,
      index: true,
    },

    /**
     * ------------------------------------------------------------------------
     * Tenant Reference
     * ------------------------------------------------------------------------
     *
     * Null is permitted for platform/global announcements.
     *
     * IMPORTANT:
     * Tenant-aware authorization must still be enforced by the service layer.
     */
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },

    /**
     * ------------------------------------------------------------------------
     * User Reference
     * ------------------------------------------------------------------------
     */
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },

    /**
     * ------------------------------------------------------------------------
     * Read State
     * ------------------------------------------------------------------------
     */
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    /**
     * Timestamp at which the announcement was first marked as read.
     *
     * This should normally be populated only once.
     */
    readAt: {
      type: Date,
      default: null,
    },

    /**
     * ------------------------------------------------------------------------
     * Dismissal State
     * ------------------------------------------------------------------------
     */
    isDismissed: {
      type: Boolean,
      default: false,
      index: true,
    },

    dismissedAt: {
      type: Date,
      default: null,
    },

    /**
     * ------------------------------------------------------------------------
     * Acknowledgement State
     * ------------------------------------------------------------------------
     *
     * Useful for mandatory notices, policy changes, compliance notices,
     * regulatory communications and other announcements requiring explicit
     * user confirmation.
     */
    isAcknowledged: {
      type: Boolean,
      default: false,
      index: true,
    },

    acknowledgedAt: {
      type: Date,
      default: null,
    },

    /**
     * ------------------------------------------------------------------------
     * View Tracking
     * ------------------------------------------------------------------------
     */

    /**
     * First time the user opened/viewed the announcement.
     */
    firstViewedAt: {
      type: Date,
      default: null,
    },

    /**
     * Most recent time the user viewed the announcement.
     */
    lastViewedAt: {
      type: Date,
      default: null,
    },

    /**
     * Number of times the announcement has been viewed.
     */
    viewCount: {
      type: Number,
      default: 0,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    },

    /**
     * ------------------------------------------------------------------------
     * Last Interaction
     * ------------------------------------------------------------------------
     *
     * Kept intentionally lightweight so this document can be used for
     * notification-center rendering without requiring an audit-log lookup.
     */
    lastAction: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_LAST_ACTION_LENGTH,
      enum: {
        values: ANNOUNCEMENT_ACTIONS,
        message:
          'Invalid announcement interaction action.',
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'announcement_reads',

    /**
     * Prevent accidental persistence of arbitrary fields.
     */
    strict: true,

    /**
     * Keep null values where explicitly defined because null has semantic
     * meaning for optional interaction timestamps.
     */
    minimize: false,
  },
);

/* ============================================================================
 * INDEXES
 * ========================================================================== */

/**
 * --------------------------------------------------------------------------
 * PRIMARY USER / ANNOUNCEMENT UNIQUENESS
 * --------------------------------------------------------------------------
 *
 * Exactly one interaction-state document should exist for a given user and
 * announcement.
 *
 * TenantId is intentionally NOT part of this uniqueness constraint because
 * announcementId + userId represents the canonical interaction relationship.
 */
AnnouncementReadSchema.index(
  {
    announcementId: 1,
    userId: 1,
  },
  {
    unique: true,
    name: 'uniq_announcement_user_state',
  },
);

/**
 * --------------------------------------------------------------------------
 * TENANT + USER + READ STATE
 * --------------------------------------------------------------------------
 *
 * Supports:
 *
 *   "Show this user's unread announcements."
 *
 * Particularly important for announcement-bell unread counts.
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    userId: 1,
    isRead: 1,
  },
  {
    name: 'idx_tenant_user_read_state',
  },
);

/**
 * --------------------------------------------------------------------------
 * TENANT + USER + DISMISSED STATE
 * --------------------------------------------------------------------------
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    userId: 1,
    isDismissed: 1,
  },
  {
    name: 'idx_tenant_user_dismissed_state',
  },
);

/**
 * --------------------------------------------------------------------------
 * TENANT + USER + ACKNOWLEDGEMENT STATE
 * --------------------------------------------------------------------------
 *
 * Supports compliance-oriented acknowledgement checks.
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    userId: 1,
    isAcknowledged: 1,
  },
  {
    name: 'idx_tenant_user_acknowledged_state',
  },
);

/**
 * --------------------------------------------------------------------------
 * USER HISTORY
 * --------------------------------------------------------------------------
 *
 * Supports:
 *
 *   "Show this user's recent announcement interactions."
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    userId: 1,
    updatedAt: -1,
  },
  {
    name: 'idx_tenant_user_updated',
  },
);

/**
 * --------------------------------------------------------------------------
 * ANNOUNCEMENT AUDIENCE / ENGAGEMENT
 * --------------------------------------------------------------------------
 *
 * Supports:
 *
 *   "How many users interacted with this announcement?"
 *
 * and future engagement analytics.
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    announcementId: 1,
    updatedAt: -1,
  },
  {
    name: 'idx_tenant_announcement_updated',
  },
);

/**
 * --------------------------------------------------------------------------
 * ACKNOWLEDGEMENT REPORTING
 * --------------------------------------------------------------------------
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    announcementId: 1,
    isAcknowledged: 1,
  },
  {
    name: 'idx_tenant_announcement_acknowledged',
  },
);

/**
 * --------------------------------------------------------------------------
 * READ REPORTING
 * --------------------------------------------------------------------------
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    announcementId: 1,
    isRead: 1,
  },
  {
    name: 'idx_tenant_announcement_read',
  },
);

/* ============================================================================
 * VALIDATION HELPERS
 * ========================================================================== */

/**
 * Ensure boolean/timestamp state remains internally consistent.
 *
 * These checks intentionally validate only supplied document state.
 * Business workflows should continue to be handled by the service layer.
 */
AnnouncementReadSchema.pre(
  'validate',
  function announcementReadValidation(next) {
    if (
      this.isRead &&
      !this.readAt
    ) {
      this.readAt = new Date();
    }

    if (
      this.isDismissed &&
      !this.dismissedAt
    ) {
      this.dismissedAt = new Date();
    }

    if (
      this.isAcknowledged &&
      !this.acknowledgedAt
    ) {
      this.acknowledgedAt = new Date();
    }

    if (
      this.firstViewedAt &&
      !this.lastViewedAt
    ) {
      this.lastViewedAt = this.firstViewedAt;
    }

    if (
      this.viewCount < 0 ||
      !Number.isSafeInteger(this.viewCount)
    ) {
      return next(
        new mongoose.Error.ValidationError(
          new mongoose.Error.ValidatorError({
            path: 'viewCount',
            message:
              'viewCount must be a non-negative safe integer.',
          }),
        ),
      );
    }

    return next();
  },
);

/* ============================================================================
 * INSTANCE METHODS
 * ========================================================================== */

/**
 * Determine whether the announcement has any recorded user interaction.
 */
AnnouncementReadSchema.methods.hasInteraction =
  function hasInteraction() {
    return Boolean(
      this.firstViewedAt ||
      this.isRead ||
      this.isDismissed ||
      this.isAcknowledged ||
      this.viewCount > 0,
    );
  };

/**
 * Record a view on the current document.
 *
 * This method is intended for application/service-layer use.
 */
AnnouncementReadSchema.methods.recordView =
  function recordView(date = new Date()) {
    if (!this.firstViewedAt) {
      this.firstViewedAt = date;
    }

    this.lastViewedAt = date;

    this.viewCount += 1;
    this.lastAction = 'viewed';

    return this;
  };

/**
 * Mark the announcement as read.
 */
AnnouncementReadSchema.methods.markRead =
  function markRead(date = new Date()) {
    this.isRead = true;

    if (!this.readAt) {
      this.readAt = date;
    }

    this.lastAction = 'read';

    return this;
  };

/**
 * Mark the announcement as unread.
 *
 * readAt is intentionally preserved because it represents the historical
 * first-read timestamp.
 */
AnnouncementReadSchema.methods.markUnread =
  function markUnread() {
    this.isRead = false;
    this.lastAction = 'unread';

    return this;
  };

/**
 * Dismiss the announcement.
 */
AnnouncementReadSchema.methods.dismiss =
  function dismiss(date = new Date()) {
    this.isDismissed = true;

    if (!this.dismissedAt) {
      this.dismissedAt = date;
    }

    this.lastAction = 'dismissed';

    return this;
  };

/**
 * Acknowledge the announcement.
 */
AnnouncementReadSchema.methods.acknowledge =
  function acknowledge(date = new Date()) {
    this.isAcknowledged = true;

    if (!this.acknowledgedAt) {
      this.acknowledgedAt = date;
    }

    this.lastAction = 'acknowledged';

    return this;
  };

/* ============================================================================
 * STATIC HELPERS
 * ========================================================================== */

/**
 * Find a user's interaction state for an announcement.
 */
AnnouncementReadSchema.statics.findUserState =
  function findUserState(
    announcementId,
    userId,
  ) {
    return this.findOne({
      announcementId,
      userId,
    });
  };

/**
 * Find all unread announcement states for a user within a tenant.
 */
AnnouncementReadSchema.statics.findUnreadForUser =
  function findUnreadForUser(
    tenantId,
    userId,
  ) {
    return this.find({
      tenantId,
      userId,
      isRead: false,
    }).sort({
      updatedAt: -1,
    });
  };

/**
 * Count unread announcements efficiently.
 */
AnnouncementReadSchema.statics.countUnreadForUser =
  function countUnreadForUser(
    tenantId,
    userId,
  ) {
    return this.countDocuments({
      tenantId,
      userId,
      isRead: false,
    });
  };

/* ============================================================================
 * JSON TRANSFORMATION
 * ========================================================================== */

/**
 * Keep API responses clean and avoid exposing Mongoose implementation
 * details.
 */
AnnouncementReadSchema.set(
  'toJSON',
  {
    virtuals: false,
    transform: (_doc, ret) => {
      delete ret.__v;

      return ret;
    },
  },
);

/* ============================================================================
 * MODEL EXPORT
 * ========================================================================== */

module.exports =
  mongoose.models.AnnouncementRead ||
  mongoose.model(
    'AnnouncementRead',
    AnnouncementReadSchema,
  );

/* ============================================================================
 * END OF TITech COMMUNITY CAPITAL ANNOUNCEMENT USER STATE MODEL
 * ============================================================================
 */