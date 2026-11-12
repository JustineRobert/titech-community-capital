import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import FaithGivingCampaign from './models/FaithGivingCampaign.js';
import FaithGivingPledge from './models/FaithGivingPledge.js';
import FaithGivingExpenseRequest from './models/FaithGivingExpenseRequest.js';
import RefugeeServingOrganisationProfile from '../refugee-partners/models/RefugeeServingOrganisationProfile.js';
import { createAuditLog } from '../audit/audit.service.js';
import {
  applyFaithGivingBudgetReservation,
  assertFaithGivingCampaignTransition,
  assertVerifiedFaithGivingPartner,
  isVerifiedFaithGivingPartner,
  normalizeFaithGivingReview,
  toFaithGivingManagementDTO,
  toFaithGivingPublicDTO,
  validateFaithGivingCampaignInput,
  validateFaithGivingExpenseInput,
  validateFaithGivingPledgeInput,
} from './faithGiving.policy.js';

function domainError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function required(value, name, maximum = 128) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw domainError(`${name} is required.`, `FAITH_GIVING_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_REQUIRED`);
  if (normalized.length > maximum) throw domainError(`${name} exceeds the permitted length.`, `FAITH_GIVING_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_TOO_LONG`);
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

function validateObjectId(id, label) {
  const value = String(id ?? '').trim();
  if (!mongoose.isValidObjectId(value)) throw domainError(`${label} identifier is invalid.`, `FAITH_GIVING_${label.toUpperCase()}_ID_INVALID`, 400);
  return value;
}

