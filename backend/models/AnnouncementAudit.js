/**
 * ============================================================================
 * backend/models/AnnouncementAudit.js
 * TITech Community Capital LTD
 * Enterprise Announcement Audit Aggregate
 * ============================================================================
 *
 * Architectural role
 * ----------------------------------------------------------------------------
 * AnnouncementAudit is the immutable audit-event aggregate for announcement
 * lifecycle and user-interaction operations.
 *
 * It records events such as:
 *
 *   - announcement creation
 *   - announcement updates
 *   - publication
 *   - scheduling
 *   - archival
 *   - restoration
 *   - deletion
 *   - viewing
 *   - reading
 *   - unread transitions
 *   - dismissal
 *   - acknowledgement
 *   - access-denied events
 *
 * The model is designed for:
 *
 *   - tenant-aware audit retrieval
 *   - operational investigation
 *   - request/correlation tracing
 *   - security-derived request context
 *   - compliance-oriented evidence
 *   - asynchronous worker/scheduler traceability
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * AnnouncementAudit IS:
 *   - an append-oriented audit-event record;
 *   - immutable evidence of announcement-related operations;
 *   - tenant-scoped when tenantId is present;
 *   - suitable for operational and compliance-oriented audit retrieval.
 *
 * AnnouncementAudit is NOT:
 *   - the source of truth for announcement content;
 *   - an authorization mechanism;
 *   - a notification queue;
 *   - a delivery-provider record;
 *   - a replacement for AuditLog;
 *   - a financial ledger;
 *   - a transaction/balance store;
 *   - an application or infrastructure log replacement;
 *   - a substitute for immutable/WORM compliance storage.
 *
 * Canonical audit architecture
 * ----------------------------------------------------------------------------
 * AuditLog.js is the platform-level canonical audit aggregate.
 *
 * AnnouncementAudit exists as a domain-specific compatibility/audit stream
 * for announcement workflows where a dedicated collection and query model
 * provide operational value.
 *
 * Security principles
 * ----------------------------------------------------------------------------
 *   - Audit records are append-only.
 *   - Existing records cannot be modified through normal application APIs.
 *   - Hard deletion is disabled.
 *   - Announcement identity is immutable.
 *   - Tenant context is immutable.
 *   - Actor identity and role are immutable.
 *   - Request/correlation identifiers are immutable.
 *   - Raw IP addresses and raw user-agent strings must never be persisted.
 *   - sourceIpHash and userAgentHash must contain derived/hash values only.
 *   - Metadata is bounded and must not contain secrets.
 *   - Bulk mutation is disabled.
 *   - Update pipelines are disabled.
 *   - Tenant authorization remains a service-layer responsibility.
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

export const AUDIT_ACTIONS = Object.freeze([
  'created',
  'updated',
  'published',
  'scheduled',
  'archived',
  'deleted',
  'restored',

  'read',
  'unread',
  'dismissed',
  'acknowledged',
  'viewed',

  'access_denied',
]);

export const AUDIT_SOURCES = Object.freeze([
  'api',
  'web',
  'mobile',
  'admin',
  'system',
  'worker',
  'scheduler',
  'migration',
  'integration',
]);

export const HASH_MAX_LENGTH = 128;
export const REQUEST_ID_MAX_LENGTH = 150;
export const CORRELATION_ID_MAX_LENGTH = 150;
export const ROLE_MAX_LENGTH = 100;
export const METADATA_MAX_KEYS = 100;
export const METADATA_MAX_STRING_LENGTH = 4096;

/*
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function normalizeNullableString(
  value
) {
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

function normalizeAction(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  return String(value)
    .trim()
    .toLowerCase();
}

function normalizeSource(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  return String(value)
    .trim()
    .toLowerCase();
}

function assertObjectId(
  value,
  fieldName
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    throw new TypeError(
      `${fieldName} is required`
    );
  }

  if (
    !mongoose.isObjectIdOrHexString(
      value
    )
  ) {
    throw new mongoose.Error.CastError(
      'ObjectId',
      value,
      fieldName
    );
  }
}

function validateMetadataDepthAndStrings(
  value,
  depth = 0
) {
  if (
    value === null ||
    value === undefined
  ) {
    return;
  }

  /*
   * Defensive depth ceiling prevents pathological nested audit payloads.
   */
  if (depth > 8) {
    throw new RangeError(
      'Audit metadata nesting is too deep'
    );
  }

  if (
    typeof value ===
    'string'
  ) {
    if (
      value.length >
      METADATA_MAX_STRING_LENGTH
    ) {
      throw new RangeError(
        `Audit metadata strings cannot exceed ` +
          `${METADATA_MAX_STRING_LENGTH} characters`
      );
    }

    return;
  }

  if (
    Array.isArray(value)
  ) {
    if (
      value.length >
      METADATA_MAX_KEYS
    ) {
      throw new RangeError(
        `Audit metadata arrays cannot contain more than ` +
          `${METADATA_MAX_KEYS} items`
      );
    }

    for (
      const item of value
    ) {
      validateMetadataDepthAndStrings(
        item,
        depth + 1
      );
    }

    return;
  }

  if (
    typeof value ===
    'object'
  ) {
    const keys =
      Object.keys(value);

    if (
      keys.length >
      METADATA_MAX_KEYS
    ) {
      throw new RangeError(
        `Audit metadata cannot contain more than ` +
          `${METADATA_MAX_KEYS} keys`
      );
    }

    for (
      const child of Object.values(
        value
      )
    ) {
      validateMetadataDepthAndStrings(
        child,
        depth + 1
      );
    }
  }
}

