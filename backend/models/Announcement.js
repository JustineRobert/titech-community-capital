/**
 * ============================================================================
 * backend/models/Announcement.js
 * TITech Community Capital LTD
 * Enterprise Announcement Aggregate
 * ============================================================================
 *
 * Architectural role
 * ----------------------------------------------------------------------------
 * Announcement is the canonical persistence aggregate for platform and
 * tenant-scoped announcements.
 *
 * It supports:
 *
 *   - platform-wide announcements
 *   - tenant-scoped announcements
 *   - role-aware targeting
 *   - user targeting
 *   - group targeting
 *   - explicit publication lifecycle
 *   - publication scheduling
 *   - expiration
 *   - acknowledgement requirements
 *   - dismissal compatibility
 *   - pinned/high-priority notices
 *   - announcement actions
 *   - media references
 *   - operational metadata
 *   - soft deletion
 *   - announcement versioning
 *
 * Relationship
 * ----------------------------------------------------------------------------
 *
 *   Announcement
 *        │
 *        ├── lifecycle/content
 *        ├── audience
 *        ├── action
 *        └── tenant context
 *                │
 *                ├── AnnouncementRead
 *                │
 *                └── AnnouncementAudit
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Announcement IS:
 *   - the source of truth for announcement content;
 *   - the source of truth for publication/lifecycle state;
 *   - the source of truth for announcement audience configuration;
 *   - the source of truth for announcement presentation/action configuration.
 *
 * Announcement is NOT:
 *   - a user interaction-state store;
 *   - a notification delivery queue;
 *   - a push/email/SMS provider record;
 *   - an audit-log replacement;
 *   - an authorization replacement;
 *   - a tenant-membership authority;
 *   - a financial ledger;
 *   - a replacement for application/service-layer authorization.
 *
 * Security principles
 * ----------------------------------------------------------------------------
 *   - Tenant ownership is explicit.
 *   - Tenant/audience authorization remains a service-layer responsibility.
 *   - Client-supplied tenantId must never be trusted without authorization.
 *   - Lifecycle transitions should use controlled methods/services.
 *   - Identity and ownership fields become immutable once created.
 *   - Direct uncontrolled update operations are blocked.
 *   - Hard deletion is disabled.
 *   - Soft deletion uses one canonical state representation.
 *   - Public serialization excludes internal ownership/deletion metadata.
 *   - URLs and media references are validated by application policy.
 *   - Audience collections are bounded.
 *   - Operational metadata is bounded.
 *   - Optimistic concurrency is enabled.
 *   - Scheduled/expiration workers must use the controlled lifecycle methods.
 *
 * Module format
 * ----------------------------------------------------------------------------
 * Native ESM.
 *
 * ============================================================================
 */

'use strict';

import mongoose from 'mongoose';

const { Schema } = mongoose;

/*
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

export const ANNOUNCEMENT_TYPES = Object.freeze([
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

export const ANNOUNCEMENT_CATEGORIES = Object.freeze([
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

export const ANNOUNCEMENT_PRIORITIES = Object.freeze([
  'low',
  'normal',
  'high',
  'urgent',
  'critical',
]);

export const ANNOUNCEMENT_SEVERITIES = Object.freeze([
  'info',
  'success',
  'warning',
  'error',
  'critical',
]);

export const ANNOUNCEMENT_STATUS = Object.freeze([
  'draft',
  'scheduled',
  'published',
  'archived',
  'expired',
  'deleted',
]);

export const ANNOUNCEMENT_AUDIENCES = Object.freeze([
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

export const ANNOUNCEMENT_ACTIONS = Object.freeze([
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

export const ANNOUNCEMENT_ACTION_TARGETS = Object.freeze([
  'internal',
  'external',
]);

export const MAX_AUDIENCE_ROLES = 50;
export const MAX_AUDIENCE_TENANTS = 1000;
export const MAX_AUDIENCE_GROUPS = 1000;
export const MAX_AUDIENCE_USERS = 1000;
export const MAX_TAGS = 50;
export const MAX_METADATA_KEYS = 50;
export const MAX_METADATA_DEPTH = 8;
export const MAX_METADATA_STRING_LENGTH = 4096;

/*
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function assertObjectId(value, name) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    throw new TypeError(
      `${name} is required`,
    );
  }

  if (
    !mongoose.isObjectIdOrHexString(value)
  ) {
    throw new mongoose.Error.CastError(
      'ObjectId',
      value,
      name,
    );
  }
}

function normalizeDate(value, name) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      normalized.getTime(),
    )
  ) {
    throw new TypeError(
      `${name} must be a valid date`,
    );
  }

  return normalized;
}

function normalizeString(value) {
  return String(
    value ?? '',
  ).trim();
}

function normalizeNullableString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    normalizeString(value);

  return normalized || null;
}

function normalizeEnumString(value) {
  return normalizeString(value).toLowerCase();
}

function validateBoundedMetadata(
  value,
  depth = 0,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return;
  }

  if (
    depth > MAX_METADATA_DEPTH
  ) {
    throw new RangeError(
      `Announcement metadata exceeds the maximum nesting depth of ${MAX_METADATA_DEPTH}`,
    );
  }

  if (
    typeof value === 'string'
  ) {
    if (
      value.length >
      MAX_METADATA_STRING_LENGTH
    ) {
      throw new RangeError(
        `Announcement metadata strings cannot exceed ${MAX_METADATA_STRING_LENGTH} characters`,
      );
    }

    return;
  }

  if (
    Array.isArray(value)
  ) {
    if (
      value.length >
      MAX_METADATA_KEYS
    ) {
      throw new RangeError(
        `Announcement metadata arrays cannot contain more than ${MAX_METADATA_KEYS} items`,
      );
    }

    for (
      const item of value
    ) {
      validateBoundedMetadata(
        item,
        depth + 1,
      );
    }

    return;
  }

  if (
    typeof value === 'object'
  ) {
    const keys =
      Object.keys(value);

    if (
      keys.length >
      MAX_METADATA_KEYS
    ) {
      throw new RangeError(
        `Announcement metadata objects cannot contain more than ${MAX_METADATA_KEYS} keys`,
      );
    }

    for (
      const child of Object.values(
        value,
      )
    ) {
      validateBoundedMetadata(
        child,
        depth + 1,
      );
    }
  }
}

function normalizeUniqueObjectIds(
  values = [],
) {
  if (
    !Array.isArray(values)
  ) {
    return [];
  }

  return [
    ...new Set(
      values.map((value) =>
        String(value),
      ),
    ),
  ].map(
    (value) =>
      new mongoose.Types.ObjectId(
        value,
      ),
  );
}

function serializeAnnouncement(
  _doc,
  ret,
) {
  if (ret._id) {
    ret.id =
      String(ret._id);
  }

  delete ret._id;
  delete ret.__v;

  delete ret.createdBy;
  delete ret.updatedBy;
  delete ret.publishedBy;
  delete ret.archivedBy;
  delete ret.deletedBy;
  delete ret.deletedAt;

  delete ret.isDeleted;

  /*
   * Audience IDs may reveal internal targeting information and therefore
   * should not be exposed through ordinary public serialization.
   */
  if (ret.audience) {
    delete ret.audience.tenantIds;
    delete ret.audience.groupIds;
    delete ret.audience.userIds;
  }

  /*
   * Metadata.extra may contain internal operational information.
   */
  if (ret.metadata) {
    const metadata =
      ret.metadata;

    ret.metadata = {
      source:
        metadata.source ??
        'titech',
      campaignId:
        metadata.campaignId ??
        null,
      tags:
        metadata.tags ??
        [],
    };
  }

  return ret;
}

