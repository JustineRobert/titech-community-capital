// backend/modules/compliance/models/AuditLog.js
'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');

const AuditLogSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: String, required: true },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    data: { type: mongoose.Schema.Types.Mixed },

    // 🔥 HASH CHAIN
    prevHash: { type: String, default: null },
    hash: { type: String, required: true },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

/**
 * Generate SHA256 hash
 */
function generateHash(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Pre-save hook (immutability guarantee)
 */
AuditLogSchema.pre('validate', async function (next) {
  const lastLog = await this.constructor
    .findOne({ tenantId: this.tenantId })
    .sort({ createdAt: -1 });

  const payload = JSON.stringify({
    tenantId: this.tenantId,
    action: this.action,
    entity: this.entity,
    entityId: this.entityId,
    data: this.data,
    prevHash: lastLog ? lastLog.hash : null,
  });

  this.prevHash = lastLog ? lastLog.hash : null;
  this.hash = generateHash(payload);

  next();
});

module.exports =
  mongoose.models.AuditLog ||
  mongoose.model('AuditLog', AuditLogSchema);