function validateMetadata(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return;
  }

  if (
    typeof value !==
      'object' ||
    Array.isArray(value) ||
    value instanceof Date
  ) {
    throw new TypeError(
      'Announcement audit metadata must be a plain object'
    );
  }

  validateMetadataDepthAndStrings(
    value
  );
}

/*
 * ============================================================================
 * SCHEMA
 * ============================================================================
 */

const AnnouncementAuditSchema =
  new Schema(
    {
      /*
       * ----------------------------------------------------------------------
       * ANNOUNCEMENT IDENTITY
       * ----------------------------------------------------------------------
       */
      announcementId: {
        type: Schema.Types.ObjectId,
        ref: 'Announcement',
        required: true,
        immutable: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * TENANCY
       * ----------------------------------------------------------------------
       *
       * null = platform/global announcement context.
       * ObjectId = tenant-scoped context.
       *
       * For access-denied events, tenantId may represent the requested tenant
       * context rather than the announcement's ownership context. The service
       * layer must preserve that distinction correctly.
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
       * ACTOR
       * ----------------------------------------------------------------------
       *
       * Null is valid for system-generated, scheduler and worker events.
       */
      actorUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        immutable: true,
        index: true,
      },

      actorRole: {
        type: String,
        trim: true,
        maxlength: ROLE_MAX_LENGTH,
        default: null,
        immutable: true,
      },

      /*
       * ----------------------------------------------------------------------
       * ACTION
       * ----------------------------------------------------------------------
       */
      action: {
        type: String,
        enum: AUDIT_ACTIONS,
        required: true,
        immutable: true,
        lowercase: true,
        trim: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * OUTCOME
       * ----------------------------------------------------------------------
       */
      success: {
        type: Boolean,
        required: true,
        default: true,
        immutable: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * TRACEABILITY
       * ----------------------------------------------------------------------
       */
      requestId: {
        type: String,
        trim: true,
        maxlength:
          REQUEST_ID_MAX_LENGTH,
        default: null,
        immutable: true,
        index: true,
      },

      correlationId: {
        type: String,
        trim: true,
        maxlength:
          CORRELATION_ID_MAX_LENGTH,
        default: null,
        immutable: true,
        index: true,
      },

      source: {
        type: String,
        enum: AUDIT_SOURCES,
        default: 'api',
        required: true,
        immutable: true,
        lowercase: true,
        trim: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * SECURITY-DERIVED REQUEST CONTEXT
       * ----------------------------------------------------------------------
       *
       * These fields contain hashes/derived values only.
       *
       * Raw IP addresses and raw user-agent strings must never be stored.
       */
      sourceIpHash: {
        type: String,
        trim: true,
        maxlength:
          HASH_MAX_LENGTH,
        default: null,
        immutable: true,
      },

      userAgentHash: {
        type: String,
        trim: true,
        maxlength:
          HASH_MAX_LENGTH,
        default: null,
        immutable: true,
      },

      /*
       * ----------------------------------------------------------------------
       * EVENT TIME
       * ----------------------------------------------------------------------
       *
       * createdAt:
       *   when MongoDB/Mongoose created the audit record.
       *
       * occurredAt:
       *   when the audited business/event operation actually occurred.
       */
      occurredAt: {
        type: Date,
        required: true,
        default: Date.now,
        immutable: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * METADATA
       * ----------------------------------------------------------------------
       *
       * Flexible non-secret operational context.
       */
      metadata: {
        type: Schema.Types.Mixed,
        default: () => ({}),
        immutable: true,

        validate: {
          validator(value) {
            try {
              validateMetadata(
                value
              );

              return true;
            } catch {
              return false;
            }
          },

          message:
            `Audit metadata cannot exceed ` +
            `${METADATA_MAX_KEYS} keys/items and must contain bounded values.`,
        },
      },
    },
    {
      timestamps: true,

      minimize: false,

      /*
       * Immutable audit records do not need ordinary document versioning.
       */
      versionKey: false,

      strict: true,

      collection:
        'announcement_audits',

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
 * Announcement-specific history.
 */
AnnouncementAuditSchema.index({
  tenantId: 1,
  announcementId: 1,
  occurredAt: -1,
  _id: -1,
});

/*
 * Tenant-wide chronological stream.
 */
AnnouncementAuditSchema.index({
  tenantId: 1,
  occurredAt: -1,
  _id: -1,
});

/*
 * Actor investigation.
 */
AnnouncementAuditSchema.index({
  tenantId: 1,
  actorUserId: 1,
  occurredAt: -1,
  _id: -1,
});

/*
 * Action investigation.
 */
AnnouncementAuditSchema.index({
  tenantId: 1,
  action: 1,
  occurredAt: -1,
  _id: -1,
});

/*
 * Failed/access-denied operations.
 */
AnnouncementAuditSchema.index({
  tenantId: 1,
  success: 1,
  occurredAt: -1,
  _id: -1,
});

/*
 * Request tracing.
 */
AnnouncementAuditSchema.index({
  requestId: 1,
  occurredAt: -1,
});

/*
 * Distributed workflow tracing.
 */
AnnouncementAuditSchema.index({
  correlationId: 1,
  occurredAt: -1,
});

/*
 * Source investigation.
 */
AnnouncementAuditSchema.index({
  tenantId: 1,
  source: 1,
  occurredAt: -1,
});

/*
 * Global/platform audit investigation.
 */
AnnouncementAuditSchema.index({
  announcementId: 1,
  occurredAt: -1,
  _id: -1,
});

/*
 * ============================================================================
 * VALIDATION
 * ============================================================================
 */

AnnouncementAuditSchema.pre(
  'validate',
  function validateAnnouncementAudit(
    next
  ) {
    /*
     * Normalize nullable strings.
     */
    this.requestId =
      normalizeNullableString(
        this.requestId
      );

    this.correlationId =
      normalizeNullableString(
        this.correlationId
      );

    this.actorRole =
      normalizeNullableString(
        this.actorRole
      );

    /*
     * Normalize enum-like strings.
     */
    this.action =
      normalizeAction(
        this.action
      );

    this.source =
      normalizeSource(
        this.source
      );

    /*
     * Explicit tenant/reference validation.
     */
    if (
      this.tenantId !== null &&
      this.tenantId !== undefined
    ) {
      if (
        !mongoose.isObjectIdOrHexString(
          this.tenantId
        )
      ) {
        this.invalidate(
          'tenantId',
          'tenantId must be a valid ObjectId.'
        );
      }
    }

    if (
      this.announcementId &&
      !mongoose.isObjectIdOrHexString(
        this.announcementId
      )
    ) {
      this.invalidate(
        'announcementId',
        'announcementId must be a valid ObjectId.'
      );
    }

    if (
      this.actorUserId !== null &&
      this.actorUserId !== undefined
    ) {
      if (
        !mongoose.isObjectIdOrHexString(
          this.actorUserId
        )
      ) {
        this.invalidate(
          'actorUserId',
          'actorUserId must be a valid ObjectId.'
        );
      }
    }

    /*
     * Audit metadata validation.
     */
    try {
      validateMetadata(
        this.metadata
      );
    } catch (error) {
      this.invalidate(
        'metadata',
        error.message
      );
    }

    /*
     * Security-derived fields must not accidentally contain obvious raw
     * network identifiers.
     *
     * The service should hash these values before calling record().
     *
     * This is defense in depth only; it is not a substitute for a proper
     * hashing policy.
     */
    if (
      this.sourceIpHash &&
      /\s/.test(
        this.sourceIpHash
      )
    ) {
      this.invalidate(
        'sourceIpHash',
        'sourceIpHash must be a compact derived/hash value.'
      );
    }

    if (
      this.userAgentHash &&
      this.userAgentHash.length >
        HASH_MAX_LENGTH
    ) {
      this.invalidate(
        'userAgentHash',
        'userAgentHash exceeds the allowed length.'
      );
    }

    next();
  }
);

/*
 * ============================================================================
 * APPEND-ONLY PROTECTION
 * ============================================================================
 */

/*
 * Existing audit records may not be saved again.
 */
AnnouncementAuditSchema.pre(
  'save',
  function preventAuditMutation(
    next
  ) {
    if (
      !this.isNew
    ) {
      return next(
        new Error(
          'Announcement audit records are immutable and cannot be modified.'
        )
      );
    }

    return next();
  }
);

/*
 * Query updates are blocked.
 */
function rejectAuditMutation(
  next
) {
  next(
    new Error(
      'Announcement audit records are immutable.'
    )
  );
}

for (const method of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
]) {
  AnnouncementAuditSchema.pre(
    method,
    rejectAuditMutation
  );
}

/*
 * Update pipelines are explicitly disabled.
 */
AnnouncementAuditSchema.pre(
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
          'AnnouncementAudit update pipelines are disabled.'
        )
      );
    }

    return next();
  }
);

AnnouncementAuditSchema.pre(
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
          'AnnouncementAudit update pipelines are disabled.'
        )
      );
    }

    return next();
  }
);

