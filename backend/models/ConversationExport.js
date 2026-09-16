/**
 * ============================================================================
 * backend/models/ConversationExport.js
 * TITech Community Capital LTD
 * Enterprise Conversation Export Model
 * ============================================================================
 *
 * Architectural role
 * ----------------------------------------------------------------------------
 * ConversationExport represents the lifecycle and metadata of an export job.
 *
 * It is NOT:
 *   - the conversation source of truth;
 *   - an authorization system;
 *   - a permanent public file URL store;
 *   - a compliance archive by itself.
 *
 * Security principles
 * ----------------------------------------------------------------------------
 * - Mandatory tenant isolation.
 * - Export authorization belongs to the service layer.
 * - Generated files are referenced by storage key, not trusted public URL.
 * - Processing uses an explicit state machine.
 * - Processing lease prevents abandoned jobs from remaining PROCESSING forever.
 * - Download counting is atomic.
 * - Sensitive export contents are not stored in this document.
 * - Retention and file expiration are separate concepts.
 *
 * Module format
 * ----------------------------------------------------------------------------
 * Native ESM.
 *
 * ============================================================================
 */

import mongoose from "mongoose";

const { Schema } = mongoose;

// =============================================================================
// CONSTANTS
// =============================================================================

const EXPORT_TYPES = Object.freeze([
  "PDF",
  "CSV",
  "XLSX",
  "JSON",
  "TXT",
  "ZIP",
]);

const EXPORT_STATUSES = Object.freeze([
  "PENDING",
  "PROCESSING",
  "READY",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
]);

const STORAGE_PROVIDERS = Object.freeze([
  "LOCAL",
  "AWS_S3",
  "AZURE_BLOB",
  "GCP_STORAGE",
  "MINIO",
]);

const EXPORT_PURPOSES = Object.freeze([
  "USER_REQUEST",
  "AUDIT",
  "COMPLIANCE",
  "REGULATORY",
  "INVESTIGATION",
  "LEGAL",
  "BACKUP",
]);

const LINKED_ENTITY_TYPES = Object.freeze([
  "GROUP",
  "LOAN",
  "SAVINGS",
  "TRANSACTION",
  "SUPPORT",
]);

const MAX_REASON_LENGTH = 2000;
const MAX_FILE_NAME_LENGTH = 255;
const MAX_STORAGE_KEY_LENGTH = 1024;
const MAX_MIME_TYPE_LENGTH = 150;
const MAX_CHECKSUM_LENGTH = 256;
const MAX_ERROR_LENGTH = 2000;
const MAX_USER_AGENT_LENGTH = 1000;
const MAX_IP_LENGTH = 128;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_CORRELATION_ID_LENGTH = 128;
const MAX_METADATA_KEYS = 50;
const MAX_METADATA_BYTES = 32 * 1024;
const MAX_PARTICIPANTS = 5000;

const DEFAULT_PROCESSING_LEASE_MS = 5 * 60 * 1000;

// =============================================================================
// HELPERS
// =============================================================================

function normalizeOptionalString(
  value,
  fieldName,
  maxLength
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(
      `${fieldName} must be a string.`
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    throw new RangeError(
      `${fieldName} exceeds maximum length of ${maxLength}.`
    );
  }

  return normalized;
}

