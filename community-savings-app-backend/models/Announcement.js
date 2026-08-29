/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Announcement Model
 * ============================================================================
 *
 * File:
 *   backend/models/Announcement.js
 *
 * Version:
 *   3.0.0
 *
 * Purpose:
 *   Multi-tenant, role-aware, audience-aware, auditable announcement
 *   persistence model for the TITech Community Capital platform.
 *
 * Design Principles:
 *   - Tenant isolation
 *   - Platform-wide announcements
 *   - Role-aware targeting
 *   - User/group targeting
 *   - Explicit lifecycle management
 *   - Publication scheduling
 *   - Expiration support
 *   - Read/dismiss/acknowledgement compatibility
 *   - Soft deletion
 *   - Optimized high-volume querying
 *   - Safe public serialization
 *   - Backward-compatible Mongoose model registration
 *
 * IMPORTANT:
 *   This model provides persistence-level safeguards.
 *   Authorization and tenant isolation MUST still be enforced by services
 *   and routes. Never trust tenantId supplied directly by clients.
 *
 * ============================================================================
 */

'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const ANNOUNCEMENT_TYPES = Object.freeze([
  'system',
  'platform',
  'service',
  'security',
  'maintenance',
  'feature',
  'product',
  'financial',
  'savings',
  'loan',
  'support',
  'community',
  'compliance',
  'regulatory',
  'promotional',
  'general',
]);

const ANNOUNCEMENT_CATEGORIES = Object.freeze([
  'important',
  'information',
  'update',
  'alert',
  'notice',
  'reminder',
  'outage',
  'maintenance',
  'security',
  'feature',
  'finance',
  'community',
  'general',
]);

const ANNOUNCEMENT_PRIORITIES = Object.freeze([
  'low',
  'normal',
  'high',
  'urgent',
  'critical',
]);

const ANNOUNCEMENT_SEVERITIES = Object.freeze([
  'info',
  'success',
  'warning',
  'error',
  'critical',
]);

const ANNOUNCEMENT_STATUS = Object.freeze([
  'draft',
  'scheduled',
  'published',
  'archived',
  'expired',
  'deleted',
]);

const ANNOUNCEMENT_AUDIENCES = Object.freeze([
  'all_users',
  'authenticated_users',
  'members',
  'admins',
  'tenant_admins',
  'support_staff',
  'loan_users',
  'savings_users',
  'community_users',
  'specific_tenant',
  'specific_group',
  'specific_user',
]);

const ANNOUNCEMENT_ACTIONS = Object.freeze([
  'none',
  'view',
  'open',
  'read',
  'acknowledge',
  'dismiss',
  'retry',
  'contact_support',
  'view_savings',
  'view_loans',
  'view_transactions',
  'view_profile',
  'view_document',
  'external_link',
]);

const ANNOUNCEMENT_ACTION_TARGETS = Object.freeze([
  'internal',
  'external',
]);

/* ============================================================================
 * SUB-SCHEMAS
 * ========================================================================== */

/**
 * Action attached to an announcement.
 */
const AnnouncementActionSchema = new Schema(
  {
    type: {
      type: String,
      enum: ANNOUNCEMENT_ACTIONS,
      default: 'none',
      trim: true,
    },

    label: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },

    url: {
      type: String,
      trim: true,
      maxlength: 2048,
      default: null,
    },

    target: {
      type: String,
      enum: ANNOUNCEMENT_ACTION_TARGETS,
      default: 'internal',
    },
  },
  {
    _id: false,
    id: false,
  },
);

/**
 * Audience definition.
 *
 * scope determines the targeting strategy.
 * IDs are intentionally kept separate so services can build efficient
 * authorization/query predicates.
 */
const AnnouncementAudienceSchema = new Schema(
  {
    scope: {
      type: String,
      enum: ANNOUNCEMENT_AUDIENCES,
      required: true,
      default: 'authenticated_users',
      trim: true,
    },

    roles: {
      type: [String],
      default: [],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length <= 50;
        },
        message: 'Audience roles cannot exceed 50 entries.',
      },
    },

    tenantIds: {
      type: [Schema.Types.ObjectId],
      default: [],
    },

    groupIds: {
      type: [Schema.Types.ObjectId],
      default: [],
    },

    userIds: {
      type: [Schema.Types.ObjectId],
      default: [],
    },
  },
  {
    _id: false,
    id: false,
  },
);

/**
 * Operational metadata.
 *
 * `extra` is intentionally available for non-query operational information,
 * but services should avoid placing sensitive information here.
 */
const AnnouncementMetadataSchema = new Schema(
  {
    source: {
      type: String,
      trim: true,
      maxlength: 100,
      default: 'titech',
    },

    campaignId: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null,
    },

    correlationId: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null,
    },

    externalReference: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },

    tags: {
      type: [String],
      default: [],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length <= 50;
        },
        message: 'Announcement tags cannot exceed 50 entries.',
      },
    },

    extra: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    _id: false,
    id: false,
  },
);

/* ============================================================================
 * MAIN SCHEMA
 * ========================================================================== */

