/**
 * ============================================================================
 * backend/models/AnnouncementRead.js
 * TITech Community Capital LTD
 * Enterprise Announcement User State Aggregate
 * ============================================================================
 *
 * Architectural role
 * ----------------------------------------------------------------------------
 * AnnouncementRead stores the per-user interaction state for an
 * Announcement.
 *
 * It supports:
 *
 *   - read / unread state
 *   - first / last viewing activity
 *   - dismissal
 *   - acknowledgement
 *   - per-user announcement history
 *   - tenant-aware querying
 *   - high-volume notification-center workloads
 *   - auditable interaction timestamps
 *
 * Relationship
 * ----------------------------------------------------------------------------
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
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * AnnouncementRead is NOT:
 *   - the source of truth for announcement content;
 *   - an authorization replacement;
 *   - a notification queue;
 *   - a delivery provider record;
 *   - an audit-log replacement;
 *   - a substitute for Announcement lifecycle state;
 *   - a substitute for tenant membership validation.
 *
 * AnnouncementRead records user interaction state, not announcement
 * publication or delivery state.
 *
 * Security principles
 * ----------------------------------------------------------------------------
 *   - Explicit tenant context for tenant-scoped announcements.
 *   - User-scoped interaction state.
 *   - Announcement reference is immutable.
 *   - User reference is immutable.
 *   - Tenant reference is immutable.
 *   - One user interaction-state document per announcement/user pair.
 *   - Controlled mutation operations are preferred over unrestricted updates.
 *   - Normal update pipelines are disabled.
 *   - Bulk mutation is disabled.
 *   - Hard deletion is restricted.
 *   - Read/dismissal/acknowledgement timestamps are internally consistent.
 *   - View counters are bounded and incremented through controlled methods.
 *   - Optimistic concurrency is enabled for document workflows.
 *   - Atomic static operations are available for high-volume workloads.
 *   - Tenant authorization remains a service-layer responsibility.
 *
 * Design principles
 * ----------------------------------------------------------------------------
 *   ✓ Multi-tenant aware
 *   ✓ User-scoped
 *   ✓ Auditable
 *   ✓ Idempotent-friendly
 *   ✓ High-volume query optimized
 *   ✓ MongoDB/Mongoose production oriented
 *   ✓ Native ESM
 *   ✓ Backward compatible with AnnouncementRead field names
 *   ✓ Safe for controlled concurrent updates
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

export const ANNOUNCEMENT_ACTIONS = Object.freeze([
  'viewed',
  'read',
  'dismissed',
  'acknowledged',
  'unread',
]);

export const MAX_LAST_ACTION_LENGTH = 100;
export const MAX_VIEW_COUNT = Number.MAX_SAFE_INTEGER;

/*
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function assertRequired(value, name) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    throw new TypeError(
      `${name} is required`
    );
  }
}

function assertObjectId(value, name) {
  assertRequired(value, name);

  if (
    !mongoose.isObjectIdOrHexString(value)
  ) {
    throw new mongoose.Error.CastError(
      'ObjectId',
      value,
      name
    );
  }
}

function normalizeDate(value, name = 'date') {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new TypeError(
      `${name} must be a valid date`
    );
  }

  return date;
}

function normalizeAction(value) {
  return String(
    value ?? ''
  )
    .trim()
    .toLowerCase();
}

function assertValidAction(action) {
  if (
    !ANNOUNCEMENT_ACTIONS.includes(
      action
    )
  ) {
    throw new Error(
      `Unsupported announcement action: ${action}`
    );
  }
}

/*
 * ============================================================================
 * SCHEMA
 * ============================================================================
 */

