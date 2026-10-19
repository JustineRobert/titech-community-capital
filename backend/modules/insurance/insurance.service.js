import InsuranceInstitutionProfile from './models/InsuranceInstitutionProfile.js';
import Tenant from '../../models/Tenant.js';
import KYC from '../../models/KYC.js';
import mongoose from 'mongoose';
import { isPrivateDocumentStorageConfigured } from '../secure-documents/secureDocument.service.js';
import InsuranceProduct from './models/InsuranceProduct.js';
import InsuranceEnrolment from './models/InsuranceEnrolment.js';
import InsurancePremium from './models/InsurancePremium.js';
import InsuranceClaim from './models/InsuranceClaim.js';
import SecureDocument from '../secure-documents/secureDocument.model.js';
import { createAuditLog } from '../audit/audit.service.js';
import { assertActiveConsent } from '../consent/services/consentService.js';
import { assertLicenceOperational, assertLicenceTransition, assertEnrolmentTransition, assertClaimReviewable, normalizeMoneyMinorUnits, INSURANCE_ORGANIZATION_TYPES } from './insurance.policy.js';

function insuranceError(message, code, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
function requiredString(value, field, maxLength = 200) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw insuranceError(`${field} is required.`, `${field.toUpperCase()}_REQUIRED`, 400);
  if (normalized.length > maxLength) throw insuranceError(`${field} exceeds the permitted length.`, `${field.toUpperCase()}_TOO_LONG`, 400);
  return normalized;
}
function contextValues(context = {}) {
  const tenantId = requiredString(context.tenantId, 'tenantId', 100).toLowerCase();
  const actorId = requiredString(context.actorId, 'actorId', 128);
  return { tenantId, actorId };
}
async function audit(context, action, data) {
  await createAuditLog({ tenantId: context.tenantId, actorId: context.actorId, action, requestId: context.requestId || null, correlationId: context.correlationId || context.requestId || null, data });
}
async function requiredPrivateEvidence({ tenantId, documentReference, purpose }) {
  const reference = requiredString(documentReference, 'documentReference', 80);
  const found = await SecureDocument.findOne({ tenantId, documentReference: reference, purpose, deletedAt: null }).select('documentReference purpose subjectId uploadedAt').lean();
  if (!found) throw insuranceError('Evidence must reference an existing private document in this tenant and for the expected purpose.', 'INSURANCE_EVIDENCE_REFERENCE_INVALID', 422);
  return found;
}
async function requiredProfile(context) {
  const profile = await InsuranceInstitutionProfile.findOne({ tenantId: context.tenantId });
  if (!profile) throw insuranceError('Insurance institution profile must be submitted first.', 'INSURANCE_PROFILE_NOT_FOUND', 404);
  return profile;
}

export async function getInstitutionProfile(inputContext) {
  const ctx = contextValues(inputContext);
  return InsuranceInstitutionProfile.findOne({ tenantId: ctx.tenantId }).select('-licenceEvidenceReference').lean();
}