async function withAuditTransaction(operation) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await operation(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

async function writeAudit(ctx, action, data, session) {
  await createAuditLog({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action,
    data,
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
    session,
  });
}

async function requireVerifiedPartnerForCommunityScope(campaign, tenantId, session = null) {
  if (campaign.communityScope !== 'REFUGEE_AND_HOST_COMMUNITIES') return null;
  const query = RefugeeServingOrganisationProfile.findOne({ tenantId, verificationStatus: 'VERIFIED' })
    .select('tenantId legalName verificationStatus programmeScopes verifiedBy verifiedAt dataSharingAgreementReference');
  if (session) query.session(session);
  const partner = await query.lean();
  return assertVerifiedFaithGivingPartner(partner);
}

async function findOwnedCampaign(ctx, campaignId, session = null) {
  const query = FaithGivingCampaign.findOne({ tenantId: ctx.tenantId, _id: validateObjectId(campaignId, 'campaign') });
  if (session) query.session(session);
  const campaign = await query;
  if (!campaign) throw domainError('Campaign was not found in this organisation.', 'FAITH_GIVING_CAMPAIGN_NOT_FOUND', 404);
  return campaign;
}

function appendCampaignHistory(campaign, ctx, nextStatus, reason = null) {
  const previous = campaign.status;
  campaign.status = nextStatus;
  campaign.updatedBy = ctx.actorId;
  campaign.history.push({ fromStatus: previous, toStatus: nextStatus, actorId: ctx.actorId, reason, version: campaign.version, at: new Date() });
}

function assertCampaignIsCollectible(campaign, now = new Date()) {
  if (campaign.status !== 'PUBLISHED' || campaign.startAt > now || campaign.endAt <= now) {
    throw domainError('Pledges are accepted only for an active, published campaign.', 'FAITH_GIVING_CAMPAIGN_NOT_OPEN', 409);
  }
}

function toPledgeDTO(pledge) {
  return {
    id: String(pledge._id ?? pledge.id),
    publicReference: pledge.publicReference,
    campaignId: String(pledge.campaignId),
    pledgeType: pledge.pledgeType || 'CASH',
    amountMinor: pledge.amountMinor ?? null,
    currency: pledge.currency ?? null,
    items: (pledge.items || []).map((item) => ({ category: item.category, description: item.description, quantity: item.quantity, unit: item.unit, condition: item.condition, notes: item.notes || null })),
    contributorLabel: pledge.anonymous ? null : pledge.contributorLabel,
    anonymous: pledge.anonymous,
    status: pledge.status,
    createdAt: pledge.createdAt,
  };
}

function toExpenseDTO(expense) {
  return {
    id: String(expense._id ?? expense.id),
    publicReference: expense.publicReference,
    campaignId: String(expense.campaignId),
    category: expense.category,
    description: expense.description,
    payeeLabel: expense.payeeLabel,
    evidenceReference: expense.evidenceReference,
    amountMinor: expense.amountMinor,
    currency: expense.currency,
    status: expense.status,
    requestedBy: expense.requestedBy,
    reviewerId: expense.reviewerId || null,
    reviewReason: expense.reviewReason || null,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  };
}

function pickCampaignInput(payload = {}) {
  return validateFaithGivingCampaignInput({
    title: payload.title,
    organisationName: payload.organisationName,
    organisationType: payload.organisationType,
    category: payload.category,
    communityScope: payload.communityScope,
    publicDescription: payload.publicDescription,
    beneficiarySummary: payload.beneficiarySummary,
    targetAmountMinor: payload.targetAmountMinor,
    currency: payload.currency,
    budgetLines: payload.budgetLines,
    startAt: payload.startAt,
    endAt: payload.endAt,
    visibility: payload.visibility,
    receivingDestinationReference: payload.receivingDestinationReference,
    organiserVerificationReference: payload.organiserVerificationReference,
    partnerAuthorizationReference: payload.partnerAuthorizationReference,
    feeDisclosure: payload.feeDisclosure,
    refundPolicy: payload.refundPolicy,
    surplusPolicy: payload.surplusPolicy,
  });
}

export async function createFaithGivingCampaign(payload = {}, context = {}) {
  const ctx = contextOf(context);
  const input = pickCampaignInput(payload);
  return withAuditTransaction(async (session) => {
    const campaign = new FaithGivingCampaign({
      ...input,
      tenantId: ctx.tenantId,
      publicReference: randomUUID(),
      status: 'DRAFT',
      version: 1,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
      history: [{ fromStatus: null, toStatus: 'DRAFT', actorId: ctx.actorId, reason: 'CAMPAIGN_CREATED', version: 1, at: new Date() }],
    });
    await campaign.save({ session });
    await writeAudit(ctx, 'FAITH_GIVING.CAMPAIGN_DRAFT_CREATED', { campaignId: String(campaign._id), publicReference: campaign.publicReference, category: campaign.category, version: campaign.version }, session);
    return toFaithGivingManagementDTO(campaign);
  });
}

export async function listFaithGivingCampaigns(context = {}) {
  const ctx = contextOf(context);
  const campaigns = await FaithGivingCampaign.find({ tenantId: ctx.tenantId }).sort({ updatedAt: -1, _id: -1 }).limit(100).lean();
  return campaigns.map(toFaithGivingManagementDTO);
}

export async function updateFaithGivingCampaign(campaignId, payload = {}, context = {}) {
  const ctx = contextOf(context);
  return withAuditTransaction(async (session) => {
    const campaign = await findOwnedCampaign(ctx, campaignId, session);
    const expectedVersion = Number(payload.expectedVersion);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== campaign.version) throw domainError('Campaign changed after it was loaded. Refresh and retry.', 'FAITH_GIVING_VERSION_CONFLICT', 409);
    if (!['DRAFT', 'REJECTED', 'APPROVED'].includes(campaign.status)) throw domainError('This campaign cannot be edited in its current state.', 'FAITH_GIVING_EDIT_NOT_ALLOWED', 409);
    const input = pickCampaignInput(payload);
    Object.assign(campaign, input);
    const previous = campaign.status;
    campaign.version += 1;
    campaign.status = 'DRAFT';
    campaign.reviewedVersion = null;
    campaign.reviewerId = null;
    campaign.reviewReason = null;
    campaign.organiserAuthorityReviewed = false;
    campaign.privacyAndSafeguardingReviewed = false;
    campaign.budgetAndTermsReviewed = false;
    campaign.partnerSafeguardingReviewed = false;
    campaign.updatedBy = ctx.actorId;
    campaign.history.push({ fromStatus: previous, toStatus: 'DRAFT', actorId: ctx.actorId, reason: 'CAMPAIGN_CONTENT_CHANGED_REQUIRES_REVIEW', version: campaign.version, at: new Date() });
    await campaign.save({ session });
    await writeAudit(ctx, 'FAITH_GIVING.CAMPAIGN_VERSION_UPDATED', { campaignId: String(campaign._id), version: campaign.version, previousStatus: previous }, session);
    return toFaithGivingManagementDTO(campaign);
  });
}

