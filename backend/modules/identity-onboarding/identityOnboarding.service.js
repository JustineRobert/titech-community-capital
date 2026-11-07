import crypto from 'node:crypto';
import mongoose from 'mongoose';
import KYC, { KYC_REJECTION_REASONS } from '../../models/KYC.js';
import Tenant from '../../models/Tenant.js';
import ConsentRecord from '../../modules/consent/models/ConsentRecord.js';
import { grantConsent, withdrawConsent } from '../../modules/consent/services/consentService.js';
import InsuranceInstitutionProfile from '../insurance/models/InsuranceInstitutionProfile.js';
import { assertLicenceOperational } from '../insurance/insurance.policy.js';
import SecureDocument from '../secure-documents/secureDocument.model.js';
import { createAuditLog } from '../audit/audit.service.js';
import { assertKycTransition, decideServiceCapability, normalizeCredentialType } from './identity.policy.js';

const IDENTITY_PURPOSE = 'IDENTITY_CREDENTIAL';
const INSURANCE_CONSENT_NOTICE_VERSION = 'INSURANCE_ENROLMENT_DATA_SHARING_V1';
const CONSENT_LANGUAGES = new Set(['en', 'sw', 'fr', 'ar']);
const INSURANCE_CONSENT_NOTICE_TEXT = Object.freeze({
  en: 'I explicitly authorize TITech Capital LTD to share the minimum identity-verification status and insurance-enrolment data necessary with the verified insurer named above, solely to submit and administer my insurance enrolment. This permission is limited to that insurer and purpose; I can withdraw it, subject to lawful records that must be retained.',
  sw: 'Ninaidhinisha waziwazi TITech Capital LTD kushiriki kiwango cha chini cha taarifa za uthibitishaji wa utambulisho na usajili wa bima kinachohitajika na kampuni ya bima iliyothibitishwa iliyoonyeshwa hapo juu, kwa madhumuni ya kuwasilisha na kusimamia usajili wangu wa bima pekee. Ruhusa hii ni maalum kwa kampuni hiyo na madhumuni hayo; ninaweza kuiondoa, kwa kuzingatia rekodi ambazo zinapaswa kuhifadhiwa kisheria.',
  fr: 'J’autorise expressément TITech Capital LTD à partager avec l’assureur vérifié indiqué ci-dessus uniquement les données minimales nécessaires relatives à la vérification de mon identité et à mon inscription à l’assurance, afin de soumettre et de gérer cette inscription. Cette autorisation est limitée à cet assureur et à cette finalité ; je peux la retirer, sous réserve des documents qui doivent être conservés en vertu de la loi.',
  ar: 'أوافق صراحةً على أن تشارك TITech Capital LTD الحد الأدنى اللازم من حالة التحقق من هويتي وبيانات التسجيل في التأمين مع شركة التأمين المعتمدة الموضحة أعلاه، حصراً لتقديم طلب التسجيل في التأمين وإدارته. يقتصر هذا الإذن على شركة التأمين والغرض المحددين؛ ويمكنني سحبه، مع مراعاة السجلات التي يجب الاحتفاظ بها قانوناً.',
});
const INSURANCE_CONSENT_CATEGORIES = Object.freeze(['INSURANCE_ENROLMENT', 'IDENTITY_VERIFICATION']);

function domainError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function requiredString(value, field, maxLength = 200) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw domainError(`${field} is required.`, `${field.toUpperCase()}_REQUIRED`, 400);
  if (normalized.length > maxLength) throw domainError(`${field} exceeds the permitted length.`, `${field.toUpperCase()}_TOO_LONG`, 400);
  return normalized;
}

function normalizeActorId(actorId) {
  const value = requiredString(actorId, 'actorId', 128);
  if (!mongoose.Types.ObjectId.isValid(value)) throw domainError('Authenticated user reference is not valid for the KYC record.', 'ACTOR_REFERENCE_INVALID', 401);
  return new mongoose.Types.ObjectId(value);
}