const AnnouncementReadSchema =
  new Schema(
    {
      /**
       * ----------------------------------------------------------------------
       * Announcement reference
       * ----------------------------------------------------------------------
       */
      announcementId: {
        type: Schema.Types.ObjectId,
        ref: 'Announcement',
        required: true,
        immutable: true,
        index: true,
      },

      /**
       * ----------------------------------------------------------------------
       * Tenant reference
       * ----------------------------------------------------------------------
       *
       * Null is permitted for platform/global announcements.
       *
       * The service layer must verify that:
       *
       *   announcement.tenantId === interaction.tenantId
       *
       * for tenant-scoped announcements.
       */
      tenantId: {
        type: Schema.Types.ObjectId,
        ref: 'Tenant',
        default: null,
        immutable: true,
        index: true,
      },

      /**
       * ----------------------------------------------------------------------
       * User reference
       * ----------------------------------------------------------------------
       */
      userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true,
        index: true,
      },

      /**
       * ----------------------------------------------------------------------
       * Read state
       * ----------------------------------------------------------------------
       */
      isRead: {
        type: Boolean,
        default: false,
        index: true,
      },

      /**
       * First-read timestamp.
       *
       * This should normally be populated once and preserved thereafter,
       * including when markUnread() is used.
       */
      readAt: {
        type: Date,
        default: null,
      },

      /**
       * ----------------------------------------------------------------------
       * Dismissal state
       * ----------------------------------------------------------------------
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
       * ----------------------------------------------------------------------
       * Acknowledgement state
       * ----------------------------------------------------------------------
       *
       * Useful for:
       *
       *   - mandatory notices
       *   - compliance communications
       *   - policy changes
       *   - regulatory notices
       *   - explicit user confirmations
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
       * ----------------------------------------------------------------------
       * View tracking
       * ----------------------------------------------------------------------
       */

      firstViewedAt: {
        type: Date,
        default: null,
      },

      lastViewedAt: {
        type: Date,
        default: null,
      },

      viewCount: {
        type: Number,
        default: 0,
        min: 0,
        max: MAX_VIEW_COUNT,
        validate: {
          validator(value) {
            return Number.isSafeInteger(
              value
            );
          },
          message:
            'viewCount must be a non-negative safe integer.',
        },
      },

      /**
       * ----------------------------------------------------------------------
       * Last interaction
       * ----------------------------------------------------------------------
       */
      lastAction: {
        type: String,
        default: null,
        trim: true,
        lowercase: true,
        maxlength:
          MAX_LAST_ACTION_LENGTH,
        enum: {
          values:
            ANNOUNCEMENT_ACTIONS,
          message:
            'Invalid announcement interaction action.',
        },
      },
    },
    {
      timestamps: true,

      /*
       * Keep the Mongoose version key because optimistic concurrency is
       * enabled. This is preferable to silently removing the concurrency
       * marker for a frequently updated state document.
       */
      versionKey: '__v',

      collection:
        'announcement_reads',

      strict: true,

      /*
       * Explicit null timestamps retain semantic meaning.
       */
      minimize: false,

      optimisticConcurrency: true,

      toJSON: {
        virtuals: true,

        transform(
          _doc,
          ret
        ) {
          if (ret._id) {
            ret.id =
              String(ret._id);
          }

          delete ret._id;
          delete ret.__v;

          return ret;
        },
      },

      toObject: {
        virtuals: true,

        transform(
          _doc,
          ret
        ) {
          if (ret._id) {
            ret.id =
              String(ret._id);
          }

          delete ret._id;
          delete ret.__v;

          return ret;
        },
      },
    }
  );

/*
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/*
 * Exactly one interaction-state document is allowed for a user +
 * announcement relationship.
 *
 * tenantId is intentionally excluded because announcementId identifies the
 * announcement relationship itself.
 */
AnnouncementReadSchema.index(
  {
    announcementId: 1,
    userId: 1,
  },
  {
    unique: true,
    name:
      'uniq_announcement_user_state',
  }
);

/*
 * Tenant + user + read state.
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    userId: 1,
    isRead: 1,
    updatedAt: -1,
  },
  {
    name:
      'idx_tenant_user_read_state',
  }
);

/*
 * Tenant + user + dismissed state.
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    userId: 1,
    isDismissed: 1,
    updatedAt: -1,
  },
  {
    name:
      'idx_tenant_user_dismissed_state',
  }
);

/*
 * Tenant + user + acknowledgement state.
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    userId: 1,
    isAcknowledged: 1,
    updatedAt: -1,
  },
  {
    name:
      'idx_tenant_user_acknowledged_state',
  }
);

/*
 * User interaction history.
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    userId: 1,
    updatedAt: -1,
    _id: -1,
  },
  {
    name:
      'idx_tenant_user_updated',
  }
);

/*
 * Announcement engagement.
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    announcementId: 1,
    updatedAt: -1,
    _id: -1,
  },
  {
    name:
      'idx_tenant_announcement_updated',
  }
);

/*
 * Announcement acknowledgement reporting.
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    announcementId: 1,
    isAcknowledged: 1,
    updatedAt: -1,
  },
  {
    name:
      'idx_tenant_announcement_acknowledged',
  }
);

/*
 * Announcement read reporting.
 */
