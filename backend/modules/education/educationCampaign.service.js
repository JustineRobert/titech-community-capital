import { randomUUID } from 'node:crypto';
import EducationCampaign from './models/EducationCampaign.js';
import RefugeeServingOrganisationProfile from '../refugee-partners/models/RefugeeServingOrganisationProfile.js';
import { createAuditLog } from '../audit/audit.service.js';
import {
  assertCampaignTransition,
  assertEducationPartnerVerified,
  toManagementCampaignDTO,
  toPublicCampaignDTO,
  validateCampaignInput,
} from './educationCampaign.policy.js';

function campaignError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function required(value, name, maximum = 128) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw campaignError(`${name} is required.`, `EDUCATION_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_REQUIRED`);
  if (normalized.length > maximum) throw campaignError(`${name} exceeds the permitted length.`, `EDUCATION_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_TOO_LONG`);
  return normalized;
}

function contextOf(context = {}) {
  return {
    tenantId: required(context.tenantId, 'tenantId', 100).toLowerCase(),
    actorId: required(context.actorId, 'actorId', 128),
    requestId: context.requestId || null,
    correlationId: context.correlationId || context.requestId || null,
  };
}

function validateCampaignId(id) {
  const normalized = String(id ?? '').trim();
  if (!/^[a-f\d]{24}$/i.test(normalized)) throw campaignError('The campaign identifier is invalid.', 'EDUCATION_CAMPAIGN_ID_INVALID', 400);
  return normalized;
}

async function writeAudit(ctx, action, data) {
  await createAuditLog({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action,
    data,
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
  });
}

async function findPartner(tenantId) {
  return RefugeeServingOrganisationProfile.findOne({ tenantId })
    .select('tenantId legalName verificationStatus programmeScopes verifiedBy verifiedAt')
    .lean();
}

async function requireVerifiedEducationPartner(tenantId) {
  const partner = await findPartner(tenantId);
  assertEducationPartnerVerified(partner);
  return partner;
}

async function findOwnedCampaign(ctx, campaignId) {
  const campaign = await EducationCampaign.findOne({ tenantId: ctx.tenantId, _id: validateCampaignId(campaignId) });
  if (!campaign) throw campaignError('The education campaign was not found in this tenant.', 'EDUCATION_CAMPAIGN_NOT_FOUND', 404);
  return campaign;
}

function appendHistory(campaign, ctx, toStatus, reason = null) {
  const fromStatus = campaign.status;
  campaign.status = toStatus;
  campaign.updatedBy = ctx.actorId;
  campaign.history.push({ fromStatus, toStatus, actorId: ctx.actorId, reason, version: campaign.version, at: new Date() });
}

function normalizeReviewPayload(payload = {}) {
  const decision = String(payload.decision ?? '').trim().toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(decision)) throw campaignError('Review decision must be APPROVED or REJECTED.', 'EDUCATION_REVIEW_DECISION_INVALID');
  if (decision === 'APPROVED' && (payload.privacyAndSafeguardingReviewed !== true || payload.budgetAndTermsReviewed !== true)) {
    throw campaignError('Approval requires explicit privacy/safeguarding and budget/terms review attestations.', 'EDUCATION_REVIEW_ATTESTATIONS_REQUIRED', 422);
  }
  const reason = String(payload.reason ?? '').trim().slice(0, 1000);
  if (decision === 'REJECTED' && !reason) throw campaignError('A reason is required when rejecting a campaign.', 'EDUCATION_REVIEW_REASON_REQUIRED');
  return { decision, reason: reason || null, privacyAndSafeguardingReviewed: decision === 'APPROVED' && payload.privacyAndSafeguardingReviewed === true, budgetAndTermsReviewed: decision === 'APPROVED' && payload.budgetAndTermsReviewed === true };
}

function pickEditableInput(payload) {
  return validateCampaignInput({
    title: payload.title,
    publicDescription: payload.publicDescription,
    category: payload.category,
    communityScope: payload.communityScope,
    eligibilitySummary: payload.eligibilitySummary,
    selectionMethod: payload.selectionMethod,
    targetAmountMinor: payload.targetAmountMinor,
    currency: payload.currency,
    budgetLines: payload.budgetLines,
    startAt: payload.startAt,
    endAt: payload.endAt,
    feeDisclosure: payload.feeDisclosure,
    refundPolicy: payload.refundPolicy,
    surplusPolicy: payload.surplusPolicy,
  });
}

