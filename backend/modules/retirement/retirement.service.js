import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Tenant from '../../models/Tenant.js';
import User from '../../models/User.js';
import KYC from '../../models/KYC.js';
import SecureDocument from '../secure-documents/secureDocument.model.js';
import { createAuditLog } from '../audit/audit.service.js';
import RetirementSupportCase from './models/RetirementSupportCase.js';
import RetirementContributionRecord from './models/RetirementContributionRecord.js';
import RetirementFinancialSupportApplication from './models/RetirementFinancialSupportApplication.js';
import {
  assertProviderOutcome, assertRetirementCaseTransition, canTransitionRetirementCase, compareContributionAmounts,
  normalizeCurrency, normalizeEnum, normalizeMinorAmount, RETIREMENT_CASE_STATES, RETIREMENT_CASE_TYPES,
  RETIREMENT_SCHEME_TYPES,
} from './retirement.policy.js';

function retirementError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
function requiredString(value, field, maxLength = 200) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw retirementError(`${field} is required.`, `RETIREMENT_${field.toUpperCase()}_REQUIRED`, 400);
  if (normalized.length > maxLength) throw retirementError(`${field} exceeds the permitted length.`, `RETIREMENT_${field.toUpperCase()}_TOO_LONG`, 400);
  return normalized;
}
function contextValues(context = {}) {
  const tenantId = requiredString(context.tenantId, 'tenantId', 100).toLowerCase();
  const actorId = requiredString(context.actorId, 'actorId', 128);
  if (!mongoose.Types.ObjectId.isValid(actorId)) throw retirementError('The authenticated user reference is invalid.', 'RETIREMENT_ACTOR_INVALID', 401);
  return { tenantId, actorId, requestId: context.requestId || null, correlationId: context.correlationId || context.requestId || null, canAssist: context.canAssist === true, canReadAllCases: context.canReadAllCases === true, canReadAllContributions: context.canReadAllContributions === true, canReadAllFinancialSupport: context.canReadAllFinancialSupport === true };
}
async function trustedTenant(tenantId) {
  const tenant = await Tenant.findOne({ tenantId, status: 'ACTIVE' }).select('_id tenantId').lean();
  if (!tenant) throw retirementError('The authenticated tenant is not registered as active.', 'RETIREMENT_TENANT_NOT_REGISTERED', 403);
  return tenant;
}
async function assertTenantUser(tenant, userId) {
  if (!mongoose.Types.ObjectId.isValid(String(userId))) throw retirementError('The participant reference is invalid.', 'RETIREMENT_SUBJECT_INVALID', 400);
  const user = await User.findOne({ _id: new mongoose.Types.ObjectId(String(userId)), tenantId: tenant._id }).select('_id').lean();
  if (!user) throw retirementError('The participant must belong to the currently authenticated tenant.', 'RETIREMENT_SUBJECT_TENANT_MISMATCH', 403);
  return String(user._id);
}
async function audit(ctx, action, data) {
  await createAuditLog({ tenantId: ctx.tenantId, actorId: ctx.actorId, action, data, requestId: ctx.requestId, correlationId: ctx.correlationId });
}
function currentRetirementPrivacyPolicy() {
  const noticeVersion = String(process.env.TITECH_RETIREMENT_NOTICE_VERSION || '').trim();
  const processingBasis = String(process.env.TITECH_RETIREMENT_PROCESSING_BASIS || '').trim().toUpperCase();
  const allowedBases = ['CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST', 'PUBLIC_TASK', 'VITAL_INTEREST'];
  return {
    configured: Boolean(noticeVersion && noticeVersion.length <= 100 && allowedBases.includes(processingBasis)),
    noticeVersion: noticeVersion && noticeVersion.length <= 100 ? noticeVersion : null,
    processingBasis: allowedBases.includes(processingBasis) ? processingBasis : null,
  };
}

