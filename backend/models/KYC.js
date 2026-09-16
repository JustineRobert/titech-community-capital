// backend/models/KYC.js
// ============================================================================
// TITech Community Capital LTD
// Enterprise KYC Model
// ============================================================================
//
// Purpose
//   Tenant-aware identity-verification record for a User.
//
// Architectural boundary
//   This model stores KYC verification state and evidence metadata.
//   It is NOT the User authentication model and must NOT store passwords,
//   access tokens, refresh tokens, or unrestricted identity documents.
//
// Security principles
//   - Mandatory tenant isolation.
//   - KYC record belongs to one user.
//   - Sensitive identifiers are protected from normal JSON serialization.
//   - Documents are represented by controlled references/metadata, not raw
//     document contents.
//   - Verification decisions are explicitly attributed.
//   - Verification history is retained.
//   - No direct controller-level mutation of verification evidence.
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

const KYC_STATUSES = Object.freeze([
  'PENDING',
  'UNDER_REVIEW',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
  'SUSPENDED',
]);

const KYC_RISK_LEVELS = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
]);

const KYC_DOCUMENT_TYPES = Object.freeze([
  'NATIONAL_ID',
  'PASSPORT',
  'DRIVING_LICENCE',
  'VOTER_ID',
  'OTHER',
]);

const KYC_DOCUMENT_STATUSES = Object.freeze([
  'PENDING',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
]);

const KYC_REJECTION_REASONS = Object.freeze([
  'DOCUMENT_INVALID',
  'DOCUMENT_EXPIRED',
  'DOCUMENT_UNREADABLE',
  'IDENTITY_MISMATCH',
  'DUPLICATE_IDENTITY',
  'INSUFFICIENT_DOCUMENTATION',
  'FRAUD_SUSPECTED',
  'OTHER',
]);

const VERIFICATION_METHODS = Object.freeze([
  'MANUAL',
  'OTP',
  'REMOTE',
  'PROVIDER',
  'SYSTEM',
]);

const MAX_NAME_LENGTH = 200;
const MAX_ID_LENGTH = 100;
const MAX_PHONE_LENGTH = 32;
const MAX_REJECTION_REASON_LENGTH = 500;
const MAX_REVIEW_NOTES_LENGTH = 2000;
const MAX_DOCUMENT_COUNT = 10;
const MAX_DOCUMENT_REFERENCE_LENGTH = 500;

// =============================================================================
// Document subdocument
// =============================================================================

const kycDocumentSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: KYC_DOCUMENT_TYPES,
      uppercase: true,
      trim: true,
    },

    /**
     * Controlled object-storage/document-service reference.
     *
     * Do not store raw file content or public unrestricted URLs here.
     */
    documentReference: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_DOCUMENT_REFERENCE_LENGTH,
      select: false,
    },

    /**
     * Optional provider-side reference.
     */
    providerReference: {
      type: String,
      trim: true,
      maxlength: 256,
      select: false,
    },

    status: {
      type: String,
      required: true,
      enum: KYC_DOCUMENT_STATUSES,
      default: 'PENDING',
      uppercase: true,
    },

    issuedAt: {
      type: Date,
    },

    expiresAt: {
      type: Date,
    },

    verifiedAt: {
      type: Date,
    },

    rejectionReason: {
      type: String,
      enum: [
        ...KYC_REJECTION_REASONS,
        null,
      ],
      default: null,
      maxlength: MAX_REJECTION_REASON_LENGTH,
    },

    /**
     * SHA-256 or equivalent content digest.
     *
     * Useful for duplicate detection and evidence integrity without storing
     * the file itself in MongoDB.
     */
    contentHash: {
      type: String,
      trim: true,
      maxlength: 128,
      select: false,
    },
  },
  {
    _id: true,
    id: true,
    strict: true,
    minimize: false,
  }
);

// =============================================================================
// Verification history
// =============================================================================