export async function createEducationCampaign(payload = {}, context = {}) {
  const ctx = contextOf(context);
  const input = pickEditableInput(payload);
  const campaign = new EducationCampaign({
    ...input,
    tenantId: ctx.tenantId,
    publicReference: randomUUID(),
    status: 'DRAFT',
    version: 1,
    createdBy: ctx.actorId,
    updatedBy: ctx.actorId,
    history: [{ fromStatus: null, toStatus: 'DRAFT', actorId: ctx.actorId, reason: 'CAMPAIGN_CREATED', version: 1, at: new Date() }],
  });
  await campaign.save();
  await writeAudit(ctx, 'EDUCATION_CAMPAIGN.DRAFT_CREATED', { campaignId: String(campaign._id), publicReference: campaign.publicReference, version: campaign.version, status: campaign.status });
  return toManagementCampaignDTO(campaign);
}

export async function listEducationCampaigns(context = {}) {
  const ctx = contextOf(context);
  const campaigns = await EducationCampaign.find({ tenantId: ctx.tenantId }).sort({ updatedAt: -1, _id: -1 }).limit(100).lean();
  return campaigns.map(toManagementCampaignDTO);
}

export async function updateEducationCampaign(campaignId, payload = {}, context = {}) {
  const ctx = contextOf(context);
  const campaign = await findOwnedCampaign(ctx, campaignId);
  const expectedVersion = Number(payload.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== campaign.version) {
    throw campaignError('The campaign changed since it was loaded. Refresh and retry your edit.', 'EDUCATION_CAMPAIGN_VERSION_CONFLICT', 409);
  }
  if (!['DRAFT', 'REJECTED', 'APPROVED', 'PAUSED'].includes(campaign.status)) {
    throw campaignError('Only draft, rejected, approved or paused campaigns may be edited. Submitted and published campaigns must first follow their lifecycle.', 'EDUCATION_CAMPAIGN_EDIT_NOT_ALLOWED', 409);
  }
  const input = pickEditableInput(payload);
  Object.assign(campaign, input);
  const fromStatus = campaign.status;
  campaign.version += 1;
  campaign.reviewedVersion = null;
  campaign.reviewerId = null;
  campaign.reviewReason = null;
  campaign.privacyAndSafeguardingReviewed = false;
  campaign.budgetAndTermsReviewed = false;
  campaign.status = 'DRAFT';
  campaign.updatedBy = ctx.actorId;
  campaign.history.push({ fromStatus, toStatus: 'DRAFT', actorId: ctx.actorId, reason: 'CONTENT_CHANGED_REQUIRES_REVIEW', version: campaign.version, at: new Date() });
  await campaign.save();
  await writeAudit(ctx, 'EDUCATION_CAMPAIGN.VERSION_UPDATED', { campaignId: String(campaign._id), version: campaign.version, previousStatus: fromStatus, status: campaign.status });
  return toManagementCampaignDTO(campaign);
}

export async function submitEducationCampaign(campaignId, context = {}) {
  const ctx = contextOf(context);
  const campaign = await findOwnedCampaign(ctx, campaignId);
  await requireVerifiedEducationPartner(ctx.tenantId);
  assertCampaignTransition(campaign.status, 'SUBMITTED');
  appendHistory(campaign, ctx, 'SUBMITTED', 'SUBMITTED_FOR_INDEPENDENT_REVIEW');
  campaign.reviewedVersion = null;
  campaign.reviewerId = null;
  campaign.reviewReason = null;
  campaign.privacyAndSafeguardingReviewed = false;
  campaign.budgetAndTermsReviewed = false;
  await campaign.save();
  await writeAudit(ctx, 'EDUCATION_CAMPAIGN.SUBMITTED', { campaignId: String(campaign._id), version: campaign.version, status: campaign.status });
  return toManagementCampaignDTO(campaign);
}

export async function reviewEducationCampaign(campaignId, payload = {}, context = {}) {
  const ctx = contextOf(context);
  const campaign = await findOwnedCampaign(ctx, campaignId);
  if (campaign.createdBy === ctx.actorId) throw campaignError('The campaign creator cannot approve or reject their own campaign.', 'EDUCATION_CAMPAIGN_SELF_REVIEW_FORBIDDEN', 403);
  const decision = normalizeReviewPayload(payload);
  assertCampaignTransition(campaign.status, decision.decision);
  campaign.reviewerId = ctx.actorId;
  campaign.reviewedVersion = campaign.version;
  campaign.reviewReason = decision.reason;
  campaign.privacyAndSafeguardingReviewed = decision.privacyAndSafeguardingReviewed;
  campaign.budgetAndTermsReviewed = decision.budgetAndTermsReviewed;
  appendHistory(campaign, ctx, decision.decision, decision.reason);
  await campaign.save();
  await writeAudit(ctx, `EDUCATION_CAMPAIGN.${decision.decision}`, { campaignId: String(campaign._id), version: campaign.version, status: campaign.status, reasonProvided: Boolean(decision.reason), privacyAndSafeguardingReviewed: campaign.privacyAndSafeguardingReviewed, budgetAndTermsReviewed: campaign.budgetAndTermsReviewed });
  return toManagementCampaignDTO(campaign);
}