function normalizeUserId(userId) {
  const value = requiredString(userId, 'userId', 128);
  if (!mongoose.Types.ObjectId.isValid(value)) throw domainError('Participant user reference is invalid.', 'PARTICIPANT_REFERENCE_INVALID', 400);
  return new mongoose.Types.ObjectId(value);
}

async function trustedTenant(tenantId) {
  const key = requiredString(tenantId, 'tenantId', 100).toLowerCase();
  const tenant = await Tenant.findOne({ tenantId: key, status: 'ACTIVE' }).select('_id tenantId').lean();
  if (!tenant) throw domainError('The authenticated tenant is not registered in the canonical KYC tenant registry.', 'KYC_TENANT_NOT_REGISTERED', 403);
  return tenant;
}

function fingerprintCredentialIdentifier(identifier) {
  const normalized = String(identifier ?? '').trim().toUpperCase();
  if (!normalized) return null;
  const secret = String(process.env.TITECH_KYC_IDENTIFIER_HMAC_KEY || '').trim();
  const key = secret ? Buffer.from(secret, 'base64') : Buffer.alloc(0);
  if (key.length < 32) throw domainError('Identity-number matching is disabled until a dedicated 32-byte base64 HMAC key is configured.', 'KYC_IDENTIFIER_HASH_NOT_CONFIGURED', 503);
  return crypto.createHmac('sha256', key).update(normalized, 'utf8').digest('hex');
}

async function assertOwnedIdentityDocument({ tenantId, documentReference, participantId }) {
  const reference = requiredString(documentReference, 'documentReference', 80);
  const document = await SecureDocument.findOne({
    tenantId: String(tenantId),
    documentReference: reference,
    subjectId: String(participantId),
    purpose: IDENTITY_PURPOSE,
    deletedAt: null,
  }).select('documentReference purpose subjectId mimeType sizeBytes uploadedAt').lean();
  if (!document) throw domainError('Identity evidence must reference an existing private document uploaded for this participant and tenant.', 'IDENTITY_DOCUMENT_REFERENCE_INVALID', 422);
  return document;
}

async function writeAudit(context, action, data) {
  await createAuditLog({
    tenantId: String(context.tenantId),
    actorId: String(context.actorId),
    action,
    requestId: context.requestId || null,
    correlationId: context.correlationId || context.requestId || null,
    data,
  });
}

function serializeStatus(record) {
  if (!record) return null;
  const safe = record.toJSON();
  return {
    id: safe.id,
    status: safe.status,
    primaryCredentialType: safe.primaryCredentialType || safe.documents?.[0]?.type || null,
    documents: (safe.documents || []).map((document) => ({
      type: document.type,
      issuingAuthority: document.issuingAuthority || null,
      issuingCountry: document.issuingCountry || null,
      status: document.status,
      issuedAt: document.issuedAt || null,
      expiresAt: document.expiresAt || null,
      verifiedAt: document.verifiedAt || null,
      rejectionReason: document.rejectionReason || null,
    })),
    submittedAt: safe.submittedAt || safe.createdAt || null,
    verifiedAt: safe.verifiedAt || null,
    verificationMethod: safe.verificationMethod || null,
    rejectionReason: safe.rejectionReason || null,
    reviewNotes: safe.reviewNotes || null,
    expiresAt: safe.expiresAt || null,
    updatedAt: safe.updatedAt || null,
  };
}