export async function submitFaithGivingCampaign(campaignId, context = {}) {
  const ctx = contextOf(context);
  return withAuditTransaction(async (session) => {
    const campaign = await findOwnedCampaign(ctx, campaignId, session);
    await requireVerifiedPartnerForCommunityScope(campaign, ctx.tenantId, session);
    assertFaithGivingCampaignTransition(campaign.status, 'SUBMITTED');
    appendCampaignHistory(campaign, ctx, 'SUBMITTED', 'SUBMITTED_FOR_INDEPENDENT_REVIEW');
    campaign.reviewedVersion = null;
    campaign.reviewerId = null;
    campaign.reviewReason = null;
    campaign.organiserAuthorityReviewed = false;
    campaign.privacyAndSafeguardingReviewed = false;
    campaign.budgetAndTermsReviewed = false;
    campaign.partnerSafeguardingReviewed = false;
    await campaign.save({ session });
    await writeAudit(ctx, 'FAITH_GIVING.CAMPAIGN_SUBMITTED', { campaignId: String(campaign._id), version: campaign.version }, session);
    return toFaithGivingManagementDTO(campaign);
  });
}

export async function reviewFaithGivingCampaign(campaignId, payload = {}, context = {}) {
  const ctx = contextOf(context);
  return withAuditTransaction(async (session) => {
    const campaign = await findOwnedCampaign(ctx, campaignId, session);
    if (campaign.createdBy === ctx.actorId) throw domainError('Campaign creators cannot review their own campaigns.', 'FAITH_GIVING_SELF_REVIEW_FORBIDDEN', 403);
    if (campaign.status !== 'SUBMITTED') throw domainError('Only submitted campaigns can be reviewed.', 'FAITH_GIVING_REVIEW_STATE_INVALID', 409);
    const review = normalizeFaithGivingReview(payload, campaign);
    assertFaithGivingCampaignTransition(campaign.status, review.decision);
    if (review.decision === 'APPROVED' && (!campaign.receivingDestinationReference || !campaign.organiserVerificationReference)) {
      throw domainError('Approval requires reviewed references to the institution-controlled receiving destination and organizer verification evidence.', 'FAITH_GIVING_EVIDENCE_REFERENCES_REQUIRED', 422);
    }
    campaign.reviewerId = ctx.actorId;
    campaign.reviewedVersion = campaign.version;
    campaign.reviewReason = review.reason;
    campaign.organiserAuthorityReviewed = review.organiserAuthorityReviewed;
    campaign.privacyAndSafeguardingReviewed = review.privacyAndSafeguardingReviewed;
    campaign.budgetAndTermsReviewed = review.budgetAndTermsReviewed;
    campaign.partnerSafeguardingReviewed = review.partnerSafeguardingReviewed;
    appendCampaignHistory(campaign, ctx, review.decision, review.reason);
    await campaign.save({ session });
    await writeAudit(ctx, `FAITH_GIVING.CAMPAIGN_${review.decision}`, { campaignId: String(campaign._id), version: campaign.version, reasonProvided: Boolean(review.reason), partnerSafeguardingReviewed: campaign.partnerSafeguardingReviewed }, session);
    return toFaithGivingManagementDTO(campaign);
  });
}

