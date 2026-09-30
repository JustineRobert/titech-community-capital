'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const WebhookSubscriptionSchema = new Schema({
  subscriptionId: { type: String, required: true, unique: true, immutable: true, index: true },
  tenantId: { type: String, required: true, immutable: true, index: true },
  employerId: { type: String, required: true, immutable: true },
  callbackUrl: { type: String, required: true, trim: true, immutable: true },
  events: { type: [String], required: true, enum: ['BATCH_PROCESSED', 'RECONCILED', 'RETRY_ATTEMPTED'], validate: (v) => Array.isArray(v) && v.length > 0 },
  encryptedSecret: { type: String, required: true, immutable: true },
  active: { type: Boolean, default: true, index: true },
  lastDeliveryAt: { type: Date, default: null },
  failureCount: { type: Number, default: 0, min: 0 },
  createdBy: { type: String, required: true, immutable: true },
}, { timestamps: true, strict: 'throw' });

WebhookSubscriptionSchema.index({ tenantId: 1, callbackUrl: 1 }, { unique: true });
WebhookSubscriptionSchema.index({ tenantId: 1, active: 1 });

module.exports = mongoose.models.PayrollWebhookSubscription || mongoose.model('PayrollWebhookSubscription', WebhookSubscriptionSchema);