AnnouncementReadSchema.index(
  {
    tenantId: 1,
    announcementId: 1,
    isRead: 1,
    updatedAt: -1,
  },
  {
    name:
      'idx_tenant_announcement_read',
  }
);

/*
 * ============================================================================
 * VALIDATION / NORMALIZATION
 * ============================================================================
 */

AnnouncementReadSchema.pre(
  'validate',
  function announcementReadValidation(
    next
  ) {
    /*
     * Ensure boolean/timestamp state remains internally coherent.
     */
    if (
      this.isRead &&
      !this.readAt
    ) {
      this.readAt =
        new Date();
    }

    if (
      this.isDismissed &&
      !this.dismissedAt
    ) {
      this.dismissedAt =
        new Date();
    }

    if (
      this.isAcknowledged &&
      !this.acknowledgedAt
    ) {
      this.acknowledgedAt =
        new Date();
    }

    if (
      this.firstViewedAt &&
      !this.lastViewedAt
    ) {
      this.lastViewedAt =
        this.firstViewedAt;
    }

    if (
      this.lastViewedAt &&
      !this.firstViewedAt
    ) {
      this.firstViewedAt =
        this.lastViewedAt;
    }

    if (
      !Number.isSafeInteger(
        this.viewCount
      ) ||
      this.viewCount < 0
    ) {
      this.invalidate(
        'viewCount',
        'viewCount must be a non-negative safe integer.'
      );
    }

    if (
      this.lastAction !== null &&
      this.lastAction !== undefined
    ) {
      const action =
        normalizeAction(
          this.lastAction
        );

      assertValidAction(
        action
      );

      this.lastAction =
        action;
    }

    if (
      this.tenantId &&
      !mongoose.isObjectIdOrHexString(
        this.tenantId
      )
    ) {
      this.invalidate(
        'tenantId',
        'tenantId must be a valid ObjectId.'
      );
    }

    next();
  }
);

/*
 * ============================================================================
 * QUERY MUTATION SAFETY
 * ============================================================================
 *
 * AnnouncementRead is an interaction-state document. Normal document
 * workflows should use instance methods or controlled static operations.
 *
 * This prevents arbitrary callers from changing multiple state fields
 * without the timestamp/action invariants being applied.
 * ============================================================================
 */

function rejectGenericMutation(
  next
) {
  const options =
    typeof this.getOptions ===
    'function'
      ? this.getOptions()
      : this.options || {};

  if (
    options.announcementReadInternal ===
    true
  ) {
    return next();
  }

  return next(
    new Error(
      `Direct ${this.op} mutations on AnnouncementRead are disabled; ` +
        'use a dedicated AnnouncementRead operation/service'
    )
  );
}

for (const method of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
]) {
  AnnouncementReadSchema.pre(
    method,
    rejectGenericMutation
  );
}

AnnouncementReadSchema.pre(
  'updateOne',
  function rejectUpdatePipeline(
    next
  ) {
    if (
      Array.isArray(
        this.getUpdate()
      )
    ) {
      return next(
        new Error(
          'AnnouncementRead update pipelines are disabled'
        )
      );
    }

    return next();
  }
);

AnnouncementReadSchema.pre(
  'updateMany',
  function rejectUpdateManyPipeline(
    next
  ) {
    if (
      Array.isArray(
        this.getUpdate()
      )
    ) {
      return next(
        new Error(
          'AnnouncementRead update pipelines are disabled'
        )
      );
    }

    return next();
  }
);

AnnouncementReadSchema.pre(
  'findOneAndUpdate',
  function rejectFindOneAndUpdatePipeline(
    next
  ) {
    if (
      Array.isArray(
        this.getUpdate()
      )
    ) {
      return next(
        new Error(
          'AnnouncementRead update pipelines are disabled'
        )
      );
    }

    return next();
  }
);

/*
 * Replacement operations can bypass state invariants.
 */
AnnouncementReadSchema.pre(
  'replaceOne',
  function rejectReplaceOne(
    next
  ) {
    next(
      new Error(
        'AnnouncementRead replacement is disabled; use controlled operations'
      )
    );
  }
);

