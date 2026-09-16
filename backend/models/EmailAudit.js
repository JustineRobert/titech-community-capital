// ============================================================================
// backend/models/EmailAudit.js
// TITech Community Capital LTD
// Enterprise Email Security / Authentication Audit Model
// ============================================================================
//
// Purpose
//   Records security-sensitive email/authentication events.
//
// Covered events
//   - Verification email sent
//   - Email verified
//   - Password reset requested
//   - Password reset completed
//   - Password changed
//   - Verification email resent
//
// Architectural principles
//   - Every production event is tenant-scoped.
//   - Email addresses are normalized.
//   - Sensitive provider responses are sanitized before persistence.
//   - Audit records are append-only.
//   - TTL is NOT the correctness mechanism.
//   - Security audit history should be archived according to policy rather
//     than silently disappearing after a fixed operational TTL.
//   - No tokens, passwords, OTPs or authentication secrets are persisted.
//
// Module format
//   ESM.
//
// ============================================================================

import mongoose from 'mongoose';

const { Schema } = mongoose;

// =============================================================================
// Constants
// =============================================================================

const EMAIL_AUDIT_EVENTS = Object.freeze([
  'SEND_VERIFICATION_EMAIL',
  'VERIFY_EMAIL',
  'REQUEST_PASSWORD_RESET',
  'RESET_PASSWORD',
  'CHANGE_PASSWORD',
  'RESEND_VERIFICATION_EMAIL',
]);

const EMAIL_AUDIT_STATUSES = Object.freeze([
  'SUCCESS',
  'FAILED',
]);

const MAX_EMAIL_LENGTH = 320;
const MAX_IP_ADDRESS_LENGTH = 128;
const MAX_USER_AGENT_LENGTH = 1000;
const MAX_REASON_LENGTH = 500;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_CORRELATION_ID_LENGTH = 128;
const MAX_PROVIDER_LENGTH = 100;
const MAX_PROVIDER_REFERENCE_LENGTH = 256;
const MAX_METADATA_KEYS = 30;
const MAX_METADATA_BYTES = 16 * 1024;

// =============================================================================
// Helpers
// =============================================================================

function normalizeEmail(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new TypeError(
      'email must be a string.'
    );
  }

  const email =
    value
      .trim()
      .toLowerCase();

  if (
    email.length >
    MAX_EMAIL_LENGTH
  ) {
    throw new RangeError(
      `email exceeds ${MAX_EMAIL_LENGTH} characters.`
    );
  }

  return email;
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

  if (typeof value !== 'string') {
    throw new TypeError(
      `${fieldName} must be a string.`
    );
  }

  const normalized =
    value.trim();

  if (
    normalized.length >
    maxLength
  ) {
    throw new RangeError(
      `${fieldName} exceeds ${maxLength} characters.`
    );
  }

  return normalized || null;
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

function validateMetadata(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return true;
  }

  if (
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  if (
    Object.keys(value).length >
    MAX_METADATA_KEYS
  ) {
    return false;
  }

  return (
    estimateBytes(value) <=
    MAX_METADATA_BYTES
  );
}

// =============================================================================
// Provider metadata
// =============================================================================
//
// Store only sanitized operational information.
//
// Never store:
//   - email body containing authentication links
//   - verification tokens
//   - password-reset tokens
//   - SMTP credentials
//   - provider API credentials
//   - Authorization headers
//   - arbitrary provider response bodies
//
// =============================================================================

