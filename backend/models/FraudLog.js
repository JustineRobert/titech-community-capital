// models/FraudLog.js
/**
 * Production-grade FraudLog schema
 * - Multi-tenant aware (tenantId required)
 * - Strong typing, validation, and indexes for fast queries
 * - Stores transaction snapshot, device & geo metadata, model explainability
 * - Immutable audit trail fields: decision, fraudScore, createdAt
 * - Review workflow fields for human-in-the-loop labeling
 * - Retention note: keep records >= 10 years; archival handled outside DB
 *
 * Usage:
 * const FraudLog = require('../models/FraudLog')
 *
 * Optional utils:
 * - ../utils/encryption (encryptSensitive) : if present, will encrypt sensitive fields
 * - ../utils/logger : repo logger
 */

const mongoose = require('mongoose');

let encryptUtil = null;
let logger = console;
try {
  encryptUtil = require('../utils/encryption');
} catch (e) {
  // encryption util optional; continue without encryption
}
try {
  logger = require('../utils/logger') || console;
} catch (e) {
  logger = console;
}

const DECISIONS = ['ALLOW', 'STEP_UP', 'BLOCK'];
const TRANSACTION_TYPES = ['deposit', 'withdrawal', 'transfer', 'payment', 'loan', 'repayment'];

const FraudLogSchema = new mongoose.Schema({
  tenantId: {
    type: String,
    required: true,
    index: true,
    trim: true
  },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  transactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    required: true,
    index: true
  },

  // Snapshot of transaction at time of evaluation (keeps immutable record)
  transactionSnapshot: {
    type: Object,
    required: true,
    default: {}
  },

  // Numeric fraud score 0.0 - 1.0
  fraudScore: {
    type: Number,
    required: true,
    min: 0,
    max: 1
  },

  // Decision taken by engine: ALLOW | STEP_UP | BLOCK
  decision: {
    type: String,
    enum: DECISIONS,
    required: true,
    index: true
  },

  // Which engine produced the decision: 'rules', 'ml', 'hybrid'
  engine: {
    type: String,
    trim: true,
    default: 'hybrid'
  },

  // Explainability / model metadata (small footprint)
  explain: {
    type: Object,
    default: {}
  },

  // Model version used to compute fraudScore (for reproducibility)
  modelVersion: {
    type: String,
    trim: true,
    default: null
  },

  // Device and geo metadata (for investigations)
  device: {
    ip: { type: String, trim: true, default: null },
    deviceId: { type: String, trim: true, default: null },
    userAgent: { type: String, trim: true, default: null }
  },

  geo: {
    country: { type: String, trim: true, default: null },
    region: { type: String, trim: true, default: null },
    city: { type: String, trim: true, default: null },
    lat: { type: Number, default: null },
    lon: { type: Number, default: null }
  },

  // Flags for downstream workflows
  reviewed: { type: Boolean, default: false, index: true },
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewNotes: { type: String, default: null },

  // Link to compliance STR report if generated
  strReportId: { type: String, default: null, index: true },

  // Soft-archival marker (archival handled by separate job)
  archived: { type: Boolean, default: false, index: true }
}, {
  timestamps: true,
  versionKey: 'version'
});

/**
 * Compound index for common query patterns: tenant + user + decision + createdAt
 * Background index creation for production
 */
FraudLogSchema.index({ tenantId: 1, userId: 1, decision: 1, createdAt: -1 }, { background: true });
FraudLogSchema.index({ tenantId: 1, transactionId: 1 }, { background: true });
FraudLogSchema.index({ tenantId: 1, strReportId: 1 }, { background: true });

/**
 * Pre-save hook: optional encryption of sensitive fields (transactionSnapshot)
 * If ../utils/encryption exposes encryptSensitive(obj) -> returns encrypted object
 */
FraudLogSchema.pre('save', async function (next) {
  try {
    // Ensure fraudScore is clamped
    if (typeof this.fraudScore === 'number') {
      this.fraudScore = Math.max(0, Math.min(1, this.fraudScore));
    }

    // Ensure decision is valid
    if (!DECISIONS.includes(this.decision)) {
      throw new Error(`Invalid decision: ${this.decision}`);
    }

    // Optionally encrypt sensitive snapshot fields
    if (encryptUtil && typeof encryptUtil.encryptSensitive === 'function' && this.isModified('transactionSnapshot')) {
      try {
        this.transactionSnapshot = await encryptUtil.encryptSensitive(this.transactionSnapshot);
      } catch (err) {
        logger.warn('FraudLog: encryption failed, saving plaintext snapshot', err.message);
      }
    }

    next();
  } catch (err) {
    next(err);
  }
});

/**
 * Instance method: mark as reviewed
 */
FraudLogSchema.methods.markReviewed = async function (reviewerId, notes = '') {
  this.reviewed = true;
  this.reviewerId = reviewerId;
  this.reviewNotes = notes;
  return this.save();
};

/**
 * Static helper: create log entry atomically
 * Accepts plain JS objects and ensures required fields exist
 */
FraudLogSchema.statics.createLog = async function (payload) {
  const required = ['tenantId', 'userId', 'transactionId', 'transactionSnapshot', 'fraudScore', 'decision'];
  for (const f of required) {
    if (payload[f] === undefined || payload[f] === null) {
      throw new Error(`Missing required field for FraudLog.createLog: ${f}`);
    }
  }
  return this.create(payload);
};

/**
 * Ensure indexes are built in background
 */
FraudLogSchema.index({ tenantId: 1, createdAt: -1 }, { background: true });

module.exports = mongoose.model('FraudLog', FraudLogSchema);