AnnouncementReadSchema.pre(
  'findOneAndReplace',
  function rejectFindOneAndReplace(
    next
  ) {
    next(
      new Error(
        'AnnouncementRead replacement is disabled; use controlled operations'
      )
    );
  }
);

/*
 * Bulk updates bypass interaction invariants.
 */
AnnouncementReadSchema.pre(
  'bulkWrite',
  function rejectBulkWrite(
    next
  ) {
    next(
      new Error(
        'AnnouncementRead.bulkWrite() is disabled; use controlled operations'
      )
    );
  }
);

/*
 * ============================================================================
 * DELETE POLICY
 * ============================================================================
 *
 * Interaction state is historical user state. Hard deletion should normally
 * be performed only by a dedicated retention/privacy workflow.
 * ============================================================================
 */

AnnouncementReadSchema.pre(
  'deleteOne',
  function rejectDeleteOne(
    next
  ) {
    next(
      new Error(
        'AnnouncementRead hard deletion is disabled; use a controlled retention workflow'
      )
    );
  }
);

AnnouncementReadSchema.pre(
  'deleteOne',
  {
    document: true,
    query: false,
  },
  function rejectDocumentDeleteOne(
    next
  ) {
    next(
      new Error(
        'AnnouncementRead hard deletion is disabled; use a controlled retention workflow'
      )
    );
  }
);

AnnouncementReadSchema.pre(
  'deleteMany',
  function rejectDeleteMany(
    next
  ) {
    next(
      new Error(
        'AnnouncementRead hard deletion is disabled; use a controlled retention workflow'
      )
    );
  }
);

AnnouncementReadSchema.pre(
  'findOneAndDelete',
  function rejectFindOneAndDelete(
    next
  ) {
    next(
      new Error(
        'AnnouncementRead hard deletion is disabled; use a controlled retention workflow'
      )
    );
  }
);

/*
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

AnnouncementReadSchema.virtual(
  'hasInteraction'
).get(function hasInteraction() {
  return Boolean(
    this.firstViewedAt ||
    this.lastViewedAt ||
    this.isRead ||
    this.isDismissed ||
    this.isAcknowledged ||
    this.viewCount > 0
  );
});

AnnouncementReadSchema.virtual(
  'isInteracted'
).get(function isInteracted() {
  return Boolean(
    this.firstViewedAt ||
    this.isRead ||
    this.isDismissed ||
    this.isAcknowledged ||
    this.viewCount > 0
  );
});

/*
 * ============================================================================
 * INSTANCE METHODS
 * ============================================================================
 */

/**
 * Determine whether this interaction document has recorded activity.
 */
AnnouncementReadSchema.methods.hasAnyInteraction =
  function hasAnyInteraction() {
    return Boolean(
      this.firstViewedAt ||
      this.isRead ||
      this.isDismissed ||
      this.isAcknowledged ||
      this.viewCount > 0
    );
  };

/**
 * Record a view.
 */
AnnouncementReadSchema.methods.recordView =
  function recordView(
    date = new Date()
  ) {
    const viewedAt =
      normalizeDate(
        date,
        'view date'
      );

    if (
      !this.firstViewedAt
    ) {
      this.firstViewedAt =
        viewedAt;
    }

    this.lastViewedAt =
      viewedAt;

    if (
      this.viewCount >=
      MAX_VIEW_COUNT
    ) {
      throw new RangeError(
        'viewCount has reached the maximum safe integer'
      );
    }

    this.viewCount += 1;
    this.lastAction =
      'viewed';

    return this;
  };

/**
 * Mark as read.
 */
AnnouncementReadSchema.methods.markRead =
  function markRead(
    date = new Date()
  ) {
    const readAt =
      normalizeDate(
        date,
        'read date'
      );

    this.isRead = true;

    /*
     * Preserve first-read timestamp.
     */
    if (
      !this.readAt
    ) {
      this.readAt =
        readAt;
    }

    this.lastAction =
      'read';

    return this;
  };

/**
 * Mark unread.
 *
 * readAt is deliberately preserved as historical first-read evidence.
 */
AnnouncementReadSchema.methods.markUnread =
  function markUnread() {
    this.isRead = false;
    this.lastAction =
      'unread';

    return this;
  };

/**
 * Dismiss the announcement.
 */
