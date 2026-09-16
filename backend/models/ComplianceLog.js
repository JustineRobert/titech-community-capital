// ============================================================================
// backend/models/ComplianceLog.js
// TITech Community Capital LTD
// Enterprise Compliance Event / Case Log
// ============================================================================
//
// Purpose
//   Tenant-aware compliance record for AML/fraud-related flags, investigations,
//   external reports, regulatory references, and resolution tracking.
//
// Architectural boundary
//   ComplianceLog records compliance evidence and workflow state.
//
//   It is NOT:
//     - the canonical financial transaction;
//     - the accounting ledger;
//     - the fraud engine itself;
//     - a replacement for an external STR/SAR/case-management system.
//
// Security principles
//   - Mandatory tenant isolation.
//   - Original compliance evidence is immutable.
//   - Resolution is explicit and attributed.
//   - Fraud linkage is tenant-scoped by service validation.
//   - Details are bounded.
//   - No credentials, tokens, KYC documents, or unnecessary sensitive payloads.
//   - External report references are preserved.
//   - ESM module format.
//
// ============================================================================

import mongoose from 'mongoose';

const { Schema } = mongoose;

// =============================================================================
// CONSTANTS
// =============================================================================

const COMPLIANCE_STATUSES = Object.freeze([
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED',
  'ESCALATED',
  'CLOSED',
]);

const COMPLIANCE_PRIORITIES = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

const REPORTER_TYPES = Object.freeze([
  'system',
  'user',
  'admin',
  'compliance_officer',
  'external_provider',
]);

const RESOLUTION_OUTCOMES = Object.freeze([
  'NO_ACTION',
  'FALSE_POSITIVE',
  'CLEARED',
  'REMEDIATED',
  'ESCALATED',
  'REPORTED',
]);

const MAX_ACTIVITY_LENGTH = 255;
const MAX_REASON_LENGTH = 2000;
const MAX_REPORT_ID_LENGTH = 256;
const MAX_EXTERNAL_REFERENCE_LENGTH = 256;
const MAX_REPORTER_LENGTH = 128;
const MAX_DETAILS_KEYS = 50;
const MAX_DETAILS_BYTES = 64 * 1024;

// =============================================================================
// Helpers
// =============================================================================