function schemeReferenceFingerprint(value) {
  const normalized = String(value ?? '').trim().normalize('NFKC').toUpperCase();
  if (!normalized) return null;
  const configuredKey = String(process.env.TITECH_RETIREMENT_REFERENCE_HMAC_KEY || '').trim();
  const key = configuredKey ? Buffer.from(configuredKey, 'base64') : Buffer.alloc(0);
  if (key.length !== 32) throw retirementError('Pension or scheme reference matching is disabled until a dedicated, exactly 32-byte base64 HMAC key is configured. Raw scheme references are not persisted.', 'RETIREMENT_REFERENCE_HASH_NOT_CONFIGURED', 503);
  return crypto.createHmac('sha256', key).update(normalized, 'utf8').digest('hex');
}
async function validateEvidenceReferences({ tenantId, subjectUserId, references, required = false }) {
  const normalized = [...new Set((Array.isArray(references) ? references : []).map((item) => String(item ?? '').trim()).filter(Boolean))];
  if (normalized.length > 20) throw retirementError('A maximum of 20 evidence references is allowed.', 'RETIREMENT_EVIDENCE_LIMIT_EXCEEDED', 400);
  if (required && normalized.length === 0) throw retirementError('At least one private evidence document is required before submission.', 'RETIREMENT_EVIDENCE_REQUIRED', 422);
  if (normalized.length === 0) return normalized;
  const records = await SecureDocument.find({ tenantId, subjectId: String(subjectUserId), documentReference: { $in: normalized }, purpose: 'RETIREMENT_SUPPORT_EVIDENCE', deletedAt: null }).select('documentReference').lean();
  if (records.length !== normalized.length) throw retirementError('Evidence must reference existing private documents uploaded for this participant and tenant.', 'RETIREMENT_EVIDENCE_REFERENCE_INVALID', 422);
  return normalized;
}
function dateOrNull(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw retirementError(`${field} must be a valid date.`, 'RETIREMENT_DATE_INVALID', 400);
  return parsed;
}
function safeCase(record) {
  if (!record) return null;
  const value = typeof record.toJSON === 'function' ? record.toJSON() : record;
  delete value.schemeReferenceFingerprint;
  delete value.activeDuplicateKey;
  return value;
}

export async function createRetirementCase(payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  const tenant = await trustedTenant(ctx.tenantId);
  const subjectUserId = payload.subjectUserId && String(payload.subjectUserId) !== ctx.actorId
    ? await (async () => {
      if (!ctx.canAssist) throw retirementError('Assisted registration requires an explicit assisted-onboarding permission.', 'RETIREMENT_ASSISTED_ONBOARDING_FORBIDDEN', 403);
      return assertTenantUser(tenant, payload.subjectUserId);
    })()
    : await assertTenantUser(tenant, ctx.actorId);
  const schemeType = normalizeEnum(payload.schemeType, RETIREMENT_SCHEME_TYPES, 'schemeType');
  const caseType = normalizeEnum(payload.caseType, RETIREMENT_CASE_TYPES, 'caseType');
  const status = payload.submitImmediately === false ? 'DRAFT' : 'SUBMITTED';
  const privacyPolicy = currentRetirementPrivacyPolicy();
  let privacyAcknowledgement = { privacyNoticeVersion: null, processingBasis: null, noticeLanguage: null, noticeAcknowledgedAt: null };
  if (status !== 'DRAFT') {
    if (!privacyPolicy.configured) throw retirementError('Retirement submissions are blocked until the privacy notice version and lawful processing basis are approved and configured for this deployment.', 'RETIREMENT_PRIVACY_POLICY_NOT_CONFIGURED', 503);
    if (payload.noticeAcknowledged !== true) throw retirementError('Acknowledge the current retirement-support privacy notice before submitting.', 'RETIREMENT_PRIVACY_NOTICE_ACKNOWLEDGEMENT_REQUIRED', 422);
    if (String(payload.noticeVersion || '').trim() !== privacyPolicy.noticeVersion) throw retirementError('The privacy notice version changed. Reload the notice and acknowledge the current version.', 'RETIREMENT_PRIVACY_NOTICE_VERSION_STALE', 409);
    const noticeLanguage = normalizeEnum(payload.noticeLanguage || 'en', ['en', 'sw', 'fr', 'ar'], 'noticeLanguage').toLowerCase();
    privacyAcknowledgement = { privacyNoticeVersion: privacyPolicy.noticeVersion, processingBasis: privacyPolicy.processingBasis, noticeLanguage, noticeAcknowledgedAt: new Date() };
  }
  const evidenceReferences = await validateEvidenceReferences({ tenantId: ctx.tenantId, subjectUserId, references: payload.evidenceReferences, required: payload.submitImmediately !== false });
  const schemeReferenceFingerprintValue = schemeReferenceFingerprint(payload.schemeReference);
  if (schemeReferenceFingerprintValue) {
    const duplicate = await RetirementSupportCase.findOne({ tenantId: ctx.tenantId, subjectUserId, schemeType, schemeReferenceFingerprint: schemeReferenceFingerprintValue, status: { $nin: ['WITHDRAWN', 'REJECTED', 'COMPLETED', 'EXPIRED'] } }).select('_id caseReference status').lean();
    if (duplicate) throw retirementError('A potentially duplicate active case exists for this participant and scheme reference. Open the existing case or refer it for controlled review.', 'RETIREMENT_POTENTIAL_DUPLICATE_CASE', 409);
  }
  const now = new Date();
  let record;
  try {
    record = await RetirementSupportCase.create({
    tenantId: ctx.tenantId,
    caseReference: `RET-${crypto.randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase()}`,
    subjectUserId,
    schemeType,
    caseType,
    jurisdiction: String(payload.jurisdiction || 'UG').trim().toUpperCase().slice(0, 80),
    employerReference: payload.employerReference ? String(payload.employerReference).trim().slice(0, 128) : null,
    schemeReferenceFingerprint: schemeReferenceFingerprintValue,
    activeDuplicateKey: schemeReferenceFingerprintValue,
    evidenceReferences,
    ...privacyAcknowledgement,
    status,
    createdBy: ctx.actorId,
    updatedBy: ctx.actorId,
    history: [{ fromStatus: null, toStatus: status, actorId: ctx.actorId, reasonCode: status === 'DRAFT' ? 'CASE_DRAFT_CREATED' : 'CASE_SUBMITTED', note: null, sourceReference: null, at: now }],
    });
  } catch (error) {
    if (error?.code === 11000 && (error?.keyPattern?.activeDuplicateKey || error?.keyValue?.activeDuplicateKey || String(error?.message || '').includes('uniq_retirement_active_scheme_reference'))) {
      throw retirementError('A potentially duplicate active case exists for this participant and scheme. Open the existing case or refer it for controlled review.', 'RETIREMENT_POTENTIAL_DUPLICATE_CASE', 409);
    }
    throw error;
  }
  await audit(ctx, status === 'DRAFT' ? 'RETIREMENT.CASE_DRAFT_CREATED' : 'RETIREMENT.CASE_SUBMITTED', { caseReference: record.caseReference, schemeType, caseType, status, evidenceCount: evidenceReferences.length, assisted: subjectUserId !== ctx.actorId, privacyNoticeVersion: privacyAcknowledgement.privacyNoticeVersion, processingBasis: privacyAcknowledgement.processingBasis, noticeLanguage: privacyAcknowledgement.noticeLanguage, noticeAcknowledged: Boolean(privacyAcknowledgement.noticeAcknowledgedAt) });
  return safeCase(record);
}