AnnouncementReadSchema.methods.dismiss =
  function dismiss(
    date = new Date()
  ) {
    const dismissedAt =
      normalizeDate(
        date,
        'dismissal date'
      );

    this.isDismissed =
      true;

    if (
      !this.dismissedAt
    ) {
      this.dismissedAt =
        dismissedAt;
    }

    this.lastAction =
      'dismissed';

    return this;
  };

/**
 * Acknowledge the announcement.
 */
AnnouncementReadSchema.methods.acknowledge =
  function acknowledge(
    date = new Date()
  ) {
    const acknowledgedAt =
      normalizeDate(
        date,
        'acknowledgement date'
      );

    this.isAcknowledged =
      true;

    if (
      !this.acknowledgedAt
    ) {
      this.acknowledgedAt =
        acknowledgedAt;
    }

    this.lastAction =
      'acknowledged';

    return this;
  };

/**
 * Persist the current state using an optional transaction session.
 */
AnnouncementReadSchema.methods.persist =
  function persist(
    options = {}
  ) {
    return this.save({
      session:
        options.session,
    });
  };

/*
 * ============================================================================
 * STATIC OPERATIONS
 * ============================================================================
 */

/**
 * Find one user's interaction state.
 */
AnnouncementReadSchema.statics.findUserState =
  function findUserState(
    announcementId,
    userId,
    options = {}
  ) {
    assertObjectId(
      announcementId,
      'announcementId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    const query =
      this.findOne({
        announcementId,
        userId,
      });

    if (
      options.session
    ) {
      query.session(
        options.session
      );
    }

    return query.exec();
  };

/**
 * Find one tenant-scoped user interaction state.
 */
AnnouncementReadSchema.statics.findTenantUserState =
  function findTenantUserState(
    tenantId,
    announcementId,
    userId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      announcementId,
      'announcementId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    const query =
      this.findOne({
        tenantId,
        announcementId,
        userId,
      });

    if (
      options.session
    ) {
      query.session(
        options.session
      );
    }

    return query.exec();
  };

/**
 * Create the user's state document.
 *
 * The unique announcementId + userId index guarantees one state document.
 */
AnnouncementReadSchema.statics.createUserState =
  async function createUserState(
    {
      announcementId,
      tenantId = null,
      userId,
    },
    options = {}
  ) {
    assertObjectId(
      announcementId,
      'announcementId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    if (
      tenantId !== null
    ) {
      assertObjectId(
        tenantId,
        'tenantId'
      );
    }

    const state =
      new this({
        announcementId,
        tenantId,
        userId,
      });

    return state.save({
      session:
        options.session,
    });
  };

/**
 * Get or create a user's announcement state.
 *
 * Intended for idempotent notification-center workflows.
 */
AnnouncementReadSchema.statics.getOrCreateUserState =
  async function getOrCreateUserState(
    {
      announcementId,
      tenantId = null,
      userId,
    },
    options = {}
  ) {
    assertObjectId(
      announcementId,
      'announcementId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    if (
      tenantId !== null
    ) {
      assertObjectId(
        tenantId,
        'tenantId'
      );
    }

    const filter = {
      announcementId,
      userId,
    };

    const update = {
      $setOnInsert: {
        announcementId,
        tenantId,
        userId,
        isRead: false,
        isDismissed: false,
        isAcknowledged: false,
        readAt: null,
        dismissedAt: null,
        acknowledgedAt:
          null,
        firstViewedAt: null,
        lastViewedAt: null,
        viewCount: 0,
        lastAction: null,
      },
    };

    return this.findOneAndUpdate(
      filter,
      update,
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert:
          true,
        runValidators: true,
        announcementReadInternal:
          true,
        session:
          options.session,
      }
    ).exec();
  };

/**
 * Atomically record one view.
 *
 * This is preferable to read-modify-save in high-volume workloads because
 * viewCount is incremented inside MongoDB.
 */
