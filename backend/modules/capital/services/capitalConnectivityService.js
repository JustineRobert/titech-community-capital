/**
 * ============================================================================
 * TITech Community Capital — Capital Connectivity Service
 * ============================================================================
 * Role: permissioned bridge between governed community financial information and
 * external capital partners.
 * Non-responsibilities: lending, balance-sheet funding, underwriting finality,
 * deposit custody, payment settlement or raw data export without consent.
 * ============================================================================
 */

import crypto from 'node:crypto';
import CapitalShareRequest, { CAPITAL_SHARE_STATUS } from '../models/CapitalShareRequest.js';
import { CapitalShareRepository } from '../repositories/capitalShareRepository.js';
import { assertActiveConsent } from '../../consent/services/consentService.js';

const repository = new CapitalShareRepository({ model: CapitalShareRequest });

function context(context = {}) {
  const tenantId = context.tenantId ? String(context.tenantId).trim() : '';
  const actorId = context.actorId ? String(context.actorId).trim() : '';
  if (!tenantId || !actorId) throw Object.assign(new Error('Trusted tenant and actor context are required.'), { code: 'TRUSTED_CONTEXT_REQUIRED', statusCode: 401 });
  return { tenantId, actorId };
}

function unique(values) {
  return [...new Set((values || []).map((v) => String(v).trim()).filter(Boolean))];
}

const SUBJECT_TYPES = new Set(['MEMBER', 'GROUP', 'INSTITUTION']);

function required(value, field) {
  const normalized = value == null ? '' : String(value).trim();
  if (!normalized) throw Object.assign(new Error(`${field} is required.`), { code: `${field.toUpperCase()}_REQUIRED`, statusCode: 400 });
  return normalized;
}

export async function requestCapitalDataShare(payload, requestContext = {}) {
  const trusted = context(requestContext);
  const dataCategories = unique(payload.dataCategories);
  const subjectType = required(payload.subjectType, 'subjectType').toUpperCase();
  if (!SUBJECT_TYPES.has(subjectType)) throw Object.assign(new Error('Unsupported capital-share subject type.'), { code: 'CAPITAL_SHARE_SUBJECT_TYPE_INVALID', statusCode: 400 });
  const subjectId = required(payload.subjectId, 'subjectId');
  const recipientPartnerId = required(payload.recipientPartnerId, 'recipientPartnerId');
  const purpose = required(payload.purpose, 'purpose');
  const consentId = required(payload.consentId, 'consentId');
  if (!dataCategories.length) throw Object.assign(new Error('Data sharing scope is required.'), { code: 'CAPITAL_SHARE_SCOPE_REQUIRED', statusCode: 400 });

  await assertActiveConsent({
    consentId: payload.consentId,
    tenantId: trusted.tenantId,
    purpose,
    recipient: recipientPartnerId,
    requiredCategories: dataCategories,
  });

  return repository.create({
    tenantId: trusted.tenantId,
    subjectType,
    subjectId,
    recipientPartnerId,
    purpose,
    dataCategories,
    consentId,
    status: CAPITAL_SHARE_STATUS.REQUESTED,
    requestedBy: trusted.actorId,
    requestedAt: new Date(),
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
    metadata: payload.metadata || {},
  });
}

export async function approveCapitalDataShare(id, requestContext = {}) {
  const trusted = context(requestContext);
  const record = await repository.findById({ tenantId: trusted.tenantId, id });
  if (!record) throw Object.assign(new Error('Capital share request not found.'), { code: 'CAPITAL_SHARE_NOT_FOUND', statusCode: 404 });
  if (record.requestedBy === trusted.actorId) throw Object.assign(new Error('The maker cannot approve their own capital data share request.'), { code: 'FOUR_EYES_REQUIRED', statusCode: 403 });
  if (record.status !== CAPITAL_SHARE_STATUS.REQUESTED) return record;

  await assertActiveConsent({
    consentId: record.consentId,
    tenantId: trusted.tenantId,
    purpose: record.purpose,
    recipient: record.recipientPartnerId,
    requiredCategories: record.dataCategories,
  });

  return repository.updateById({
    tenantId: trusted.tenantId,
    id,
    update: { $set: { status: CAPITAL_SHARE_STATUS.APPROVED, approvedBy: trusted.actorId, approvedAt: new Date() } },
  });
}

export async function revokeCapitalDataShare(id, reason, requestContext = {}) {
  const trusted = context(requestContext);
  const record = await repository.findById({ tenantId: trusted.tenantId, id });
  if (!record) throw Object.assign(new Error('Capital share request not found.'), { code: 'CAPITAL_SHARE_NOT_FOUND', statusCode: 404 });
  if (![CAPITAL_SHARE_STATUS.APPROVED, CAPITAL_SHARE_STATUS.SHARED].includes(record.status)) return record;
  return repository.updateById({
    tenantId: trusted.tenantId,
    id,
    update: { $set: { status: CAPITAL_SHARE_STATUS.REVOKED, decisionReason: reason || 'Revoked by authorized actor.' } },
  });
}

export async function markShared({ id, payloadSnapshot }, requestContext = {}) {
  const trusted = context(requestContext);
  const record = await repository.findById({ tenantId: trusted.tenantId, id });
  if (!record) throw Object.assign(new Error('Capital share request not found.'), { code: 'CAPITAL_SHARE_NOT_FOUND', statusCode: 404 });
  if (record.status !== CAPITAL_SHARE_STATUS.APPROVED) throw Object.assign(new Error('Capital data share must be approved before it can be shared.'), { code: 'CAPITAL_SHARE_NOT_APPROVED', statusCode: 409 });
  await assertActiveConsent({ consentId: record.consentId, tenantId: trusted.tenantId, purpose: record.purpose, recipient: record.recipientPartnerId, requiredCategories: record.dataCategories });
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payloadSnapshot ?? {})).digest('hex');
  return repository.updateById({ tenantId: trusted.tenantId, id, update: { $set: { status: CAPITAL_SHARE_STATUS.SHARED, sharedAt: new Date(), payloadHash } } });
}

export function toPermissionedPartnerEnvelope(record, governedData) {
  return Object.freeze({
    shareRequestId: String(record._id),
    subject: { type: record.subjectType, id: record.subjectId },
    recipientPartnerId: record.recipientPartnerId,
    purpose: record.purpose,
    categories: [...record.dataCategories],
    consentId: record.consentId,
    status: record.status,
    data: governedData,
  });
}