function rejectGenericMutation(
  next,
) {
  const options =
    typeof this.getOptions ===
    'function'
      ? this.getOptions()
      : this.options || {};

  if (
    options.announcementInternal ===
    true
  ) {
    return next();
  }

  return next(
    new Error(
      `Direct ${this.op} mutations on Announcement are disabled; ` +
        'use a dedicated Announcement operation/service',
    ),
  );
}

function assertLifecycleTransition(
  currentStatus,
  nextStatus,
) {
  const allowed = {
    draft: new Set([
      'draft',
      'scheduled',
      'published',
      'deleted',
    ]),

    scheduled: new Set([
      'scheduled',
      'published',
      'draft',
      'deleted',
    ]),

    published: new Set([
      'published',
      'archived',
      'expired',
      'deleted',
    ]),

    archived: new Set([
      'archived',
      'restored',
      'deleted',
    ]),

    expired: new Set([
      'expired',
      'archived',
      'deleted',
    ]),

    deleted: new Set([
      'deleted',
    ]),
  };

  const permitted =
    allowed[currentStatus];

  if (
    !permitted ||
    !permitted.has(nextStatus)
  ) {
    throw new Error(
      `Invalid announcement lifecycle transition: ${currentStatus} -> ${nextStatus}`,
    );
  }
}

/*
 * ============================================================================
 * SUB-SCHEMAS
 * ============================================================================
 */

/*
 * --------------------------------------------------------------------------
 * ACTION
 * --------------------------------------------------------------------------
 */

const AnnouncementActionSchema =
  new Schema(
    {
      type: {
        type: String,
        enum: ANNOUNCEMENT_ACTIONS,
        default: 'none',
        lowercase: true,
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
        enum:
          ANNOUNCEMENT_ACTION_TARGETS,
        default: 'internal',
        lowercase: true,
        trim: true,
      },
    },
    {
      _id: false,
      id: false,
      strict: true,
    },
  );

/*
 * --------------------------------------------------------------------------
 * AUDIENCE
 * --------------------------------------------------------------------------
 */