AnnouncementAuditSchema.pre(
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
          'AnnouncementAudit update pipelines are disabled.'
        )
      );
    }

    return next();
  }
);

/*
 * Bulk operations are deliberately blocked because they could bypass the
 * append-only domain boundary.
 */
AnnouncementAuditSchema.pre(
  'bulkWrite',
  function rejectBulkWrite(
    next
  ) {
    next(
      new Error(
        'AnnouncementAudit.bulkWrite() is disabled; use the controlled append operation.'
      )
    );
  }
);

/*
 * ============================================================================
 * DELETE PROTECTION
 * ============================================================================
 */

/*
 * Query-level deletion.
 */
for (const method of [
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndRemove',
]) {
  AnnouncementAuditSchema.pre(
    method,
    function rejectAuditDeletion(
      next
    ) {
      next(
        new Error(
          'Announcement audit records cannot be deleted through normal application workflows.'
        )
      );
    }
  );
}

/*
 * Document-level deleteOne().
 */
AnnouncementAuditSchema.pre(
  'deleteOne',
  {
    document: true,
    query: false,
  },
  function rejectDocumentAuditDeletion(
    next
  ) {
    next(
      new Error(
        'Announcement audit records cannot be deleted through normal application workflows.'
      )
    );
  }
);

/*
 * ============================================================================
 * INSTANCE HELPERS
 * ============================================================================
 */