export async function publishEducationCampaign(campaignId, context = {}) {
  const ctx = contextOf(context);
  const campaign = await findOwnedCampaign(ctx, campaignId);
  await requireVerifiedEducationPartner(ctx.tenantId);
  if (campaign.reviewedVersion !== campaign.version || !campaign.reviewerId || campaign.createdBy === campaign.reviewerId || !campaign.privacyAndSafeguardingReviewed || !campaign.budgetAndTermsReviewed) {
    throw campaignError('Publication requires independent approval of the current campaign version and explicit budget/terms and safeguarding attestations.', 'EDUCATION_CAMPAIGN_APPROVAL_REQUIRED', 409);
  }
  assertCampaignTransition(campaign.status, 'PUBLISHED');
  appendHistory(campaign, ctx, 'PUBLISHED', 'PUBLISHED_AFTER_VERIFIED_PARTNER_AND_REVIEW');
  await campaign.save();
  await writeAudit(ctx, 'EDUCATION_CAMPAIGN.PUBLISHED', { campaignId: String(campaign._id), publicReference: campaign.publicReference, version: campaign.version, status: campaign.status });
  return toManagementCampaignDTO(campaign);
}

export async function transitionEducationCampaign(campaignId, targetStatus, payload = {}, context = {}) {
  const ctx = contextOf(context);
  const campaign = await findOwnedCampaign(ctx, campaignId);
  const destination = String(targetStatus ?? '').trim().toUpperCase();
  const reason = String(payload.reason ?? '').trim().slice(0, 1000) || null;
  if (['PAUSED', 'CLOSED'].includes(destination) && !reason) throw campaignError('A reason is required to pause or close a campaign.', 'EDUCATION_CAMPAIGN_REASON_REQUIRED');
  if (destination === 'CLOSED' && campaign.status !== 'PAUSED') throw campaignError('Pause a published campaign before closing it.', 'EDUCATION_CAMPAIGN_CLOSE_REQUIRES_PAUSE', 409);
  if (destination === 'PUBLISHED') await requireVerifiedEducationPartner(ctx.tenantId);
  assertCampaignTransition(campaign.status, destination);
  appendHistory(campaign, ctx, destination, reason || `TRANSITION_TO_${destination}`);
  await campaign.save();
  await writeAudit(ctx, `EDUCATION_CAMPAIGN.${destination}`, { campaignId: String(campaign._id), version: campaign.version, status: campaign.status, reasonProvided: Boolean(reason) });
  return toManagementCampaignDTO(campaign);
}

export async function listPublicEducationCampaigns({ now = new Date() } = {}) {
  const campaigns = await EducationCampaign.find({ status: 'PUBLISHED', startAt: { $lte: now }, endAt: { $gt: now } })
    .sort({ startAt: 1, title: 1 }).limit(100).lean();
  if (!campaigns.length) return [];
  const tenantIds = [...new Set(campaigns.map((item) => item.tenantId))];
  const partnerProfiles = await RefugeeServingOrganisationProfile.find({ tenantId: { $in: tenantIds }, verificationStatus: 'VERIFIED' })
    .select('tenantId legalName programmeScopes verificationStatus')
    .lean();
  const partnerByTenant = new Map(partnerProfiles.map((profile) => [profile.tenantId, profile]));
  return campaigns.filter((campaign) => {
    try { assertEducationPartnerVerified(partnerByTenant.get(campaign.tenantId)); return true; } catch { return false; }
  }).map((campaign) => toPublicCampaignDTO(campaign, partnerByTenant.get(campaign.tenantId)?.legalName));
}

export async function getPublicEducationCampaign(publicReference, { now = new Date() } = {}) {
  const reference = required(publicReference, 'publicReference', 64);
  const campaign = await EducationCampaign.findOne({ publicReference: reference, status: 'PUBLISHED', startAt: { $lte: now }, endAt: { $gt: now } }).lean();
  if (!campaign) throw campaignError('The education campaign was not found or is not currently public.', 'EDUCATION_PUBLIC_CAMPAIGN_NOT_FOUND', 404);
  const partner = await findPartner(campaign.tenantId);
  assertEducationPartnerVerified(partner);
  return toPublicCampaignDTO(campaign, partner.legalName);
}
