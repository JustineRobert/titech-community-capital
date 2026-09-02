'use strict';

/**
 * ============================================================================
 * CONVERSATION EXPORT MODEL
 * ============================================================================
 * TITech Community Capital LTD (ACFOS)
 * TITechChat Enterprise Communication Platform
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Manages conversation export requests, generation, downloads, retention,
 * compliance investigations, regulatory reporting, and evidence preservation.
 *
 * Supports:
 *
 * ✅ Conversation History Export
 * ✅ PDF Export
 * ✅ CSV Export
 * ✅ Excel Export
 * ✅ JSON Export
 * ✅ Compliance Reporting
 * ✅ Regulatory Investigations
 * ✅ Audit Evidence Preservation
 * ✅ Export Download Tracking
 * ✅ Export Expiration Policies
 * ✅ Export Queue Processing
 * ✅ Background Jobs
 * ✅ Administrative Reporting
 * ✅ Multi-Tenant Isolation
 *
 * FEATURES
 * ----------------------------------------------------------------------------
 * ✅ Enterprise Grade Validation
 * ✅ Export Lifecycle Tracking
 * ✅ Compliance Ready
 * ✅ Audit Ready
 * ✅ Background Processing Ready
 * ✅ Search Ready
 * ✅ Analytics Ready
 * ✅ Multi-Tenant Ready
 * ✅ Horizontal Scaling Ready
 * ✅ Storage Provider Agnostic
 * ✅ Retention Policy Ready
 *
 * RELATED MODULES
 * ----------------------------------------------------------------------------
 * Conversation
 * Message
 * User
 * MessageAudit
 * Notification
 * AuditLog
 * SupportTicket
 * Loan
 * Savings
 * Transaction
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

const ConversationExportSchema = new Schema(
  {
    /*
    |--------------------------------------------------------------------------
    | Ownership
    |--------------------------------------------------------------------------
    */

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },

    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },

    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    /*
    |--------------------------------------------------------------------------
    | Export Information
    |--------------------------------------------------------------------------
    */

    exportType: {
      type: String,
      enum: [
        'PDF',
        'CSV',
        'XLSX',
        'JSON',
        'TXT',
        'ZIP',
      ],
      default: 'PDF',
      uppercase: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        'PENDING',
        'PROCESSING',
        'READY',
        'FAILED',
        'EXPIRED',
        'CANCELLED',
      ],
      default: 'PENDING',
      uppercase: true,
      index: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    /*
    |--------------------------------------------------------------------------
    | Generated File
    |--------------------------------------------------------------------------
    */

    fileName: {
      type: String,
      trim: true,
    },

    fileUrl: {
      type: String,
      trim: true,
    },

    storageProvider: {
      type: String,
      enum: [
        'LOCAL',
        'AWS_S3',
        'AZURE_BLOB',
        'GCP_STORAGE',
        'MINIO',
      ],
      uppercase: true,
      default: 'LOCAL',
    },

    mimeType: {
      type: String,
      trim: true,
    },

    fileSize: {
      type: Number,
      default: 0,
    },

    checksum: {
      type: String,
      trim: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Export Filters
    |--------------------------------------------------------------------------
    */

    filters: {
      startDate: Date,
      endDate: Date,
      includeDeletedMessages: {
        type: Boolean,
        default: false,
      },
      includeAttachments: {
        type: Boolean,
        default: true,
      },
      includeAuditLogs: {
        type: Boolean,
        default: false,
      },
      participants: [
        {
          type: Schema.Types.ObjectId,
          ref: 'User',
        },
      ],
    },

    /*
    |--------------------------------------------------------------------------
    | Processing Information
    |--------------------------------------------------------------------------
    */

    queuedAt: {
      type: Date,
      default: Date.now,
    },

    processingStartedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    lastDownloadedAt: {
      type: Date,
      default: null,
    },

    downloadCount: {
      type: Number,
      default: 0,
    },

    /*
    |--------------------------------------------------------------------------
    | Compliance Information
    |--------------------------------------------------------------------------
    */

    purpose: {
      type: String,
      enum: [
        'USER_REQUEST',
        'AUDIT',
        'COMPLIANCE',
        'REGULATORY',
        'INVESTIGATION',
        'LEGAL',
        'BACKUP',
      ],
      default: 'USER_REQUEST',
      uppercase: true,
      index: true,
    },

    linkedEntityType: {
      type: String,
      enum: [
        'GROUP',
        'LOAN',
        'SAVINGS',
        'TRANSACTION',
        'SUPPORT',
      ],
      uppercase: true,
      default: null,
      index: true,
    },

    linkedEntityId: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    /*
    |--------------------------------------------------------------------------
    | Security & Tracking
    |--------------------------------------------------------------------------
    */

    requestId: {
      type: String,
      trim: true,
      index: true,
    },

    correlationId: {
      type: String,
      trim: true,
      index: true,
    },

    ipAddress: {
      type: String,
      trim: true,
    },

    userAgent: {
      type: String,
      trim: true,
    },

    error: {
      type: String,
      trim: true,
    },

    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,

    toJSON: {
      virtuals: true,

      transform(doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },

    toObject: {
      virtuals: true,
    },
  }
);