function normalizeRequiredString(
  value,
  fieldName,
  maxLength
) {
  const normalized =
    normalizeOptionalString(
      value,
      fieldName,
      maxLength
    );

  if (!normalized) {
    throw new Error(
      `${fieldName} is required.`
    );
  }

  return normalized;
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
      "utf8"
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function parsePositiveInteger(
  value,
  fieldName,
  defaultValue = 0
) {
  if (
    value === undefined ||
    value === null
  ) {
    return defaultValue;
  }

  const number =
    Number(value);

  if (
    !Number.isInteger(number) ||
    number < 0
  ) {
    throw new TypeError(
      `${fieldName} must be a non-negative integer.`
    );
  }

  return number;
}

// =============================================================================
// FILTER SCHEMA
// =============================================================================

const exportFilterSchema =
  new Schema(
    {
      startDate: {
        type: Date,
        default: null,
      },

      endDate: {
        type: Date,
        default: null,
      },

      includeDeletedMessages: {
        type: Boolean,
        required: true,
        default: false,
      },

      includeAttachments: {
        type: Boolean,
        required: true,
        default: true,
      },

      includeAuditLogs: {
        type: Boolean,
        required: true,
        default: false,
      },

      participants: {
        type: [
          {
            type: Schema.Types.ObjectId,
            ref: "User",
          },
        ],
        default: [],
        validate: {
          validator(values) {
            return (
              Array.isArray(values) &&
              values.length <=
                MAX_PARTICIPANTS
            );
          },
          message:
            `An export cannot specify more than ${MAX_PARTICIPANTS} participants.`,
        },
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

const conversationExportSchema =
  new Schema(
    {
      // -----------------------------------------------------------------------
      // TENANT
      // -----------------------------------------------------------------------

      tenantId: {
        type: Schema.Types.ObjectId,
        ref: "Tenant",
        required: true,
        immutable: true,
        index: true,
      },

      // -----------------------------------------------------------------------
      // SOURCE CONVERSATION
      // -----------------------------------------------------------------------

      conversationId: {
        type: Schema.Types.ObjectId,
        ref: "Conversation",
        required: true,
        immutable: true,
        index: true,
      },

      // -----------------------------------------------------------------------
      // REQUESTOR / APPROVAL
      // -----------------------------------------------------------------------

      requestedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        immutable: true,
        index: true,
      },

      approvedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
        immutable: true,
        index: true,
      },

      approvedAt: {
        type: Date,
        default: null,
        immutable: true,
      },

      // -----------------------------------------------------------------------
      // EXPORT DEFINITION
      // -----------------------------------------------------------------------

      exportType: {
        type: String,
        enum: EXPORT_TYPES,
        required: true,
        default: "PDF",
        uppercase: true,
        trim: true,
        immutable: true,
        index: true,
      },

      purpose: {
        type: String,
        enum: EXPORT_PURPOSES,
        required: true,
        default: "USER_REQUEST",
        uppercase: true,
        trim: true,
        immutable: true,
        index: true,
      },

      reason: {
        type: String,
        trim: true,
        maxlength: MAX_REASON_LENGTH,
        immutable: true,
      },

      filters: {
        type: exportFilterSchema,
        required: true,
        default: () => ({}),
        immutable: true,
      },

      // -----------------------------------------------------------------------
      // LIFECYCLE
      // -----------------------------------------------------------------------

      status: {
        type: String,
        enum: EXPORT_STATUSES,
        required: true,
        default: "PENDING",
        uppercase: true,
        trim: true,
        index: true,
      },

      queuedAt: {
        type: Date,
        required: true,
        default: Date.now,
        immutable: true,
        index: true,
      },

      processingStartedAt: {
        type: Date,
        default: null,
      },

      processingLeaseExpiresAt: {
        type: Date,
        default: null,
        index: true,
      },

      completedAt: {
        type: Date,
        default: null,
      },

      // -----------------------------------------------------------------------
      // FILE / STORAGE
      // -----------------------------------------------------------------------

      fileName: {
        type: String,
        trim: true,
        maxlength: MAX_FILE_NAME_LENGTH,
        default: null,
      },

      /**
       * Internal object-storage key/reference.
       *
       * Do NOT treat this as a public URL.
       */
      storageKey: {
        type: String,
        trim: true,
        maxlength: MAX_STORAGE_KEY_LENGTH,
        default: null,
        select: false,
      },

      storageProvider: {
        type: String,
        enum: STORAGE_PROVIDERS,
        uppercase: true,
        trim: true,
        default: "LOCAL",
      },

      mimeType: {
        type: String,
        trim: true,
        maxlength: MAX_MIME_TYPE_LENGTH,
        default: null,
      },

      fileSize: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        validate: {
          validator(value) {
            return (
              Number.isFinite(value) &&
              Number.isInteger(value) &&
              value >= 0
            );
          },
          message:
            "fileSize must be a non-negative integer.",
        },
      },

      checksum: {
        type: String,
        trim: true,
        maxlength: MAX_CHECKSUM_LENGTH,
        default: null,
      },

      // -----------------------------------------------------------------------
      // FILE ACCESS / EXPIRATION
      // -----------------------------------------------------------------------

      fileExpiresAt: {
        type: Date,
        default: null,
        index: true,
      },

      // -----------------------------------------------------------------------
      // DOWNLOAD TRACKING
      // -----------------------------------------------------------------------

      lastDownloadedAt: {
        type: Date,
        default: null,
      },

      downloadCount: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        validate: {
          validator(value) {
            return (
              Number.isInteger(value) &&
              value >= 0
            );
          },
          message:
            "downloadCount must be a non-negative integer.",
        },
      },

      // -----------------------------------------------------------------------
      // COMPLIANCE / LINKAGE
      // -----------------------------------------------------------------------

      linkedEntityType: {
        type: String,
        enum: [
          ...LINKED_ENTITY_TYPES,
          null,
        ],
        uppercase: true,
        trim: true,
        default: null,
        immutable: true,
        index: true,
      },

      linkedEntityId: {
        type: Schema.Types.ObjectId,
        default: null,
        immutable: true,
        index: true,
      },

      // -----------------------------------------------------------------------
      // REQUEST TRACEABILITY
      // -----------------------------------------------------------------------

      requestId: {
        type: String,
        trim: true,
        maxlength:
          MAX_REQUEST_ID_LENGTH,
        immutable: true,
        index: true,
      },

      correlationId: {
        type: String,
        trim: true,
        maxlength:
          MAX_CORRELATION_ID_LENGTH,
        immutable: true,
        index: true,
      },

      ipAddress: {
        type: String,
        trim: true,
        maxlength: MAX_IP_LENGTH,
        immutable: true,
      },

      userAgent: {
        type: String,
        trim: true,
        maxlength:
          MAX_USER_AGENT_LENGTH,
        immutable: true,
      },

      // -----------------------------------------------------------------------
      // ERROR
      // -----------------------------------------------------------------------

      error: {
        type: String,
        trim: true,
        maxlength: MAX_ERROR_LENGTH,
        default: null,
      },

      // -----------------------------------------------------------------------
      // RETENTION
      // -----------------------------------------------------------------------

      /**
       * Retention of the export RECORD.
       *
       * This is intentionally distinct from fileExpiresAt.
       */
      retentionExpiresAt: {
        type: Date,
        default: null,
        index: true,
      },

      // -----------------------------------------------------------------------
      // METADATA
      // -----------------------------------------------------------------------

      metadata: {
        type: Map,
        of: Schema.Types.Mixed,
        default: undefined,
      },
    },
    {
      timestamps: true,

      versionKey: "__v",

      strict: true,
      strictQuery: true,
      minimize: false,

      collection:
        "conversation_exports",

      optimisticConcurrency: true,

      toJSON: {
        virtuals: true,

        transform(
          doc,
          ret
        ) {
          ret.id =
            ret._id?.toString();

          delete ret._id;
          delete ret.__v;

          /**
           * storageKey is deliberately excluded from ordinary responses.
           *
           * The download service should generate an authorized/short-lived
           * URL after checking tenant + requester permissions.
           */
          delete ret.storageKey;

          return ret;
        },
      },

      toObject: {
        virtuals: true,
      },
    }
  );

