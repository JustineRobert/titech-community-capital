/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Announcement Audit Model
 * ============================================================================
 *
 * File:
 *   backend/models/AnnouncementAudit.js
 *
 * Version:
 *   2.0.0
 *
 * Purpose:
 *   Immutable, tenant-aware, security-conscious audit trail for announcement
 *   lifecycle and user-interaction operations.
 *
 * Design:
 *   - MongoDB / Mongoose
 *   - Multi-tenant aware
 *   - Append-only
 *   - Audit-event oriented
 *   - Operationally searchable
 *   - Correlation/request trace compatible
 *   - Security metadata compatible
 *   - Compliance/audit friendly
 *
 * Important:
 *   Audit records are evidence records and MUST NOT be modified or deleted
 *   through normal application workflows.
 *
 * Security:
 *   Never store:
 *     - passwords
 *     - access tokens
 *     - refresh tokens
 *     - session tokens
 *     - financial credentials
 *     - authentication secrets
 *     - unnecessary PII
 *
 *   IP addresses and user-agent values should be hashed before persistence.
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

const AUDIT_ACTIONS = Object.freeze([
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

const AUDIT_SOURCES = Object.freeze([
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

const HASH_MAX_LENGTH = 128;
const REQUEST_ID_MAX_LENGTH = 150;
const CORRELATION_ID_MAX_LENGTH = 150;
const ROLE_MAX_LENGTH = 100;
const METADATA_MAX_KEYS = 100;

/* ============================================================================
 * SUB-SCHEMA / METADATA VALIDATION
 * ========================================================================== */

/**
 * Audit metadata is intentionally kept flexible because different
 * announcement operations may require different non-sensitive context.
 *
 * The application/service layer MUST sanitize metadata before writing it.
 *
 * Examples of acceptable metadata:
 *   {
 *     previousStatus: 'draft',
 *     newStatus: 'published',
 *     version: 2,
 *     reason: 'scheduled publication',
 *     channel: 'web'
 *   }
 *
 * Examples of prohibited metadata:
 *   {
 *     accessToken: '...',
 *     refreshToken: '...',
 *     password: '...',
 *     cardNumber: '...',
 *     pin: '...'
 *   }
 */

/* ============================================================================
 * MAIN SCHEMA
 * ========================================================================== */

const AnnouncementAuditSchema = new Schema(
  {
    /* ------------------------------------------------------------------------
     * ANNOUNCEMENT IDENTITY
     * ---------------------------------------------------------------------- */

    announcementId: {
      type: Schema.Types.ObjectId,
      ref: 'Announcement',
      required: true,
      immutable: true,
      index: true,
    },

    /* ------------------------------------------------------------------------
     * TENANCY
     *
     * null = platform-level announcement.
     * ObjectId = tenant-scoped announcement.
     *
     * The application authorization layer MUST independently validate that
     * the actor has access to the specified tenant and announcement.
     * ---------------------------------------------------------------------- */

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      immutable: true,
      index: true,
    },

    /* ------------------------------------------------------------------------
     * ACTOR
     * ---------------------------------------------------------------------- */

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

    /* ------------------------------------------------------------------------
     * ACTION
     * ---------------------------------------------------------------------- */

    action: {
      type: String,
      enum: AUDIT_ACTIONS,
      required: true,
      immutable: true,
      index: true,
    },

    /* ------------------------------------------------------------------------
     * OUTCOME
     * ---------------------------------------------------------------------- */

    success: {
      type: Boolean,
      default: true,
      immutable: true,
      index: true,
    },

    /* ------------------------------------------------------------------------
     * REQUEST / TRACEABILITY
     * ---------------------------------------------------------------------- */

    requestId: {
      type: String,
      trim: true,
      maxlength: REQUEST_ID_MAX_LENGTH,
      default: null,
      immutable: true,
      index: true,
    },

    correlationId: {
      type: String,
      trim: true,
      maxlength: CORRELATION_ID_MAX_LENGTH,
      default: null,
      immutable: true,
      index: true,
    },

    source: {
      type: String,
      enum: AUDIT_SOURCES,
      default: 'api',
      immutable: true,
      index: true,
    },

    /* ------------------------------------------------------------------------
     * SECURITY-DERIVED REQUEST CONTEXT
     *
     * These values MUST be hashes generated by the application/service layer.
     * Raw IP addresses and raw user-agent strings should never be persisted.
     * ---------------------------------------------------------------------- */

    sourceIpHash: {
      type: String,
      trim: true,
      maxlength: HASH_MAX_LENGTH,
      default: null,
      immutable: true,
    },

    userAgentHash: {
      type: String,
      trim: true,
      maxlength: HASH_MAX_LENGTH,
      default: null,
      immutable: true,
    },

    /* ------------------------------------------------------------------------
     * EVENT TIMESTAMP
     *
     * createdAt remains the database audit-record creation timestamp.
     * occurredAt represents when the audited operation actually happened.
     *
     * They are normally equal or very close, but keeping both makes delayed
     * workers and asynchronous processing traceable.
     * ---------------------------------------------------------------------- */

    occurredAt: {
      type: Date,
      default: Date.now,
      immutable: true,
      index: true,
    },

    /* ------------------------------------------------------------------------
     * METADATA
     *
     * Flexible, non-secret operational context.
     * ---------------------------------------------------------------------- */

    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
      immutable: true,
      validate: {
        validator(value) {
          if (
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value)
          ) {
            return false;
          }

          return Object.keys(value).length <= METADATA_MAX_KEYS;
        },

        message:
          `Audit metadata cannot contain more than ${METADATA_MAX_KEYS} keys.`,
      },
    },
  },
  {
    timestamps: true,

    /**
     * Prevent Mongoose from silently removing intentionally empty metadata
     * structures.
     */
    minimize: false,

    /**
     * Audit records use their own explicit event identifiers and do not need
     * Mongoose's internal version key.
     */
    versionKey: false,

    /**
     * Strict mode prevents unexpected top-level fields from being persisted.
     */
    strict: true,

    collection: 'announcement_audits',
  },
);

/* ============================================================================
 * INDEXES
 * ========================================================================== */

/**
 * Announcement audit history.
 */
AnnouncementAuditSchema.index({
  tenantId: 1,
  announcementId: 1,
  occurredAt: -1,
  _id: -1,
});

/**
 * Tenant-wide chronological audit stream.
 */
AnnouncementAuditSchema.index({
  tenantId: 1,
  occurredAt: -1,
  _id: -1,
});

/**
 * Actor activity.
 */
AnnouncementAuditSchema.index({
  tenantId: 1,
  actorUserId: 1,
  occurredAt: -1,
  _id: -1,
});

/**
 * Operational investigation by action.
 */
AnnouncementAuditSchema.index({
  tenantId: 1,
  action: 1,
  occurredAt: -1,
  _id: -1,
});

/**
 * Failed operations / access-denied investigation.
 */
AnnouncementAuditSchema.index({
  tenantId: 1,
  success: 1,
  occurredAt: -1,
  _id: -1,
});

/**
 * Request tracing.
 */
AnnouncementAuditSchema.index({
  requestId: 1,
  occurredAt: -1,
});

/**
 * Distributed tracing / workflow correlation.
 */
AnnouncementAuditSchema.index({
  correlationId: 1,
  occurredAt: -1,
});

/**
 * Source/channel investigation.
 */
AnnouncementAuditSchema.index({
  tenantId: 1,
  source: 1,
  occurredAt: -1,
});

/* ============================================================================
 * VALIDATION
 * ========================================================================== */

/**
 * Platform-level announcements should not accidentally contain tenant scope
 * metadata unless explicitly intended by the application.
 *
 * This validation intentionally does NOT enforce a strict relationship between
 * Announcement.tenantId and AnnouncementAudit.tenantId because the audit
 * model may also be used for access-denied events where the requested tenant
 * context can differ from the announcement's ownership context.
 */
AnnouncementAuditSchema.pre(
  'validate',
  function validateAuditRecord(next) {
    if (
      this.requestId !== null &&
      this.requestId !== undefined &&
      String(this.requestId).trim().length === 0
    ) {
      this.requestId = null;
    }

    if (
      this.correlationId !== null &&
      this.correlationId !== undefined &&
      String(this.correlationId).trim().length === 0
    ) {
      this.correlationId = null;
    }

    if (
      this.actorRole !== null &&
      this.actorRole !== undefined &&
      String(this.actorRole).trim().length === 0
    ) {
      this.actorRole = null;
    }

    next();
  },
);

/* ============================================================================
 * IMMUTABILITY PROTECTION
 * ========================================================================== */

/**
 * Audit records are append-only.
 *
 * These middleware protections cover the common Mongoose mutation APIs.
 */

/* --------------------------------------------------------------------------
 * Document save
 * ------------------------------------------------------------------------ */

AnnouncementAuditSchema.pre(
  'save',
  function preventAuditMutation(next) {
    /**
     * Creating a new audit record is allowed.
     *
     * Saving an existing audit record is prohibited.
     */
    if (!this.isNew) {
      return next(
        new Error(
          'Announcement audit records are immutable and cannot be modified.',
        ),
      );
    }

    next();
  },
);

/* --------------------------------------------------------------------------
 * Query updates
 * ------------------------------------------------------------------------ */

AnnouncementAuditSchema.pre(
  'updateOne',
  function preventAuditMutation() {
    throw new Error(
      'Announcement audit records are immutable.',
    );
  },
);

AnnouncementAuditSchema.pre(
  'updateMany',
  function preventAuditMutation() {
    throw new Error(
      'Announcement audit records are immutable.',
    );
  },
);

AnnouncementAuditSchema.pre(
  'findOneAndUpdate',
  function preventAuditMutation() {
    throw new Error(
      'Announcement audit records are immutable.',
    );
  },
);

AnnouncementAuditSchema.pre(
  'findOneAndReplace',
  function preventAuditMutation() {
    throw new Error(
      'Announcement audit records are immutable.',
    );
  },
);

AnnouncementAuditSchema.pre(
  'replaceOne',
  function preventAuditMutation() {
    throw new Error(
      'Announcement audit records are immutable.',
    );
  },
);

/* --------------------------------------------------------------------------
 * Query deletion
 * ------------------------------------------------------------------------ */

AnnouncementAuditSchema.pre(
  'deleteOne',
  function preventAuditDeletion() {
    throw new Error(
      'Announcement audit records cannot be deleted.',
    );
  },
);

AnnouncementAuditSchema.pre(
  'deleteMany',
  function preventAuditDeletion() {
    throw new Error(
      'Announcement audit records cannot be deleted.',
    );
  },
);

AnnouncementAuditSchema.pre(
  'findOneAndDelete',
  function preventAuditDeletion() {
    throw new Error(
      'Announcement audit records cannot be deleted.',
    );
  },
);

AnnouncementAuditSchema.pre(
  'findOneAndRemove',
  function preventAuditDeletion() {
    throw new Error(
      'Announcement audit records cannot be removed.',
    );
  },
);

/* ============================================================================
 * STATIC HELPERS
 * ========================================================================== */

/**
 * Create an audit event.
 *
 * This provides a single application-level entry point for audit creation.
 *
 * Example:
 *
 *   await AnnouncementAudit.record({
 *     announcementId,
 *     tenantId,
 *     actorUserId,
 *     actorRole,
 *     action: 'published',
 *     requestId,
 *     correlationId,
 *     source: 'api',
 *     metadata: {
 *       previousStatus: 'draft',
 *       newStatus: 'published',
 *     },
 *   });
 *
 * IMPORTANT:
 *   Metadata must already be sanitized by the caller.
 */
AnnouncementAuditSchema.statics.record =
  async function recordAnnouncementAudit(data = {}) {
    if (!data || typeof data !== 'object') {
      throw new TypeError(
        'Announcement audit data must be an object.',
      );
    }

    const auditData = {
      announcementId:
        data.announcementId ?? null,

      tenantId:
        data.tenantId ?? null,

      actorUserId:
        data.actorUserId ?? null,

      actorRole:
        data.actorRole ?? null,

      action:
        data.action,

      success:
        data.success !== undefined
          ? Boolean(data.success)
          : true,

      requestId:
        data.requestId ?? null,

      correlationId:
        data.correlationId ?? null,

      source:
        data.source || 'api',

      sourceIpHash:
        data.sourceIpHash ?? null,

      userAgentHash:
        data.userAgentHash ?? null,

      occurredAt:
        data.occurredAt || new Date(),

      metadata:
        data.metadata &&
        typeof data.metadata === 'object' &&
        !Array.isArray(data.metadata)
          ? data.metadata
          : {},
    };

    return this.create(auditData);
  };

/**
 * Explicitly prevents application code from attempting to use the audit
 * collection as a mutable record store.
 */
AnnouncementAuditSchema.statics.updateAudit =
  function updateAudit() {
    throw new Error(
      'Announcement audit records are immutable.',
    );
  };

AnnouncementAuditSchema.statics.deleteAudit =
  function deleteAudit() {
    throw new Error(
      'Announcement audit records cannot be deleted.',
    );
  };

/* ============================================================================
 * SERIALIZATION
 * ========================================================================== */

/**
 * Public serialization deliberately excludes internal security metadata.
 *
 * Audit records should generally NOT be exposed directly to normal end users.
 * Administrative audit endpoints should apply their own authorization and
 * field-level projection.
 */
AnnouncementAuditSchema.methods.toPublicJSON =
  function toPublicJSON() {
    return {
      id: String(this._id),

      announcementId:
        String(this.announcementId),

      tenantId:
        this.tenantId
          ? String(this.tenantId)
          : null,

      actorUserId:
        this.actorUserId
          ? String(this.actorUserId)
          : null,

      actorRole:
        this.actorRole || null,

      action:
        this.action,

      success:
        this.success,

      requestId:
        this.requestId || null,

      correlationId:
        this.correlationId || null,

      source:
        this.source,

      occurredAt:
        this.occurredAt,

      createdAt:
        this.createdAt,
    };
  };

/**
 * Administrative/internal serialization.
 *
 * This is intentionally separate from toPublicJSON().
 *
 * sourceIpHash and userAgentHash remain hashed values and therefore do not
 * expose the original network information.
 */
AnnouncementAuditSchema.methods.toAuditJSON =
  function toAuditJSON() {
    return {
      id: String(this._id),

      announcementId:
        String(this.announcementId),

      tenantId:
        this.tenantId
          ? String(this.tenantId)
          : null,

      actorUserId:
        this.actorUserId
          ? String(this.actorUserId)
          : null,

      actorRole:
        this.actorRole || null,

      action:
        this.action,

      success:
        this.success,

      requestId:
        this.requestId || null,

      correlationId:
        this.correlationId || null,

      source:
        this.source,

      sourceIpHash:
        this.sourceIpHash || null,

      userAgentHash:
        this.userAgentHash || null,

      occurredAt:
        this.occurredAt,

      metadata:
        this.metadata || {},

      createdAt:
        this.createdAt,
    };
  };

/* ============================================================================
 * MODEL EXPORT
 * ========================================================================== */

module.exports =
  mongoose.models.AnnouncementAudit ||
  mongoose.model(
    'AnnouncementAudit',
    AnnouncementAuditSchema,
  );

/* ============================================================================
 * END OF TITech COMMUNITY CAPITAL LTD ANNOUNCEMENT AUDIT MODEL
 * ============================================================================
 */