export async function listMyRetirementCases(inputContext = {}) {
  const ctx = contextValues(inputContext);
  await trustedTenant(ctx.tenantId);
  return RetirementSupportCase.find({ tenantId: ctx.tenantId, subjectUserId: ctx.actorId }).sort({ updatedAt: -1 }).limit(100).select('-schemeReferenceFingerprint').lean();
}
export async function listRetirementCases(inputContext = {}) {
  const ctx = contextValues(inputContext);
  if (!ctx.canReadAllCases) throw retirementError('A case-management permission is required to view the institutional queue.', 'RETIREMENT_CASE_READ_FORBIDDEN', 403);
  await trustedTenant(ctx.tenantId);
  return RetirementSupportCase.find({ tenantId: ctx.tenantId }).sort({ updatedAt: -1 }).limit(100).select('-schemeReferenceFingerprint').lean();
}
export async function getRetirementCase(caseId, inputContext = {}) {
  const ctx = contextValues(inputContext);
  await trustedTenant(ctx.tenantId);
  if (!mongoose.Types.ObjectId.isValid(String(caseId))) throw retirementError('Case reference is invalid.', 'RETIREMENT_CASE_REFERENCE_INVALID', 400);
  const record = await RetirementSupportCase.findOne({ _id: caseId, tenantId: ctx.tenantId }).select('-schemeReferenceFingerprint');
  if (!record) throw retirementError('Retirement support case was not found within this tenant.', 'RETIREMENT_CASE_NOT_FOUND', 404);
  if (record.subjectUserId !== ctx.actorId && !ctx.canReadAllCases) throw retirementError('This case is not accessible to the current actor.', 'RETIREMENT_CASE_ACCESS_DENIED', 403);
  return safeCase(record);
}