/**
 * Return a safe public representation.
 *
 * Administrative endpoints should preferably use a dedicated audit
 * authorization policy before exposing any audit record.
 */
AnnouncementAuditSchema.methods.toPublicJSON =
  function toPublicJSON() {
    return {
      id: String(
        this._id
      ),

      announcementId:
        String(
          this.announcementId
        ),

      tenantId:
        this.tenantId
          ? String(
              this.tenantId
            )
          : null,

      actorUserId:
        this.actorUserId
          ? String(
              this.actorUserId
            )
          : null,

      actorRole:
        this.actorRole ||
        null,

      action:
        this.action,

      success:
        this.success,

      requestId:
        this.requestId ||
        null,

      correlationId:
        this.correlationId ||
        null,

      source:
        this.source,

      occurredAt:
        this.occurredAt,

      createdAt:
        this.createdAt,
    };
  };

/**
 * Administrative/internal representation.
 *
 * Hashed security-derived fields may be included because they do not expose
 * the original raw IP/user-agent values.
 */
AnnouncementAuditSchema.methods.toAuditJSON =
  function toAuditJSON() {
    return {
      id: String(
        this._id
      ),

      announcementId:
        String(
          this.announcementId
        ),

      tenantId:
        this.tenantId
          ? String(
              this.tenantId
            )
          : null,

      actorUserId:
        this.actorUserId
          ? String(
              this.actorUserId
            )
          : null,

      actorRole:
        this.actorRole ||
        null,

      action:
        this.action,

      success:
        this.success,

      requestId:
        this.requestId ||
        null,

      correlationId:
        this.correlationId ||
        null,

      source:
        this.source,

      sourceIpHash:
        this.sourceIpHash ||
        null,

      userAgentHash:
        this.userAgentHash ||
        null,

      occurredAt:
        this.occurredAt,

      metadata:
        this.metadata ||
        {},

      createdAt:
        this.createdAt,
    };
  };