const AnnouncementAudienceSchema =
  new Schema(
    {
      scope: {
        type: String,
        enum:
          ANNOUNCEMENT_AUDIENCES,
        required: true,
        default:
          'authenticated_users',
        lowercase: true,
        trim: true,
      },

      roles: {
        type: [String],
        default: [],
        validate: {
          validator(value) {
            if (
              !Array.isArray(
                value,
              )
            ) {
              return false;
            }

            return (
              value.length <=
              MAX_AUDIENCE_ROLES
            );
          },

          message:
            `Audience roles cannot exceed ${MAX_AUDIENCE_ROLES} entries.`,
        },
      },

      tenantIds: {
        type: [
          Schema.Types.ObjectId,
        ],
        default: [],
        validate: {
          validator(value) {
            return (
              Array.isArray(
                value,
              ) &&
              value.length <=
                MAX_AUDIENCE_TENANTS
            );
          },

          message:
            `Audience tenantIds cannot exceed ${MAX_AUDIENCE_TENANTS} entries.`,
        },
      },

      groupIds: {
        type: [
          Schema.Types.ObjectId,
        ],
        default: [],
        validate: {
          validator(value) {
            return (
              Array.isArray(
                value,
              ) &&
              value.length <=
                MAX_AUDIENCE_GROUPS
            );
          },

          message:
            `Audience groupIds cannot exceed ${MAX_AUDIENCE_GROUPS} entries.`,
        },
      },

      userIds: {
        type: [
          Schema.Types.ObjectId,
        ],
        default: [],
        validate: {
          validator(value) {
            return (
              Array.isArray(
                value,
              ) &&
              value.length <=
                MAX_AUDIENCE_USERS
            );
          },

          message:
            `Audience userIds cannot exceed ${MAX_AUDIENCE_USERS} entries.`,
        },
      },
    },
    {
      _id: false,
      id: false,
      strict: true,
    },
  );

/*
 * --------------------------------------------------------------------------
 * METADATA
 * --------------------------------------------------------------------------
 */

const AnnouncementMetadataSchema =
  new Schema(
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
            return (
              Array.isArray(value) &&
              value.length <=
                MAX_TAGS
            );
          },

          message:
            `Announcement tags cannot exceed ${MAX_TAGS} entries.`,
        },
      },

      extra: {
        type: Schema.Types.Mixed,
        default: undefined,
      },
    },
    {
      _id: false,
      id: false,
      strict: true,
    },
  );

/*
 * ============================================================================
 * MAIN SCHEMA
 * ============================================================================
 */