export async function transitionRetirementCase(caseId, payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  await trustedTenant(ctx.tenantId);
  if (!mongoose.Types.ObjectId.isValid(String(caseId))) throw retirementError('Case reference is invalid.', 'RETIREMENT_CASE_REFERENCE_INVALID', 400);
  const record = await RetirementSupportCase.findOne({ _id: caseId, tenantId: ctx.tenantId }).select('+schemeReferenceFingerprint');
  if (!record) throw retirementError('Retirement support case was not found within this tenant.', 'RETIREMENT_CASE_NOT_FOUND', 404);
  const targetStatus = normalizeEnum(payload.targetStatus, RETIREMENT_CASE_STATES, 'targetStatus');
  if (targetStatus === 'SCHEME_VERIFIED') throw retirementError('Scheme verification must use the authority-evidence endpoint; generic case transitions cannot mark a scheme verified.', 'RETIREMENT_AUTHORITY_EVIDENCE_REQUIRED', 422);
  if (targetStatus !== 'DRAFT' && !['DRAFT', 'WITHDRAWN'].includes(record.status) && !record.privacyNoticeVersion) {
    throw retirementError('This case has no recorded privacy notice. Route it through the approved remediation process rather than silently backfilling acknowledgement.', 'RETIREMENT_PRIVACY_EVIDENCE_MISSING', 409);
  }
  if (record.status === 'DRAFT' && targetStatus === 'SUBMITTED') {
    const privacyPolicy = currentRetirementPrivacyPolicy();
    if (!privacyPolicy.configured) throw retirementError('Retirement submissions are blocked until the privacy notice version and lawful processing basis are approved and configured for this deployment.', 'RETIREMENT_PRIVACY_POLICY_NOT_CONFIGURED', 503);
    if (payload.noticeAcknowledged !== true || String(payload.noticeVersion || '').trim() !== privacyPolicy.noticeVersion) throw retirementError('Acknowledge the current retirement-support privacy notice before submitting the draft.', 'RETIREMENT_PRIVACY_NOTICE_ACKNOWLEDGEMENT_REQUIRED', 422);
    record.privacyNoticeVersion = privacyPolicy.noticeVersion;
    record.processingBasis = privacyPolicy.processingBasis;
    record.noticeLanguage = normalizeEnum(payload.noticeLanguage || 'en', ['en', 'sw', 'fr', 'ar'], 'noticeLanguage').toLowerCase();
    record.noticeAcknowledgedAt = new Date();
  }
  let identityEvidence = false;
  if (targetStatus === 'IDENTITY_VERIFIED') {
    const tenant = await trustedTenant(ctx.tenantId);
    const userObjectId = new mongoose.Types.ObjectId(record.subjectUserId);
    const kyc = await KYC.findOne({ tenantId: tenant._id, userId: userObjectId }).select('status').lean();
    identityEvidence = String(kyc?.status || '').toUpperCase() === 'VERIFIED';
  }
  assertRetirementCaseTransition(record.status, targetStatus, { identityEvidence });
  const previousStatus = record.status;
  record.status = targetStatus;
  if (targetStatus === 'SCHEME_VERIFICATION_PENDING') {
    record.schemeVerificationStatus = 'PENDING';
    if (previousStatus === 'EXPIRED') record.activeDuplicateKey = record.schemeReferenceFingerprint || null;
  }
  if (['WITHDRAWN', 'REJECTED', 'EXPIRED', 'COMPLETED'].includes(targetStatus)) record.activeDuplicateKey = null;
  record.updatedBy = ctx.actorId;
  record.history.push({ fromStatus: previousStatus, toStatus: targetStatus, actorId: ctx.actorId, reasonCode: requiredString(payload.reasonCode || 'CASE_STATUS_UPDATED', 'reasonCode', 100), note: payload.note ? String(payload.note).trim().slice(0, 1000) : null, sourceReference: payload.sourceReference ? String(payload.sourceReference).trim().slice(0, 200) : null, at: new Date() });
  if (record.history.length > 100) record.history = record.history.slice(-100);
  try { await record.save(); } catch (error) {
    if (error?.code === 11000 && (error?.keyPattern?.activeDuplicateKey || error?.keyValue?.activeDuplicateKey || String(error?.message || '').includes('uniq_retirement_active_scheme_reference'))) throw retirementError('Another active case now exists for this participant and scheme. Review that case before reopening this one.', 'RETIREMENT_POTENTIAL_DUPLICATE_CASE', 409);
    throw error;
  }
  await audit(ctx, 'RETIREMENT.CASE_STATUS_CHANGED', { caseReference: record.caseReference, previousStatus, newStatus: targetStatus, reasonCode: payload.reasonCode || 'CASE_STATUS_UPDATED' });
  return safeCase(record);
}