/*
 * ============================================================================
 * STATIC OPERATIONS
 * ============================================================================
 */

/**
 * Append one announcement audit event.
 *
 * This is the preferred model-level entry point.
 *
 * Authorization, announcement ownership, tenant membership and metadata
 * sanitization remain service-layer responsibilities.
 */
AnnouncementAuditSchema.statics.record =
  async function record(
    data = {},
    options = {}
  ) {
    if (
      !data ||
      typeof data !==
        'object' ||
      Array.isArray(data)
    ) {
      throw new TypeError(
        'Announcement audit data must be a plain object.'
      );
    }

    assertObjectId(
      data.announcementId,
      'announcementId'
    );

    if (
      data.tenantId !== null &&
      data.tenantId !== undefined
    ) {
      assertObjectId(
        data.tenantId,
        'tenantId'
      );
    }

    if (
      data.actorUserId !== null &&
      data.actorUserId !== undefined
    ) {
      assertObjectId(
        data.actorUserId,
        'actorUserId'
      );
    }

    const audit =
      new this({
        announcementId:
          data.announcementId,

        tenantId:
          data.tenantId ??
          null,

        actorUserId:
          data.actorUserId ??
          null,

        actorRole:
          data.actorRole ??
          null,

        action:
          data.action,

        success:
          data.success !==
          undefined
            ? Boolean(
                data.success
              )
            : true,

        requestId:
          data.requestId ??
          null,

        correlationId:
          data.correlationId ??
          null,

        source:
          data.source ??
          'api',

        sourceIpHash:
          data.sourceIpHash ??
          null,

        userAgentHash:
          data.userAgentHash ??
          null,

        occurredAt:
          data.occurredAt ??
          new Date(),

        metadata:
          data.metadata ??
          {},
      });

    return audit.save({
      session:
        options.session,
    });
  };