function normalizeRequiredString(
  value,
  fieldName,
  maxLength
) {
  if (typeof value !== 'string') {
    throw new TypeError(
      `${fieldName} must be a string.`
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(
      `${fieldName} is required.`
    );
  }

  if (normalized.length > maxLength) {
    throw new RangeError(
      `${fieldName} exceeds maximum length of ${maxLength}.`
    );
  }

  return normalized;
}

function normalizeOptionalString(
  value,
  fieldName,
  maxLength
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  return normalizeRequiredString(
    value,
    fieldName,
    maxLength
  );
}

function estimateBytes(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  try {
    return Buffer.byteLength(
      JSON.stringify(value),
      'utf8'
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

// =============================================================================
// DETAILS SUBDOCUMENT
// =============================================================================

const detailsSchema = new Schema(
  {
    /**
     * Flexible but bounded compliance evidence.
     *
     * The service layer must redact credentials, authentication secrets,
     * unnecessary KYC material, and raw financial credentials before storage.
     */
    data: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
    minimize: false,
  }
);

// =============================================================================
// SCHEMA
// =============================================================================

const complianceLogSchema = new Schema(
  {
    // -------------------------------------------------------------------------
    // Tenant
    // -------------------------------------------------------------------------

    /**
     * Kept as String because the existing ComplianceLog model and some
     * surrounding compliance/idempotency models use string tenant identity.
     *
     * Standardize tenant representation repository-wide before migrating.
     */
    tenantId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: 128,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Subject
    // -------------------------------------------------------------------------

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Compliance event identity
    // -------------------------------------------------------------------------

    activity: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: MAX_ACTIVITY_LENGTH,
      index: true,
    },

    flagged: {
      type: Boolean,
      required: true,
      default: false,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Compliance case/report identity
    // -------------------------------------------------------------------------

    reportId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: MAX_REPORT_ID_LENGTH,
      index: true,
    },

    externalReportRef: {
      type: String,
      default: null,
      immutable: true,
      trim: true,
      maxlength: MAX_EXTERNAL_REFERENCE_LENGTH,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Status / priority
    // -------------------------------------------------------------------------

    status: {
      type: String,
      required: true,
      enum: COMPLIANCE_STATUSES,
      default: 'OPEN',
      uppercase: true,
      trim: true,
      index: true,
    },

    priority: {
      type: String,
      required: true,
      enum: COMPLIANCE_PRIORITIES,
      default: 'MEDIUM',
      uppercase: true,
      trim: true,
      index: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: MAX_REASON_LENGTH,
      immutable: true,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Evidence/details
    // -------------------------------------------------------------------------

    details: {
      type: detailsSchema,
      default: undefined,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Fraud linkage
    // -------------------------------------------------------------------------

    fraudLogId: {
      type: Schema.Types.ObjectId,
      ref: 'FraudLog',
      default: null,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Reporter
    // -------------------------------------------------------------------------

    reporter: {
      type: String,
      required: true,
      default: 'system',
      trim: true,
      maxlength: MAX_REPORTER_LENGTH,
      immutable: true,
    },

    reporterType: {
      type: String,
      required: true,
      enum: REPORTER_TYPES,
      default: 'system',
      lowercase: true,
      trim: true,
      immutable: true,
    },

    reportedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Resolution
    // -------------------------------------------------------------------------

    resolved: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },

    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    resolvedAt: {
      type: Date,
      default: null,
    },

    resolutionOutcome: {
      type: String,
      enum: [
        ...RESOLUTION_OUTCOMES,
        null,
      ],
      default: null,
    },

    resolutionNotes: {
      type: String,
      trim: true,
      maxlength: MAX_REASON_LENGTH,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Archival
    // -------------------------------------------------------------------------

    archived: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },

    archivedAt: {
      type: Date,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Traceability
    // -------------------------------------------------------------------------

    correlationId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
      immutable: true,
      index: true,
    },

    requestId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
      immutable: true,
      index: true,
    },
  },
  {
    timestamps: true,

    /**
     * Resolution/archive state legitimately changes, so versioning is kept.
     */
    versionKey: '__v',

    strict: true,
    strictQuery: true,
    minimize: false,

    collection: 'compliance_logs',

    optimisticConcurrency: true,

    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id?.toString();

        delete ret._id;
        delete ret.__v;

        return ret;
      },
    },
  }
);

// =============================================================================
// INDEXES
// =============================================================================

/**
 * One tenant/report identity should refer to one compliance case.
 */
complianceLogSchema.index(
  {
    tenantId: 1,
    reportId: 1,
  },
  {
    unique: true,
    name: 'uq_compliance_tenant_report',
  }
);

complianceLogSchema.index(
  {
    tenantId: 1,
    userId: 1,
    activity: 1,
    createdAt: -1,
  },
  {
    name: 'idx_compliance_tenant_user_activity_created',
  }
);

complianceLogSchema.index(
  {
    tenantId: 1,
    flagged: 1,
    status: 1,
    createdAt: -1,
  },
  {
    name: 'idx_compliance_tenant_flag_status_created',
  }
);

complianceLogSchema.index(
  {
    tenantId: 1,
    priority: 1,
    status: 1,
    createdAt: -1,
  },
  {
    name: 'idx_compliance_tenant_priority_status_created',
  }
);

complianceLogSchema.index(
  {
    tenantId: 1,
    fraudLogId: 1,
    createdAt: -1,
  },
  {
    sparse: true,
    name: 'idx_compliance_tenant_fraud_created',
  }
);

complianceLogSchema.index(
  {
    tenantId: 1,
    externalReportRef: 1,
  },
  {
    sparse: true,
    name: 'idx_compliance_tenant_external_report',
  }
);

complianceLogSchema.index(
  {
    tenantId: 1,
    resolved: 1,
    createdAt: -1,
  },
  {
    name: 'idx_compliance_tenant_resolution_created',
  }
);

complianceLogSchema.index(
  {
    tenantId: 1,
    archived: 1,
    createdAt: -1,
  },
  {
    name: 'idx_compliance_tenant_archived_created',
  }
);

complianceLogSchema.index(
  {
    tenantId: 1,
    correlationId: 1,
    createdAt: -1,
  },
  {
    sparse: true,
    name: 'idx_compliance_tenant_correlation_created',
  }
);

// =============================================================================
// VALIDATION
// =============================================================================

complianceLogSchema.pre(
  'validate',
  function validateComplianceLog(next) {
    try {
      if (!this.tenantId?.trim()) {
        throw new Error(
          'tenantId is required.'
        );
      }

      if (!this.userId) {
        throw new Error(
          'userId is required.'
        );
      }

      if (!this.activity?.trim()) {
        throw new Error(
          'activity is required.'
        );
      }

      if (!this.reportId?.trim()) {
        throw new Error(
          'reportId is required.'
        );
      }

      // -----------------------------------------------------------------------
      // Resolution consistency
      // -----------------------------------------------------------------------

      if (this.resolved) {
        if (!this.resolvedBy) {
          throw new Error(
            'Resolved compliance records require resolvedBy.'
          );
        }

        if (!this.resolvedAt) {
          throw new Error(
            'Resolved compliance records require resolvedAt.'
          );
        }

        if (!this.resolutionOutcome) {
          throw new Error(
            'Resolved compliance records require resolutionOutcome.'
          );
        }

        if (
          ![
            'RESOLVED',
            'CLOSED',
          ].includes(this.status)
        ) {
          throw new Error(
            'Resolved compliance records must use RESOLVED or CLOSED status.'
          );
        }
      } else if (
        this.resolvedBy ||
        this.resolvedAt ||
        this.resolutionOutcome ||
        this.resolutionNotes
      ) {
        throw new Error(
          'Unresolved compliance records cannot contain resolution state.'
        );
      }

      if (
        this.status === 'CLOSED' &&
        !this.resolved
      ) {
        throw new Error(
          'CLOSED compliance records must be resolved.'
        );
      }

      if (
        this.status === 'OPEN' &&
        this.resolved
      ) {
        throw new Error(
          'OPEN compliance records cannot be resolved.'
        );
      }

      // -----------------------------------------------------------------------
      // Archive consistency
      // -----------------------------------------------------------------------

      if (this.archived && !this.archivedAt) {
        this.archivedAt = new Date();
      }

      if (!this.archived && this.archivedAt) {
        throw new Error(
          'archivedAt cannot be set while archived=false.'
        );
      }

      // -----------------------------------------------------------------------
      // Details safety
      // -----------------------------------------------------------------------

      if (this.details?.data) {
        const details = this.details.data;

        if (
          typeof details !== 'object' ||
          Array.isArray(details)
        ) {
          throw new Error(
            'details.data must be a JSON object.'
          );
        }

        if (
          Object.keys(details).length >
          MAX_DETAILS_KEYS
        ) {
          throw new RangeError(
            `details.data cannot contain more than ${MAX_DETAILS_KEYS} keys.`
          );
        }

        if (
          estimateBytes(details) >
          MAX_DETAILS_BYTES
        ) {
          throw new RangeError(
            'details.data exceeds the permitted size.'
          );
        }
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

// =============================================================================
// IMMUTABILITY PROTECTION
// =============================================================================
//
// Original compliance evidence must not be rewritten.
//
// The following remain immutable after creation:
//   tenantId
//   userId
//   activity
//   flagged
//   reportId
//   reason
//   details
//   fraudLogId
//   reporter
//   reporterType
//   reportedBy
//   externalReportRef
//   correlationId
//   requestId
//
// Resolution and archive fields are handled through dedicated service methods.
//
// =============================================================================

const IMMUTABLE_PATHS = new Set([
  'tenantId',
  'userId',
  'activity',
  'flagged',
  'reportId',
  'reason',
  'details',
  'fraudLogId',
  'reporter',
  'reporterType',
  'reportedBy',
  'externalReportRef',
  'correlationId',
  'requestId',
]);

function inspectImmutableUpdate(update) {
  if (!update) {
    throw new Error(
      'Compliance updates require an explicit state-transition method.'
    );
  }

  for (
    const [operator, value]
    of Object.entries(update)
  ) {
    if (!operator.startsWith('$')) {
      const root = operator.split('.')[0];

      if (
        IMMUTABLE_PATHS.has(root)
      ) {
        throw new Error(
          `Compliance field "${root}" is immutable.`
        );
      }

      continue;
    }

    if (
      !value ||
      typeof value !== 'object'
    ) {
      continue;
    }

    for (
      const path of Object.keys(value)
    ) {
      const root =
        path.split('.')[0];

      if (
        IMMUTABLE_PATHS.has(root)
      ) {
        throw new Error(
          `Compliance field "${root}" is immutable.`
        );
      }
    }
  }
}

complianceLogSchema.pre(
  'updateOne',
  function rejectUnsafeUpdate() {
    inspectImmutableUpdate(
      this.getUpdate()
    );
  }
);

complianceLogSchema.pre(
  'updateMany',
  function rejectUnsafeUpdate() {
    inspectImmutableUpdate(
      this.getUpdate()
    );
  }
);

complianceLogSchema.pre(
  'findOneAndUpdate',
  function rejectUnsafeUpdate() {
    inspectImmutableUpdate(
      this.getUpdate()
    );
  }
);

complianceLogSchema.pre(
  'replaceOne',
  function rejectReplace() {
    throw new Error(
      'Compliance records cannot be replaced.'
    );
  }
);

complianceLogSchema.pre(
  'findOneAndReplace',
  function rejectReplace() {
    throw new Error(
      'Compliance records cannot be replaced.'
    );
  }

);

complianceLogSchema.pre(
  'deleteOne',
  function rejectDelete() {
    throw new Error(
      'Compliance records cannot be deleted.'
    );
  }
);

complianceLogSchema.pre(
  'deleteMany',
  function rejectDelete() {
    throw new Error(
      'Compliance records cannot be deleted.'
    );
  }
);

complianceLogSchema.pre(
  'findOneAndDelete',
  function rejectDelete() {
    throw new Error(
      'Compliance records cannot be deleted.'
    );
  }
);

// =============================================================================
// STATIC CREATE
// =============================================================================

complianceLogSchema.statics.createLog =
  async function (
    {
      tenantId,
      userId,
      activity,
      flagged = false,
      reportId,

      reason = null,
      details = null,

      fraudLogId = null,

      reporter = 'system',
      reporterType = 'system',
      reportedBy = null,

      priority = 'MEDIUM',

      externalReportRef = null,

      correlationId = null,
      requestId = null,

      session = null,
    } = {}
  ) {
    const document =
      new this({
        tenantId:
          normalizeRequiredString(
            tenantId,
            'tenantId',
            128
          ),

        userId,

        activity:
          normalizeRequiredString(
            activity,
            'activity',
            MAX_ACTIVITY_LENGTH
          ),

        flagged,

        reportId:
          normalizeRequiredString(
            reportId,
            'reportId',
            MAX_REPORT_ID_LENGTH
          ),

        reason:
          normalizeOptionalString(
            reason,
            'reason',
            MAX_REASON_LENGTH
          ),

        details:
          details
            ? { data: details }
            : undefined,

        fraudLogId,

        reporter:
          normalizeRequiredString(
            reporter,
            'reporter',
            MAX_REPORTER_LENGTH
          ),

        reporterType,

        reportedBy,

        priority,

        externalReportRef:
          normalizeOptionalString(
            externalReportRef,
            'externalReportRef',
            MAX_EXTERNAL_REFERENCE_LENGTH
          ),

        correlationId:
          normalizeOptionalString(
            correlationId,
            'correlationId',
            128
          ),

        requestId:
          normalizeOptionalString(
            requestId,
            'requestId',
            128
          ),
      });

    await document.save(
      session
        ? { session }
        : undefined
    );

    return document;
  };

// =============================================================================
// WORKFLOW METHODS
// =============================================================================

complianceLogSchema.methods.beginReview =
  async function (
    {
      reviewerId,
      session = null,
    } = {}
  ) {
    if (!reviewerId) {
      throw new Error(
        'reviewerId is required.'
      );
    }

    if (this.resolved) {
      throw new Error(
        'A resolved compliance case cannot enter review.'
      );
    }

    const options = {
      new: true,
    };

    if (session) {
      options.session = session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id: this._id,
          tenantId: this.tenantId,
          resolved: false,
          status: 'OPEN',
        },
        {
          $set: {
            status: 'UNDER_REVIEW',
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        'Compliance record is no longer open.'
      );
    }

    return updated;
  };

complianceLogSchema.methods.resolve =
  async function (
    {
      resolvedBy,
      outcome,
      notes = null,
      session = null,
      resolvedAt = new Date(),
    } = {}
  ) {
    if (!resolvedBy) {
      throw new Error(
        'resolvedBy is required.'
      );
    }

    if (
      !RESOLUTION_OUTCOMES.includes(
        outcome
      )
    ) {
      throw new Error(
        `Unsupported resolution outcome: ${outcome}`
      );
    }

    const options = {
      new: true,
    };

    if (session) {
      options.session = session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id: this._id,
          tenantId: this.tenantId,
          resolved: false,
          status: {
            $in: [
              'OPEN',
              'UNDER_REVIEW',
              'ESCALATED',
            ],
          },
        },
        {
          $set: {
            resolved: true,

            resolvedBy,

            resolvedAt,

            resolutionOutcome:
              outcome,

            resolutionNotes:
              notes
                ? String(notes).trim()
                : null,

            status:
              'RESOLVED',
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        'Compliance record is no longer unresolved.'
      );
    }

    return updated;
  };

complianceLogSchema.methods.escalate =
  async function (
    {
      session = null,
    } = {}
  ) {
    if (this.resolved) {
      throw new Error(
        'Resolved compliance records cannot be escalated.'
      );
    }

    const options = {
      new: true,
    };

    if (session) {
      options.session = session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id: this._id,
          tenantId: this.tenantId,
          resolved: false,
        },
        {
          $set: {
            status:
              'ESCALATED',
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        'Compliance record is no longer active.'
      );
    }

    return updated;
  };

complianceLogSchema.methods.archive =
  async function (
    {
      session = null,
    } = {}
  ) {
    if (!this.resolved) {
      throw new Error(
        'Only resolved compliance records should be archived.'
      );
    }

    const options = {
      new: true,
    };

    if (session) {
      options.session = session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id: this._id,
          tenantId: this.tenantId,
          resolved: true,
          archived: false,
        },
        {
          $set: {
            archived: true,
            archivedAt: new Date(),
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        'Compliance record is already archived or unavailable.'
      );
    }

    return updated;
  };

// =============================================================================
// READ HELPERS
// =============================================================================

complianceLogSchema.methods.isOpen =
  function () {
    return (
      !this.resolved &&
      [
        'OPEN',
        'UNDER_REVIEW',
        'ESCALATED',
      ].includes(this.status)
    );
  };

complianceLogSchema.statics.findByReportId =
  async function (
    tenantId,
    reportId,
    {
      session = null,
    } = {}
  ) {
    const query =
      this.findOne({
        tenantId,
        reportId,
      });

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

complianceLogSchema.statics.findByFraudLog =
  async function (
    tenantId,
    fraudLogId,
    {
      session = null,
    } = {}
  ) {
    const query =
      this.find({
        tenantId,
        fraudLogId,
      }).sort({
        createdAt: -1,
      });

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

complianceLogSchema.statics.findOpenCases =
  async function (
    tenantId,
    {
      limit = 100,
      session = null,
    } = {}
  ) {
    const normalizedLimit =
      Math.min(
        500,
        Math.max(
          1,
          Number(limit) || 100
        )
      );

    const query =
      this.find({
        tenantId,
        resolved: false,
        archived: false,
        status: {
          $in: [
            'OPEN',
            'UNDER_REVIEW',
            'ESCALATED',
          ],
        },
      })
        .sort({
          priority: 1,
          createdAt: 1,
          _id: 1,
        })
        .limit(
          normalizedLimit
        );

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

// =============================================================================
// MODEL
// =============================================================================

const ComplianceLog =
  mongoose.models.ComplianceLog ||
  mongoose.model(
    'ComplianceLog',
    complianceLogSchema
  );

export default ComplianceLog;

export {
  COMPLIANCE_STATUSES,
  COMPLIANCE_PRIORITIES,
  REPORTER_TYPES,
  RESOLUTION_OUTCOMES,
};