const AnnouncementSchema =
  new Schema(
    {
      /*
       * ----------------------------------------------------------------------
       * IDENTITY
       * ----------------------------------------------------------------------
       */

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

      /*
       * ----------------------------------------------------------------------
       * CLASSIFICATION
       * ----------------------------------------------------------------------
       */

      type: {
        type: String,
        enum: ANNOUNCEMENT_TYPES,
        default: 'general',
        lowercase: true,
        trim: true,
        index: true,
      },

      category: {
        type: String,
        enum:
          ANNOUNCEMENT_CATEGORIES,
        default: 'information',
        lowercase: true,
        trim: true,
        index: true,
      },

      priority: {
        type: String,
        enum:
          ANNOUNCEMENT_PRIORITIES,
        default: 'normal',
        lowercase: true,
        trim: true,
        index: true,
      },

      severity: {
        type: String,
        enum:
          ANNOUNCEMENT_SEVERITIES,
        default: 'info',
        lowercase: true,
        trim: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * LIFECYCLE
       * ----------------------------------------------------------------------
       */

      status: {
        type: String,
        enum: ANNOUNCEMENT_STATUS,
        default: 'draft',
        lowercase: true,
        trim: true,
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

      /*
       * ----------------------------------------------------------------------
       * TENANCY
       * ----------------------------------------------------------------------
       *
       * null:
       *   platform-level announcement.
       *
       * ObjectId:
       *   tenant-owned announcement.
       */

      tenantId: {
        type: Schema.Types.ObjectId,
        ref: 'Tenant',
        default: null,
        immutable: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * AUDIENCE
       * ----------------------------------------------------------------------
       */

      audience: {
        type:
          AnnouncementAudienceSchema,
        required: true,
        default: () => ({
          scope:
            'authenticated_users',
          roles: [],
          tenantIds: [],
          groupIds: [],
          userIds: [],
        }),
      },

      /*
       * ----------------------------------------------------------------------
       * BEHAVIOUR
       * ----------------------------------------------------------------------
       */

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

      /*
       * ----------------------------------------------------------------------
       * ACTION
       * ----------------------------------------------------------------------
       */

      action: {
        type:
          AnnouncementActionSchema,
        default: () => ({
          type: 'none',
          label: '',
          url: null,
          target: 'internal',
        }),
      },

      /*
       * ----------------------------------------------------------------------
       * MEDIA
       * ----------------------------------------------------------------------
       */

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

      /*
       * ----------------------------------------------------------------------
       * METADATA
       * ----------------------------------------------------------------------
       */

      metadata: {
        type:
          AnnouncementMetadataSchema,
        default: () => ({}),
      },

      /*
       * ----------------------------------------------------------------------
       * OWNERSHIP / AUDIT ATTRIBUTION
       * ----------------------------------------------------------------------
       */

      createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true,
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

      /*
       * ----------------------------------------------------------------------
       * VERSIONING
       * ----------------------------------------------------------------------
       */

      version: {
        type: Number,
        default: 1,
        min: 1,
        validate: {
          validator(value) {
            return (
              Number.isSafeInteger(
                value,
              ) &&
              value >= 1
            );
          },

          message:
            'Announcement version must be a positive safe integer.',
        },
      },

      /*
       * ----------------------------------------------------------------------
       * SOFT DELETE COMPATIBILITY
       * ----------------------------------------------------------------------
       */

      isDeleted: {
        type: Boolean,
        default: false,
        index: true,
      },
    },
    {
      timestamps: true,

      minimize: false,

      /*
       * Retain __v because the aggregate uses optimistic concurrency.
       */
      versionKey: '__v',

      optimisticConcurrency: true,

      strict: true,

      collection:
        'announcements',

      toJSON: {
        virtuals: true,
        transform:
          serializeAnnouncement,
      },

      toObject: {
        virtuals: true,
        transform:
          serializeAnnouncement,
      },
    },
  );

/*
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/*
 * Primary tenant publication feed.
 */
AnnouncementSchema.index({
  tenantId: 1,
  isDeleted: 1,
  status: 1,
  publishedAt: -1,
  _id: -1,
});

/*
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

/*
 * Audience filtering.
 */
AnnouncementSchema.index({
  tenantId: 1,
  'audience.scope': 1,
  isDeleted: 1,
  status: 1,
  publishedAt: -1,
});

/*
 * Scheduled publication worker.
 */
AnnouncementSchema.index({
  status: 1,
  isDeleted: 1,
  scheduledAt: 1,
});

/*
 * Expiration worker.
 */
AnnouncementSchema.index({
  status: 1,
  isDeleted: 1,
  expiresAt: 1,
});

/*
 * Author/admin management.
 */
AnnouncementSchema.index({
  tenantId: 1,
  createdBy: 1,
  createdAt: -1,
  _id: -1,
});

/*
 * Tenant-scoped slug uniqueness.
 *
 * Sparse permits announcements without a slug.
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

/*
 * Platform/global slug uniqueness is separately protected for announcements
 * whose tenantId is null.
 */
AnnouncementSchema.index(
  {
    slug: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      tenantId: null,
      slug: {
        $type: 'string',
      },
    },
    name:
      'uniq_platform_announcement_slug',
  },
);

/*
 * Operational correlation lookup.
 */
AnnouncementSchema.index({
  tenantId: 1,
  'metadata.correlationId': 1,
});

/*
 * Text search.
 */
AnnouncementSchema.index({
  title: 'text',
  summary: 'text',
  body: 'text',
});

/*
 * ============================================================================
 * VALIDATION
 * ============================================================================
 */

AnnouncementSchema.pre(
  'validate',
  function validateAnnouncement(
    next,
  ) {
    const now =
      new Date();

    /*
     * ------------------------------------------------------------------------
     * Required content
     * ------------------------------------------------------------------------
     */

    this.title =
      normalizeString(
        this.title,
      );

    this.summary =
      normalizeString(
        this.summary,
      );

    this.body =
      normalizeString(
        this.body,
      );

    if (
      !this.title
    ) {
      this.invalidate(
        'title',
        'Announcement title is required.',
      );
    }

    if (
      !this.body
    ) {
      this.invalidate(
        'body',
        'Announcement body is required.',
      );
    }

    /*
     * ------------------------------------------------------------------------
     * Audience normalization
     * ------------------------------------------------------------------------
     */

    if (
      this.audience?.roles
    ) {
      this.audience.roles =
        [
          ...new Set(
            this.audience.roles
              .map((role) =>
                normalizeString(
                  role,
                ),
              )
              .filter(
                Boolean,
              ),
          ),
        ];
    }

    /*
     * Validate audience scope requirements.
     */
    const audienceScope =
      this.audience?.scope;

    if (
      audienceScope ===
      'specific_tenant'
    ) {
      if (
        !Array.isArray(
          this.audience.tenantIds,
        ) ||
        this.audience.tenantIds.length ===
          0
      ) {
        this.invalidate(
          'audience.tenantIds',
          'specific_tenant announcements require at least one tenant ID.',
        );
      }
    }

    if (
      audienceScope ===
      'specific_group'
    ) {
      if (
        !Array.isArray(
          this.audience.groupIds,
        ) ||
        this.audience.groupIds.length ===
          0
      ) {
        this.invalidate(
          'audience.groupIds',
          'specific_group announcements require at least one group ID.',
        );
      }
    }

    if (
      audienceScope ===
      'specific_user'
    ) {
      if (
        !Array.isArray(
          this.audience.userIds,
        ) ||
        this.audience.userIds.length ===
          0
      ) {
        this.invalidate(
          'audience.userIds',
          'specific_user announcements require at least one user ID.',
        );
      }
    }

    /*
     * ------------------------------------------------------------------------
     * Tenant/audience semantics
     * ------------------------------------------------------------------------
     */

    if (
      this.tenantId &&
      audienceScope ===
        'specific_tenant' &&
      Array.isArray(
        this.audience.tenantIds,
      )
    ) {
      /*
       * A tenant-owned announcement targeting specific tenants should normally
       * include its owning tenant. Cross-tenant broadcasting requires an
       * explicit service-layer policy.
       */
      const tenantMatches =
        this.audience.tenantIds.some(
          (id) =>
            String(id) ===
            String(this.tenantId),
        );

      if (
        !tenantMatches
      ) {
        this.invalidate(
          'audience.tenantIds',
          'A tenant-owned specific_tenant announcement must include its owning tenant.',
        );
      }
    }

    /*
     * ------------------------------------------------------------------------
     * Scheduling/publication lifecycle
     * ------------------------------------------------------------------------
     */

    if (
      this.status ===
      'scheduled'
    ) {
      if (
        !this.scheduledAt
      ) {
        return next(
          new Error(
            'Scheduled announcements require scheduledAt.',
          ),
        );
      }

      if (
        this.scheduledAt <=
        now
      ) {
        return next(
          new Error(
            'scheduledAt must be in the future for scheduled announcements.',
          ),
        );
      }

      if (
        this.publishedAt
      ) {
        this.invalidate(
          'publishedAt',
          'Scheduled announcements cannot have publishedAt yet.',
        );
      }
    }

    if (
      this.status ===
      'published'
    ) {
      if (
        !this.publishedAt
      ) {
        this.publishedAt =
          now;
      }

      if (
        this.scheduledAt &&
        this.scheduledAt >
          this.publishedAt
      ) {
        this.invalidate(
          'scheduledAt',
          'scheduledAt cannot be later than publishedAt.',
        );
      }
    }

    if (
      this.status ===
        'draft' &&
      this.publishedAt
    ) {
      this.invalidate(
        'publishedAt',
        'Draft announcements cannot have publishedAt.',
      );
    }

    if (
      this.status ===
        'archived' &&
      !this.publishedAt
    ) {
      this.invalidate(
        'publishedAt',
        'Archived announcements must have a publication history.',
      );
    }

    if (
      this.status ===
        'expired' &&
      !this.expiresAt
    ) {
      this.invalidate(
        'expiresAt',
        'Expired announcements must have expiresAt.',
      );
    }

    /*
     * Expiration must occur after publication.
     */
    if (
      this.expiresAt &&
      this.publishedAt &&
      this.expiresAt <=
        this.publishedAt
    ) {
      this.invalidate(
        'expiresAt',
        'expiresAt must be later than publishedAt.',
      );
    }

    /*
     * An already-expired published announcement should not remain published.
     */
    if (
      this.status ===
        'published' &&
      this.expiresAt &&
      this.expiresAt <=
        now
    ) {
      /*
       * Do not silently mutate lifecycle state during validation.
       * The expiration worker should perform this controlled transition.
       */
      this.invalidate(
        'expiresAt',
        'Published announcement has already passed expiresAt; expiration must be processed by the lifecycle worker.',
      );
    }

    /*
     * ------------------------------------------------------------------------
     * Action validation
     * ------------------------------------------------------------------------
     */

    const actionType =
      this.action?.type ||
      'none';

    if (
      actionType ===
      'none'
    ) {
      if (
        this.action?.url
      ) {
        this.invalidate(
          'action.url',
          'An action URL cannot be specified when action type is none.',
        );
      }
    }

    if (
      actionType ===
      'external_link'
    ) {
      if (
        !this.action?.url
      ) {
        this.invalidate(
          'action.url',
          'external_link actions require a URL.',
        );
      }

      if (
        this.action?.target !==
        'external'
      ) {
        this.invalidate(
          'action.target',
          'external_link actions require target=external.',
        );
      }
    }

    if (
      actionType !==
        'none' &&
      !this.action?.label
    ) {
      this.invalidate(
        'action.label',
        'Announcement actions require a label.',
      );
    }

    /*
     * Internal actions should not accidentally carry external targets.
     */
    if (
      actionType !==
        'external_link' &&
      this.action?.target ===
        'external'
    ) {
      this.invalidate(
        'action.target',
        'Only external_link actions may use target=external.',
      );
    }

    /*
     * ------------------------------------------------------------------------
     * Metadata validation
     * ------------------------------------------------------------------------
     */

    try {
      validateBoundedMetadata(
        this.metadata?.extra,
      );
    } catch (
      error
    ) {
      this.invalidate(
        'metadata.extra',
        error.message,
      );
    }

    /*
     * ------------------------------------------------------------------------
     * Soft-delete lifecycle coherence
     * ------------------------------------------------------------------------
     */

    if (
      this.status ===
        'deleted'
    ) {
      this.isDeleted =
        true;

      if (
        !this.deletedAt
      ) {
        this.deletedAt =
          now;
      }
    }

    if (
      this.status !==
        'deleted' &&
      this.isDeleted
    ) {
      this.invalidate(
        'isDeleted',
        'isDeleted can only be true when status is deleted.',
      );
    }

    if (
      this.isDeleted &&
      !this.deletedAt
    ) {
      this.deletedAt =
        now;
    }

    if (
      !this.isDeleted &&
      this.deletedAt
    ) {
      this.invalidate(
        'deletedAt',
        'deletedAt must be null for non-deleted announcements.',
      );
    }

    next();
  },
);

/*
 * ============================================================================
 * QUERY MUTATION SAFETY
 * ============================================================================
 */

for (const method of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
]) {
  AnnouncementSchema.pre(
    method,
    rejectGenericMutation,
  );
}

/*
 * Update pipelines are explicitly disabled.
 */
AnnouncementSchema.pre(
  'updateOne',
  function rejectUpdatePipeline(
    next,
  ) {
    if (
      Array.isArray(
        this.getUpdate(),
      )
    ) {
      return next(
        new Error(
          'Announcement update pipelines are disabled.',
        ),
      );
    }

    return next();
  },
);

AnnouncementSchema.pre(
  'updateMany',
  function rejectUpdateManyPipeline(
    next,
  ) {
    if (
      Array.isArray(
        this.getUpdate(),
      )
    ) {
      return next(
        new Error(
          'Announcement update pipelines are disabled.',
        ),
      );
    }

    return next();
  },
);

AnnouncementSchema.pre(
  'findOneAndUpdate',
  function rejectFindOneAndUpdatePipeline(
    next,
  ) {
    if (
      Array.isArray(
        this.getUpdate(),
      )
    ) {
      return next(
        new Error(
          'Announcement update pipelines are disabled.',
        ),
      );
    }

    return next();
  },
);

/*
 * Bulk updates are deliberately disabled.
 */
AnnouncementSchema.pre(
  'bulkWrite',
  function rejectBulkWrite(
    next,
  ) {
    next(
      new Error(
        'Announcement.bulkWrite() is disabled; use controlled announcement operations.',
      ),
    );
  },
);

/*
 * ============================================================================
 * HARD DELETE PROTECTION
 * ============================================================================
 */

AnnouncementSchema.pre(
  'deleteOne',
  function rejectDeleteOne(
    next,
  ) {
    next(
      new Error(
        'Announcement hard deletion is disabled; use softDelete().',
      ),
    );
  },
);

AnnouncementSchema.pre(
  'deleteOne',
  {
    document: true,
    query: false,
  },
  function rejectDocumentDeleteOne(
    next,
  ) {
    next(
      new Error(
        'Announcement hard deletion is disabled; use softDelete().',
      ),
    );
  },
);

AnnouncementSchema.pre(
  'deleteMany',
  function rejectDeleteMany(
    next,
  ) {
    next(
      new Error(
        'Announcement hard deletion is disabled; use a controlled retention workflow.',
      ),
    );
  },
);

AnnouncementSchema.pre(
  'findOneAndDelete',
  function rejectFindOneAndDelete(
    next,
  ) {
    next(
      new Error(
        'Announcement hard deletion is disabled; use softDelete().',
      ),
    );
  },
);

/*
 * ============================================================================
 * INSTANCE METHODS
 * ============================================================================
 */

/**
 * Determine whether the announcement is currently visible to an already
 * authorized caller.
 */
AnnouncementSchema.methods.isCurrentlyActive =
  function isCurrentlyActive(
    now = new Date(),
  ) {
    return (
      !this.isDeleted &&
      this.status ===
        'published' &&
      (!this.publishedAt ||
        this.publishedAt <=
          now) &&
      (!this.expiresAt ||
        this.expiresAt >
          now)
    );
  };

/**
 * Soft delete.
 */
AnnouncementSchema.methods.softDelete =
  async function softDelete(
    actorId,
    options = {},
  ) {
    assertObjectId(
      actorId,
      'actorId',
    );

    if (
      this.status ===
      'deleted'
    ) {
      return this;
    }

    assertLifecycleTransition(
      this.status,
      'deleted',
    );

    this.status =
      'deleted';

    this.isDeleted =
      true;

    this.deletedAt =
      new Date();

    this.deletedBy =
      actorId;

    this.updatedBy =
      actorId;

    this.version +=
      1;

    return this.save({
      session:
        options.session,
    });
  };

/**
 * Schedule publication.
 */
AnnouncementSchema.methods.schedule =
  async function schedule(
    scheduledAt,
    actorId,
    options = {},
  ) {
    assertObjectId(
      actorId,
      'actorId',
    );

    const date =
      normalizeDate(
        scheduledAt,
        'scheduledAt',
      );

    if (
      date <= new Date()
    ) {
      throw new Error(
        'scheduledAt must be in the future.',
      );
    }

    assertLifecycleTransition(
      this.status,
      'scheduled',
    );

    this.status =
      'scheduled';

    this.scheduledAt =
      date;

    this.publishedAt =
      null;

    this.updatedBy =
      actorId;

    this.version +=
      1;

    return this.save({
      session:
        options.session,
    });
  };

/**
 * Publish immediately.
 */
AnnouncementSchema.methods.publish =
  async function publish(
    actorId,
    options = {},
  ) {
    assertObjectId(
      actorId,
      'actorId',
    );

    assertLifecycleTransition(
      this.status,
      'published',
    );

    const now =
      new Date();

    if (
      this.expiresAt &&
      this.expiresAt <=
        now
    ) {
      throw new Error(
        'Cannot publish an already-expired announcement.',
      );
    }

    this.status =
      'published';

    this.publishedAt =
      this.publishedAt ||
      now;

    this.publishedBy =
      actorId;

    this.updatedBy =
      actorId;

    this.version +=
      1;

    return this.save({
      session:
        options.session,
    });
  };

/**
 * Publish a scheduled announcement at the worker-controlled time.
 */
AnnouncementSchema.methods.publishScheduled =
  async function publishScheduled(
    options = {},
  ) {
    if (
      this.status !==
      'scheduled'
    ) {
      throw new Error(
        'Only scheduled announcements can be published by the scheduled publication workflow.',
      );
    }

    const now =
      new Date();

    if (
      !this.scheduledAt
    ) {
      throw new Error(
        'Scheduled publication requires scheduledAt.',
      );
    }

    if (
      this.scheduledAt >
      now
    ) {
      throw new Error(
        'The scheduled publication time has not been reached.',
      );
    }

    if (
      this.expiresAt &&
      this.expiresAt <=
        now
    ) {
      throw new Error(
        'Cannot publish an announcement whose expiration time has already passed.',
      );
    }

    assertLifecycleTransition(
      this.status,
      'published',
    );

    this.status =
      'published';

    this.publishedAt =
      now;

    this.scheduledAt =
      null;

    this.version +=
      1;

    return this.save({
      session:
        options.session,
    });
  };

/**
 * Archive a published or expired announcement.
 */
AnnouncementSchema.methods.archive =
  async function archive(
    actorId,
    options = {},
  ) {
    assertObjectId(
      actorId,
      'actorId',
    );

    assertLifecycleTransition(
      this.status,
      'archived',
    );

    this.status =
      'archived';

    this.archivedBy =
      actorId;

    this.updatedBy =
      actorId;

    this.version +=
      1;

    return this.save({
      session:
        options.session,
    });
  };

/**
 * Restore an archived announcement to draft state.
 *
 * Republished content should go through publish() afterward.
 */
AnnouncementSchema.methods.restore =
  async function restore(
    actorId,
    options = {},
  ) {
    assertObjectId(
      actorId,
      'actorId',
    );

    if (
      this.status !==
      'archived'
    ) {
      throw new Error(
        'Only archived announcements can be restored through the standard restore workflow.',
      );
    }

    this.status =
      'draft';

    this.updatedBy =
      actorId;

    this.version +=
      1;

    return this.save({
      session:
        options.session,
    });
  };

/**
 * Mark as expired.
 *
 * Intended for the expiration worker.
 */
AnnouncementSchema.methods.expire =
  async function expire(
    options = {},
  ) {
    if (
      this.status !==
      'published'
    ) {
      throw new Error(
        'Only published announcements can be expired.',
      );
    }

    assertLifecycleTransition(
      this.status,
      'expired',
    );

    const now =
      new Date();

    if (
      !this.expiresAt
    ) {
      throw new Error(
        'Announcement has no expiration timestamp.',
      );
    }

    if (
      this.expiresAt >
      now
    ) {
      throw new Error(
        'Announcement has not reached its expiration time.',
      );
    }

    this.status =
      'expired';

    this.version +=
      1;

    return this.save({
      session:
        options.session,
    });
  };

/**
 * Update editable announcement content/configuration while maintaining
 * optimistic versioning.
 */
AnnouncementSchema.methods.updateContent =
  async function updateContent(
    patch = {},
    actorId,
    options = {},
  ) {
    assertObjectId(
      actorId,
      'actorId',
    );

    if (
      this.status ===
      'deleted'
    ) {
      throw new Error(
        'Deleted announcements cannot be edited.',
      );
    }

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

    for (
      const field of allowedFields
    ) {
      if (
        Object.prototype.hasOwnProperty.call(
          patch,
          field,
        )
      ) {
        this[field] =
          patch[field];
      }
    }

    this.updatedBy =
      actorId;

    this.version +=
      1;

    return this.save({
      session:
        options.session,
    });
  };

/**
 * Safe public response.
 */
AnnouncementSchema.methods.toPublicJSON =
  function toPublicJSON() {
    return {
      id: String(
        this._id,
      ),

      title:
        this.title,

      summary:
        this.summary,

      body:
        this.body,

      slug:
        this.slug,

      type:
        this.type,

      category:
        this.category,

      priority:
        this.priority,

      severity:
        this.severity,

      status:
        this.status,

      tenantId:
        this.tenantId
          ? String(
              this.tenantId,
            )
          : null,

      audience: {
        scope:
          this.audience?.scope ??
          null,

        roles:
          this.audience?.roles ??
          [],
      },

      isPinned:
        this.isPinned,

      requiresAcknowledgement:
        this.requiresAcknowledgement,

      allowDismiss:
        this.allowDismiss,

      action:
        this.action,

      imageUrl:
        this.imageUrl,

      icon:
        this.icon,

      tags:
        this.metadata?.tags ??
        [],

      createdAt:
        this.createdAt,

      updatedAt:
        this.updatedAt,

      publishedAt:
        this.publishedAt,

      scheduledAt:
        this.scheduledAt,

      expiresAt:
        this.expiresAt,
    };
  };

/*
 * ============================================================================
 * STATIC OPERATIONS
 * ============================================================================
 */

/**
 * Standard filter for currently active announcements.
 *
 * Authorization/audience predicates must be added by the service layer.
 */
AnnouncementSchema.statics.activeFilter =
  function activeFilter(
    now = new Date(),
  ) {
    return {
      isDeleted: false,

      status:
        'published',

      $and: [
        {
          $or: [
            {
              publishedAt:
                null,
            },
            {
              publishedAt: {
                $lte: now,
              },
            },
          ],
        },
        {
          $or: [
            {
              expiresAt:
                null,
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
  };

/**
 * Tenant-scoped active announcement filter.
 */
AnnouncementSchema.statics.tenantActiveFilter =
  function tenantActiveFilter(
    tenantId,
    now = new Date(),
  ) {
    assertObjectId(
      tenantId,
      'tenantId',
    );

    return {
      tenantId,
      ...this.activeFilter(
        now,
      ),
    };
  };

/**
 * Find one announcement within a tenant.
 */
AnnouncementSchema.statics.findTenantAnnouncement =
  function findTenantAnnouncement(
    tenantId,
    announcementId,
    options = {},
  ) {
    assertObjectId(
      tenantId,
      'tenantId',
    );

    assertObjectId(
      announcementId,
      'announcementId',
    );

    const filter = {
      _id:
        announcementId,
      tenantId,
    };

    if (
      options.includeDeleted !==
      true
    ) {
      filter.isDeleted =
        false;
    }

    const query =
      this.findOne(
        filter,
      );

    if (
      options.session
    ) {
      query.session(
        options.session,
      );
    }

    return query.exec();
  };

/**
 * Find a platform/global announcement.
 */
AnnouncementSchema.statics.findPlatformAnnouncement =
  function findPlatformAnnouncement(
    announcementId,
    options = {},
  ) {
    assertObjectId(
      announcementId,
      'announcementId',
    );

    const filter = {
      _id:
        announcementId,
      tenantId:
        null,
    };

    if (
      options.includeDeleted !==
      true
    ) {
      filter.isDeleted =
        false;
    }

    const query =
      this.findOne(
        filter,
      );

    if (
      options.session
    ) {
      query.session(
        options.session,
      );
    }

    return query.exec();
  };

/**
 * Retrieve the active tenant feed.
 *
 * Audience authorization is intentionally NOT inferred here.
 */
AnnouncementSchema.statics.findTenantFeed =
  function findTenantFeed(
    tenantId,
    options = {},
  ) {
    assertObjectId(
      tenantId,
      'tenantId',
    );

    const limit =
      Math.min(
        Math.max(
          Number(
            options.limit,
          ) || 50,
          1,
        ),
        100,
      );

    const filter =
      this.tenantActiveFilter(
        tenantId,
        options.now ||
          new Date(),
      );

    if (
      options.category
    ) {
      filter.category =
        normalizeEnumString(
          options.category,
        );
    }

    if (
      options.type
    ) {
      filter.type =
        normalizeEnumString(
          options.type,
        );
    }

    if (
      options.priority
    ) {
      filter.priority =
        normalizeEnumString(
          options.priority,
        );
    }

    if (
      options.before
    ) {
      const before =
        normalizeDate(
          options.before,
          'before',
        );

      filter.$or = [
        {
          publishedAt: {
            $lt: before,
          },
        },
        {
          publishedAt:
            before,
        },
      ];
    }

    const query =
      this.find(filter)
        .sort({
          isPinned: -1,
          priority: -1,
          publishedAt: -1,
          _id: -1,
        })
        .limit(limit)
        .lean();

    if (
      options.session
    ) {
      query.session(
        options.session,
      );
    }

    return query.exec();
  };

/**
 * Find announcements ready for scheduled publication.
 *
 * Intended for the scheduler/worker service.
 */
AnnouncementSchema.statics.findDueScheduled =
  function findDueScheduled(
    now = new Date(),
    options = {},
  ) {
    const query =
      this.find({
        status:
          'scheduled',

        isDeleted:
          false,

        scheduledAt: {
          $lte: now,
        },
      })
        .sort({
          scheduledAt: 1,
          _id: 1,
        })
        .limit(
          Math.min(
            Math.max(
              Number(
                options.limit,
              ) || 100,
              1,
            ),
            500,
          ),
        );

    if (
      options.session
    ) {
      query.session(
        options.session,
      );
    }

    return query.exec();
  };

/**
 * Find announcements that have reached their expiration time.
 */
AnnouncementSchema.statics.findDueExpirations =
  function findDueExpirations(
    now = new Date(),
    options = {},
  ) {
    const query =
      this.find({
        status:
          'published',

        isDeleted:
          false,

        expiresAt: {
          $ne: null,
          $lte: now,
        },
      })
        .sort({
          expiresAt: 1,
          _id: 1,
        })
        .limit(
          Math.min(
            Math.max(
              Number(
                options.limit,
              ) || 100,
              1,
            ),
            500,
          ),
        );

    if (
      options.session
    ) {
      query.session(
        options.session,
      );
    }

    return query.exec();
  };

/**
 * Normalize and deduplicate an audience target list.
 *
 * This helper is useful to services before persisting an announcement.
 */
AnnouncementSchema.statics.normalizeAudience =
  function normalizeAudience(
    audience = {},
  ) {
    const normalized = {
      scope:
        normalizeEnumString(
          audience.scope ||
            'authenticated_users',
        ),

      roles: [
        ...new Set(
          (
            audience.roles ||
            []
          )
            .map((role) =>
              normalizeString(
                role,
              ).toLowerCase(),
            )
            .filter(
              Boolean,
            ),
        ),
      ],

      tenantIds:
        normalizeUniqueObjectIds(
          audience.tenantIds ||
            [],
        ),

      groupIds:
        normalizeUniqueObjectIds(
          audience.groupIds ||
            [],
        ),

      userIds:
        normalizeUniqueObjectIds(
          audience.userIds ||
            [],
        ),
    };

    return normalized;
  };

/*
 * ============================================================================
 * MODEL
 * ============================================================================
 */

const Announcement =
  mongoose.models
    .Announcement ||
  mongoose.model(
    'Announcement',
    AnnouncementSchema,
  );

export {
  AnnouncementActionSchema,
  AnnouncementAudienceSchema,
  AnnouncementMetadataSchema,
  AnnouncementSchema,
};

export default Announcement;

/*
 * ============================================================================
 * END OF TITech COMMUNITY CAPITAL LTD ANNOUNCEMENT MODEL
 * ============================================================================
 */