export async function submitIdentityCredential(payload = {}, context = {}) {
  const tenant = await trustedTenant(context.tenantId);
  const actorId = normalizeActorId(context.actorId);
  const actorIdText = String(actorId);
  const targetUserId = payload.userId ? normalizeUserId(payload.userId) : actorId;
  const targetUserIdText = String(targetUserId);
  const assisted = targetUserIdText !== actorIdText;
  if (assisted && context.canAssist !== true) throw domainError('Only an explicitly authorised assisted-onboarding actor can submit credentials for another participant.', 'ASSISTED_ONBOARDING_FORBIDDEN', 403);

  const credentialType = normalizeCredentialType(payload.credentialType);
  const fullName = requiredString(payload.fullName, 'fullName', 200);
  const issuingAuthority = requiredString(payload.issuingAuthority, 'issuingAuthority', 200);
  const issuingCountry = requiredString(payload.issuingCountry, 'issuingCountry', 80).toUpperCase();
  const documentReference = requiredString(payload.documentReference, 'documentReference', 80);
  const issuedAt = payload.issuedAt ? new Date(payload.issuedAt) : null;
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
  if ((issuedAt && Number.isNaN(issuedAt.getTime())) || (expiresAt && Number.isNaN(expiresAt.getTime()))) throw domainError('Credential dates must be valid timestamps.', 'IDENTITY_CREDENTIAL_DATE_INVALID', 400);
  if (issuedAt && expiresAt && expiresAt <= issuedAt) throw domainError('Credential expiry must be later than issue date.', 'IDENTITY_CREDENTIAL_DATE_RANGE_INVALID', 400);
  if (credentialType === 'OTHER_APPROVED_DOCUMENT' && payload.approvedDocumentPolicyReference == null) throw domainError('The approved-document policy reference is required for this credential route.', 'APPROVED_DOCUMENT_POLICY_REQUIRED', 422);

  await assertOwnedIdentityDocument({ tenantId: tenant.tenantId, documentReference, participantId: targetUserIdText });
  const identifierHash = payload.credentialIdentifier ? fingerprintCredentialIdentifier(payload.credentialIdentifier) : null;
  const safeDocument = {
    type: credentialType,
    issuingAuthority,
    issuingCountry,
    ...(credentialType === 'OTHER_APPROVED_DOCUMENT' ? { approvedDocumentPolicyReference: requiredString(payload.approvedDocumentPolicyReference, 'approvedDocumentPolicyReference', 200) } : {}),
    ...(identifierHash ? { credentialIdentifierHash: identifierHash } : {}),
    ...(issuedAt ? { issuedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    documentReference,
    status: 'PENDING',
  };

  let record = await KYC.findOne({ tenantId: tenant._id, userId: targetUserId })
    .select('+nationalIdHash +documents.documentReference +documents.credentialIdentifierHash +documents.providerReference +documents.contentHash');

  if (!record) {
    record = new KYC({
      tenantId: tenant._id,
      userId: targetUserId,
      fullName,
      primaryCredentialType: credentialType,
      submittedBy: actorId,
      submittedAt: new Date(),
      status: 'PENDING',
      documents: [safeDocument],
      correlationId: context.correlationId || context.requestId || undefined,
      requestId: context.requestId || undefined,
    });
  } else {
    if (!['PENDING', 'NEEDS_MORE_INFORMATION'].includes(record.status)) {
      throw domainError('Identity credentials can only be added to a pending review or an approved request for additional information. A rejected record must use the appeal workflow.', 'KYC_RESUBMISSION_NOT_ALLOWED', 409);
    }
    if (record.documents.some((document) => String(document.documentReference) === documentReference)) {
      throw domainError('This identity document is already attached to the participant KYC record.', 'IDENTITY_DOCUMENT_DUPLICATE', 409);
    }
    const previousStatus = record.status;
    record.fullName = fullName;
    record.documents.push(safeDocument);
    record.primaryCredentialType = record.primaryCredentialType || credentialType;
    record.submittedBy = actorId;
    record.submittedAt = new Date();
    record.rejectionReason = null;
    record.reviewNotes = undefined;
    if (previousStatus === 'NEEDS_MORE_INFORMATION') {
      assertKycTransition(previousStatus, 'PENDING');
      record.status = 'PENDING';
      record.verificationHistory.push({ previousStatus, newStatus: 'PENDING', verificationMethod: 'MANUAL', performedBy: actorId, performedAt: new Date(), reason: 'ADDITIONAL_INFORMATION_SUBMITTED', requestId: context.requestId, correlationId: context.correlationId });
    }
  }

  await record.save();
  await writeAudit({ ...context, actorId: actorIdText }, 'PARTICIPANT.IDENTITY_CREDENTIAL_SUBMITTED', {
    participantReference: targetUserIdText,
    credentialType,
    status: record.status,
    assisted,
    documentEvidenceAttached: true,
  });
  return serializeStatus(record);
}

export async function getInsuranceConsentRecipient({ recipientTenantId, language = 'en' } = {}, context = {}) {
  await trustedTenant(context.tenantId);
  const recipientId = requiredString(recipientTenantId, 'recipientTenantId', 100).toLowerCase();
  const normalizedLanguage = String(language || 'en').trim().toLowerCase().split('-')[0];
  if (!CONSENT_LANGUAGES.has(normalizedLanguage)) throw domainError('The requested consent language is not supported.', 'CONSENT_LANGUAGE_UNSUPPORTED', 400);
  const recipientTenant = await Tenant.findOne({ tenantId: recipientId, status: 'ACTIVE' }).select('tenantId').lean();
  const profile = await InsuranceInstitutionProfile.findOne({ tenantId: recipientId }).select('organisationType legalName jurisdiction competentAuthority licenceReference licenceExpiresAt licenceStatus approvedTerritories').lean();
  if (!recipientTenant || !profile) throw domainError('The requested recipient is not a registered insurance institution.', 'INSURANCE_CONSENT_RECIPIENT_NOT_FOUND', 404);
  try { assertLicenceOperational(profile, 'insurance data-sharing consent'); }
  catch { throw domainError('The insurer must have a currently verified, non-expired licence before participants can grant enrolment consent.', 'INSURANCE_CONSENT_RECIPIENT_NOT_APPROVED', 422); }
  return Object.freeze({
    tenantId: recipientTenant.tenantId,
    legalName: profile.legalName,
    organisationType: profile.organisationType,
    jurisdiction: profile.jurisdiction,
    competentAuthority: profile.competentAuthority,
    licenceReference: profile.licenceReference,
    licenceExpiresAt: profile.licenceExpiresAt || null,
    licenceStatus: profile.licenceStatus,
    approvedTerritories: profile.approvedTerritories || [],
    noticeVersion: INSURANCE_CONSENT_NOTICE_VERSION,
    noticeLanguage: normalizedLanguage,
    noticeText: INSURANCE_CONSENT_NOTICE_TEXT[normalizedLanguage],
  });
}

function serializeInsuranceConsent(record) {
  if (!record) return null;
  return Object.freeze({
    consentId: String(record._id || record.id),
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    recipient: record.recipient,
    purpose: record.purpose,
    dataCategories: record.dataCategories,
    status: record.status,
    grantedAt: record.grantedAt || null,
    withdrawnAt: record.withdrawnAt || null,
    version: record.version,
    noticeVersion: record.metadata?.noticeVersion || null,
    noticeLanguage: record.metadata?.noticeLanguage || null,
    noticeText: record.metadata?.noticeTextSnapshot || null,
  });
}

export async function getMyInsuranceEnrolmentConsent({ recipientTenantId } = {}, context = {}) {
  const tenant = await trustedTenant(context.tenantId);
  const actorId = normalizeActorId(context.actorId);
  const recipientId = requiredString(recipientTenantId, 'recipientTenantId', 100).toLowerCase();
  const record = await ConsentRecord.findOne({
    tenantId: tenant.tenantId,
    subjectType: 'MEMBER',
    subjectId: String(actorId),
    purpose: 'INSURANCE_ENROLMENT',
    recipient: recipientId,
  }).sort({ createdAt: -1 }).lean();
  return serializeInsuranceConsent(record);
}

export async function grantMyInsuranceEnrolmentConsent(payload = {}, context = {}) {
  const tenant = await trustedTenant(context.tenantId);
  const actorId = normalizeActorId(context.actorId);
  if (payload.affirmed !== true) throw domainError('Explicit participant affirmation is required before creating insurer-specific consent.', 'CONSENT_AFFIRMATION_REQUIRED', 422);
  const noticeVersion = requiredString(payload.noticeVersion, 'noticeVersion', 80);
  if (noticeVersion !== INSURANCE_CONSENT_NOTICE_VERSION) throw domainError('The consent notice version is not current. Refresh the notice before continuing.', 'CONSENT_NOTICE_VERSION_MISMATCH', 409);
  const language = String(payload.noticeLanguage || 'en').trim().toLowerCase().split('-')[0];
  if (!CONSENT_LANGUAGES.has(language)) throw domainError('The requested consent language is not supported.', 'CONSENT_LANGUAGE_UNSUPPORTED', 400);
  const recipient = await getInsuranceConsentRecipient({ recipientTenantId: payload.recipientTenantId, language }, context);
  const now = new Date();
  const existing = await ConsentRecord.findOne({
    tenantId: tenant.tenantId,
    subjectType: 'MEMBER',
    subjectId: String(actorId),
    purpose: 'INSURANCE_ENROLMENT',
    recipient: recipient.tenantId,
    status: 'GRANTED',
    startsAt: { $lte: now },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  }).lean();
  if (existing) {
    const categories = new Set(existing.dataCategories || []);
    const hasScope = INSURANCE_CONSENT_CATEGORIES.every((category) => categories.has(category));
    if (hasScope && existing.metadata?.noticeVersion === noticeVersion && existing.metadata?.noticeLanguage === language && existing.metadata?.noticeTextSnapshot === recipient.noticeText) return serializeInsuranceConsent(existing);
    throw domainError('An active consent record already exists for this insurer. Withdraw it before providing a new notice version or language.', 'CONSENT_RECONFIRMATION_REQUIRED', 409);
  }

  const evidenceRef = `consent_attestation:${crypto.randomUUID()}`;
  const result = await grantConsent({
    subjectType: 'MEMBER',
    subjectId: String(actorId),
    dataCategories: [...INSURANCE_CONSENT_CATEGORIES],
    purpose: 'INSURANCE_ENROLMENT',
    recipient: recipient.tenantId,
    legalBasis: 'CONSENT',
    sourceChannel: 'AUTHENTICATED_SELF_SERVICE_WEB',
    evidenceRef,
    startsAt: now,
    metadata: {
      noticeVersion,
      noticeLanguage: language,
      noticeTextSnapshot: recipient.noticeText,
      collectionMethod: 'EXPLICIT_PARTICIPANT_CHECKBOX',
      participantAffirmed: true,
      product: 'TITech Community Capital',
    },
  }, { tenantId: tenant.tenantId, actorId: String(actorId) });

  // Existing consentService is the persistence/business-rule boundary. Refuse to
  // return a pre-existing record that did not match this exact versioned consent.
  const resultCategories = new Set(result.dataCategories || []);
  const exactConsent = result.metadata?.noticeVersion === noticeVersion
    && result.metadata?.noticeLanguage === language
    && result.metadata?.noticeTextSnapshot === recipient.noticeText
    && INSURANCE_CONSENT_CATEGORIES.every((category) => resultCategories.has(category));
  if (!exactConsent) throw domainError('A prior consent record has a different scope or notice version; withdraw/re-consent through the approved workflow.', 'CONSENT_RECONFIRMATION_REQUIRED', 409);

  try {
    await writeAudit({ ...context, actorId: String(actorId) }, 'PARTICIPANT.INSURANCE_DATA_SHARING_CONSENT_GRANTED', {
      consentId: String(result._id),
      recipientTenantId: recipient.tenantId,
      purpose: 'INSURANCE_ENROLMENT',
      dataCategories: [...INSURANCE_CONSENT_CATEGORIES],
      noticeVersion,
      noticeLanguage: language,
      evidenceReference: evidenceRef,
    });
  } catch {
    await withdrawConsent(String(result._id), { tenantId: tenant.tenantId, actorId: String(actorId) }).catch(() => {});
    throw domainError('Consent could not be durably audited; the attempted consent has been withdrawn and was not confirmed.', 'CONSENT_AUDIT_FAILED', 503);
  }
  return serializeInsuranceConsent(result);
}

export async function withdrawMyInsuranceEnrolmentConsent(consentId, context = {}) {
  const tenant = await trustedTenant(context.tenantId);
  const actorId = normalizeActorId(context.actorId);
  const record = await ConsentRecord.findOne({
    tenantId: tenant.tenantId,
    _id: consentId,
    subjectType: 'MEMBER',
    subjectId: String(actorId),
    purpose: 'INSURANCE_ENROLMENT',
  });
  if (!record) throw domainError('The insurer-specific consent record was not found for the authenticated participant.', 'CONSENT_NOT_FOUND', 404);
  const withdrawn = await withdrawConsent(String(record._id), { tenantId: tenant.tenantId, actorId: String(actorId) });
  await writeAudit({ ...context, actorId: String(actorId) }, 'PARTICIPANT.INSURANCE_DATA_SHARING_CONSENT_WITHDRAWN', {
    consentId: String(record._id), recipientTenantId: record.recipient, purpose: record.purpose,
  });
  return serializeInsuranceConsent(withdrawn);
}

export async function getMyIdentityStatus(context = {}) {
  const tenant = await trustedTenant(context.tenantId);
  const actorId = normalizeActorId(context.actorId);
  const record = await KYC.findOne({ tenantId: tenant._id, userId: actorId });
  return serializeStatus(record);
}

export async function reviewIdentityCredential({ participantUserId, decision, reasonCode, reviewNotes, assignReviewerId = null }, context = {}) {
  const tenant = await trustedTenant(context.tenantId);
  const actorId = normalizeActorId(context.actorId);
  const targetUserId = normalizeUserId(participantUserId);
  if (String(actorId) === String(targetUserId)) throw domainError('A reviewer cannot approve or reject their own identity record.', 'KYC_SELF_REVIEW_FORBIDDEN', 403);

  const target = await KYC.findOne({ tenantId: tenant._id, userId: targetUserId })
    .select('+documents.documentReference +documents.credentialIdentifierHash');
  if (!target) throw domainError('Participant KYC record was not found in this tenant.', 'KYC_RECORD_NOT_FOUND', 404);
  if (target.submittedBy && String(target.submittedBy) === String(actorId)) throw domainError('The identity submission actor cannot review their own submission.', 'KYC_SEPARATION_OF_DUTIES_VIOLATION', 403);
  if (target.assignedReviewerId && String(target.assignedReviewerId) !== String(actorId) && context.canOverrideAssignment !== true) throw domainError('This KYC record is assigned to another reviewer.', 'KYC_REVIEWER_ASSIGNMENT_MISMATCH', 403);

  const toStatus = String(decision || '').trim().toUpperCase();
  if (!['VERIFIED', 'REJECTED', 'NEEDS_MORE_INFORMATION'].includes(toStatus)) throw domainError('Only verification, rejection or an additional-information request can be recorded through this review endpoint.', 'KYC_DECISION_UNSUPPORTED', 400);
  assertKycTransition(target.status, toStatus);
  const notes = String(reviewNotes ?? '').trim();
  if (toStatus === 'NEEDS_MORE_INFORMATION' && !notes) throw domainError('A safe, participant-understandable reason is required when requesting more information.', 'KYC_REVIEW_NOTES_REQUIRED', 400);
  const rejection = toStatus === 'REJECTED' ? String(reasonCode || '').trim().toUpperCase() : null;
  if (toStatus === 'REJECTED' && !KYC_REJECTION_REASONS.includes(rejection)) throw domainError('A valid rejection reason code is required.', 'KYC_REJECTION_REASON_INVALID', 400);

  const now = new Date();
  const previousStatus = target.status;
  target.status = toStatus;
  target.verifiedBy = null;
  target.verifiedAt = null;
  target.verificationMethod = null;
  target.verificationProvider = null;
  target.rejectionReason = rejection;
  target.reviewNotes = notes || undefined;
  if (assignReviewerId) target.assignedReviewerId = normalizeUserId(assignReviewerId);

  if (toStatus === 'VERIFIED') {
    const unexpiredDocuments = target.documents.filter((document) => !document.expiresAt || new Date(document.expiresAt) > now);
    if (!unexpiredDocuments.length || unexpiredDocuments.some((document) => document.status === 'EXPIRED')) throw domainError('At least one non-expired credential must be present before verification.', 'KYC_VALID_CREDENTIAL_REQUIRED', 422);
    target.verifiedBy = actorId;
    target.verifiedAt = now;
    target.verificationMethod = 'MANUAL';
    for (const document of unexpiredDocuments) {
      document.status = 'VERIFIED';
      document.verifiedAt = now;
      document.verifiedBy = actorId;
      document.verificationMethod = 'MANUAL';
    }
  }

  target.verificationHistory.push({
    previousStatus,
    newStatus: toStatus,
    verificationMethod: 'MANUAL',
    performedBy: actorId,
    performedAt: now,
    reason: rejection || (toStatus === 'NEEDS_MORE_INFORMATION' ? 'ADDITIONAL_INFORMATION_REQUIRED' : 'MANUAL_REVIEW_DECISION'),
    notes: notes || undefined,
    requestId: context.requestId,
    correlationId: context.correlationId,
  });
  await target.save();
  await writeAudit({ ...context, actorId: String(actorId) }, 'PARTICIPANT.IDENTITY_REVIEW_DECIDED', {
    participantReference: String(targetUserId),
    previousStatus,
    newStatus: toStatus,
    reasonCode: rejection,
    verificationMethod: 'MANUAL',
  });
  return serializeStatus(target);
}

export async function appealIdentityDecision({ reason }, context = {}) {
  const tenant = await trustedTenant(context.tenantId);
  const actorId = normalizeActorId(context.actorId);
  const record = await KYC.findOne({ tenantId: tenant._id, userId: actorId });
  if (!record) throw domainError('Participant KYC record was not found.', 'KYC_RECORD_NOT_FOUND', 404);
  if (record.status !== 'REJECTED') throw domainError('Only a rejected identity decision can be appealed.', 'KYC_APPEAL_NOT_ALLOWED', 409);
  const safeReason = requiredString(reason, 'reason', 1000);
  assertKycTransition(record.status, 'APPEALED');
  const now = new Date();
  record.status = 'APPEALED';
  record.rejectionReason = null;
  record.reviewNotes = safeReason;
  record.verificationHistory.push({ previousStatus: 'REJECTED', newStatus: 'APPEALED', verificationMethod: 'MANUAL', performedBy: actorId, performedAt: now, reason: 'PARTICIPANT_APPEAL_SUBMITTED', notes: safeReason, requestId: context.requestId, correlationId: context.correlationId });
  await record.save();
  await writeAudit({ ...context, actorId: String(actorId) }, 'PARTICIPANT.IDENTITY_APPEAL_SUBMITTED', { participantReference: String(actorId), previousStatus: 'REJECTED', newStatus: 'APPEALED' });
  return serializeStatus(record);
}

export async function getIdentityCapability(context = {}, capability = 'COMMUNITY_PRE_REGISTRATION') {
  const record = await getMyIdentityStatus(context);
  const decision = decideServiceCapability({ kycStatus: record?.status || 'NONE', capability });
  return Object.freeze({ ...decision, kycStatus: record?.status || 'NOT_SUBMITTED', capability: String(capability).toUpperCase() });
}