export async function submitInstitutionProfile(payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  const organisationType = requiredString(payload.organisationType, 'organisationType', 60).toUpperCase();
  if (!INSURANCE_ORGANIZATION_TYPES.includes(organisationType)) throw insuranceError('Unsupported insurance-sector organisation type.', 'INSURANCE_ORGANISATION_TYPE_INVALID', 400);
  const legalName = requiredString(payload.legalName, 'legalName', 200);
  const registrationReference = requiredString(payload.registrationReference, 'registrationReference', 128);
  const jurisdiction = requiredString(payload.jurisdiction, 'jurisdiction', 80).toUpperCase();
  const competentAuthority = requiredString(payload.competentAuthority, 'competentAuthority', 200);
  const licenceReference = requiredString(payload.licenceReference, 'licenceReference', 128);
  const licenceEvidenceReference = requiredString(payload.licenceEvidenceReference, 'licenceEvidenceReference', 80);
  await requiredPrivateEvidence({ tenantId: ctx.tenantId, documentReference: licenceEvidenceReference, purpose: 'INSURANCE_LICENCE' });

  let profile = await InsuranceInstitutionProfile.findOne({ tenantId: ctx.tenantId }).select('+licenceEvidenceReference');
  if (profile && !['DRAFT', 'NEEDS_MORE_INFORMATION'].includes(profile.onboardingStatus)) {
    throw insuranceError('An already submitted or approved institution profile cannot be silently replaced. Use the documented compliance correction workflow.', 'INSURANCE_PROFILE_EDIT_NOT_ALLOWED', 409);
  }
  const previousStatus = profile?.licenceStatus || 'PENDING_SUBMISSION';
  if (!profile) profile = new InsuranceInstitutionProfile({ tenantId: ctx.tenantId, createdBy: ctx.actorId });
  Object.assign(profile, {
    organisationType,
    legalName,
    tradingName: payload.tradingName ? String(payload.tradingName).trim().slice(0, 200) : null,
    registrationReference,
    jurisdiction,
    competentAuthority,
    registeredContactEmail: payload.registeredContactEmail ? String(payload.registeredContactEmail).trim().toLowerCase().slice(0, 254) : null,
    registeredContactPhone: payload.registeredContactPhone ? String(payload.registeredContactPhone).trim().slice(0, 32) : null,
    approvedTerritories: Array.isArray(payload.approvedTerritories) ? [...new Set(payload.approvedTerritories.map((x) => String(x).trim().toUpperCase()).filter(Boolean))].slice(0, 50) : [],
    licenceReference,
    licenceActivities: Array.isArray(payload.licenceActivities) ? [...new Set(payload.licenceActivities.map((x) => String(x).trim()).filter(Boolean))].slice(0, 50) : [],
    licenceIssuedAt: payload.licenceIssuedAt ? new Date(payload.licenceIssuedAt) : null,
    licenceExpiresAt: payload.licenceExpiresAt ? new Date(payload.licenceExpiresAt) : null,
    licenceEvidenceReference,
    licenceStatus: 'PENDING_VERIFICATION',
    verificationSource: null,
    verifiedAt: null,
    verifiedBy: null,
    verificationReason: null,
    onboardingStatus: 'SUBMITTED',
    agreementReference: payload.agreementReference ? String(payload.agreementReference).trim().slice(0, 128) : null,
    dataProcessingAgreementReference: payload.dataProcessingAgreementReference ? String(payload.dataProcessingAgreementReference).trim().slice(0, 128) : null,
    updatedBy: ctx.actorId,
    approvalHistory: [...(profile.approvalHistory || []), { fromStatus: previousStatus, toStatus: 'PENDING_VERIFICATION', actorId: ctx.actorId, reason: 'INSTITUTION_PROFILE_SUBMITTED', sourceReference: licenceEvidenceReference, at: new Date() }],
  });
  await profile.save();
  await audit(ctx, 'INSURANCE.INSTITUTION_PROFILE_SUBMITTED', { organisationType, licenceStatus: profile.licenceStatus, onboardingStatus: profile.onboardingStatus });
  return profile.toJSON();
}