/**
 * Record an access-denied event.
 *
 * This keeps the security event shape explicit and avoids treating
 * authorization failures as ordinary successful actions.
 */
AnnouncementAuditSchema.statics.recordAccessDenied =
  async function recordAccessDenied(
    data = {},
    options = {}
  ) {
    return this.record(
      {
        ...data,
        action:
          'access_denied',
        success: false,
      },
      options
    );
  };

/**
 * Find audit history for one announcement within one tenant.
 */
AnnouncementAuditSchema.statics.findAnnouncementHistory =
  function findAnnouncementHistory(
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

    const safeLimit =
      Math.min(
        Math.max(
          Number(
            options.limit
          ) || 100,
          1
        ),
        500
      );

    const filter = {
      tenantId,
      announcementId,
    };

    if (
      options.action
    ) {
      filter.action =
        normalizeAction(
          options.action
        );
    }

    if (
      options.success !==
      undefined
    ) {
      filter.success =
        Boolean(
          options.success
        );
    }

    if (
      options.before
    ) {
      const before =
        options.before instanceof
        Date
          ? options.before
          : new Date(
              options.before
            );

      if (
        Number.isNaN(
          before.getTime()
        )
      ) {
        throw new TypeError(
          'before must be a valid date'
        );
      }

      filter.occurredAt = {
        $lt: before,
      };
    }

    const query =
      this.find(filter)
        .sort({
          occurredAt: -1,
          _id: -1,
        })
        .limit(
          safeLimit
        )
        .lean();

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
 * Find tenant-wide announcement audit history.
 */
AnnouncementAuditSchema.statics.findTenantHistory =
  function findTenantHistory(
    tenantId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    const safeLimit =
      Math.min(
        Math.max(
          Number(
            options.limit
          ) || 100,
          1
        ),
        500
      );

    const filter = {
      tenantId,
    };

    if (
      options.action
    ) {
      filter.action =
        normalizeAction(
          options.action
        );
    }

    if (
      options.actorUserId
    ) {
      assertObjectId(
        options.actorUserId,
        'actorUserId'
      );

      filter.actorUserId =
        options.actorUserId;
    }

    if (
      options.source
    ) {
      filter.source =
        normalizeSource(
          options.source
        );
    }

    if (
      options.success !==
      undefined
    ) {
      filter.success =
        Boolean(
          options.success
        );
    }

    const query =
      this.find(filter)
        .sort({
          occurredAt: -1,
          _id: -1,
        })
        .limit(
          safeLimit
        )
        .lean();

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
 * Find events associated with one actor.
 */
AnnouncementAuditSchema.statics.findActorHistory =
  function findActorHistory(
    tenantId,
    actorUserId,
    options = {}
  ) {
    assertObjectId(
      tenantId,
      'tenantId'
    );

    assertObjectId(
      actorUserId,
      'actorUserId'
    );

    const safeLimit =
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
        actorUserId,
      })
        .sort({
          occurredAt: -1,
          _id: -1,
        })
        .limit(
          safeLimit
        )
        .lean();

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
 * Count acknowledged events for an announcement.
 */
AnnouncementAuditSchema.statics.countAcknowledgements =
  function countAcknowledgements(
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
        action:
          'acknowledged',
        success: true,
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
 * Count read events for an announcement.
 */
AnnouncementAuditSchema.statics.countReads =
  function countReads(
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
        action: 'read',
        success: true,
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

const AnnouncementAudit =
  mongoose.models.AnnouncementAudit ||
  mongoose.model(
    'AnnouncementAudit',
    AnnouncementAuditSchema
  );

export {
  AnnouncementAuditSchema,
};

export default AnnouncementAudit;

/*
 * ============================================================================
 * END OF TITech COMMUNITY CAPITAL LTD ANNOUNCEMENT AUDIT MODEL
 * ============================================================================
 */