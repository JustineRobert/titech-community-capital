'use strict';

import api, { generateIdempotencyKey } from '../../services/api';

const PAYROLL_BASE = import.meta.env.PROD ? '/payroll' : '/api/v1/payroll';

export function uploadPayroll(csvText, fileName) {
  return api.post(`${PAYROLL_BASE}/uploadPayroll`, csvText, {
    headers: {
      'Content-Type': 'text/csv',
      'Idempotency-Key': generateIdempotencyKey(),
      'X-Filename': fileName || 'payroll.csv',
    },
  });
}

export function getPayrollReport(params = {}) {
  return api.get(`${PAYROLL_BASE}/report`, { params });
}

export function processPayrollBatch(batchId) {
  return api.post(`${PAYROLL_BASE}/processBatch`, { batchId }, { headers: { 'Idempotency-Key': generateIdempotencyKey() } });
}

export function reconcilePayrollBatch(batchId) {
  return api.post(`${PAYROLL_BASE}/reconcile`, { batchId }, { headers: { 'Idempotency-Key': generateIdempotencyKey() } });
}

export function retryFailedPayroll(batchId) {
  return api.post(`${PAYROLL_BASE}/retryFailed`, { batchId: batchId || undefined }, { headers: { 'Idempotency-Key': generateIdempotencyKey() } });
}

export function listWebhookSubscriptions() {
  return api.get(`${PAYROLL_BASE}/webhookSubscriptions`);
}

export function createWebhookSubscription(callbackUrl, events) {
  return api.post(`${PAYROLL_BASE}/webhookSubscriptions`, {
    callbackUrl,
    events,
  }, { headers: { 'Idempotency-Key': generateIdempotencyKey() } });
}

export function deleteWebhookSubscription(subscriptionId) {
  return api.delete(`${PAYROLL_BASE}/webhookSubscriptions/${encodeURIComponent(subscriptionId)}`, { headers: { 'Idempotency-Key': generateIdempotencyKey() } });
}

export function testWebhook(subscriptionId, eventType) {
  return api.post(`${PAYROLL_BASE}/testWebhook`, {
    subscriptionId,
    eventType,
  }, { headers: { 'Idempotency-Key': generateIdempotencyKey() } });
}

export function getWebhookAuditLogs(params = {}) {
  return api.get(`${PAYROLL_BASE}/testWebhook/auditLogs`, { params });
}