AnnouncementReadSchema.statics.recordViewForUser =
  async function recordViewForUser(
    {
      announcementId,
      tenantId = null,
      userId,
      date = new Date(),
    },
    options = {}
  ) {
    assertObjectId(
      announcementId,
      'announcementId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    if (
      tenantId !== null
    ) {
      assertObjectId(
        tenantId,
        'tenantId'
      );
    }

    const viewedAt =
      normalizeDate(
        date,
        'view date'
      );

    /*
     * Create-on-first-use using $setOnInsert and then increment the view
     * counter atomically.
     */
    const query =
      this.findOneAndUpdate(
        {
          announcementId,
          userId,
        },
        {
          $setOnInsert: {
            announcementId,
            tenantId,
            userId,
            isRead: false,
            isDismissed: false,
            isAcknowledged: false,
            readAt: null,
            dismissedAt: null,
            acknowledgedAt:
              null,
            firstViewedAt:
              viewedAt,
            lastViewedAt:
              viewedAt,
            viewCount: 0,
          },

          $set: {
            lastViewedAt:
              viewedAt,
            lastAction:
              'viewed',
          },

          $inc: {
            viewCount: 1,
          },
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert:
            true,
          runValidators: true,
          announcementReadInternal:
            true,
          session:
            options.session,
        }
      );

    return query.exec();
  };

/**
 * Atomically mark a user's state as read.
 *
 * Returns the updated state document.
 */