const verificationHistorySchema = new Schema(
  {
    previousStatus: {
      type: String,
      enum: KYC_STATUSES,
      required: true,
    },

    newStatus: {
      type: String,
      enum: KYC_STATUSES,
      required: true,
    },

    verificationMethod: {
      type: String,
      enum: VERIFICATION_METHODS,
      required: true,
    },

    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    performedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: MAX_REJECTION_REASON_LENGTH,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: MAX_REVIEW_NOTES_LENGTH,
    },

    correlationId: {
      type: String,
      trim: true,
      maxlength: 128,
    },

    requestId: {
      type: String,
      trim: true,
      maxlength: 128,
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

const kycSchema = new Schema(
  {
    // -------------------------------------------------------------------------
    // Tenant
    // -------------------------------------------------------------------------

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // User
    // -------------------------------------------------------------------------

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Identity snapshot
    // -------------------------------------------------------------------------

    /**
     * Snapshot of the name used during the KYC process.
     * This should not automatically overwrite User.name.
     */
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_NAME_LENGTH,
    },

    /**
     * National identifier.
     *
     * Hidden from normal queries/JSON responses. Only a privileged KYC service
     * should explicitly select this field when operationally required.
     */
    nationalId: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_ID_LENGTH,
      select: false,
    },

    /**
     * Optional one-way fingerprint used for duplicate identity detection.
     *
     * Never use the hash as a replacement for authorization.
     */
    nationalIdHash: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: 128,
      select: false,
    },

    phone: {
      type: String,
      trim: true,
      maxlength: MAX_PHONE_LENGTH,
    },

    phoneVerified: {
      type: Boolean,
      required: true,
      default: false,
    },

    // -------------------------------------------------------------------------
    // Documents
    // -------------------------------------------------------------------------

    documents: {
      type: [kycDocumentSchema],
      default: [],
      validate: {
        validator: (documents) =>
          Array.isArray(documents) &&
          documents.length <= MAX_DOCUMENT_COUNT,
        message:
          `A KYC record cannot contain more than ${MAX_DOCUMENT_COUNT} documents.`,
      },
    },

    // -------------------------------------------------------------------------
    // Decision
    // -------------------------------------------------------------------------

    status: {
      type: String,
      required: true,
      enum: KYC_STATUSES,
      default: 'PENDING',
      uppercase: true,
      trim: true,
      index: true,
    },

    riskLevel: {
      type: String,
      required: true,
      enum: KYC_RISK_LEVELS,
      default: 'LOW',
      uppercase: true,
      trim: true,
      index: true,
    },

    rejectionReason: {
      type: String,
      enum: [
        ...KYC_REJECTION_REASONS,
        null,
      ],
      default: null,
      maxlength: MAX_REJECTION_REASON_LENGTH,
    },

    reviewNotes: {
      type: String,
      trim: true,
      maxlength: MAX_REVIEW_NOTES_LENGTH,
    },

    // -------------------------------------------------------------------------
    // Verification
    // -------------------------------------------------------------------------

    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    verifiedAt: {
      type: Date,
      default: null,
    },

    verificationMethod: {
      type: String,
      enum: VERIFICATION_METHODS,
      default: null,
    },

    verificationProvider: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Expiry
    // -------------------------------------------------------------------------

    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    // -------------------------------------------------------------------------
    // History
    // -------------------------------------------------------------------------

    verificationHistory: {
      type: [verificationHistorySchema],
      default: [],
    },

    // -------------------------------------------------------------------------
    // Traceability
    // -------------------------------------------------------------------------

    correlationId: {
      type: String,
      trim: true,
      maxlength: 128,
      index: true,
    },

    requestId: {
      type: String,
      trim: true,
      maxlength: 128,
      index: true,
    },
  },
  {
    timestamps: true,

    /**
     * KYC records can legitimately move through their lifecycle, therefore
     * the entire document is not append-only like LoanAudit.
     *
     * Changes to status/evidence should nevertheless go through the dedicated
     * KYC service and append verificationHistory.
     */
    versionKey: '__v',

    strict: true,
    strictQuery: true,
    minimize: false,

    toJSON: {
      transform(doc, ret) {
        ret.id = doc._id.toString();

        // Defensive removal of sensitive fields.
        delete ret._id;
        delete ret.nationalId;
        delete ret.nationalIdHash;

        if (Array.isArray(ret.documents)) {
          for (const document of ret.documents) {
            delete document.documentReference;
            delete document.providerReference;
            delete document.contentHash;
          }
        }
      },
    },
  }
);

// =============================================================================
// Indexes
// =============================================================================

/**
 * There should normally be one current KYC record per user per tenant.
 */
kycSchema.index(
  {
    tenantId: 1,
    userId: 1,
  },
  {
    unique: true,
    name: 'uniq_kyc_tenant_user',
  }
);

