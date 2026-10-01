'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const PayrollWebhookEventSchema = new Schema({
  eventId: { type: String, required: true, immutable: true },
  provider: { type: String, required: true, immutable: true },
  tenantId: { type: String, default: null, index: true },
  transactionId: { type: String, required: true, index: true },
  status: { type: String, required: true },
  payloadHash: { type: String, required: true, immutable: true },
  receivedAt: { type: Date, required: true },
  processedAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });

PayrollWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

module.exports = mongoose.models.PayrollWebhookEvent || mongoose.model('PayrollWebhookEvent', PayrollWebhookEventSchema);