export async function recordLicenceReview(payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  const profile = await requiredProfile(ctx);
  const decision = requiredString(payload.decision, 'decision', 40).toUpperCase();
  if (!['VERIFIED', 'NEEDS_MORE_INFORMATION', 'REJECTED', 'SUSPENDED', 'EXPIRED'].includes(decision)) throw insuranceError('Unsupported licence-review decision.', 'INSURANCE_LICENCE_DECISION_INVALID', 400);
  const verificationSource = requiredString(payload.verificationSource, 'verificationSource', 500);
  const reason = String(payload.reason || '').trim().slice(0, 1000);
  if (String(profile.createdBy) === ctx.actorId) throw insuranceError('The submitting institution administrator cannot review their own licence submission.', 'INSURANCE_LICENCE_SELF_APPROVAL_FORBIDDEN', 403);
  if (decision === 'VERIFIED' && profile.licenceExpiresAt && new Date(profile.licenceExpiresAt) <= new Date()) throw insuranceError('An expired licence cannot be verified as currently operational.', 'INSURANCE_LICENCE_EXPIRED', 422);
  if (['NEEDS_MORE_INFORMATION', 'REJECTED', 'SUSPENDED'].includes(decision) && !reason) throw insuranceError('A reason is required for this compliance decision.', 'INSURANCE_LICENCE_REASON_REQUIRED', 400);
  assertLicenceTransition(profile.licenceStatus, decision);
  const previousStatus = profile.licenceStatus;
  profile.licenceStatus = decision;
  profile.verificationSource = verificationSource;
  profile.verifiedAt = decision === 'VERIFIED' ? new Date() : null;
  profile.verifiedBy = decision === 'VERIFIED' ? ctx.actorId : null;
  profile.verificationReason = reason || null;
  profile.suspensionReason = decision === 'SUSPENDED' ? reason : null;
  profile.onboardingStatus = decision === 'VERIFIED' ? 'APPROVED_FOR_CONFIGURATION' : decision === 'SUSPENDED' ? 'SUSPENDED' : decision === 'REJECTED' ? 'REJECTED' : 'NEEDS_MORE_INFORMATION';
  profile.approvalHistory.push({ fromStatus: previousStatus, toStatus: decision, actorId: ctx.actorId, reason: reason || 'MANUAL_OFFICIAL_REGISTER_REVIEW', sourceReference: verificationSource, at: new Date() });
  profile.updatedBy = ctx.actorId;
  await profile.save();
  await audit(ctx, 'INSURANCE.LICENCE_REVIEW_DECIDED', { previousStatus, newStatus: decision, verificationSource, reason });
  return profile.toJSON();
}