export async function publishFaithGivingCampaign(campaignId, context = {}) {
  const ctx = contextOf(context);
  return withAuditTransaction(async (session) => {
    const campaign = await findOwnedCampaign(ctx, campaignId, session);
    await requireVerifiedPartnerForCommunityScope(campaign, ctx.tenantId, session);
    if (campaign.reviewedVersion !== campaign.version || !campaign.reviewerId || campaign.reviewerId === campaign.createdBy) throw domainError('Publication requires independent approval of the current campaign version.', 'FAITH_GIVING_APPROVAL_REQUIRED', 409);
    if (!campaign.receivingDestinationReference || !campaign.organiserVerificationReference) throw domainError('Publication requires reviewed organizer and receiving-destination evidence references.', 'FAITH_GIVING_EVIDENCE_REFERENCES_REQUIRED', 422);
    if (campaign.communityScope === 'REFUGEE_AND_HOST_COMMUNITIES' && (!campaign.partnerAuthorizationReference || !campaign.partnerSafeguardingReviewed)) throw domainError('Publication requires authorized partner evidence and refugee/host-community safeguarding review.', 'FAITH_GIVING_PARTNER_REVIEW_REQUIRED', 422);
    if (campaign.visibility === 'PUBLIC' && campaign.beneficiarySummary.length < 10) throw domainError('A safe public beneficiary summary is required.', 'FAITH_GIVING_BENEFICIARY_SUMMARY_REQUIRED', 422);
    assertFaithGivingCampaignTransition(campaign.status, 'PUBLISHED');
    appendCampaignHistory(campaign, ctx, 'PUBLISHED', 'PUBLISHED_AFTER_INDEPENDENT_REVIEW');
    await campaign.save({ session });
    await writeAudit(ctx, 'FAITH_GIVING.CAMPAIGN_PUBLISHED', { campaignId: String(campaign._id), publicReference: campaign.publicReference, version: campaign.version, visibility: campaign.visibility }, session);
    return toFaithGivingManagementDTO(campaign);
  });
}

export async function transitionFaithGivingCampaign(campaignId, nextStatus, payload = {}, context = {}) {
  const ctx = contextOf(context);
  return withAuditTransaction(async (session) => {
    const campaign = await findOwnedCampaign(ctx, campaignId, session);
    const destination = String(nextStatus ?? '').trim().toUpperCase();
    const reason = String(payload.reason ?? '').trim().slice(0, 1000) || null;
    if (['PAUSED', 'CLOSED'].includes(destination) && !reason) throw domainError('A reason is required to pause or close a campaign.', 'FAITH_GIVING_REASON_REQUIRED', 422);
    if (destination === 'CLOSED' && campaign.status !== 'PAUSED') throw domainError('Pause a published campaign before closing it.', 'FAITH_GIVING_CLOSE_REQUIRES_PAUSE', 409);
    assertFaithGivingCampaignTransition(campaign.status, destination);
    appendCampaignHistory(campaign, ctx, destination, reason);
    await campaign.save({ session });
    await writeAudit(ctx, `FAITH_GIVING.CAMPAIGN_${destination}`, { campaignId: String(campaign._id), version: campaign.version, reasonProvided: Boolean(reason) }, session);
    return toFaithGivingManagementDTO(campaign);
  });
}