// =============================================================================
// VIRTUALS
// =============================================================================

conversationExportSchema.virtual(
  "id"
).get(function () {
  return this._id.toString();
});

conversationExportSchema.virtual(
  "isProcessingLeaseExpired"
).get(function () {
  return (
    this.status ===
      "PROCESSING" &&
    this.processingLeaseExpiresAt &&
    new Date() >=
      this.processingLeaseExpiresAt
  );
});

conversationExportSchema.virtual(
  "isFileExpired"
).get(function () {
  return (
    this.fileExpiresAt &&
    new Date() >=
      this.fileExpiresAt
  );
});

// =============================================================================
// VALIDATION
// =============================================================================

conversationExportSchema.pre(
  "validate",
  function validateConversationExport(
    next
  ) {
    try {
      if (!this.tenantId) {
        throw new Error(
          "tenantId is required."
        );
      }

      if (!this.conversationId) {
        throw new Error(
          "conversationId is required."
        );
      }

      if (!this.requestedBy) {
        throw new Error(
          "requestedBy is required."
        );
      }

      // -----------------------------------------------------------------------
      // Filter date validation
      // -----------------------------------------------------------------------

      if (
        this.filters?.startDate &&
        this.filters?.endDate &&
        this.filters.startDate >
          this.filters.endDate
      ) {
        throw new Error(
          "filters.startDate cannot be later than filters.endDate."
        );
      }

      // -----------------------------------------------------------------------
      // Approval validation
      // -----------------------------------------------------------------------

      if (
        this.approvedAt &&
        !this.approvedBy
      ) {
        throw new Error(
          "approvedBy is required when approvedAt is set."
        );
      }

      // -----------------------------------------------------------------------
      // Processing state
      // -----------------------------------------------------------------------

      if (
        this.status ===
        "PROCESSING"
      ) {
        if (
          !this.processingStartedAt
        ) {
          throw new Error(
            "PROCESSING exports require processingStartedAt."
          );
        }

        if (
          !this.processingLeaseExpiresAt
        ) {
          throw new Error(
            "PROCESSING exports require processingLeaseExpiresAt."
          );
        }

        if (
          this.completedAt
        ) {
          throw new Error(
            "PROCESSING exports cannot have completedAt."
          );
        }
      }

      // -----------------------------------------------------------------------
      // READY state
      // -----------------------------------------------------------------------

      if (
        this.status ===
        "READY"
      ) {
        if (
          !this.storageKey
        ) {
          throw new Error(
            "READY exports require storageKey."
          );
        }

        if (
          !this.fileName
        ) {
          throw new Error(
            "READY exports require fileName."
          );
        }

        if (
          !this.completedAt
        ) {
          throw new Error(
            "READY exports require completedAt."
          );
        }

        if (
          this.error
        ) {
          throw new Error(
            "READY exports cannot contain an error."
          );
        }
      }

      // -----------------------------------------------------------------------
      // FAILED state
      // -----------------------------------------------------------------------

      if (
        this.status ===
        "FAILED" &&
        !this.error
      ) {
        throw new Error(
          "FAILED exports require an error."
        );
      }

      // -----------------------------------------------------------------------
      // EXPIRED state
      // -----------------------------------------------------------------------

      if (
        this.status ===
        "EXPIRED" &&
        !this.fileExpiresAt &&
        !this.completedAt
      ) {
        throw new Error(
          "EXPIRED exports require file expiration or prior completion."
        );
      }

      // -----------------------------------------------------------------------
      // Metadata safety
      // -----------------------------------------------------------------------

      if (
        this.metadata
      ) {
        const metadataObject =
          Object.fromEntries(
            this.metadata
          );

        if (
          Object.keys(
            metadataObject
          ).length >
          MAX_METADATA_KEYS
        ) {
          throw new RangeError(
            `metadata cannot contain more than ${MAX_METADATA_KEYS} keys.`
          );
        }

        if (
          estimateBytes(
            metadataObject
          ) >
          MAX_METADATA_BYTES
        ) {
          throw new RangeError(
            "metadata exceeds maximum permitted size."
          );
        }
      }

      // -----------------------------------------------------------------------
      // File expiration
      // -----------------------------------------------------------------------

      if (
        this.fileExpiresAt &&
        this.completedAt &&
        this.fileExpiresAt <=
          this.completedAt
      ) {
        throw new Error(
          "fileExpiresAt must be later than completedAt."
        );
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

// =============================================================================
// INDEXES
// =============================================================================

conversationExportSchema.index(
  {
    tenantId: 1,
    conversationId: 1,
    createdAt: -1,
  },
  {
    name:
      "idx_export_tenant_conversation_created",
  }
);

conversationExportSchema.index(
  {
    tenantId: 1,
    requestedBy: 1,
    createdAt: -1,
  },
  {
    name:
      "idx_export_tenant_requester_created",
  }
);

conversationExportSchema.index(
  {
    tenantId: 1,
    status: 1,
    queuedAt: 1,
  },
  {
    name:
      "idx_export_tenant_status_queue",
  }
);

conversationExportSchema.index(
  {
    status: 1,
    processingLeaseExpiresAt: 1,
  },
  {
    name:
      "idx_export_processing_lease",
  }
);

conversationExportSchema.index(
  {
    tenantId: 1,
    exportType: 1,
    status: 1,
    createdAt: -1,
  },
  {
    name:
      "idx_export_tenant_type_status_created",
  }
);

conversationExportSchema.index(
  {
    tenantId: 1,
    purpose: 1,
    createdAt: -1,
  },
  {
    name:
      "idx_export_tenant_purpose_created",
  }
);

conversationExportSchema.index(
  {
    tenantId: 1,
    linkedEntityType: 1,
    linkedEntityId: 1,
    createdAt: -1,
  },
  {
    sparse: true,
    name:
      "idx_export_tenant_linked_entity",
  }
);

conversationExportSchema.index(
  {
    tenantId: 1,
    requestId: 1,
  },
  {
    sparse: true,
    name:
      "idx_export_tenant_request_id",
  }
);

conversationExportSchema.index(
  {
    tenantId: 1,
    correlationId: 1,
    createdAt: -1,
  },
  {
    sparse: true,
    name:
      "idx_export_tenant_correlation",
  }
);

conversationExportSchema.index(
  {
    tenantId: 1,
    fileExpiresAt: 1,
    status: 1,
  },
  {
    sparse: true,
    name:
      "idx_export_file_expiration",
  }
);

/**
 * Export-record retention.
 *
 * Records should only receive retentionExpiresAt once retention policy allows
 * cleanup.
 */
conversationExportSchema.index(
  {
    retentionExpiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
    sparse: true,
    name:
      "ttl_export_record_retention",
  }
);

// =============================================================================
// STATIC METHODS
// =============================================================================

/**
 * Create export request.
 */
conversationExportSchema.statics.createExport =
  async function (
    payload,
    {
      session = null,
    } = {}
  ) {
    if (!payload) {
      throw new Error(
        "Export payload is required."
      );
    }

    const exportDocument =
      new this({
        ...payload,
        tenantId:
          payload.tenantId,
        queuedAt:
          new Date(),
      });

    await exportDocument.save(
      session
        ? { session }
        : undefined
    );

    return exportDocument;
  };

/**
 * Find pending jobs within a tenant.
 */
conversationExportSchema.statics.findPending =
  async function (
    tenantId,
    {
      limit = 50,
      session = null,
    } = {}
  ) {
    const normalizedLimit =
      Math.min(
        200,
        Math.max(
          1,
          parsePositiveInteger(
            limit,
            "limit",
            50
          )
        )
      );

    const query =
      this.find({
        tenantId,
        status: "PENDING",
      })
        .sort({
          queuedAt: 1,
          _id: 1,
        })
        .limit(
          normalizedLimit
        );

    if (session) {
      query.session(
        session
      );
    }

    return query.exec();
  };

/**
 * Find ready exports within a tenant.
 */
conversationExportSchema.statics.findReady =
  async function (
    tenantId,
    {
      limit = 50,
      session = null,
    } = {}
  ) {
    const normalizedLimit =
      Math.min(
        200,
        Math.max(
          1,
          parsePositiveInteger(
            limit,
            "limit",
            50
          )
        )
      );

    const query =
      this.find({
        tenantId,
        status: "READY",
      })
        .sort({
          completedAt: -1,
          _id: -1,
        })
        .limit(
          normalizedLimit
        );

    if (session) {
      query.session(
        session
      );
    }

    return query.exec();
  };

/**
 * Find expired processing jobs.
 */
conversationExportSchema.statics.findExpiredProcessing =
  async function (
    {
      tenantId = null,
      limit = 100,
      now = new Date(),
      session = null,
    } = {}
  ) {
    const filter = {
      status:
        "PROCESSING",
      processingLeaseExpiresAt: {
        $lte: now,
      },
    };

    if (tenantId) {
      filter.tenantId =
        tenantId;
    }

    const normalizedLimit =
      Math.min(
        500,
        Math.max(
          1,
          parsePositiveInteger(
            limit,
            "limit",
            100
          )
        )
      );

    const query =
      this.find(filter)
        .sort({
          processingLeaseExpiresAt:
            1,
          _id: 1,
        })
        .limit(
          normalizedLimit
        );

    if (session) {
      query.session(
        session
      );
    }

    return query.exec();
  };

/**
 * Find one tenant-scoped export by ID.
 */
conversationExportSchema.statics.findTenantExport =
  async function (
    tenantId,
    exportId,
    {
      session = null,
      includeStorageKey = false,
    } = {}
  ) {
    let query =
      this.findOne({
        _id: exportId,
        tenantId,
      });

    if (
      includeStorageKey
    ) {
      query =
        query.select(
          "+storageKey"
        );
    }

    if (session) {
      query.session(
        session
      );
    }

    return query.exec();
  };

// =============================================================================
// INSTANCE METHODS
// =============================================================================

/**
 * Start processing with a lease.
 *
 * Uses an atomic state predicate so two workers cannot acquire the same PENDING
 * job simultaneously through this method.
 */
conversationExportSchema.methods.startProcessing =
  async function (
    {
      leaseMs =
        DEFAULT_PROCESSING_LEASE_MS,
      session = null,
      now = new Date(),
    } = {}
  ) {
    if (
      this.status !==
      "PENDING"
    ) {
      throw new Error(
        `Export cannot start from status ${this.status}.`
      );
    }

    if (
      !Number.isInteger(
        leaseMs
      ) ||
      leaseMs <= 0
    ) {
      throw new RangeError(
        "leaseMs must be a positive integer."
      );
    }

    const options = {
      new: true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id: this._id,
          status: "PENDING",
        },
        {
          $set: {
            status:
              "PROCESSING",

            processingStartedAt:
              now,

            processingLeaseExpiresAt:
              new Date(
                now.getTime() +
                  leaseMs
              ),
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        "Export was already claimed or is no longer pending."
      );
    }

    return updated;
  };

/**
 * Extend processing lease.
 */
conversationExportSchema.methods.heartbeat =
  async function (
    {
      leaseMs =
        DEFAULT_PROCESSING_LEASE_MS,
      session = null,
      now = new Date(),
    } = {}
  ) {
    if (
      !Number.isInteger(
        leaseMs
      ) ||
      leaseMs <= 0
    ) {
      throw new RangeError(
        "leaseMs must be a positive integer."
      );
    }

    const options = {
      new: true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id: this._id,
          status:
            "PROCESSING",
          processingLeaseExpiresAt:
            {
              $gt: now,
            },
        },
        {
          $set: {
            processingLeaseExpiresAt:
              new Date(
                now.getTime() +
                  leaseMs
              ),
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        "Processing lease is no longer active."
      );
    }

    return updated;
  };

/**
 * Mark export ready.
 */
conversationExportSchema.methods.markReady =
  async function (
    {
      storageKey,
      fileName,
      mimeType = null,
      fileSize = 0,
      checksum = null,
      fileExpiresAt = null,
      session = null,
      completedAt = new Date(),
    } = {}
  ) {
    const normalizedStorageKey =
      normalizeRequiredString(
        storageKey,
        "storageKey",
        MAX_STORAGE_KEY_LENGTH
      );

    const normalizedFileName =
      normalizeRequiredString(
        fileName,
        "fileName",
        MAX_FILE_NAME_LENGTH
      );

    if (
      !Number.isInteger(
        fileSize
      ) ||
      fileSize < 0
    ) {
      throw new RangeError(
        "fileSize must be a non-negative integer."
      );
    }

    const options = {
      new: true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id: this._id,
          status:
            "PROCESSING",
        },
        {
          $set: {
            status:
              "READY",

            storageKey:
              normalizedStorageKey,

            fileName:
              normalizedFileName,

            mimeType:
              mimeType
                ? String(
                    mimeType
                  ).trim()
                : null,

            fileSize,

            checksum:
              checksum
                ? String(
                    checksum
                  ).trim()
                : null,

            fileExpiresAt:
              fileExpiresAt
                ? new Date(
                    fileExpiresAt
                  )
                : null,

            completedAt,

            processingLeaseExpiresAt:
              null,

            error:
              null,
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        "Export is no longer in PROCESSING state."
      );
    }

    return updated;
  };

/**
 * Mark export failed.
 */
conversationExportSchema.methods.markFailed =
  async function (
    error,
    {
      session = null,
      completedAt = new Date(),
    } = {}
  ) {
    const normalizedError =
      normalizeRequiredString(
        typeof error === "string"
          ? error
          : error?.message,
        "error",
        MAX_ERROR_LENGTH
      );

    const options = {
      new: true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id: this._id,
          status:
            "PROCESSING",
        },
        {
          $set: {
            status:
              "FAILED",

            error:
              normalizedError,

            completedAt,

            processingLeaseExpiresAt:
              null,
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        "Export is no longer in PROCESSING state."
      );
    }

    return updated;
  };

/**
 * Mark a download atomically.
 */
conversationExportSchema.methods.markDownloaded =
  async function (
    {
      session = null,
      downloadedAt = new Date(),
    } = {}
  ) {
    const options = {
      new: true,
      runValidators: false,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id: this._id,
          status:
            "READY",
          fileExpiresAt: {
            $gt: downloadedAt,
          },
        },
        {
          $inc: {
            downloadCount:
              1,
          },

          $set: {
            lastDownloadedAt:
              downloadedAt,
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        "Export is not available for download."
      );
    }

    return updated;
  };

/**
 * Expire the generated file/export.
 */
conversationExportSchema.methods.expire =
  async function (
    {
      session = null,
    } = {}
  ) {
    const options = {
      new: true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id: this._id,
          status:
            "READY",
        },
        {
          $set: {
            status:
              "EXPIRED",

            fileExpiresAt:
              new Date(),

            storageKey:
              null,
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        "Only READY exports can be expired."
      );
    }

    return updated;
  };

/**
 * Cancel an export.
 */
conversationExportSchema.methods.cancel =
  async function (
    {
      session = null,
    } = {}
  ) {
    const options = {
      new: true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.constructor.findOneAndUpdate(
        {
          _id: this._id,
          status: {
            $in: [
              "PENDING",
              "PROCESSING",
            ],
          },
        },
        {
          $set: {
            status:
              "CANCELLED",

            processingLeaseExpiresAt:
              null,
          },
        },
        options
      );

    if (!updated) {
      throw new Error(
        "Only PENDING or PROCESSING exports can be cancelled."
      );
    }

    return updated;
  };

// =============================================================================
// MODEL EXPORT
// =============================================================================

const ConversationExport =
  mongoose.models.ConversationExport ||
  mongoose.model(
    "ConversationExport",
    conversationExportSchema
  );

export default ConversationExport;

export {
  EXPORT_TYPES,
  EXPORT_STATUSES,
  STORAGE_PROVIDERS,
  EXPORT_PURPOSES,
  LINKED_ENTITY_TYPES,
};