const AnnouncementSchema = new Schema(
  {
    /* ------------------------------------------------------------------------
     * IDENTITY
     * ---------------------------------------------------------------------- */

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },

    summary: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },

    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 10000,
    },

    slug: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 180,
      default: null,
    },

    /* ------------------------------------------------------------------------
     * CLASSIFICATION
     * ---------------------------------------------------------------------- */

    type: {
      type: String,
      enum: ANNOUNCEMENT_TYPES,
      default: 'general',
      index: true,
    },

    category: {
      type: String,
      enum: ANNOUNCEMENT_CATEGORIES,
      default: 'information',
      index: true,
    },

    priority: {
      type: String,
      enum: ANNOUNCEMENT_PRIORITIES,
      default: 'normal',
      index: true,
    },

    severity: {
      type: String,
      enum: ANNOUNCEMENT_SEVERITIES,
      default: 'info',
      index: true,
    },

    /* ------------------------------------------------------------------------
     * LIFECYCLE
     * ---------------------------------------------------------------------- */

    status: {
      type: String,
      enum: ANNOUNCEMENT_STATUS,
      default: 'draft',
      index: true,
    },

    publishedAt: {
      type: Date,
      default: null,
      index: true,
    },

    scheduledAt: {
      type: Date,
      default: null,
      index: true,
    },

    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    /* ------------------------------------------------------------------------
     * TENANCY
     *
     * null = platform-wide announcement.
     * ObjectId = tenant-owned announcement.
     * ---------------------------------------------------------------------- */

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },

    /* ------------------------------------------------------------------------
     * AUDIENCE
     * ---------------------------------------------------------------------- */

    audience: {
      type: AnnouncementAudienceSchema,
      required: true,
      default: () => ({
        scope: 'authenticated_users',
        roles: [],
        tenantIds: [],
        groupIds: [],
        userIds: [],
      }),
    },

    /* ------------------------------------------------------------------------
     * BEHAVIOUR
     * ---------------------------------------------------------------------- */

    isPinned: {
      type: Boolean,
      default: false,
      index: true,
    },

    requiresAcknowledgement: {
      type: Boolean,
      default: false,
      index: true,
    },

    allowDismiss: {
      type: Boolean,
      default: true,
    },

    /* ------------------------------------------------------------------------
     * ACTION
     * ---------------------------------------------------------------------- */

    action: {
      type: AnnouncementActionSchema,
      default: () => ({
        type: 'none',
        label: '',
        url: null,
        target: 'internal',
      }),
    },

    /* ------------------------------------------------------------------------
     * MEDIA
     * ---------------------------------------------------------------------- */

    imageUrl: {
      type: String,
      trim: true,
      maxlength: 2048,
      default: null,
    },

    icon: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },

    /* ------------------------------------------------------------------------
     * METADATA
     * ---------------------------------------------------------------------- */

    metadata: {
      type: AnnouncementMetadataSchema,
      default: () => ({}),
    },

    /* ------------------------------------------------------------------------
     * OWNERSHIP / AUDIT
     * ---------------------------------------------------------------------- */

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    publishedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    archivedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },

    /* ------------------------------------------------------------------------
     * VERSIONING
     * ---------------------------------------------------------------------- */

    version: {
      type: Number,
      default: 1,
      min: 1,
    },

    /* ------------------------------------------------------------------------
     * SOFT DELETE
     * ---------------------------------------------------------------------- */

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    minimize: false,
    versionKey: false,
    collection: 'announcements',
  },
);

/* ============================================================================
 * INDEXES
 * ========================================================================== */

/**
 * Primary tenant publication feed.
 */
AnnouncementSchema.index({
  tenantId: 1,
  isDeleted: 1,
  status: 1,
  publishedAt: -1,
  _id: -1,
});

/**
 * Pinned/high-priority feed.
 */
AnnouncementSchema.index({
  tenantId: 1,
  isDeleted: 1,
  status: 1,
  isPinned: -1,
  priority: -1,
  publishedAt: -1,
});

/**
 * Audience filtering.
 */
AnnouncementSchema.index({
  tenantId: 1,
  'audience.scope': 1,
  isDeleted: 1,
  status: 1,
  publishedAt: -1,
});

/**
 * Scheduled publication worker.
 */
AnnouncementSchema.index({
  status: 1,
  isDeleted: 1,
  scheduledAt: 1,
});

/**
 * Expiration worker.
 */
AnnouncementSchema.index({
  status: 1,
  isDeleted: 1,
  expiresAt: 1,
});

/**
 * Author/admin management.
 */
AnnouncementSchema.index({
  tenantId: 1,
  createdBy: 1,
  createdAt: -1,
});

/**
 * Slug lookup.
 *
 * Sparse uniqueness allows multiple tenant records to omit slug while
 * preventing duplicate explicit slugs within the same tenant.
 */
AnnouncementSchema.index(
  {
    tenantId: 1,
    slug: 1,
  },
  {
    unique: true,
    sparse: true,
  },
);

/**
 * Operational correlation lookup.
 */
AnnouncementSchema.index({
  tenantId: 1,
  'metadata.correlationId': 1,
});

