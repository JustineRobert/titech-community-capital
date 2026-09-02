// models/IdempotencyKey.js
'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const IdempotencyKeySchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    tenantId: { type: String }, // no inline index
    createdAt: { type: Date, default: Date.now }, // no inline index
    expiresAt: { type: Date }, // no inline index
    metadata: {
      requestId: { type: String, trim: true }, // no inline index
      endpoint: { type: String, trim: true },
      payloadHash: { type: String, trim: true },
      extra: { type: Schema.Types.Mixed, default: {} },
    },
    isDeleted: { type: Boolean, default: false }, // no inline index
  },
  { versionKey: false }
);

// ✅ Centralized index definitions
IdempotencyKeySchema.index({ tenantId: 1, createdAt: 1 }); // compound for tenant scoping
IdempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup
IdempotencyKeySchema.index({ isDeleted: 1 }); // soft delete flag

module.exports = mongoose.model('IdempotencyKey', IdempotencyKeySchema);