export async function listPublicFaithGivingCampaigns({ now = new Date() } = {}) {
  const campaigns = await FaithGivingCampaign.find({
    status: 'PUBLISHED', visibility: 'PUBLIC', startAt: { $lte: now }, endAt: { $gt: now },
  }).sort({ startAt: 1, title: 1 }).limit(100).lean();
  const refugeeScoped = campaigns.filter((campaign) => campaign.communityScope === 'REFUGEE_AND_HOST_COMMUNITIES');
  if (!refugeeScoped.length) return campaigns.map(toFaithGivingPublicDTO);
  const tenantIds = [...new Set(refugeeScoped.map((campaign) => campaign.tenantId))];
  const profiles = await RefugeeServingOrganisationProfile.find({ tenantId: { $in: tenantIds }, verificationStatus: 'VERIFIED' })
    .select('tenantId verificationStatus programmeScopes')
    .lean();
  const verifiedTenantIds = new Set(profiles.filter(isVerifiedFaithGivingPartner).map((profile) => profile.tenantId));
  return campaigns
    .filter((campaign) => campaign.communityScope !== 'REFUGEE_AND_HOST_COMMUNITIES' || verifiedTenantIds.has(campaign.tenantId))
    .map(toFaithGivingPublicDTO);
}

export async function getPublicFaithGivingCampaign(publicReference, { now = new Date() } = {}) {
  const reference = required(publicReference, 'publicReference', 64);
  const campaign = await FaithGivingCampaign.findOne({
    publicReference: reference, status: 'PUBLISHED', visibility: 'PUBLIC', startAt: { $lte: now }, endAt: { $gt: now },
  }).lean();
  if (!campaign) throw domainError('Campaign was not found or is not currently public.', 'FAITH_GIVING_PUBLIC_CAMPAIGN_NOT_FOUND', 404);
  if (campaign.communityScope === 'REFUGEE_AND_HOST_COMMUNITIES') {
    const profile = await RefugeeServingOrganisationProfile.findOne({ tenantId: campaign.tenantId, verificationStatus: 'VERIFIED' })
      .select('tenantId verificationStatus programmeScopes')
      .lean();
    if (!isVerifiedFaithGivingPartner(profile)) throw domainError('The campaign is not currently eligible for public display because its institutional partner verification is inactive.', 'FAITH_GIVING_PARTNER_NOT_VERIFIED', 403);
  }
  return toFaithGivingPublicDTO(campaign);
}

export async function createFaithGivingPledge(campaignId, payload = {}, idempotencyKey, context = {}) {
  const ctx = contextOf(context);
  const key = required(idempotencyKey, 'Idempotency-Key', 128);
  const campaignObjectId = validateObjectId(campaignId, 'campaign');
  const intentMatches = (pledge, input, ownedCampaignId) => (
    String(pledge.campaignId) === String(ownedCampaignId)
    && (pledge.pledgeType || 'CASH') === input.pledgeType
    && (pledge.amountMinor ?? null) === input.amountMinor
    && (pledge.currency ?? null) === input.currency
    && JSON.stringify(pledge.items || []) === JSON.stringify(input.items || [])
    && pledge.anonymous === input.anonymous
    && (pledge.contributorLabel || null) === (input.contributorLabel || null)
  );
  try {
    return await withAuditTransaction(async (session) => {
      const campaign = await findOwnedCampaign(ctx, campaignObjectId, session);
      assertCampaignIsCollectible(campaign);
      await requireVerifiedPartnerForCommunityScope(campaign, ctx.tenantId, session);
      const input = validateFaithGivingPledgeInput(payload, campaign);
      const previous = await FaithGivingPledge.findOne({ tenantId: ctx.tenantId, idempotencyKey: key }).session(session);
      if (previous) {
        if (!intentMatches(previous, input, campaign._id)) throw domainError('Idempotency-Key was already used for a different pledge.', 'FAITH_GIVING_IDEMPOTENCY_CONFLICT', 409);
        return toPledgeDTO(previous);
      }
      const pledge = new FaithGivingPledge({
        ...input,
        tenantId: ctx.tenantId,
        campaignId: campaign._id,
        publicReference: randomUUID(),
        idempotencyKey: key,
        status: 'PLEDGED',
        createdBy: ctx.actorId,
      });
      await pledge.save({ session });
      await writeAudit(ctx, 'FAITH_GIVING.PLEDGE_RECORDED', {
        campaignId: String(campaign._id), pledgeId: String(pledge._id), pledgeType: pledge.pledgeType,
        amountMinor: pledge.amountMinor ?? null, currency: pledge.currency ?? null,
        itemCount: pledge.items?.length || 0, status: pledge.status,
      }, session);
      return toPledgeDTO(pledge);
    });
  } catch (error) {
    if (error?.code !== 11000 && error?.name !== 'MongoServerError') throw error;
    const existing = await FaithGivingPledge.findOne({ tenantId: ctx.tenantId, idempotencyKey: key }).lean();
    if (!existing) throw error;
    const campaign = await findOwnedCampaign(ctx, campaignObjectId);
    const input = validateFaithGivingPledgeInput(payload, campaign);
    if (!intentMatches(existing, input, campaign._id)) throw domainError('Idempotency-Key was already used for a different pledge.', 'FAITH_GIVING_IDEMPOTENCY_CONFLICT', 409);
    return toPledgeDTO(existing);
  }
}