const providerMetadataSchema =
  new Schema(
    {
      provider: {
        type: String,
        trim: true,
        maxlength:
          MAX_PROVIDER_LENGTH,
      },

      messageId: {
        type: String,
        trim: true,
        maxlength:
          MAX_PROVIDER_REFERENCE_LENGTH,
      },

      providerReference: {
        type: String,
        trim: true,
        maxlength:
          MAX_PROVIDER_REFERENCE_LENGTH,
      },

      accepted: {
        type: Boolean,
      },

      rejected: {
        type: Boolean,
      },

      responseCode: {
        type: String,
        trim: true,
        maxlength: 100,
      },

      responseMessage: {
        type: String,
        trim: true,
        maxlength: 500,
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
// Schema
// =============================================================================

const emailAuditSchema =
  new Schema(
    {
      // -----------------------------------------------------------------------
      // Tenant
      // -----------------------------------------------------------------------

      tenantId: {
        type: Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true,
        immutable: true,
        index: true,
      },

      // -----------------------------------------------------------------------
      // Event
      // -----------------------------------------------------------------------

      event: {
        type: String,
        enum: EMAIL_AUDIT_EVENTS,
        required: true,
        uppercase: true,
        trim: true,
        immutable: true,
        index: true,
      },

      // -----------------------------------------------------------------------
      // User
      // -----------------------------------------------------------------------

      userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        immutable: true,
        index: true,
      },

      // -----------------------------------------------------------------------
      // Email address
      // -----------------------------------------------------------------------

      /**
       * Kept for operational investigation.
       *
       * This is PII and should not be exposed through unrestricted API
       * serialization.
       */
      email: {
        type: String,
        lowercase: true,
        trim: true,
        maxlength: MAX_EMAIL_LENGTH,
        immutable: true,
        index: true,
        sparse: true,
      },

      // -----------------------------------------------------------------------
      // Request context
      // -----------------------------------------------------------------------

      ipAddress: {
        type: String,
        trim: true,
        maxlength:
          MAX_IP_ADDRESS_LENGTH,
        immutable: true,
        index: true,
        sparse: true,
      },

      userAgent: {
        type: String,
        trim: true,
        maxlength:
          MAX_USER_AGENT_LENGTH,
        immutable: true,
      },

      requestId: {
        type: String,
        trim: true,
        maxlength:
          MAX_REQUEST_ID_LENGTH,
        immutable: true,
        index: true,
        sparse: true,
      },

      correlationId: {
        type: String,
        trim: true,
        maxlength:
          MAX_CORRELATION_ID_LENGTH,
        immutable: true,
        index: true,
        sparse: true,
      },

      // -----------------------------------------------------------------------
      // Result
      // -----------------------------------------------------------------------

      status: {
        type: String,
        enum: EMAIL_AUDIT_STATUSES,
        required: true,
        default: 'SUCCESS',
        uppercase: true,
        trim: true,
        immutable: true,
        index: true,
      },

      reason: {
        type: String,
        trim: true,
        maxlength:
          MAX_REASON_LENGTH,
        immutable: true,
      },

      // -----------------------------------------------------------------------
      // Provider information
      // -----------------------------------------------------------------------

      provider: {
        type:
          providerMetadataSchema,
        default: undefined,
        immutable: true,
      },

      // -----------------------------------------------------------------------
      // Additional safe metadata
      // -----------------------------------------------------------------------

      metadata: {
        type: Schema.Types.Mixed,
        default: undefined,
        immutable: true,
        validate: {
          validator:
            validateMetadata,
          message:
            'metadata must be a bounded JSON object.',
        },
      },

      // -----------------------------------------------------------------------
      // Archival
      // -----------------------------------------------------------------------

      isArchived: {
        type: Boolean,
        required: true,
        default: false,
        index: true,
      },

      archivedAt: {
        type: Date,
        default: null,
      },

      // -----------------------------------------------------------------------
      // Audit timestamp
      // -----------------------------------------------------------------------

      timestamp: {
        type: Date,
        required: true,
        default: Date.now,
        immutable: true,
        index: true,
      },
    },
    {
      collection:
        'email_audits',

      timestamps: true,

      versionKey: false,

      strict: true,
      strictQuery: true,
      minimize: false,

      toJSON: {
        transform(
          doc,
          ret
        ) {
          ret.id =
            ret._id?.toString();

          delete ret._id;

          /**
           * Email is PII; generic API responses should not expose it unless
           * a privileged application query explicitly requests it.
           */
          delete ret.email;

          return ret;
        },
      },
    }
  );

// =============================================================================
// Indexes
// =============================================================================

emailAuditSchema.index(
  {
    tenantId: 1,
    userId: 1,
    event: 1,
    timestamp: -1,
  },
  {
    sparse: true,
    name:
      'idx_email_audit_tenant_user_event_time',
  }
);

emailAuditSchema.index(
  {
    tenantId: 1,
    email: 1,
    event: 1,
    timestamp: -1,
  },
  {
    sparse: true,
    name:
      'idx_email_audit_tenant_email_event_time',
  }
);

emailAuditSchema.index(
  {
    tenantId: 1,
    status: 1,
    timestamp: -1,
  },
  {
    name:
      'idx_email_audit_tenant_status_time',
  }
);

emailAuditSchema.index(
  {
    tenantId: 1,
    requestId: 1,
    timestamp: -1,
  },
  {
    sparse: true,
    name:
      'idx_email_audit_tenant_request_time',
  }
);

emailAuditSchema.index(
  {
    tenantId: 1,
    correlationId: 1,
    timestamp: -1,
  },
  {
    sparse: true,
    name:
      'idx_email_audit_tenant_correlation_time',
  }
);

emailAuditSchema.index(
  {
    tenantId: 1,
    isArchived: 1,
    timestamp: -1,
  },
  {
    name:
      'idx_email_audit_tenant_archive_time',
  }
);

// =============================================================================
// Validation
// =============================================================================

emailAuditSchema.pre(
  'validate',
  function validateEmailAudit(next) {
    try {
      if (!this.tenantId) {
        throw new Error(
          'tenantId is required.'
        );
      }

      if (
        !EMAIL_AUDIT_EVENTS.includes(
          this.event
        )
      ) {
        throw new Error(
          `Unsupported email audit event: ${this.event}`
        );
      }

      if (
        !EMAIL_AUDIT_STATUSES.includes(
          this.status
        )
      ) {
        throw new Error(
          `Unsupported email audit status: ${this.status}`
        );
      }

      if (this.email) {
        this.email =
          normalizeEmail(
            this.email
          );
      }

      if (
        this.status ===
          'FAILED' &&
        !this.reason
      ) {
        throw new Error(
          'Failed email audit records should contain a reason.'
        );
      }

      if (
        this.isArchived &&
        !this.archivedAt
      ) {
        this.archivedAt =
          new Date();
      }

      if (
        !this.isArchived &&
        this.archivedAt
      ) {
        throw new Error(
          'archivedAt cannot be set while isArchived=false.'
        );
      }

      if (
        this.metadata &&
        !validateMetadata(
          this.metadata
        )
      ) {
        throw new Error(
          'metadata exceeds the permitted structure or size.'
        );
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

// =============================================================================
// Append-only protection
// =============================================================================
//
// Email security events are evidence. Do not rewrite them.
//
// Corrections should result in a new event.
//
// =============================================================================

const immutableAuditError =
  () => {
    const error =
      new Error(
        'Email audit records are append-only and cannot be modified or deleted.'
      );

    error.code =
      'EMAIL_AUDIT_IMMUTABLE';

    error.statusCode =
      409;

    return error;
  };

emailAuditSchema.pre(
  'updateOne',
  function rejectUpdate() {
    throw immutableAuditError();
  }
);

emailAuditSchema.pre(
  'updateMany',
  function rejectUpdate() {
    throw immutableAuditError();
  }
);

emailAuditSchema.pre(
  'findOneAndUpdate',
  function rejectUpdate() {
    throw immutableAuditError();
  }
);

emailAuditSchema.pre(
  'replaceOne',
  function rejectReplace() {
    throw immutableAuditError();
  }
);

emailAuditSchema.pre(
  'findOneAndReplace',
  function rejectReplace() {
    throw immutableAuditError();
  }
);

emailAuditSchema.pre(
  'deleteOne',
  function rejectDelete() {
    throw immutableAuditError();
  }
);

emailAuditSchema.pre(
  'deleteMany',
  function rejectDelete() {
    throw immutableAuditError();
  }
);

emailAuditSchema.pre(
  'findOneAndDelete',
  function rejectDelete() {
    throw immutableAuditError();
  }
);

emailAuditSchema.pre(
  'findOneAndRemove',
  function rejectRemove() {
    throw immutableAuditError();
  }
);

// =============================================================================
// Static helper
// =============================================================================

emailAuditSchema.statics.record =
  async function (
    {
      tenantId,

      event,

      userId = null,

      email = null,

      ipAddress = null,

      userAgent = null,

      requestId = null,

      correlationId = null,

      status = 'SUCCESS',

      reason = null,

      provider = null,

      metadata = null,

      session = null,

    } = {}
  ) {
    if (!tenantId) {
      throw new Error(
        'tenantId is required.'
      );
    }

    if (
      !EMAIL_AUDIT_EVENTS.includes(
        event
      )
    ) {
      throw new Error(
        `Unsupported email audit event: ${event}`
      );
    }

    if (
      !EMAIL_AUDIT_STATUSES.includes(
        status
      )
    ) {
      throw new Error(
        `Unsupported email audit status: ${status}`
      );
    }

    const audit =
      new this({
        tenantId,

        event,

        userId,

        email:
          normalizeEmail(
            email
          ),

        ipAddress:
          normalizeOptionalString(
            ipAddress,
            'ipAddress',
            MAX_IP_ADDRESS_LENGTH
          ),

        userAgent:
          normalizeOptionalString(
            userAgent,
            'userAgent',
            MAX_USER_AGENT_LENGTH
          ),

        requestId:
          normalizeOptionalString(
            requestId,
            'requestId',
            MAX_REQUEST_ID_LENGTH
          ),

        correlationId:
          normalizeOptionalString(
            correlationId,
            'correlationId',
            MAX_CORRELATION_ID_LENGTH
          ),

        status,

        reason:
          normalizeOptionalString(
            reason,
            'reason',
            MAX_REASON_LENGTH
          ),

        provider,

        metadata,

        timestamp:
          new Date(),
      });

    await audit.save(
      session
        ? { session }
        : undefined
    );

    return audit;
  };

// =============================================================================
// Read helpers
// =============================================================================

emailAuditSchema.methods.summary =
  function summary() {
    return {
      id:
        this._id.toString(),

      tenantId:
        this.tenantId,

      userId:
        this.userId,

      event:
        this.event,

      status:
        this.status,

      timestamp:
        this.timestamp,

      isArchived:
        this.isArchived,
    };
  };

// =============================================================================
// Model
// =============================================================================

const EmailAudit =
  mongoose.models.EmailAudit ||
  mongoose.model(
    'EmailAudit',
    emailAuditSchema
  );

export default EmailAudit;

export {
  EMAIL_AUDIT_EVENTS,
  EMAIL_AUDIT_STATUSES,
};