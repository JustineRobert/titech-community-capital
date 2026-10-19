import RefugeeServingOrganisationProfile from './models/RefugeeServingOrganisationProfile.js';
import SecureDocument from '../secure-documents/secureDocument.model.js';
import { createAuditLog } from '../audit/audit.service.js';

function partnerError(message, code, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
function required(value, name, max = 200) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw partnerError(`${name} is required.`, `${name.toUpperCase()}_REQUIRED`);
  if (normalized.length > max) throw partnerError(`${name} exceeds the permitted length.`, `${name.toUpperCase()}_TOO_LONG`);
  return normalized;
}
function contextOf(context = {}) {
  return { tenantId: required(context.tenantId, 'tenantId', 100).toLowerCase(), actorId: required(context.actorId, 'actorId', 128), requestId: context.requestId || null, correlationId: context.correlationId || context.requestId || null };
}
async function audit(ctx, action, data) {
  await createAuditLog({ tenantId: ctx.tenantId, actorId: ctx.actorId, action, data, requestId: ctx.requestId, correlationId: ctx.correlationId });
}

export async function submitRefugeeServingOrganisation(payload = {}, context = {}) {
  const ctx = contextOf(context);
  const organisationType = required(payload.organisationType, 'organisationType', 60).toUpperCase();
  if (!['REFUGEE_SERVING_ORGANISATION', 'COMMUNITY_SUPPORT_ORGANISATION', 'HUMANITARIAN_PARTNER', 'OTHER_APPROVED_PARTNER'].includes(organisationType)) throw partnerError('Unsupported organisation category.', 'REFUGEE_PARTNER_TYPE_INVALID');
  const evidenceReference = required(payload.evidenceReference, 'evidenceReference', 80);
  const evidence = await SecureDocument.findOne({ tenantId: ctx.tenantId, documentReference: evidenceReference, purpose: 'OTHER_COMPLIANCE_EVIDENCE', deletedAt: null }).select('documentReference').lean();
  if (!evidence) throw partnerError('Organisation evidence must be uploaded into this tenant’s private document store first.', 'REFUGEE_PARTNER_EVIDENCE_INVALID', 422);
  let profile = await RefugeeServingOrganisationProfile.findOne({ tenantId: ctx.tenantId }).select('+evidenceReference');
  if (profile && !['NEEDS_MORE_INFORMATION', 'REJECTED'].includes(profile.verificationStatus)) throw partnerError('An existing partner registration cannot be silently replaced.', 'REFUGEE_PARTNER_EDIT_NOT_ALLOWED', 409);
  const previous = profile?.verificationStatus || 'PENDING_SUBMISSION';
  if (!profile) profile = new RefugeeServingOrganisationProfile({ tenantId: ctx.tenantId, createdBy: ctx.actorId });
  Object.assign(profile, {
    legalName: required(payload.legalName, 'legalName', 200),
    organisationType,
    registrationReference: required(payload.registrationReference, 'registrationReference', 128),
    jurisdiction: required(payload.jurisdiction, 'jurisdiction', 80).toUpperCase(),
    competentAuthority: required(payload.competentAuthority, 'competentAuthority', 200),
    programmeScopes: Array.isArray(payload.programmeScopes) ? [...new Set(payload.programmeScopes.map((value) => String(value).trim()).filter(Boolean))].slice(0, 30) : [],
    evidenceReference,
    verificationStatus: 'PENDING_REVIEW',
    dataSharingAgreementReference: payload.dataSharingAgreementReference ? String(payload.dataSharingAgreementReference).trim().slice(0, 128) : null,
    verifiedBy: null,
    verifiedAt: null,
    verificationSource: null,
    reviewReason: null,
    updatedBy: ctx.actorId,
    history: [...(profile.history || []), { fromStatus: previous, toStatus: 'PENDING_REVIEW', actorId: ctx.actorId, reason: 'PARTNER_REGISTRATION_SUBMITTED', sourceReference: evidenceReference, at: new Date() }],
  });
  await profile.save();
  await audit(ctx, 'REFUGEE_PARTNER.REGISTRATION_SUBMITTED', { organisationType, verificationStatus: profile.verificationStatus });
  return profile.toJSON();
}

export async function reviewRefugeeServingOrganisation(payload = {}, context = {}) {
  const ctx = contextOf(context);
  const profile = await RefugeeServingOrganisationProfile.findOne({ tenantId: ctx.tenantId });
  if (!profile) throw partnerError('Refugee-serving organisation registration was not found.', 'REFUGEE_PARTNER_NOT_FOUND', 404);
  if (String(profile.createdBy) === ctx.actorId) throw partnerError('The submitting administrator cannot review their own organisation.', 'REFUGEE_PARTNER_SELF_APPROVAL_FORBIDDEN', 403);
  const decision = required(payload.decision, 'decision', 40).toUpperCase();
  if (!['VERIFIED', 'NEEDS_MORE_INFORMATION', 'REJECTED', 'SUSPENDED'].includes(decision)) throw partnerError('Unsupported partner review decision.', 'REFUGEE_PARTNER_DECISION_INVALID');
  if (!['PENDING_REVIEW', 'NEEDS_MORE_INFORMATION', 'SUBMITTED', 'VERIFIED'].includes(profile.verificationStatus)) throw partnerError('This partner lifecycle state cannot be reviewed.', 'REFUGEE_PARTNER_TRANSITION_NOT_ALLOWED', 409);
  const source = required(payload.verificationSource, 'verificationSource', 500);
  const reason = String(payload.reason || '').trim().slice(0, 1000);
  if (['NEEDS_MORE_INFORMATION', 'REJECTED', 'SUSPENDED'].includes(decision) && !reason) throw partnerError('A reason is required for this review decision.', 'REFUGEE_PARTNER_REASON_REQUIRED');
  const previous = profile.verificationStatus;
  profile.verificationStatus = decision;
  profile.verifiedBy = decision === 'VERIFIED' ? ctx.actorId : null;
  profile.verifiedAt = decision === 'VERIFIED' ? new Date() : null;
  profile.verificationSource = source;
  profile.reviewReason = reason || null;
  profile.updatedBy = ctx.actorId;
  profile.history.push({ fromStatus: previous, toStatus: decision, actorId: ctx.actorId, reason: reason || 'MANUAL_PARTNER_REVIEW', sourceReference: source, at: new Date() });
  await profile.save();
  await audit(ctx, 'REFUGEE_PARTNER.REVIEW_DECIDED', { previousStatus: previous, newStatus: decision, verificationSource: source, reason: reason || null });
  return profile.toJSON();
}

export async function getRefugeeServingOrganisation(inputContext = {}) {
  const ctx = contextOf(inputContext);
  return RefugeeServingOrganisationProfile.findOne({ tenantId: ctx.tenantId }).select('-evidenceReference').lean();
}