/**
 * Text search.
 *
 * MongoDB Atlas Search should replace this for very large deployments.
 */
AnnouncementSchema.index({
  title: 'text',
  summary: 'text',
  body: 'text',
});

/* ============================================================================
 * VALIDATION
 * ========================================================================== */

AnnouncementSchema.pre(
  'validate',
  function validateAnnouncement(next) {
    const now = new Date();

    /* ------------------------------------------------------------------------
     * Tenant/audience consistency
     * ---------------------------------------------------------------------- */

    if (
      this.tenantId &&
      this.audience?.scope === 'specific_tenant' &&
      Array.isArray(this.audience.tenantIds) &&
      this.audience.tenantIds.length === 0
    ) {
      return next(
        new Error(
          'specific_tenant announcements require at least one tenant ID.',
        ),
      );
    }

    if (
      this.audience?.scope === 'specific_group' &&
      (!Array.isArray(this.audience.groupIds) ||
        this.audience.groupIds.length === 0)
    ) {
      return next(
        new Error(
          'specific_group announcements require at least one group ID.',
        ),
      );
    }

    if (
      this.audience?.scope === 'specific_user' &&
      (!Array.isArray(this.audience.userIds) ||
        this.audience.userIds.length === 0)
    ) {
      return next(
        new Error(
          'specific_user announcements require at least one user ID.',
        ),
      );
    }

    /* ------------------------------------------------------------------------
     * Publication lifecycle
     * ---------------------------------------------------------------------- */

    if (
      this.status === 'published' &&
      !this.publishedAt
    ) {
      this.publishedAt = now;
    }

    if (
      this.status === 'scheduled' &&
      !this.scheduledAt
    ) {
      return next(
        new Error(
          'Scheduled announcements require scheduledAt.',
        ),
      );
    }

    if (
      this.status === 'scheduled' &&
      this.scheduledAt &&
      this.scheduledAt <= now
    ) {
      return next(
        new Error(
          'scheduledAt must be in the future for scheduled announcements.',
        ),
      );
    }

    if (
      this.expiresAt &&
      this.publishedAt &&
      this.expiresAt <= this.publishedAt
    ) {
      return next(
        new Error(
          'expiresAt must be later than publishedAt.',
        ),
      );
    }

    /* ------------------------------------------------------------------------
     * Action validation
     * ---------------------------------------------------------------------- */

    const actionType = this.action?.type || 'none';

    if (
      actionType === 'external_link' &&
      !this.action?.url
    ) {
      return next(
        new Error(
          'external_link actions require a URL.',
        ),
      );
    }

    if (
      actionType !== 'none' &&
      !this.action?.label
    ) {
      return next(
        new Error(
          'Announcement actions require a label.',
        ),
      );
    }

    next();
  },
);

/* ============================================================================
 * INSTANCE METHODS
 * ========================================================================== */

/**
 * Determine whether an announcement is currently publishable.
 */
AnnouncementSchema.methods.isCurrentlyActive =
  function isCurrentlyActive() {
    const now = new Date();

    return (
      !this.isDeleted &&
      this.status === 'published' &&
      (!this.publishedAt || this.publishedAt <= now) &&
      (!this.expiresAt || this.expiresAt > now)
    );
  };

/**
 * Safe public representation.
 *
 * Internal ownership fields, deletion metadata and operational metadata
 * are intentionally excluded.
 */
AnnouncementSchema.methods.toPublicJSON =
  function toPublicJSON() {
    return {
      id: String(this._id),

      title: this.title,

      summary: this.summary,

      body: this.body,

      slug: this.slug,

      type: this.type,

      category: this.category,

      priority: this.priority,

      severity: this.severity,

      status: this.status,

      audience: {
        scope: this.audience?.scope || null,
        roles: this.audience?.roles || [],
      },

      isPinned: this.isPinned,

      requiresAcknowledgement:
        this.requiresAcknowledgement,

      allowDismiss: this.allowDismiss,

      action: this.action,

      imageUrl: this.imageUrl,

      icon: this.icon,

      tags: this.metadata?.tags || [],

      metadata: {
        source:
          this.metadata?.source || 'titech',
      },

      createdAt: this.createdAt,

      updatedAt: this.updatedAt,

      publishedAt: this.publishedAt,

      scheduledAt: this.scheduledAt,

      expiresAt: this.expiresAt,
    };
  };

/* ============================================================================
 * STATIC HELPERS
 * ========================================================================== */

/**
 * Standard active-announcement predicate.
 *
 * Services can extend this with tenant/audience authorization predicates.
 */
AnnouncementSchema.statics.activeFilter =
  function activeFilter(now = new Date()) {
    return {
      isDeleted: false,
      status: 'published',
      $and: [
        {
          $or: [
            { publishedAt: null },
            { publishedAt: { $lte: now } },
          ],
        },
        {
          $or: [
            { expiresAt: null },
            { expiresAt: { $gt: now } },
          ],
        },
      ],
    };
  };

/* ============================================================================
 * MODEL
 * ========================================================================== */

module.exports =
  mongoose.models.Announcement ||
  mongoose.model(
    'Announcement',
    AnnouncementSchema,
  );