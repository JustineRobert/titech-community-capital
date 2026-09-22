/**
 * ============================================================================
 * TITech Community Capital — Consent Service
 * ============================================================================
 * Architectural role: enforce granular, purpose-bound consent before governed
 * financial data can be shared with an approved recipient.
 * Non-responsibilities: data extraction, underwriting, payment processing or
 * balance mutations.
 * ============================================================================
 */

import ConsentRecord, { CONSENT_STATUS } from '../models/ConsentRecord.js';
import { ConsentRepository } from '../repositories/consentRepository.js';

const repository = new ConsentRepository({ model: ConsentRecord });

function assertTenant(tenantId) {
  if (!tenantId || String(tenantId).trim().length === 0) {
    const error = new Error('Trusted tenant context is required.');
    error.code = 'TENANT_CONTEXT_REQUIRED';
    error.statusCode = 401;
    throw error;
  }
}

function normalizeContext(context = {}) {
  assertTenant(context.tenantId);
  return {
    tenantId: String(context.tenantId).trim(),
    actorId: context.actorId ? String(context.actorId).trim() : null,
  };
}

const SUBJECT_TYPES = new Set(['MEMBER', 'GROUP', 'INSTITUTION']);

function assertRequiredString(value, field) {
  const normalized = value == null ? '' : String(value).trim();
  if (!normalized) throw Object.assign(new Error(`${field} is required.`), { code: `${field.toUpperCase()}_REQUIRED`, statusCode: 400 });
  return normalized;
}

function normalizeCategories(categories) {
  const values = [...new Set((categories || []).map((value) => String(value).trim()).filter(Boolean))];
  if (!values.length) throw Object.assign(new Error('At least one data category is required.'), { code: 'CONSENT_CATEGORIES_REQUIRED', statusCode: 400 });
  return values;
}

export async function grantConsent(payload, context = {}) {
  const trusted = normalizeContext(context);
  if (!trusted.actorId) throw Object.assign(new Error('Actor identity is required.'), { code: 'ACTOR_REQUIRED', statusCode: 401 });

  const dataCategories = normalizeCategories(payload.dataCategories);
  const subjectType = assertRequiredString(payload.subjectType, 'subjectType').toUpperCase();
  if (!SUBJECT_TYPES.has(subjectType)) throw Object.assign(new Error('Unsupported consent subject type.'), { code: 'CONSENT_SUBJECT_TYPE_INVALID', statusCode: 400 });
  const subjectId = assertRequiredString(payload.subjectId, 'subjectId');
  const purpose = assertRequiredString(payload.purpose, 'purpose');
  const recipient = assertRequiredString(payload.recipient, 'recipient');
  const legalBasis = assertRequiredString(payload.legalBasis, 'legalBasis');
  const evidenceRef = assertRequiredString(payload.evidenceRef, 'evidenceRef');
  const startsAt = payload.startsAt ? new Date(payload.startsAt) : new Date();
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
  if (Number.isNaN(startsAt.getTime()) || (expiresAt && Number.isNaN(expiresAt.getTime()))) {
    throw Object.assign(new Error('Consent dates must be valid ISO timestamps.'), { code: 'CONSENT_DATE_INVALID', statusCode: 400 });
  }
  if (expiresAt && expiresAt <= startsAt) {
    throw Object.assign(new Error('Consent expiry must be later than start time.'), { code: 'CONSENT_EXPIRY_INVALID', statusCode: 400 });
  }

  const existing = await repository.findActive({
    tenantId: trusted.tenantId,
    subjectType,
    subjectId,
    purpose,
    recipient,
  });

  if (existing) return existing;

  return repository.create({
    tenantId: trusted.tenantId,
    subjectType,
    subjectId,
    dataCategories,
    purpose,
    recipient,
    legalBasis,
    sourceChannel: String(payload.sourceChannel || 'API').trim(),
    evidenceRef,
    startsAt,
    expiresAt,
    status: CONSENT_STATUS.GRANTED,
    grantedAt: new Date(),
    version: 1,
    metadata: payload.metadata || {},
    createdBy: trusted.actorId,
    updatedBy: trusted.actorId,
  });
}

export async function withdrawConsent(consentId, context = {}) {
  const trusted = normalizeContext(context);
  if (!trusted.actorId) throw Object.assign(new Error('Actor identity is required.'), { code: 'ACTOR_REQUIRED', statusCode: 401 });
  const current = await repository.findById({ tenantId: trusted.tenantId, id: consentId });
  if (!current) throw Object.assign(new Error('Consent record not found.'), { code: 'CONSENT_NOT_FOUND', statusCode: 404 });
  if (current.status !== CONSENT_STATUS.GRANTED) return current;
  return repository.updateById({
    tenantId: trusted.tenantId,
    id: consentId,
    update: {
      $set: { status: CONSENT_STATUS.WITHDRAWN, withdrawnAt: new Date(), withdrawnBy: trusted.actorId, updatedBy: trusted.actorId },
      $inc: { version: 1 },
    },
  });
}

export async function getConsent(consentId, context = {}) {
  const trusted = normalizeContext(context);
  const record = await repository.findById({ tenantId: trusted.tenantId, id: consentId });
  if (!record) throw Object.assign(new Error('Consent record not found.'), { code: 'CONSENT_NOT_FOUND', statusCode: 404 });
  return record;
}

export async function listConsents(filters = {}, context = {}) {
  const trusted = normalizeContext(context);
  return repository.list({ tenantId: trusted.tenantId, ...filters });
}

export async function assertActiveConsent({ consentId, tenantId, purpose, recipient, requiredCategories = [] }) {
  assertTenant(tenantId);
  const record = await repository.findById({ tenantId: String(tenantId).trim(), id: consentId });
  if (!record || record.status !== CONSENT_STATUS.GRANTED) {
    throw Object.assign(new Error('Required consent is not active.'), { code: 'CONSENT_REQUIRED', statusCode: 403 });
  }
  const now = new Date();
  if (record.startsAt > now || (record.expiresAt && record.expiresAt <= now)) {
    throw Object.assign(new Error('Required consent is outside its validity period.'), { code: 'CONSENT_EXPIRED', statusCode: 403 });
  }
  if (purpose && record.purpose !== purpose) throw Object.assign(new Error('Consent purpose does not match requested use.'), { code: 'CONSENT_PURPOSE_MISMATCH', statusCode: 403 });
  if (recipient && record.recipient !== recipient) throw Object.assign(new Error('Consent recipient does not match requested recipient.'), { code: 'CONSENT_RECIPIENT_MISMATCH', statusCode: 403 });
  const granted = new Set(record.dataCategories);
  for (const category of requiredCategories) if (!granted.has(category)) throw Object.assign(new Error(`Consent does not cover data category: ${category}`), { code: 'CONSENT_SCOPE_INSUFFICIENT', statusCode: 403 });
  return record;
}