export async function createInsuranceProduct(payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  const profile = await requiredProfile(ctx);
  assertLicenceOperational(profile, 'insurance product registration');
  const productReference = requiredString(payload.productReference, 'productReference', 128);
  const productVersion = requiredString(payload.productVersion, 'productVersion', 80);
  const productName = requiredString(payload.productName, 'productName', 200);
  const sourceSystemReference = requiredString(payload.sourceSystemReference, 'sourceSystemReference', 200);
  const termsAndConditionsVersion = requiredString(payload.termsAndConditionsVersion, 'termsAndConditionsVersion', 80);
  const currency = requiredString(payload.currency, 'currency', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw insuranceError('Currency must be a three-letter currency code.', 'INSURANCE_CURRENCY_INVALID', 400);
  const coverageReferences = Array.isArray(payload.coverageReferences) ? payload.coverageReferences.slice(0, 100).map((coverage) => ({
    coverageReference: requiredString(coverage?.coverageReference, 'coverageReference', 128),
    coverageName: requiredString(coverage?.coverageName, 'coverageName', 200),
    termsVersion: requiredString(coverage?.termsVersion, 'termsVersion', 80),
    sourceSystemReference: requiredString(coverage?.sourceSystemReference, 'coverageSourceSystemReference', 200),
  })) : [];
  const product = await InsuranceProduct.create({ tenantId: ctx.tenantId, insurerProfileId: profile._id, productReference, productName, productVersion, currency, productStatus: 'DRAFT', coverageReferences, sourceSystemReference, termsAndConditionsVersion, eligibilityRuleReference: payload.eligibilityRuleReference ? String(payload.eligibilityRuleReference).trim().slice(0, 200) : null, submittedBy: ctx.actorId });
  await audit(ctx, 'INSURANCE.PRODUCT_REFERENCE_CREATED', { productReference, productVersion, productStatus: product.productStatus });
  return product.toJSON();
}

export async function activateInsuranceProduct(productId, payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  const profile = await requiredProfile(ctx);
  assertLicenceOperational(profile, 'insurance product activation');
  const product = await InsuranceProduct.findOne({ _id: productId, tenantId: ctx.tenantId });
  if (!product) throw insuranceError('Product reference was not found in this insurer tenant.', 'INSURANCE_PRODUCT_NOT_FOUND', 404);
  if (product.productStatus !== 'DRAFT' && product.productStatus !== 'PENDING_APPROVAL') throw insuranceError('Only draft or pending products can be activated.', 'INSURANCE_PRODUCT_ACTIVATION_NOT_ALLOWED', 409);
  if (String(product.submittedBy) === ctx.actorId) throw insuranceError('The product submitter cannot approve their own product activation.', 'INSURANCE_PRODUCT_SELF_APPROVAL_FORBIDDEN', 403);
  const activationEvidenceReference = requiredString(payload.activationEvidenceReference, 'activationEvidenceReference', 80);
  await requiredPrivateEvidence({ tenantId: ctx.tenantId, documentReference: activationEvidenceReference, purpose: 'OTHER_COMPLIANCE_EVIDENCE' });
  product.productStatus = 'ACTIVE';
  product.activatedBy = ctx.actorId;
  product.activatedAt = new Date();
  product.activationEvidenceReference = activationEvidenceReference;
  await product.save();
  await audit(ctx, 'INSURANCE.PRODUCT_ACTIVATED', { productReference: product.productReference, productVersion: product.productVersion, activationEvidenceReference });
  return product.toJSON();
}

export async function listInsuranceProducts(inputContext = {}) {
  const ctx = contextValues(inputContext);
  return InsuranceProduct.find({ tenantId: ctx.tenantId }).select('-activationEvidenceReference').sort({ updatedAt: -1 }).lean();
}

export async function createInsuranceEnrolment(payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  const profile = await requiredProfile(ctx);
  assertLicenceOperational(profile, 'insurance enrolment submission');
  const product = await InsuranceProduct.findOne({ _id: payload.productId, tenantId: ctx.tenantId, productStatus: 'ACTIVE' });
  if (!product) throw insuranceError('An active product owned by this insurer is required.', 'INSURANCE_ACTIVE_PRODUCT_REQUIRED', 403);
  const productCoverage = product.coverageReferences.find((item) => item.coverageReference === String(payload.coverageReference || '').trim());
  if (!productCoverage) throw insuranceError('Coverage reference is not part of the selected product version.', 'INSURANCE_COVERAGE_REFERENCE_INVALID', 422);
  const participantTenantReference = requiredString(payload.participantTenantReference, 'participantTenantReference', 100).toLowerCase();
  const participantReference = requiredString(payload.participantReference, 'participantReference', 128);
  if (!mongoose.Types.ObjectId.isValid(participantReference)) throw insuranceError('Participant reference must identify an account in the registered TITech source tenant.', 'INSURANCE_PARTICIPANT_REFERENCE_INVALID', 422);
  const participantVerificationReference = requiredString(payload.participantVerificationReference, 'participantVerificationReference', 200);
  const consentReference = requiredString(payload.consentReference, 'consentReference', 200);
  const termsAndConditionsVersion = requiredString(payload.termsAndConditionsVersion, 'termsAndConditionsVersion', 80);
  if (termsAndConditionsVersion !== product.termsAndConditionsVersion || productCoverage.termsVersion !== termsAndConditionsVersion) throw insuranceError('Enrolment terms version must match the selected insurer product/coverage version.', 'INSURANCE_TERMS_VERSION_MISMATCH', 422);
  // Resolve the participant's source tenant through the canonical tenant registry;
  // client-supplied tenant references never establish tenant existence or scope.
  const sourceTenant = await Tenant.findOne({ tenantId: participantTenantReference, status: 'ACTIVE' }).select('_id tenantId').lean();
  if (!sourceTenant) throw insuranceError('Participant source tenant is not an active registered tenant.', 'INSURANCE_PARTICIPANT_TENANT_INVALID', 403);
  // Do not accept a caller-entered "verified" reference as evidence. Resolve the
  // canonical KYC record inside the source tenant, require VERIFIED state and a
  // current verified credential, and bind the supplied reference to that record.
  const participantKyc = await KYC.findOne({
    tenantId: sourceTenant._id,
    userId: new mongoose.Types.ObjectId(participantReference),
    status: 'VERIFIED',
  }).select('verifiedAt expiresAt documents').lean();
  const now = new Date();
  const hasCurrentVerifiedCredential = (participantKyc?.documents || []).some((document) =>
    document.status === 'VERIFIED' && (!document.expiresAt || new Date(document.expiresAt) > now)
  );
  if (!participantKyc || !participantKyc.verifiedAt || (participantKyc.expiresAt && new Date(participantKyc.expiresAt) <= now) || !hasCurrentVerifiedCredential || String(participantKyc._id) !== participantVerificationReference) {
    throw insuranceError('Insurance enrolment requires a current VERIFIED KYC record in the participant source tenant; the supplied verification reference did not prove that state.', 'INSURANCE_VERIFIED_KYC_REQUIRED', 422);
  }
  // Consent lives in the participant's source tenant. The insurer receives only
  // a narrowly scoped, active consent record for this exact participant, recipient
  // and purpose; a free-form consent reference is never accepted as proof.
  const consent = await assertActiveConsent({
    consentId: consentReference,
    tenantId: participantTenantReference,
    purpose: 'INSURANCE_ENROLMENT',
    recipient: ctx.tenantId,
    requiredCategories: ['INSURANCE_ENROLMENT', 'IDENTITY_VERIFICATION'],
  });
  if (String(consent.subjectId) !== participantReference) throw insuranceError('Consent subject does not match the referenced participant.', 'INSURANCE_CONSENT_SUBJECT_MISMATCH', 403);
  const enrolment = await InsuranceEnrolment.create({ tenantId: ctx.tenantId, insurerProfileId: profile._id, productId: product._id, participantTenantReference, participantReference, groupReference: payload.groupReference ? String(payload.groupReference).trim().slice(0, 128) : null, productReference: product.productReference, coverageReference: productCoverage.coverageReference, participantVerificationReference, consentReference, termsAndConditionsVersion, status: 'SUBMITTED', createdBy: ctx.actorId, updatedBy: ctx.actorId, history: [{ fromStatus: 'DRAFT', toStatus: 'SUBMITTED', actorId: ctx.actorId, externalReference: participantVerificationReference, reason: 'ENROLMENT_SUBMITTED', at: new Date() }] });
  await audit(ctx, 'INSURANCE.ENROLMENT_SUBMITTED', { enrolmentId: String(enrolment._id), productReference: product.productReference, status: enrolment.status });
  return enrolment.toJSON();
}

export async function recordInsuranceEnrolmentDecision(enrolmentId, payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  const profile = await requiredProfile(ctx);
  assertLicenceOperational(profile, 'insurer enrolment decision recording');
  const enrolment = await InsuranceEnrolment.findOne({ _id: enrolmentId, tenantId: ctx.tenantId });
  if (!enrolment) throw insuranceError('Enrolment was not found in this insurer tenant.', 'INSURANCE_ENROLMENT_NOT_FOUND', 404);
  const status = requiredString(payload.status, 'status', 40).toUpperCase();
  const allowed = new Set(['PENDING_ELIGIBILITY', 'NEEDS_MORE_INFORMATION', 'ELIGIBLE', 'INELIGIBLE', 'POLICY_ISSUED', 'COVERAGE_ACTIVE', 'COVERAGE_ENDED', 'CANCELLED']);
  if (!allowed.has(status)) throw insuranceError('Unsupported insurer enrolment status.', 'INSURANCE_ENROLMENT_STATUS_INVALID', 400);
  const decisionSource = requiredString(payload.decisionSource, 'decisionSource', 200);
  const decisionReference = requiredString(payload.decisionReference, 'decisionReference', 200);
  if (['POLICY_ISSUED', 'COVERAGE_ACTIVE', 'COVERAGE_ENDED'].includes(status) && !String(payload.policyReference || '').trim()) throw insuranceError('An external policy reference is required for issued/active/ended coverage.', 'INSURANCE_POLICY_REFERENCE_REQUIRED', 422);
  if (status === 'COVERAGE_ACTIVE' && !payload.coverageStartsAt) throw insuranceError('Insurer coverage start is required before coverage is shown as active.', 'INSURANCE_COVERAGE_START_REQUIRED', 422);
  if (status === 'NEEDS_MORE_INFORMATION' && !String(payload.reason || '').trim()) throw insuranceError('A reason is required when requesting additional information.', 'INSURANCE_ENROLMENT_REASON_REQUIRED', 400);
  const previousStatus = enrolment.status;
  assertEnrolmentTransition(previousStatus, status);
  enrolment.status = status;
  enrolment.insurerDecisionSource = decisionSource;
  enrolment.insurerDecisionReference = decisionReference;
  enrolment.policyReference = payload.policyReference ? String(payload.policyReference).trim().slice(0, 128) : null;
  enrolment.coverageStartsAt = payload.coverageStartsAt ? new Date(payload.coverageStartsAt) : null;
  enrolment.coverageEndsAt = payload.coverageEndsAt ? new Date(payload.coverageEndsAt) : null;
  enrolment.updatedBy = ctx.actorId;
  enrolment.history.push({ fromStatus: previousStatus, toStatus: status, actorId: ctx.actorId, externalReference: decisionReference, reason: String(payload.reason || '').trim().slice(0, 500) || null, at: new Date() });
  await enrolment.save();
  await audit(ctx, 'INSURANCE.ENROLMENT_DECISION_RECORDED', { enrolmentId: String(enrolment._id), previousStatus, newStatus: status, decisionSource, decisionReference });
  return enrolment.toJSON();
}

export async function listInsuranceEnrolments(inputContext = {}) {
  const ctx = contextValues(inputContext);
  return InsuranceEnrolment.find({ tenantId: ctx.tenantId }).sort({ updatedAt: -1 }).lean();
}

export async function createPremiumObligation(payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  const profile = await requiredProfile(ctx);
  assertLicenceOperational(profile, 'premium-obligation registration');
  const enrolment = await InsuranceEnrolment.findOne({ _id: payload.enrolmentId, tenantId: ctx.tenantId });
  if (!enrolment || !['POLICY_ISSUED', 'COVERAGE_ACTIVE'].includes(enrolment.status)) throw insuranceError('Premium obligations require an insurer-issued policy or active coverage reference.', 'INSURANCE_POLICY_REFERENCE_REQUIRED', 422);
  const { amountMinor, currency } = normalizeMoneyMinorUnits(payload.expectedAmountMinor, payload.currency);
  const idempotencyKey = requiredString(payload.idempotencyKey, 'idempotencyKey', 160);
  const premiumReference = requiredString(payload.premiumReference, 'premiumReference', 128);
  const product = await InsuranceProduct.findOne({ _id: enrolment.productId, tenantId: ctx.tenantId });
  if (!product || product.currency !== currency) throw insuranceError('Premium currency must match the insurer product currency.', 'INSURANCE_PREMIUM_CURRENCY_MISMATCH', 422);
  const existing = await InsurancePremium.findOne({ tenantId: ctx.tenantId, idempotencyKey });
  if (existing) {
    if (existing.enrolmentId.equals(enrolment._id) && existing.expectedAmountMinor === amountMinor && existing.currency === currency && existing.premiumReference === premiumReference) return existing.toJSON();
    throw insuranceError('Idempotency key has already been used for a different premium obligation.', 'INSURANCE_PREMIUM_IDEMPOTENCY_CONFLICT', 409);
  }
  const dueAt = payload.dueAt ? new Date(payload.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) throw insuranceError('Premium due date is invalid.', 'INSURANCE_PREMIUM_DUE_DATE_INVALID', 400);
  let premium;
  try {
    premium = await InsurancePremium.create({ tenantId: ctx.tenantId, insurerProfileId: profile._id, enrolmentId: enrolment._id, premiumReference, idempotencyKey, expectedAmountMinor: amountMinor, currency, dueAt, status: 'DUE', createdBy: ctx.actorId });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const concurrent = await InsurancePremium.findOne({ tenantId: ctx.tenantId, $or: [{ idempotencyKey }, { premiumReference }] });
    if (concurrent && concurrent.idempotencyKey === idempotencyKey && concurrent.enrolmentId.equals(enrolment._id) && concurrent.expectedAmountMinor === amountMinor && concurrent.currency === currency && concurrent.premiumReference === premiumReference) return concurrent.toJSON();
    throw insuranceError('The premium reference or idempotency key was concurrently used for another obligation.', 'INSURANCE_PREMIUM_IDEMPOTENCY_CONFLICT', 409);
  }
  await audit(ctx, 'INSURANCE.PREMIUM_OBLIGATION_CREATED', { premiumReference, expectedAmountMinor: amountMinor, currency, enrolmentId: String(enrolment._id), status: premium.status });
  return premium.toJSON();
}

export async function listPremiumObligations(inputContext = {}) {
  const ctx = contextValues(inputContext);
  return InsurancePremium.find({ tenantId: ctx.tenantId }).sort({ dueAt: 1, createdAt: -1 }).lean();
}

export async function createInsuranceClaim(payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  const profile = await requiredProfile(ctx);
  assertLicenceOperational(profile, 'insurance claim intake');
  const enrolment = await InsuranceEnrolment.findOne({ _id: payload.enrolmentId, tenantId: ctx.tenantId });
  if (!enrolment || !['POLICY_ISSUED', 'COVERAGE_ACTIVE', 'COVERAGE_ENDED'].includes(enrolment.status)) throw insuranceError('Claim intake requires an insurer-issued policy reference.', 'INSURANCE_POLICY_REFERENCE_REQUIRED', 422);
  const policyReference = requiredString(payload.policyReference, 'policyReference', 128);
  if (policyReference !== enrolment.policyReference) throw insuranceError('The claim policy reference does not match the enrolment in this tenant.', 'INSURANCE_POLICY_REFERENCE_MISMATCH', 422);
  const evidenceReferences = Array.isArray(payload.evidenceReferences) ? [...new Set(payload.evidenceReferences.map((x) => String(x).trim()).filter(Boolean))].slice(0, 10) : [];
  for (const evidenceReference of evidenceReferences) await requiredPrivateEvidence({ tenantId: ctx.tenantId, documentReference: evidenceReference, purpose: 'INSURANCE_CLAIM' });
  const claim = await InsuranceClaim.create({ tenantId: ctx.tenantId, insurerProfileId: profile._id, enrolmentId: enrolment._id, claimReference: requiredString(payload.claimReference, 'claimReference', 128), policyReference, claimantReference: requiredString(payload.claimantReference, 'claimantReference', 128), claimCategory: requiredString(payload.claimCategory, 'claimCategory', 100), submittedAt: payload.submittedAt ? new Date(payload.submittedAt) : new Date(), evidenceReferences, status: 'SUBMITTED', createdBy: ctx.actorId, updatedBy: ctx.actorId, history: [{ fromStatus: 'DRAFT', toStatus: 'SUBMITTED', actorId: ctx.actorId, reason: 'CLAIM_INTAKE', at: new Date() }] });
  await audit(ctx, 'INSURANCE.CLAIM_SUBMITTED', { claimReference: claim.claimReference, enrolmentId: String(enrolment._id), evidenceCount: evidenceReferences.length, status: claim.status });
  return claim.toJSON();
}

export async function recordInsurerClaimDecision(claimId, payload = {}, inputContext = {}) {
  const ctx = contextValues(inputContext);
  const profile = await requiredProfile(ctx);
  assertLicenceOperational(profile, 'insurer claim decision recording');
  const claim = await InsuranceClaim.findOne({ _id: claimId, tenantId: ctx.tenantId });
  if (!claim) throw insuranceError('Claim was not found in this insurer tenant.', 'INSURANCE_CLAIM_NOT_FOUND', 404);
  assertClaimReviewable(claim.status);
  const decision = requiredString(payload.decision, 'decision', 40).toUpperCase();
  if (!['APPROVED', 'REJECTED', 'NEEDS_MORE_INFORMATION'].includes(decision)) throw insuranceError('Unsupported insurer claim decision.', 'INSURANCE_CLAIM_DECISION_INVALID', 400);
  const sourceSystem = requiredString(payload.sourceSystem, 'sourceSystem', 200);
  const externalDecisionReference = requiredString(payload.externalDecisionReference, 'externalDecisionReference', 200);
  const decidedAt = payload.decidedAt ? new Date(payload.decidedAt) : new Date();
  if (Number.isNaN(decidedAt.getTime())) throw insuranceError('Insurer decision timestamp is invalid.', 'INSURANCE_CLAIM_DECISION_DATE_INVALID', 400);
  if (decision === 'NEEDS_MORE_INFORMATION' && !String(payload.reasonReference || '').trim()) throw insuranceError('A reason reference is required when additional information is requested.', 'INSURANCE_CLAIM_REASON_REQUIRED', 400);
  const previousStatus = claim.status;
  claim.insurerDecision = { decision, sourceSystem, externalDecisionReference, decidedAt, recordedBy: ctx.actorId, reasonReference: payload.reasonReference ? String(payload.reasonReference).trim().slice(0, 200) : null };
  claim.status = decision === 'REJECTED' ? 'REJECTED' : decision === 'NEEDS_MORE_INFORMATION' ? 'NEEDS_MORE_INFORMATION' : 'DECISION_RECORDED';
  claim.additionalInformationRequest = decision === 'NEEDS_MORE_INFORMATION' ? String(payload.additionalInformationRequest || '').trim().slice(0, 1000) : null;
  if (decision === 'NEEDS_MORE_INFORMATION' && !claim.additionalInformationRequest) throw insuranceError('A participant-safe request for additional information is required.', 'INSURANCE_CLAIM_REQUEST_TEXT_REQUIRED', 400);
  claim.updatedBy = ctx.actorId;
  claim.history.push({ fromStatus: previousStatus, toStatus: claim.status, actorId: ctx.actorId, externalReference: externalDecisionReference, reason: payload.reasonReference ? String(payload.reasonReference).trim().slice(0, 500) : null, at: new Date() });
  await claim.save();
  await audit(ctx, 'INSURANCE.CLAIM_DECISION_REFERENCE_RECORDED', { claimReference: claim.claimReference, previousStatus, newStatus: claim.status, decisionSource: sourceSystem, externalDecisionReference });
  return claim.toJSON();
}

export async function listInsuranceClaims(inputContext = {}) {
  const ctx = contextValues(inputContext);
  return InsuranceClaim.find({ tenantId: ctx.tenantId }).sort({ updatedAt: -1 }).lean();
}

export async function getInsuranceOperationalReadiness(inputContext = {}) {
  const ctx = contextValues(inputContext);
  const profile = await InsuranceInstitutionProfile.findOne({ tenantId: ctx.tenantId }).select('licenceStatus licenceExpiresAt onboardingStatus integrationStatus').lean();
  const operational = profile ? (() => { try { assertLicenceOperational(profile); return true; } catch { return false; } })() : false;
  const privateDocumentStorageConfigured = isPrivateDocumentStorageConfigured();
  const refugeeOnboardingEnabled = process.env.TITECH_REFUGEE_ONBOARDING_ENABLED === 'true';
  const insuranceOnboardingEnabled = process.env.TITECH_INSURANCE_ONBOARDING_ENABLED === 'true';
  const insuranceOperationsEnabled = process.env.TITECH_INSURANCE_OPERATIONS_ENABLED === 'true';
  const blockingReasons = [
    ...(!operational ? ['CURRENT_VERIFIED_INSURANCE_LICENCE_REQUIRED'] : []),
    ...(profile?.integrationStatus !== 'TESTS_PASSED' ? ['INTEGRATION_TEST_EVIDENCE_REQUIRED'] : []),
    ...(!privateDocumentStorageConfigured ? ['PRIVATE_ENCRYPTED_DOCUMENT_STORAGE_NOT_CONFIGURED'] : []),
    ...(!refugeeOnboardingEnabled ? ['REFUGEE_ONBOARDING_FEATURE_FLAG_DISABLED'] : []),
    ...(!insuranceOnboardingEnabled ? ['INSURANCE_ONBOARDING_FEATURE_FLAG_DISABLED'] : []),
    ...(!insuranceOperationsEnabled ? ['INSURANCE_OPERATIONS_FEATURE_FLAG_DISABLED'] : []),
    'CANONICAL_INSURANCE_PAYMENT_ADAPTER_NOT_REGISTERED',
    'FORMAL_LEGAL_AND_PRODUCTION_APPROVAL_REQUIRED',
  ];
  return Object.freeze({
    institutionProfileSubmitted: Boolean(profile),
    licenceStatus: profile?.licenceStatus || 'NOT_SUBMITTED',
    licenceOperational: operational,
    onboardingStatus: profile?.onboardingStatus || 'NOT_STARTED',
    integrationStatus: profile?.integrationStatus || 'NOT_CONFIGURED',
    privateDocumentStorageConfigured,
    refugeeOnboardingEnabled,
    insuranceOnboardingEnabled,
    insuranceOperationsEnabled,
    livePremiumProcessing: false,
    livePayoutProcessing: false,
    blockingReasons: Object.freeze(blockingReasons),
  });
}
