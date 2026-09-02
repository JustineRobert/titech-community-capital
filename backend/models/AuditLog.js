const mongoose = require('mongoose');
const crypto = require('crypto');

const AuditLogSchema = new mongoose.Schema({
  action: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: false },
  entityType: { type: String, required: true },
  entityId: { type: mongoose.Schema.Types.ObjectId, required: false },
  metadata: { type: mongoose.Schema.Types.Mixed },
  prevHash: { type: String, default: null },
  currentHash: { type: String, default: null },
}, { timestamps: true });

AuditLogSchema.pre('save', async function(next) {
  try {
    const doc = this;
    // find last audit for the tenant
    const query = {};
    if (doc.tenantId) query.tenantId = doc.tenantId;
    const last = await mongoose.model('AuditLog').findOne(query).sort({ createdAt: -1 }).lean();
    doc.prevHash = last ? last.currentHash : null;
    const payload = JSON.stringify({
      action: doc.action,
      userId: doc.userId,
      tenantId: doc.tenantId,
      entityType: doc.entityType,
      entityId: doc.entityId,
      metadata: doc.metadata,
      prevHash: doc.prevHash,
      ts: new Date().toISOString(),
    });
    doc.currentHash = crypto.createHash('sha256').update(payload).digest('hex');
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('AuditLog', AuditLogSchema);