export async function recordSchemeVerification(caseId, payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  await trustedTenant(ctx.tenantId);
  if (!mongoose.Types.ObjectId.isValid(String(caseId))) throw retirementError('Case reference is invalid.', 'RETIREMENT_CASE_REFERENCE_INVALID', 400);
  const record = await RetirementSupportCase.findOne({ _id: caseId, tenantId: ctx.tenantId }).select('+schemeReferenceFingerprint');
  if (!record) throw retirementError('Retirement support case was not found within this tenant.', 'RETIREMENT_CASE_NOT_FOUND', 404);
  if (!['SCHEME_VERIFICATION_PENDING', 'REFERRED_TO_AUTHORITY', 'DISCREPANCY_DETECTED', 'MANUAL_REVIEW_REQUIRED'].includes(record.status)) throw retirementError('The case is not in a state that can accept an authoritative scheme result.', 'RETIREMENT_VERIFICATION_STATE_INVALID', 409);
  const decision = normalizeEnum(payload.decision, ['CONFIRMED', 'INCONCLUSIVE', 'NOT_FOUND'], 'decision');
  const sourceType = normalizeEnum(payload.sourceType, ['AUTHORIZED_PROVIDER', 'AUTHORIZED_INSTITUTION_REVIEW'], 'sourceType');
  const sourceName = requiredString(payload.sourceName, 'sourceName', 200);
  const sourceReference = requiredString(payload.sourceReference, 'sourceReference', 200);
  const validUntil = dateOrNull(payload.validUntil, 'validUntil');
  if (validUntil && validUntil <= new Date()) throw retirementError('A verification validity end date must be in the future.', 'RETIREMENT_VERIFICATION_VALIDITY_INVALID', 400);
  const previousStatus = record.status;
  let targetStatus;
  if (decision === 'CONFIRMED') {
    targetStatus = 'SCHEME_VERIFIED';
    assertRetirementCaseTransition(previousStatus, targetStatus, { authorityEvidence: true });
    record.schemeVerificationStatus = 'CONFIRMED';
    record.verificationSourceType = sourceType;
    record.verificationSourceName = sourceName;
    record.verificationSourceReference = sourceReference;
    record.schemeVerifiedAt = new Date();
    record.schemeVerifiedBy = ctx.actorId;
    record.schemeValidUntil = validUntil;
  } else {
    const preferredTarget = decision === 'NOT_FOUND' ? 'DISCREPANCY_DETECTED' : 'MANUAL_REVIEW_REQUIRED';
    if (previousStatus === preferredTarget || canTransitionRetirementCase(previousStatus, preferredTarget)) {
      targetStatus = preferredTarget;
    } else if (canTransitionRetirementCase(previousStatus, 'REFERRED_TO_AUTHORITY')) {
      targetStatus = 'REFERRED_TO_AUTHORITY';
    } else {
      targetStatus = previousStatus;
    }
    if (previousStatus !== targetStatus) assertRetirementCaseTransition(previousStatus, targetStatus);
    record.schemeVerificationStatus = decision;
    record.verificationSourceType = sourceType;
    record.verificationSourceName = sourceName;
    record.verificationSourceReference = sourceReference;
    record.schemeVerifiedAt = null;
    record.schemeVerifiedBy = null;
    record.schemeValidUntil = null;
  }
  record.status = targetStatus;
  record.updatedBy = ctx.actorId;
  record.history.push({ fromStatus: previousStatus, toStatus: targetStatus, actorId: ctx.actorId, reasonCode: `AUTHORITY_RESULT_${decision}`, note: payload.note ? String(payload.note).trim().slice(0, 1000) : null, sourceReference, at: new Date() });
  if (record.history.length > 100) record.history = record.history.slice(-100);
  await record.save();
  await audit(ctx, 'RETIREMENT.SCHEME_VERIFICATION_RECORDED', { caseReference: record.caseReference, sourceType, sourceName, sourceReferenceRecorded: true, decision, status: targetStatus });
  return safeCase(record);
}