export async function createPublicFaithGivingPledge(publicReference, payload = {}, idempotencyKey, context = {}) {
  const ctx = contextOf(context);
  const reference = required(publicReference, 'publicReference', 64);
  const campaign = await FaithGivingCampaign.findOne({ tenantId: ctx.tenantId, publicReference: reference, visibility: 'PUBLIC' }).select('_id').lean();
  if (!campaign) throw domainError('The public campaign is not available for pledges within the signed-in institution.', 'FAITH_GIVING_CAMPAIGN_NOT_FOUND', 404);
  return createFaithGivingPledge(String(campaign._id), payload, idempotencyKey, ctx);
}

export async function listFaithGivingPledges(campaignId, context = {}) {
  const ctx = contextOf(context);
  const campaign = await findOwnedCampaign(ctx, campaignId);
  const pledges = await FaithGivingPledge.find({ tenantId: ctx.tenantId, campaignId: campaign._id }).sort({ createdAt: -1 }).limit(500).lean();
  return pledges.map(toPledgeDTO);
}

export async function cancelFaithGivingPledge(campaignId, pledgeId, context = {}) {
  const ctx = contextOf(context);
  return withAuditTransaction(async (session) => {
    const campaign = await findOwnedCampaign(ctx, campaignId, session);
    const pledge = await FaithGivingPledge.findOne({ tenantId: ctx.tenantId, campaignId: campaign._id, _id: validateObjectId(pledgeId, 'pledge') }).session(session);
    if (!pledge) throw domainError('Pledge was not found in this campaign.', 'FAITH_GIVING_PLEDGE_NOT_FOUND', 404);
    if (pledge.createdBy !== ctx.actorId) throw domainError('Only the pledge creator may cancel this pledge.', 'FAITH_GIVING_PLEDGE_OWNER_REQUIRED', 403);
    if (pledge.status !== 'PLEDGED') throw domainError('Only an outstanding pledge may be cancelled.', 'FAITH_GIVING_PLEDGE_STATE_INVALID', 409);
    pledge.status = 'CANCELLED';
    pledge.cancelledBy = ctx.actorId;
    pledge.cancelledAt = new Date();
    await pledge.save({ session });
    await writeAudit(ctx, 'FAITH_GIVING.PLEDGE_CANCELLED', { campaignId: String(campaign._id), pledgeId: String(pledge._id) }, session);
    return toPledgeDTO(pledge);
  });
}

