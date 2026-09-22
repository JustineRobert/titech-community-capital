/**
 * TITech Community Capital — Data Provenance Service
 * Role: record and query lineage for important financial/risk information.
 * Non-responsibilities: data sharing approval, scoring, payments or ledger mutation.
 * Security: tenant and actor context are required for writes.
 */

import DataProvenance from '../models/DataProvenance.js';

function assertTenant(tenantId) {
  if (!tenantId) throw Object.assign(new Error('Trusted tenant context is required.'), { code: 'TENANT_CONTEXT_REQUIRED', statusCode: 401 });
}

export async function recordProvenance(payload, context = {}) {
  assertTenant(context.tenantId);
  if (!context.actorId && payload.consumerType !== 'SYSTEM') {
    throw Object.assign(new Error('Actor identity is required for provenance writes.'), { code: 'ACTOR_REQUIRED', statusCode: 401 });
  }
  return DataProvenance.create({
    tenantId: String(context.tenantId),
    subjectType: payload.subjectType,
    subjectId: String(payload.subjectId),
    dataType: payload.dataType,
    sourceType: payload.sourceType,
    sourceId: String(payload.sourceId),
    sourceEventId: payload.sourceEventId || null,
    collectedAt: payload.collectedAt ? new Date(payload.collectedAt) : new Date(),
    transformation: payload.transformation || 'NONE',
    validationStatus: payload.validationStatus || 'RAW',
    confidence: payload.confidence ?? 1,
    consentId: payload.consentId || null,
    purpose: payload.purpose,
    consumer: payload.consumer || null,
    metadata: payload.metadata || {},
  });
}

export async function traceProvenance({ tenantId, subjectId, dataType, limit = 100 }) {
  assertTenant(tenantId);
  return DataProvenance.find({ tenantId: String(tenantId), ...(subjectId ? { subjectId: String(subjectId) } : {}), ...(dataType ? { dataType } : {}) })
    .sort({ collectedAt: -1 })
    .limit(Math.min(Number(limit) || 100, 250));
}