kycSchema.index(
  {
    tenantId: 1,
    status: 1,
    expiresAt: 1,
  },
  {
    name: 'idx_kyc_tenant_status_expiry',
  }
);

kycSchema.index(
  {
    tenantId: 1,
    riskLevel: 1,
    status: 1,
  },
  {
    name: 'idx_kyc_tenant_risk_status',
  }
);

kycSchema.index(
  {
    tenantId: 1,
    verifiedAt: -1,
  },
  {
    name: 'idx_kyc_tenant_verified_at',
  }
);

kycSchema.index(
  {
    tenantId: 1,
    nationalIdHash: 1,
  },
  {
    unique: true,
    sparse: true,
    name: 'uniq_kyc_tenant_national_id_hash',
  }
);

kycSchema.index(
  {
    tenantId: 1,
    correlationId: 1,
  },
  {
    sparse: true,
    name: 'idx_kyc_tenant_correlation',
  }
);

// =============================================================================
// Validation
// =============================================================================

kycSchema.pre(
  'validate',
  function validateKYC(next) {
    try {
      if (!this.tenantId) {
        throw new Error(
          'tenantId is required for KYC records.'
        );
      }

      if (!this.userId) {
        throw new Error(
          'userId is required for KYC records.'
        );
      }

      if (!this.fullName?.trim()) {
        throw new Error(
          'fullName is required for KYC records.'
        );
      }

      if (!this.nationalIdHash?.trim()) {
        throw new Error(
          'nationalIdHash is required for KYC records.'
        );
      }

      // -----------------------------------------------------------------------
      // Status consistency
      // -----------------------------------------------------------------------

      if (this.status === 'VERIFIED') {
        if (!this.verifiedBy) {
          throw new Error(
            'A VERIFIED KYC record must identify verifiedBy.'
          );
        }

        if (!this.verifiedAt) {
          throw new Error(
            'A VERIFIED KYC record must contain verifiedAt.'
          );
        }

        if (!this.verificationMethod) {
          throw new Error(
            'A VERIFIED KYC record must contain verificationMethod.'
          );
        }
      }

      if (this.status !== 'VERIFIED') {
        if (this.verifiedAt && this.status !== 'EXPIRED') {
          throw new Error(
            'verifiedAt is only valid for verified or expired records.'
          );
        }
      }

      // -----------------------------------------------------------------------
      // Rejection consistency
      // -----------------------------------------------------------------------

      if (
        this.status === 'REJECTED' &&
        !this.rejectionReason
      ) {
        throw new Error(
          'Rejected KYC records must specify rejectionReason.'
        );
      }

      if (
        this.status !== 'REJECTED' &&
        this.rejectionReason
      ) {
        throw new Error(
          'rejectionReason is only valid for rejected KYC records.'
        );
      }

      // -----------------------------------------------------------------------
      // Expiry consistency
      // -----------------------------------------------------------------------

      if (
        this.status === 'VERIFIED' &&
        this.expiresAt &&
        this.expiresAt <= this.verifiedAt
      ) {
        throw new Error(
          'KYC expiresAt must be later than verifiedAt.'
        );
      }

      // -----------------------------------------------------------------------
      // Document consistency
      // -----------------------------------------------------------------------

      for (const document of this.documents) {
        if (
          document.status === 'VERIFIED' &&
          !document.verifiedAt
        ) {
          throw new Error(
            'Verified KYC documents must contain verifiedAt.'
          );
        }

        if (
          document.issuedAt &&
          document.expiresAt &&
          document.expiresAt <= document.issuedAt
        ) {
          throw new Error(
            'Document expiresAt must be later than issuedAt.'
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
// Lifecycle helpers
// =============================================================================

/**
 * Determine whether the KYC record is currently valid.
 */
kycSchema.methods.isCurrentlyVerified =
  function (referenceDate = new Date()) {
    if (this.status !== 'VERIFIED') {
      return false;
    }

    if (
      this.expiresAt &&
      referenceDate >= this.expiresAt
    ) {
      return false;
    }

    return true;
  };

/**
 * Mark KYC as verified.
 *
 * The caller should normally execute this through a dedicated KYC service,
 * inside the relevant MongoDB session where other state changes are required.
 */
kycSchema.methods.markVerified =
  function ({
    verifiedBy,
    verificationMethod,
    verificationProvider = null,
    expiresAt = null,
    notes = null,
    correlationId = null,
    requestId = null,
    verifiedAt = new Date(),
  }) {
    if (!verifiedBy) {
      throw new Error(
        'verifiedBy is required.'
      );
    }

    if (!VERIFICATION_METHODS.includes(verificationMethod)) {
      throw new Error(
        `Unsupported verification method: ${verificationMethod}`
      );
    }

    const previousStatus = this.status;

    this.status = 'VERIFIED';
    this.verifiedBy = verifiedBy;
    this.verifiedAt = verifiedAt;
    this.verificationMethod = verificationMethod;
    this.verificationProvider =
      verificationProvider || null;
    this.expiresAt = expiresAt || null;
    this.rejectionReason = null;
    this.reviewNotes = notes || null;

    this.correlationId =
      correlationId || this.correlationId;

    this.requestId =
      requestId || this.requestId;

    this.verificationHistory.push({
      previousStatus,
      newStatus: 'VERIFIED',
      verificationMethod,
      performedBy: verifiedBy,
      performedAt: verifiedAt,
      notes: notes || undefined,
      correlationId: correlationId || undefined,
      requestId: requestId || undefined,
    });

    return this;
  };

/**
 * Reject KYC.
 */
kycSchema.methods.markRejected =
  function ({
    rejectedBy,
    reason,
    notes = null,
    correlationId = null,
    requestId = null,
    rejectedAt = new Date(),
  }) {
    if (!rejectedBy) {
      throw new Error(
        'rejectedBy is required.'
      );
    }

    if (!KYC_REJECTION_REASONS.includes(reason)) {
      throw new Error(
        `Unsupported KYC rejection reason: ${reason}`
      );
    }

    const previousStatus = this.status;

    this.status = 'REJECTED';
    this.rejectionReason = reason;
    this.reviewNotes = notes || null;

    this.verifiedBy = null;
    this.verifiedAt = null;
    this.verificationMethod = null;
    this.verificationProvider = null;

    this.verificationHistory.push({
      previousStatus,
      newStatus: 'REJECTED',
      verificationMethod: 'MANUAL',
      performedBy: rejectedBy,
      performedAt: rejectedAt,
      reason,
      notes: notes || undefined,
      correlationId: correlationId || undefined,
      requestId: requestId || undefined,
    });

    return this;
  };

/**
 * Suspend the KYC record.
 */
kycSchema.methods.markSuspended =
  function ({
    performedBy,
    reason,
    notes = null,
    suspendedAt = new Date(),
  }) {
    if (!performedBy) {
      throw new Error(
        'performedBy is required.'
      );
    }

    const previousStatus = this.status;

    this.status = 'SUSPENDED';
    this.reviewNotes = notes || null;

    this.verificationHistory.push({
      previousStatus,
      newStatus: 'SUSPENDED',
      verificationMethod: 'MANUAL',
      performedBy,
      performedAt: suspendedAt,
      reason,
      notes: notes || undefined,
    });

    return this;
  };

// =============================================================================
// Static helpers
// =============================================================================

/**
 * Find a tenant-scoped user's KYC record.
 */
kycSchema.statics.findByUser =
  async function (
    tenantId,
    userId,
    {
      session = null,
      includeSensitive = false,
    } = {}
  ) {
    if (!tenantId) {
      throw new Error('tenantId is required.');
    }

    if (!userId) {
      throw new Error('userId is required.');
    }

    let query = this.findOne({
      tenantId,
      userId,
    });

    if (includeSensitive) {
      query = query.select(
        '+nationalId +nationalIdHash +documents.documentReference ' +
          '+documents.providerReference +documents.contentHash'
      );
    }

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Find only currently valid verified KYC.
 */
kycSchema.statics.findVerified =
  async function (
    tenantId,
    userId,
    {
      session = null,
      now = new Date(),
    } = {}
  ) {
    const filter = {
      tenantId,
      userId,
      status: 'VERIFIED',
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } },
      ],
    };

    const query = this.findOne(filter);

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

// =============================================================================
// Model
// =============================================================================

const KYC =
  mongoose.models.KYC ||
  mongoose.model(
    'KYC',
    kycSchema
  );

export default KYC;

export {
  KYC_STATUSES,
  KYC_RISK_LEVELS,
  KYC_DOCUMENT_TYPES,
  KYC_DOCUMENT_STATUSES,
  KYC_REJECTION_REASONS,
  VERIFICATION_METHODS,
};