export async function createFaithGivingExpenseRequest(campaignId, payload = {}, context = {}) {
  const ctx = contextOf(context);
  return withAuditTransaction(async (session) => {
    const campaign = await findOwnedCampaign(ctx, campaignId, session);
    if (!['PUBLISHED', 'PAUSED'].includes(campaign.status)) throw domainError('Expense requests require a published or paused campaign.', 'FAITH_GIVING_EXPENSE_CAMPAIGN_STATE_INVALID', 409);
    const input = validateFaithGivingExpenseInput(payload, campaign);
    applyFaithGivingBudgetReservation(campaign.budgetLines, input.category, input.amountMinor, 'RESERVE');
    await campaign.save({ session });
    const expense = new FaithGivingExpenseRequest({
      ...input,
      tenantId: ctx.tenantId,
      campaignId: campaign._id,
      publicReference: randomUUID(),
      status: 'PENDING_APPROVAL',
      requestedBy: ctx.actorId,
      history: [{ fromStatus: null, toStatus: 'PENDING_APPROVAL', actorId: ctx.actorId, reason: 'EXPENSE_REQUEST_CREATED', at: new Date() }],
    });
    await expense.save({ session });
    await writeAudit(ctx, 'FAITH_GIVING.EXPENSE_REQUEST_CREATED', { campaignId: String(campaign._id), expenseId: String(expense._id), amountMinor: expense.amountMinor, category: expense.category }, session);
    return toExpenseDTO(expense);
  });
}

export async function listFaithGivingExpenseRequests(campaignId, context = {}) {
  const ctx = contextOf(context);
  const campaign = await findOwnedCampaign(ctx, campaignId);
  const expenses = await FaithGivingExpenseRequest.find({ tenantId: ctx.tenantId, campaignId: campaign._id }).sort({ createdAt: -1 }).limit(500).lean();
  return expenses.map(toExpenseDTO);
}

export async function reviewFaithGivingExpenseRequest(campaignId, expenseId, payload = {}, context = {}) {
  const ctx = contextOf(context);
  return withAuditTransaction(async (session) => {
    const campaign = await findOwnedCampaign(ctx, campaignId, session);
    const expense = await FaithGivingExpenseRequest.findOne({ tenantId: ctx.tenantId, campaignId: campaign._id, _id: validateObjectId(expenseId, 'expense') }).session(session);
    if (!expense) throw domainError('Expense request was not found in this campaign.', 'FAITH_GIVING_EXPENSE_NOT_FOUND', 404);
    if (expense.requestedBy === ctx.actorId) throw domainError('The requester cannot approve or reject their own expense request.', 'FAITH_GIVING_EXPENSE_SELF_REVIEW_FORBIDDEN', 403);
    if (expense.status !== 'PENDING_APPROVAL') throw domainError('Only pending expense requests may be reviewed.', 'FAITH_GIVING_EXPENSE_STATE_INVALID', 409);
    const decision = String(payload.decision ?? '').trim().toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw domainError('Decision must be APPROVED or REJECTED.', 'FAITH_GIVING_EXPENSE_DECISION_INVALID', 400);
    const reason = String(payload.reason ?? '').trim().slice(0, 1000) || null;
    if (decision === 'REJECTED' && !reason) throw domainError('A reason is required when rejecting an expense request.', 'FAITH_GIVING_EXPENSE_REASON_REQUIRED', 422);
    const previous = expense.status;
    if (decision === 'REJECTED') {
      applyFaithGivingBudgetReservation(campaign.budgetLines, expense.category, expense.amountMinor, 'RELEASE');
      await campaign.save({ session });
    }
    expense.status = decision;
    expense.reviewerId = ctx.actorId;
    expense.reviewReason = reason;
    expense.history.push({ fromStatus: previous, toStatus: decision, actorId: ctx.actorId, reason, at: new Date() });
    await expense.save({ session });
    await writeAudit(ctx, `FAITH_GIVING.EXPENSE_REQUEST_${decision}`, { campaignId: String(campaign._id), expenseId: String(expense._id), amountMinor: expense.amountMinor, reasonProvided: Boolean(reason) }, session);
    return toExpenseDTO(expense);
  });
}