export async function createContributionRecord(payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  await trustedTenant(ctx.tenantId);
  if (!mongoose.Types.ObjectId.isValid(String(payload.caseId))) throw retirementError('A valid retirement case reference is required.', 'RETIREMENT_CASE_REFERENCE_INVALID', 400);
  const parent = await RetirementSupportCase.findOne({ _id: payload.caseId, tenantId: ctx.tenantId }).select('subjectUserId schemeType caseReference');
  if (!parent) throw retirementError('The contribution must be attached to a case in the current tenant.', 'RETIREMENT_CASE_NOT_FOUND', 404);
  const currency = normalizeCurrency(payload.currency);
  const expectedEmployeeAmountMinor = normalizeMinorAmount(payload.expectedEmployeeAmountMinor, 'expected employee amount');
  const expectedEmployerAmountMinor = normalizeMinorAmount(payload.expectedEmployerAmountMinor, 'expected employer amount');
  const period = requiredString(payload.contributionPeriod, 'contributionPeriod', 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw retirementError('Contribution period must use YYYY-MM format.', 'RETIREMENT_PERIOD_INVALID', 400);
  const employerReference = requiredString(payload.employerReference, 'employerReference', 128);
  const evidenceReferences = await validateEvidenceReferences({ tenantId: ctx.tenantId, subjectUserId: parent.subjectUserId, references: payload.evidenceReferences });
  let record;
  try {
    record = await RetirementContributionRecord.create({ tenantId: ctx.tenantId, caseId: parent._id, subjectUserId: parent.subjectUserId, schemeType: parent.schemeType, employerReference, contributionPeriod: period, currency, expectedEmployeeAmountMinor, expectedEmployerAmountMinor, evidenceReferences, createdBy: ctx.actorId, updatedBy: ctx.actorId });
  } catch (error) {
    if (error?.code === 11000 && (error?.keyPattern?.caseId || error?.keyValue?.caseId || String(error?.message || '').includes('uniq_retirement_contribution_case_period'))) {
      throw retirementError('An expected contribution record already exists for this case and period. Review or reconcile the existing record instead of creating a duplicate.', 'RETIREMENT_CONTRIBUTION_PERIOD_DUPLICATE', 409);
    }
    throw error;
  }
  await audit(ctx, 'RETIREMENT.CONTRIBUTION_EXPECTATION_RECORDED', { caseReference: parent.caseReference, contributionPeriod: period, currency, evidenceCount: evidenceReferences.length });
  return record.toJSON();
}
export async function listRetirementContributions(inputContext = {}) {
  const ctx = contextValues(inputContext);
  await trustedTenant(ctx.tenantId);
  const filter = { tenantId: ctx.tenantId };
  if (!ctx.canReadAllContributions) filter.subjectUserId = ctx.actorId;
  return RetirementContributionRecord.find(filter).sort({ contributionPeriod: -1, updatedAt: -1 }).limit(200).lean();
}
export async function reconcileContributionRecord(recordId, payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  await trustedTenant(ctx.tenantId);
  if (!mongoose.Types.ObjectId.isValid(String(recordId))) throw retirementError('Contribution reference is invalid.', 'RETIREMENT_CONTRIBUTION_REFERENCE_INVALID', 400);
  const record = await RetirementContributionRecord.findOne({ _id: recordId, tenantId: ctx.tenantId });
  if (!record) throw retirementError('Contribution record was not found within this tenant.', 'RETIREMENT_CONTRIBUTION_NOT_FOUND', 404);
  const employee = normalizeMinorAmount(payload.reportedEmployeeAmountMinor, 'reported employee amount');
  const employer = normalizeMinorAmount(payload.reportedEmployerAmountMinor, 'reported employer amount');
  const sourceReference = requiredString(payload.remittanceSourceReference, 'remittanceSourceReference', 200);
  const evidenceReferences = await validateEvidenceReferences({ tenantId: ctx.tenantId, subjectUserId: record.subjectUserId, references: payload.evidenceReferences });
  const previousStatus = record.matchingStatus;
  const matchingStatus = compareContributionAmounts({ expectedEmployeeAmountMinor: record.expectedEmployeeAmountMinor, expectedEmployerAmountMinor: record.expectedEmployerAmountMinor, reportedEmployeeAmountMinor: employee, reportedEmployerAmountMinor: employer });
  record.reportedEmployeeAmountMinor = employee;
  record.reportedEmployerAmountMinor = employer;
  record.remittanceSourceReference = sourceReference;
  record.evidenceReferences = [...new Set([...record.evidenceReferences, ...evidenceReferences])].slice(0, 20);
  record.matchingStatus = matchingStatus;
  record.updatedBy = ctx.actorId;
  await record.save();
  await audit(ctx, 'RETIREMENT.CONTRIBUTION_RECONCILED', { contributionId: String(record._id), contributionPeriod: record.contributionPeriod, previousStatus, newStatus: matchingStatus, remittanceReferenceRecorded: true, schemeCreditStatus: record.schemeCreditStatus });
  return record.toJSON();
}
export async function recordOfficialSchemeCredit(recordId, payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  await trustedTenant(ctx.tenantId);
  if (!mongoose.Types.ObjectId.isValid(String(recordId))) throw retirementError('Contribution reference is invalid.', 'RETIREMENT_CONTRIBUTION_REFERENCE_INVALID', 400);
  const record = await RetirementContributionRecord.findOne({ _id: recordId, tenantId: ctx.tenantId });
  if (!record) throw retirementError('Contribution record was not found within this tenant.', 'RETIREMENT_CONTRIBUTION_NOT_FOUND', 404);
  const decision = normalizeEnum(payload.decision, ['CONFIRMED', 'NOT_CONFIRMED'], 'decision');
  const sourceName = requiredString(payload.sourceName, 'sourceName', 200);
  const sourceReference = requiredString(payload.sourceReference, 'sourceReference', 200);
  const evidenceReferences = await validateEvidenceReferences({ tenantId: ctx.tenantId, subjectUserId: record.subjectUserId, references: payload.evidenceReferences });
  record.schemeCreditStatus = decision;
  record.schemeCreditSourceName = sourceName;
  record.schemeCreditSourceReference = sourceReference;
  record.schemeCreditConfirmedAt = decision === 'CONFIRMED' ? new Date() : null;
  record.schemeCreditConfirmedBy = decision === 'CONFIRMED' ? ctx.actorId : null;
  record.evidenceReferences = [...new Set([...record.evidenceReferences, ...evidenceReferences])].slice(0, 20);
  record.updatedBy = ctx.actorId;
  await record.save();
  await audit(ctx, 'RETIREMENT.OFFICIAL_SCHEME_CREDIT_RECORDED', { contributionId: String(record._id), decision, sourceName, sourceReferenceRecorded: true });
  return record.toJSON();
}

export async function createFinancialSupportApplication(payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  const tenant = await trustedTenant(ctx.tenantId);
  const subjectUserId = await assertTenantUser(tenant, ctx.actorId);
  const supportType = normalizeEnum(payload.supportType, ['EMERGENCY_ASSISTANCE', 'REGULATED_LOAN', 'EMPLOYER_FINANCE', 'SAVINGS_REFERRAL', 'INSURANCE_REFERRAL', 'FINANCIAL_COUNSELLING'], 'supportType');
  const privacyPolicy = currentRetirementPrivacyPolicy();
  if (!privacyPolicy.configured) throw retirementError('Financial-support referrals are blocked until the privacy notice version and lawful processing basis are approved and configured for this deployment.', 'RETIREMENT_PRIVACY_POLICY_NOT_CONFIGURED', 503);
  if (payload.noticeAcknowledged !== true) throw retirementError('Acknowledge the current retirement-support privacy notice before submitting the financial-support request.', 'RETIREMENT_PRIVACY_NOTICE_ACKNOWLEDGEMENT_REQUIRED', 422);
  if (String(payload.noticeVersion || '').trim() !== privacyPolicy.noticeVersion) throw retirementError('The privacy notice version changed. Reload the notice and acknowledge the current version.', 'RETIREMENT_PRIVACY_NOTICE_VERSION_STALE', 409);
  const noticeLanguage = normalizeEnum(payload.noticeLanguage || 'en', ['en', 'sw', 'fr', 'ar'], 'noticeLanguage').toLowerCase();
  const noticeAcknowledgedAt = new Date();
  const requestedAmountMinor = payload.requestedAmountMinor === undefined || payload.requestedAmountMinor === null || payload.requestedAmountMinor === '' ? null : normalizeMinorAmount(payload.requestedAmountMinor, 'requested amount');
  const currency = normalizeCurrency(payload.currency || 'UGX');
  if (['REGULATED_LOAN', 'EMPLOYER_FINANCE', 'INSURANCE_REFERRAL'].includes(supportType)) {
    const kyc = await KYC.findOne({ tenantId: tenant._id, userId: new mongoose.Types.ObjectId(subjectUserId) }).select('status').lean();
    if (String(kyc?.status || '').toUpperCase() !== 'VERIFIED') throw retirementError('This referral category requires a current verified identity record. TITech has not assessed provider approval or benefit eligibility.', 'RETIREMENT_KYC_REQUIRED', 403);
  }
  const record = await RetirementFinancialSupportApplication.create({ tenantId: ctx.tenantId, applicationReference: `RFS-${crypto.randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase()}`, subjectUserId, supportType, requestedAmountMinor, currency, privacyNoticeVersion: privacyPolicy.noticeVersion, processingBasis: privacyPolicy.processingBasis, noticeLanguage, noticeAcknowledgedAt, disclosureVersion: payload.disclosureVersion ? String(payload.disclosureVersion).trim().slice(0, 100) : null, createdBy: ctx.actorId, updatedBy: ctx.actorId });
  await audit(ctx, 'RETIREMENT.FINANCIAL_SUPPORT_APPLICATION_SUBMITTED', { applicationReference: record.applicationReference, supportType, currency, amountProvided: requestedAmountMinor !== null, privacyNoticeVersion: record.privacyNoticeVersion, processingBasis: record.processingBasis, noticeLanguage, noticeAcknowledged: true });
  return record.toJSON();
}
export async function listMyFinancialSupportApplications(inputContext = {}) {
  const ctx = contextValues(inputContext);
  await trustedTenant(ctx.tenantId);
  return RetirementFinancialSupportApplication.find({ tenantId: ctx.tenantId, subjectUserId: ctx.actorId }).sort({ updatedAt: -1 }).limit(100).lean();
}
export async function listFinancialSupportApplications(inputContext = {}) {
  const ctx = contextValues(inputContext);
  if (!ctx.canReadAllFinancialSupport) throw retirementError('Institutional financial-support case access is not authorized.', 'RETIREMENT_SUPPORT_READ_FORBIDDEN', 403);
  await trustedTenant(ctx.tenantId);
  return RetirementFinancialSupportApplication.find({ tenantId: ctx.tenantId }).sort({ updatedAt: -1 }).limit(100).lean();
}
export async function recordFinancialSupportProviderOutcome(applicationId, payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  await trustedTenant(ctx.tenantId);
  if (!mongoose.Types.ObjectId.isValid(String(applicationId))) throw retirementError('Financial-support application reference is invalid.', 'RETIREMENT_SUPPORT_REFERENCE_INVALID', 400);
  const record = await RetirementFinancialSupportApplication.findOne({ _id: applicationId, tenantId: ctx.tenantId });
  if (!record) throw retirementError('Financial-support application was not found within this tenant.', 'RETIREMENT_SUPPORT_NOT_FOUND', 404);
  if (!['SUBMITTED', 'NEEDS_MORE_INFORMATION', 'REFERRED_TO_PROVIDER', 'PROVIDER_DECISION_PENDING'].includes(record.status)) throw retirementError('A final or cancelled financial-support request cannot accept another provider outcome. Use the approved correction process.', 'RETIREMENT_SUPPORT_OUTCOME_STATE_INVALID', 409);
  const decision = assertProviderOutcome(payload);
  const sourceName = requiredString(payload.decisionSource, 'decisionSource', 200);
  const externalDecisionReference = requiredString(payload.externalDecisionReference, 'externalDecisionReference', 200);
  const providerReference = requiredString(payload.providerReference, 'providerReference', 128);
  record.status = decision;
  record.providerReference = providerReference;
  record.providerDecisionSource = sourceName;
  record.externalDecisionReference = externalDecisionReference;
  record.providerDecisionAt = new Date();
  record.providerDecisionRecordedBy = ctx.actorId;
  record.updatedBy = ctx.actorId;
  await record.save();
  await audit(ctx, 'RETIREMENT.FINANCIAL_SUPPORT_PROVIDER_OUTCOME_RECORDED', { applicationReference: record.applicationReference, decision, sourceName, externalDecisionReferenceRecorded: true, providerReferenceRecorded: true, moneyMovement: 'NOT_PERFORMED_BY_THIS_WORKFLOW' });
  return record.toJSON();
}

export function getRetirementReadiness() {
  const enabled = String(process.env.TITECH_RETIREMENT_SUPPORT_ENABLED || '').trim().toLowerCase() === 'true';
  return Object.freeze({
    capability: 'RETIREMENT_SUPPORT',
    enabled,
    implementationScope: 'CASE_MANAGEMENT_AND_EVIDENCE_TRACKING',
    privacyConfigured: currentRetirementPrivacyPolicy().configured,
    privacyNoticeVersion: currentRetirementPrivacyPolicy().noticeVersion,
    processingBasis: currentRetirementPrivacyPolicy().processingBasis,
    officialGovernmentIntegration: 'NOT_ESTABLISHED',
    officialNssfIntegration: 'NOT_ESTABLISHED',
    identityProviderIntegration: 'USES_CANONICAL_KYC_RECORD; LIVE_PROVIDER_ACCESS_NOT_ASSERTED',
    livePayments: 'DISABLED',
    pensionBalanceSource: 'NO_AUTHORITATIVE_LIVE_BALANCE_SOURCE_CONFIGURED',
    productionApproved: false,
    blockers: ['TITECH_RETIREMENT_SUPPORT_ENABLED must be approved for the environment', 'A legally reviewed TITECH_RETIREMENT_NOTICE_VERSION and TITECH_RETIREMENT_PROCESSING_BASIS must be configured', 'Government/NSSF institutional access and data-sharing authority are not established by source code', 'Provider contracts, privacy/legal review, and independent security and operational evidence remain external release gates'],
  });
}