AnnouncementReadSchema.statics.markReadForUser =
  async function markReadForUser(
    {
      announcementId,
      tenantId = null,
      userId,
      date = new Date(),
    },
    options = {}
  ) {
    assertObjectId(
      announcementId,
      'announcementId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    if (
      tenantId !== null
    ) {
      assertObjectId(
        tenantId,
        'tenantId'
      );
    }

    const readAt =
      normalizeDate(
        date,
        'read date'
      );

    return this.findOneAndUpdate(
      {
        announcementId,
        userId,
      },
      {
        $setOnInsert: {
          announcementId,
          tenantId,
          userId,
          isRead: false,
          isDismissed: false,
          isAcknowledged: false,
          readAt: null,
          dismissedAt: null,
          acknowledgedAt:
            null,
          firstViewedAt: null,
          lastViewedAt: null,
          viewCount: 0,
        },

        $set: {
          isRead: true,
          lastAction: 'read',
        },

        $setOnInsert: {
          announcementId,
          tenantId,
          userId,
          isRead: true,
          isDismissed: false,
          isAcknowledged: false,
          readAt,
          dismissedAt: null,
          acknowledgedAt:
            null,
          firstViewedAt: null,
          lastViewedAt: null,
          viewCount: 0,
          lastAction: 'read',
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert:
          true,
        runValidators: true,
        announcementReadInternal:
          true,
        session:
          options.session,
      }
    ).exec();
  };

/**
 * Atomically mark as unread.
 *
 * Existing readAt is deliberately preserved.
 */
AnnouncementReadSchema.statics.markUnreadForUser =
  async function markUnreadForUser(
    {
      announcementId,
      tenantId = null,
      userId,
    },
    options = {}
  ) {
    assertObjectId(
      announcementId,
      'announcementId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    if (
      tenantId !== null
    ) {
      assertObjectId(
        tenantId,
        'tenantId'
      );
    }

    return this.findOneAndUpdate(
      {
        announcementId,
        userId,
      },
      {
        $set: {
          isRead: false,
          lastAction: 'unread',
        },

        $setOnInsert: {
          announcementId,
          tenantId,
          userId,
          isDismissed: false,
          isAcknowledged: false,
          readAt: null,
          dismissedAt: null,
          acknowledgedAt:
            null,
          firstViewedAt: null,
          lastViewedAt: null,
          viewCount: 0,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert:
          true,
        runValidators: true,
        announcementReadInternal:
          true,
        session:
          options.session,
      }
    ).exec();
  };

/**
 * Atomically dismiss an announcement for a user.
 */
AnnouncementReadSchema.statics.dismissForUser =
  async function dismissForUser(
    {
      announcementId,
      tenantId = null,
      userId,
      date = new Date(),
    },
    options = {}
  ) {
    assertObjectId(
      announcementId,
      'announcementId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    if (
      tenantId !== null
    ) {
      assertObjectId(
        tenantId,
        'tenantId'
      );
    }

    const dismissedAt =
      normalizeDate(
        date,
        'dismissal date'
      );

    return this.findOneAndUpdate(
      {
        announcementId,
        userId,
      },
      {
        $set: {
          isDismissed: true,
          dismissedAt,
          lastAction:
            'dismissed',
        },

        $setOnInsert: {
          announcementId,
          tenantId,
          userId,
          isRead: false,
          isAcknowledged: false,
          readAt: null,
          firstViewedAt: null,
          lastViewedAt: null,
          viewCount: 0,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert:
          true,
        runValidators: true,
        announcementReadInternal:
          true,
        session:
          options.session,
      }
    ).exec();
  };

/**
 * Atomically acknowledge an announcement for a user.
 */
AnnouncementReadSchema.statics.acknowledgeForUser =
  async function acknowledgeForUser(
    {
      announcementId,
      tenantId = null,
      userId,
      date = new Date(),
    },
    options = {}
  ) {
    assertObjectId(
      announcementId,
      'announcementId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    if (
      tenantId !== null
    ) {
      assertObjectId(
        tenantId,
        'tenantId'
      );
    }

    const acknowledgedAt =
      normalizeDate(
        date,
        'acknowledgement date'
      );

    return this.findOneAndUpdate(
      {
        announcementId,
        userId,
      },
      {
        $set: {
          isAcknowledged: true,
          acknowledgedAt,
          lastAction:
            'acknowledged',
        },

        $setOnInsert: {
          announcementId,
          tenantId,
          userId,
          isRead: false,
          isDismissed: false,
          readAt: null,
          dismissedAt: null,
          firstViewedAt: null,
          lastViewedAt: null,
          viewCount: 0,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert:
          true,
        runValidators: true,
        announcementReadInternal:
          true,
        session:
          options.session,
      }
    ).exec();
  };

/**
 * Find unread announcements for one user in a tenant.
 */
AnnouncementReadSchema.statics.findUnreadForUser =
  function findUnreadForUser(
    tenantId,
    userId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    const limit =
      Math.min(
        Math.max(
          Number(
            options.limit
          ) || 100,
          1
        ),
        500
      );

    const query =
      this.find({
        tenantId,
        userId,
        isRead: false,
      })
        .sort({
          updatedAt: -1,
          _id: -1,
        })
        .limit(limit);

    if (
      options.session
    ) {
      query.session(
        options.session
      );
    }

    return query.exec();
  };

/**
 * Count unread announcements for one user.
 */
AnnouncementReadSchema.statics.countUnreadForUser =
  function countUnreadForUser(
    tenantId,
    userId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    const query =
      this.countDocuments({
        tenantId,
        userId,
        isRead: false,
      });

    if (
      options.session
    ) {
      query.session(
        options.session
      );
    }

    return query.exec();
  };

/**
 * Find a user's recent announcement interaction history.
 */
AnnouncementReadSchema.statics.findUserHistory =
  function findUserHistory(
    tenantId,
    userId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      userId,
      'userId'
    );

    const limit =
      Math.min(
        Math.max(
          Number(
            options.limit
          ) || 100,
          1
        ),
        500
      );

    const query =
      this.find({
        tenantId,
        userId,
      })
        .sort({
          updatedAt: -1,
          _id: -1,
        })
        .limit(limit);

    if (
      options.session
    ) {
      query.session(
        options.session
      );
    }

    return query.exec();
  };

/**
 * Count acknowledgement state for one announcement.
 */
AnnouncementReadSchema.statics.countAcknowledgedForAnnouncement =
  function countAcknowledgedForAnnouncement(
    tenantId,
    announcementId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      announcementId,
      'announcementId'
    );

    const query =
      this.countDocuments({
        tenantId,
        announcementId,
        isAcknowledged: true,
      });

    if (
      options.session
    ) {
      query.session(
        options.session
      );
    }

    return query.exec();
  };

/**
 * Count read state for one announcement.
 */
AnnouncementReadSchema.statics.countReadForAnnouncement =
  function countReadForAnnouncement(
    tenantId,
    announcementId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      announcementId,
      'announcementId'
    );

    const query =
      this.countDocuments({
        tenantId,
        announcementId,
        isRead: true,
      });

    if (
      options.session
    ) {
      query.session(
        options.session
      );
    }

    return query.exec();
  };

/*
 * ============================================================================
 * MODEL
 * ============================================================================
 */

const AnnouncementRead =
  mongoose.models.AnnouncementRead ||
  mongoose.model(
    'AnnouncementRead',
    AnnouncementReadSchema
  );

export {
  AnnouncementReadSchema,
};

export default AnnouncementRead;

/*
 * ============================================================================
 * END OF TITech COMMUNITY CAPITAL ANNOUNCEMENT USER STATE MODEL
 * ============================================================================
 */