/*
|--------------------------------------------------------------------------
| Indexes
|--------------------------------------------------------------------------
*/

ConversationExportSchema.index({
  conversationId: 1,
  createdAt: -1,
});

ConversationExportSchema.index({
  requestedBy: 1,
  createdAt: -1,
});

ConversationExportSchema.index({
  tenantId: 1,
  createdAt: -1,
});

ConversationExportSchema.index({
  status: 1,
  createdAt: -1,
});

ConversationExportSchema.index({
  exportType: 1,
  status: 1,
});

ConversationExportSchema.index({
  purpose: 1,
  createdAt: -1,
});

ConversationExportSchema.index({
  linkedEntityType: 1,
  linkedEntityId: 1,
});

ConversationExportSchema.index({
  requestId: 1,
});

ConversationExportSchema.index({
  correlationId: 1,
});

/*
|--------------------------------------------------------------------------
| Virtuals
|--------------------------------------------------------------------------
*/

ConversationExportSchema.virtual('id').get(function () {
  return this._id.toString();
});

/*
|--------------------------------------------------------------------------
| Static Methods
|--------------------------------------------------------------------------
*/

ConversationExportSchema.statics.createExport =
  function (payload) {
    return this.create(payload);
  };

ConversationExportSchema.statics.findPending =
  function () {
    return this.find({
      status: 'PENDING',
    }).sort({
      createdAt: 1,
    });
  };

ConversationExportSchema.statics.findReady =
  function () {
    return this.find({
      status: 'READY',
    });
  };

/*
|--------------------------------------------------------------------------
| Instance Methods
|--------------------------------------------------------------------------
*/

ConversationExportSchema.methods.startProcessing =
  async function () {
    this.status = 'PROCESSING';
    this.processingStartedAt = new Date();

    await this.save();

    return this;
  };

ConversationExportSchema.methods.markReady =
  async function ({
    fileUrl,
    fileName,
    fileSize = 0,
    checksum = null,
  }) {
    this.status = 'READY';
    this.fileUrl = fileUrl;
    this.fileName = fileName;
    this.fileSize = fileSize;
    this.checksum = checksum;
    this.completedAt = new Date();

    await this.save();

    return this;
  };

ConversationExportSchema.methods.markFailed =
  async function (error) {
    this.status = 'FAILED';
    this.error = error;
    this.completedAt = new Date();

    await this.save();

    return this;
  };

ConversationExportSchema.methods.markDownloaded =
  async function () {
    this.downloadCount += 1;
    this.lastDownloadedAt = new Date();

    await this.save();

    return this;
  };

ConversationExportSchema.methods.expire =
  async function () {
    this.status = 'EXPIRED';

    await this.save();

    return this;
  };

module.exports = mongoose.model(
  'ConversationExport',
  ConversationExportSchema
);