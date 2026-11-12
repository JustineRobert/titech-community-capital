/**
 * TITech Faith & Community Giving — pure domain policy.
 * This module has no database, HTTP, payment-provider or ledger dependencies.
 */

export const FAITH_GIVING_CATEGORIES = Object.freeze([
  'CHURCH_TITHES_OFFERINGS',
  'THANKSGIVING_DONATIONS',
  'CHURCH_PROJECTS',
  'MISSIONS_AND_MINISTRY',
  'BURIAL_BEREAVEMENT_SUPPORT',
  'WEDDING_AND_TRADITIONAL_INTRODUCTION',
  'COMMUNITY_FUNCTIONS',
  'EMERGENCY_MEDICAL_ASSISTANCE',
  'EDUCATION_AND_SCHOOL_FEES',
  'EDUCATION_RESOURCES_AND_MATERIALS',
  'SCHOOL_COMPUTERS_AND_DIGITAL_ACCESS',
  'SCHOOL_FURNITURE_AND_FACILITIES',
  'SCHOOL_CONSTRUCTION_AND_REHABILITATION',
  'SCHOLARSHIPS_AND_LEARNING_SUPPORT',
  'CHARITY_AND_HUMANITARIAN',
  'COMMUNITY_DEVELOPMENT',
  'COMMUNITY_WELFARE',
  'OTHER_APPROVED_PURPOSE',
]);

export const FAITH_GIVING_ORGANISATION_TYPES = Object.freeze([
  'CHURCH', 'DIOCESE', 'PARISH', 'CONGREGATION', 'MOSQUE', 'RELIGIOUS_INSTITUTION',
  'BURIAL_ASSOCIATION', 'FUNERAL_SUPPORT_ASSOCIATION', 'WEDDING_COMMITTEE',
  'FAMILY_ASSOCIATION', 'CLAN_ASSOCIATION', 'COMMUNITY_GROUP', 'NGO', 'CHARITY',
  'COMMUNITY_DEVELOPMENT_ORGANISATION', 'OTHER_APPROVED_ORGANISATION',
]);

export const FAITH_GIVING_COMMUNITY_SCOPES = Object.freeze([
  'COMMUNITY_WIDE', 'REFUGEE_AND_HOST_COMMUNITIES',
]);

export const FAITH_GIVING_BUDGET_CATEGORIES = Object.freeze([
  'CHURCH_CONSTRUCTION', 'LAND_AND_FACILITIES', 'MISSIONS', 'MINISTRY', 'BENEVOLENCE',
  'FUNERAL_TRANSPORT', 'FUNERAL_SERVICES', 'FOOD_AND_REFRESHMENTS', 'VENUE',
  'CATERING', 'PHOTOGRAPHY', 'DECORATION', 'TRANSPORT', 'ACCOMMODATION',
  'MEDICAL_AND_HOSPITAL', 'EDUCATION_AND_FEES', 'WATER_AND_SANITATION',
  'COMMUNITY_INFRASTRUCTURE', 'ADMINISTRATION',
  'SCHOLASTIC_MATERIALS', 'COMPUTERS_AND_DIGITAL_EQUIPMENT', 'SCHOOL_FURNITURE',
  'LIBRARY_AND_TEXTBOOKS', 'CLASSROOM_EQUIPMENT', 'TEACHING_AND_LEARNING_MATERIALS',
  'ACCESSIBILITY_EQUIPMENT', 'CONSTRUCTION_MATERIALS', 'SCHOOL_REHABILITATION',
  'OTHER_APPROVED_COST',
]);

export const FAITH_GIVING_IN_KIND_CATEGORIES = Object.freeze([
  'SCHOLASTIC_MATERIALS', 'COMPUTERS_AND_DIGITAL_EQUIPMENT', 'SCHOOL_FURNITURE',
  'LIBRARY_AND_TEXTBOOKS', 'CLASSROOM_EQUIPMENT', 'TEACHING_AND_LEARNING_MATERIALS',
  'ACCESSIBILITY_EQUIPMENT', 'CONSTRUCTION_MATERIALS', 'WATER_AND_SANITATION',
  'OTHER_APPROVED_COST',
]);
export const FAITH_GIVING_PLEDGE_TYPES = Object.freeze(['CASH', 'IN_KIND']);
export const FAITH_GIVING_IN_KIND_UNITS = Object.freeze(['PIECE', 'SET', 'BOX', 'PACK', 'BAG', 'KG', 'LITRE', 'UNIT']);
export const FAITH_GIVING_ITEM_CONDITIONS = Object.freeze(['NEW', 'GOOD_USED', 'REFURBISHED', 'NOT_APPLICABLE']);

// UGX is the only enabled collection currency in this release. Additional
// currency support is a configuration and provider-readiness decision, not a
// promise that a provider can collect those currencies today.
export const FAITH_GIVING_CURRENCIES = Object.freeze(['UGX']);

export const FAITH_GIVING_PARTNER_SCOPES = Object.freeze([
  'COMMUNITY_SUPPORT', 'HUMANITARIAN', 'REFUGEE_SUPPORT',
  'REFUGEE_AND_HOST_COMMUNITIES', 'COMMUNITY_WELFARE',
  'FAITH_AND_COMMUNITY_GIVING', 'COMMUNITY_GIVING',
]);

export const FAITH_GIVING_STATES = Object.freeze([
  'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PUBLISHED', 'PAUSED', 'CLOSED',
]);

export const FAITH_GIVING_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['SUBMITTED']),
  SUBMITTED: Object.freeze(['APPROVED', 'REJECTED']),
  APPROVED: Object.freeze(['PUBLISHED']),
  REJECTED: Object.freeze(['DRAFT']),
  PUBLISHED: Object.freeze(['PAUSED']),
  PAUSED: Object.freeze(['PUBLISHED', 'CLOSED']),
  CLOSED: Object.freeze([]),
});

export const FAITH_GIVING_PLEDGE_STATES = Object.freeze(['PLEDGED', 'CANCELLED', 'EXPIRED']);
export const FAITH_GIVING_EXPENSE_STATES = Object.freeze(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED']);

function policyError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function boundedText(value, field, minimum, maximum, { publicText = false } = {}) {
  const normalized = String(value ?? '').trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw policyError(`${field} must contain ${minimum}–${maximum} characters.`, `FAITH_GIVING_${field.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_INVALID`);
  }
  if (publicText && hasObviousContactData(normalized)) {
    throw policyError(`${field} must not contain public URLs, email addresses or phone numbers.`, 'FAITH_GIVING_PUBLIC_CONTACT_DATA_FORBIDDEN', 422);
  }
  return normalized;
}

export function hasObviousContactData(value) {
  const text = String(value ?? '');
  if (/(?:https?:\/\/|www\.)/i.test(text) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return true;
  const candidates = text.match(/(?:^|\s)\+?[0-9][0-9 ().-]{7,}[0-9](?:$|\s)/g) || [];
  return candidates.some((candidate) => (candidate.match(/\d/g) || []).length >= 10);
}

export function isVerifiedFaithGivingPartner(profile) {
  if (!profile || String(profile.verificationStatus ?? '').toUpperCase() !== 'VERIFIED') return false;
  const scopes = Array.isArray(profile.programmeScopes) ? profile.programmeScopes : [];
  return scopes.some((scope) => FAITH_GIVING_PARTNER_SCOPES.includes(String(scope ?? '').trim().toUpperCase()));
}

export function assertVerifiedFaithGivingPartner(profile) {
  if (!isVerifiedFaithGivingPartner(profile)) {
    throw policyError('A currently verified refugee/community-serving partner with an approved humanitarian or community programme scope is required.', 'FAITH_GIVING_PARTNER_NOT_VERIFIED', 403);
  }
  return profile;
}

export function applyFaithGivingBudgetReservation(budgetLines, category, amountMinor, operation = 'RESERVE') {
  const amount = normalizeSafeInteger(amountMinor, 'amountMinor', { minimum: 1 });
  const line = Array.isArray(budgetLines) ? budgetLines.find((item) => item.category === category) : null;
  if (!line) throw policyError('The expense must map to an existing campaign budget line.', 'FAITH_GIVING_EXPENSE_BUDGET_LINE_INVALID', 422);
  const committed = normalizeSafeInteger(line.committedAmountMinor ?? 0, 'committedAmountMinor');
  const budget = normalizeSafeInteger(line.amountMinor, 'budgetLineAmountMinor', { minimum: 1 });
  const action = String(operation).trim().toUpperCase();
  if (action === 'RESERVE') {
    if (amount > budget - committed) throw policyError('Pending and approved expense requests cannot exceed the remaining campaign budget line.', 'FAITH_GIVING_BUDGET_RESERVATION_EXCEEDED', 422);
    line.committedAmountMinor = committed + amount;
  } else if (action === 'RELEASE') {
    if (amount > committed) throw policyError('Budget reservation release exceeds the currently committed amount.', 'FAITH_GIVING_BUDGET_RESERVATION_INTEGRITY_ERROR', 409);
    line.committedAmountMinor = committed - amount;
  } else {
    throw policyError('Budget reservation operation is invalid.', 'FAITH_GIVING_BUDGET_RESERVATION_OPERATION_INVALID');
  }
  return line.committedAmountMinor;
}

export function normalizeSafeInteger(value, name, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const candidate = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw policyError(`${name} must be a safe integer within the permitted range.`, 'FAITH_GIVING_AMOUNT_INVALID', 422);
  }
  return candidate;
}

export function validateFaithGivingCampaignInput(payload = {}) {
  const category = String(payload.category ?? '').trim().toUpperCase();
  if (!FAITH_GIVING_CATEGORIES.includes(category)) throw policyError('Select a supported campaign category.', 'FAITH_GIVING_CATEGORY_INVALID');

  const organisationType = String(payload.organisationType ?? '').trim().toUpperCase();
  if (!FAITH_GIVING_ORGANISATION_TYPES.includes(organisationType)) throw policyError('Select a supported organisation type.', 'FAITH_GIVING_ORGANISATION_TYPE_INVALID');

  const communityScope = String(payload.communityScope ?? 'COMMUNITY_WIDE').trim().toUpperCase();
  if (!FAITH_GIVING_COMMUNITY_SCOPES.includes(communityScope)) throw policyError('Select a supported community scope.', 'FAITH_GIVING_COMMUNITY_SCOPE_INVALID');

  const currency = String(payload.currency ?? 'UGX').trim().toUpperCase();
  if (!FAITH_GIVING_CURRENCIES.includes(currency)) throw policyError('The requested currency is not enabled for this release.', 'FAITH_GIVING_CURRENCY_NOT_ENABLED');

  const targetAmountMinor = normalizeSafeInteger(payload.targetAmountMinor, 'targetAmountMinor', { minimum: 1 });
  if (!Array.isArray(payload.budgetLines) || payload.budgetLines.length < 1 || payload.budgetLines.length > 20) {
    throw policyError('Provide between one and twenty budget lines.', 'FAITH_GIVING_BUDGET_LINES_INVALID');
  }

  const budgetLines = payload.budgetLines.map((line, index) => {
    const budgetCategory = String(line?.category ?? '').trim().toUpperCase();
    if (!FAITH_GIVING_BUDGET_CATEGORIES.includes(budgetCategory)) throw policyError(`Budget line ${index + 1} uses an unsupported category.`, 'FAITH_GIVING_BUDGET_CATEGORY_INVALID');
    return {
      category: budgetCategory,
      description: boundedText(line?.description, `budgetLines[${index}].description`, 2, 180, { publicText: true }),
      amountMinor: normalizeSafeInteger(line?.amountMinor, `budgetLines[${index}].amountMinor`, { minimum: 1 }),
      committedAmountMinor: 0,
    };
  });
  const budgetTotal = budgetLines.reduce((sum, line) => {
    const total = sum + line.amountMinor;
    if (!Number.isSafeInteger(total)) throw policyError('Budget total exceeds safe monetary precision.', 'FAITH_GIVING_BUDGET_TOTAL_INVALID', 422);
    return total;
  }, 0);
  if (budgetTotal > targetAmountMinor) throw policyError('The proposed budget cannot exceed the campaign target.', 'FAITH_GIVING_BUDGET_EXCEEDS_TARGET', 422);

  const startAt = new Date(payload.startAt);
  const endAt = new Date(payload.endAt);
  if (!payload.startAt || !payload.endAt || !Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
    throw policyError('The campaign end date must be later than the start date.', 'FAITH_GIVING_CAMPAIGN_DATES_INVALID', 422);
  }

  const visibility = String(payload.visibility ?? 'PUBLIC').trim().toUpperCase();
  if (!['PUBLIC', 'PRIVATE'].includes(visibility)) throw policyError('Campaign visibility must be PUBLIC or PRIVATE.', 'FAITH_GIVING_VISIBILITY_INVALID');
  const surplusPolicy = String(payload.surplusPolicy ?? '').trim().toUpperCase();
  if (!['REFUND_OR_RETURN', 'DONOR_CONSENT_REQUIRED_REALLOCATION', 'PARTNER_TERMS_REVIEW_REQUIRED'].includes(surplusPolicy)) {
    throw policyError('Select an explicit unused-funds policy.', 'FAITH_GIVING_SURPLUS_POLICY_INVALID');
  }

  return {
    title: boundedText(payload.title, 'title', 5, 120, { publicText: true }),
    organisationName: boundedText(payload.organisationName, 'organisationName', 2, 140, { publicText: true }),
    organisationType,
    category,
    communityScope,
    publicDescription: boundedText(payload.publicDescription, 'publicDescription', 30, 2400, { publicText: true }),
    beneficiarySummary: boundedText(payload.beneficiarySummary, 'beneficiarySummary', 10, 600, { publicText: true }),
    targetAmountMinor,
    currency,
    budgetLines,
    startAt,
    endAt,
    visibility,
    receivingDestinationReference: String(payload.receivingDestinationReference ?? '').trim() || null,
    organiserVerificationReference: String(payload.organiserVerificationReference ?? '').trim() || null,
    partnerAuthorizationReference: String(payload.partnerAuthorizationReference ?? '').trim() || null,
    feeDisclosure: boundedText(payload.feeDisclosure, 'feeDisclosure', 5, 600, { publicText: true }),
    refundPolicy: boundedText(payload.refundPolicy, 'refundPolicy', 10, 1200, { publicText: true }),
    surplusPolicy,
  };
}

export function validateFaithGivingPledgeInput(payload = {}, campaign = {}) {
  const pledgeType = String(payload.pledgeType ?? 'CASH').trim().toUpperCase();
  if (!FAITH_GIVING_PLEDGE_TYPES.includes(pledgeType)) {
    throw policyError('Select either a cash pledge or an in-kind donation offer.', 'FAITH_GIVING_PLEDGE_TYPE_INVALID');
  }
  const anonymous = payload.anonymous === true;
  const contributorLabel = anonymous ? null : (payload.contributorLabel ? boundedText(payload.contributorLabel, 'contributorLabel', 2, 80) : null);

  if (pledgeType === 'CASH') {
    const amountMinor = normalizeSafeInteger(payload.amountMinor, 'amountMinor', { minimum: 1 });
    const currency = String(payload.currency ?? campaign.currency ?? '').trim().toUpperCase();
    if (!FAITH_GIVING_CURRENCIES.includes(currency) || currency !== campaign.currency) {
      throw policyError('Pledge currency must match the campaign currency and be enabled.', 'FAITH_GIVING_PLEDGE_CURRENCY_INVALID', 422);
    }
    if (Array.isArray(payload.items) && payload.items.length) {
      throw policyError('Cash pledges cannot also contain in-kind items.', 'FAITH_GIVING_PLEDGE_PAYLOAD_INVALID', 422);
    }
    return { pledgeType, amountMinor, currency, items: [], contributorLabel, anonymous };
  }

  if (payload.amountMinor !== undefined && payload.amountMinor !== null && payload.amountMinor !== '') {
    throw policyError('In-kind offers must not include a monetary amount.', 'FAITH_GIVING_IN_KIND_AMOUNT_FORBIDDEN', 422);
  }
  if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 10) {
    throw policyError('Provide between one and ten in-kind items.', 'FAITH_GIVING_IN_KIND_ITEMS_INVALID', 422);
  }
  const items = payload.items.map((item, index) => {
    const category = String(item?.category ?? '').trim().toUpperCase();
    if (!FAITH_GIVING_IN_KIND_CATEGORIES.includes(category)) throw policyError(`In-kind item ${index + 1} uses an unsupported donation category.`, 'FAITH_GIVING_IN_KIND_CATEGORY_INVALID', 422);
    const unit = String(item?.unit ?? '').trim().toUpperCase();
    if (!FAITH_GIVING_IN_KIND_UNITS.includes(unit)) throw policyError(`In-kind item ${index + 1} uses an unsupported quantity unit.`, 'FAITH_GIVING_IN_KIND_UNIT_INVALID', 422);
    const condition = String(item?.condition ?? 'NOT_APPLICABLE').trim().toUpperCase();
    if (!FAITH_GIVING_ITEM_CONDITIONS.includes(condition)) throw policyError(`In-kind item ${index + 1} uses an unsupported condition.`, 'FAITH_GIVING_IN_KIND_CONDITION_INVALID', 422);
    return {
      category,
      description: boundedText(item?.description, `items[${index}].description`, 2, 140, { publicText: true }),
      quantity: normalizeSafeInteger(item?.quantity, `items[${index}].quantity`, { minimum: 1, maximum: 100000 }),
      unit,
      condition,
      notes: item?.notes ? boundedText(item.notes, `items[${index}].notes`, 2, 300, { publicText: true }) : null,
    };
  });
  return { pledgeType, amountMinor: null, currency: null, items, contributorLabel, anonymous };
}

export function validateFaithGivingExpenseInput(payload = {}, campaign = {}) {
  const category = String(payload.category ?? '').trim().toUpperCase();
  if (!FAITH_GIVING_BUDGET_CATEGORIES.includes(category)) throw policyError('Select a supported expense category.', 'FAITH_GIVING_EXPENSE_CATEGORY_INVALID');
  const amountMinor = normalizeSafeInteger(payload.amountMinor, 'amountMinor', { minimum: 1 });
  const currency = String(payload.currency ?? campaign.currency ?? '').trim().toUpperCase();
  if (currency !== campaign.currency) throw policyError('Expense currency must match the campaign currency.', 'FAITH_GIVING_EXPENSE_CURRENCY_INVALID', 422);
  return {
    category,
    amountMinor,
    currency,
    description: boundedText(payload.description, 'description', 5, 500),
    payeeLabel: boundedText(payload.payeeLabel, 'payeeLabel', 2, 120),
    evidenceReference: boundedText(payload.evidenceReference, 'evidenceReference', 4, 128),
  };
}

export function normalizeFaithGivingReview(payload = {}, campaign = {}) {
  const decision = String(payload.decision ?? '').trim().toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(decision)) throw policyError('Review decision must be APPROVED or REJECTED.', 'FAITH_GIVING_REVIEW_DECISION_INVALID');
  const reason = String(payload.reason ?? '').trim().slice(0, 1000) || null;
  if (decision === 'REJECTED' && !reason) throw policyError('A reason is required when rejecting a campaign.', 'FAITH_GIVING_REVIEW_REASON_REQUIRED');
  if (decision === 'APPROVED') {
    for (const field of ['organiserAuthorityReviewed', 'privacyAndSafeguardingReviewed', 'budgetAndTermsReviewed']) {
      if (payload[field] !== true) throw policyError(`Approval requires ${field}.`, 'FAITH_GIVING_REVIEW_ATTESTATIONS_REQUIRED', 422);
    }
    if (campaign.communityScope === 'REFUGEE_AND_HOST_COMMUNITIES') {
      if (payload.partnerSafeguardingReviewed !== true) {
        throw policyError('Refugee and host-community campaigns require an explicit partner safeguarding attestation.', 'FAITH_GIVING_REVIEW_ATTESTATIONS_REQUIRED', 422);
      }
      if (!campaign.partnerAuthorizationReference) {
        throw policyError('Refugee and host-community campaigns require a partner authorization evidence reference.', 'FAITH_GIVING_PARTNER_REVIEW_REQUIRED', 422);
      }
    }
  }
  return {
    decision,
    reason,
    organiserAuthorityReviewed: decision === 'APPROVED' && payload.organiserAuthorityReviewed === true,
    privacyAndSafeguardingReviewed: decision === 'APPROVED' && payload.privacyAndSafeguardingReviewed === true,
    budgetAndTermsReviewed: decision === 'APPROVED' && payload.budgetAndTermsReviewed === true,
    partnerSafeguardingReviewed: decision === 'APPROVED' && payload.partnerSafeguardingReviewed === true,
  };
}

export function canTransitionFaithGivingCampaign(from, to) {
  return Boolean(FAITH_GIVING_TRANSITIONS[String(from ?? '').trim().toUpperCase()]?.includes(String(to ?? '').trim().toUpperCase()));
}

export function assertFaithGivingCampaignTransition(from, to) {
  if (!canTransitionFaithGivingCampaign(from, to)) {
    throw policyError(`Campaign transition from ${String(from)} to ${String(to)} is not permitted.`, 'FAITH_GIVING_TRANSITION_NOT_ALLOWED', 409);
  }
}

export function toFaithGivingManagementDTO(campaign) {
  return {
    id: String(campaign._id ?? campaign.id),
    publicReference: campaign.publicReference,
    title: campaign.title,
    organisationName: campaign.organisationName,
    organisationType: campaign.organisationType,
    category: campaign.category,
    communityScope: campaign.communityScope,
    publicDescription: campaign.publicDescription,
    beneficiarySummary: campaign.beneficiarySummary,
    targetAmountMinor: campaign.targetAmountMinor,
    currency: campaign.currency,
    budgetLines: (campaign.budgetLines || []).map((line) => ({ category: line.category, description: line.description, amountMinor: line.amountMinor, committedAmountMinor: Number(line.committedAmountMinor || 0) })),
    startAt: campaign.startAt,
    endAt: campaign.endAt,
    visibility: campaign.visibility,
    receivingDestinationReference: campaign.receivingDestinationReference || null,
    organiserVerificationReference: campaign.organiserVerificationReference || null,
    partnerAuthorizationReference: campaign.partnerAuthorizationReference || null,
    feeDisclosure: campaign.feeDisclosure,
    refundPolicy: campaign.refundPolicy,
    surplusPolicy: campaign.surplusPolicy,
    status: campaign.status,
    version: campaign.version,
    reviewedVersion: campaign.reviewedVersion ?? null,
    reviewerId: campaign.reviewerId || null,
    reviewReason: campaign.reviewReason || null,
    reviewAttestations: {
      organiserAuthorityReviewed: campaign.organiserAuthorityReviewed === true,
      privacyAndSafeguardingReviewed: campaign.privacyAndSafeguardingReviewed === true,
      budgetAndTermsReviewed: campaign.budgetAndTermsReviewed === true,
      partnerSafeguardingReviewed: campaign.partnerSafeguardingReviewed === true,
    },
    history: (campaign.history || []).map((item) => ({ fromStatus: item.fromStatus, toStatus: item.toStatus, reason: item.reason, at: item.at, version: item.version })),
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
}

export function toFaithGivingPublicDTO(campaign) {
  return Object.freeze({
    id: String(campaign.publicReference),
    title: campaign.title,
    organisationName: campaign.organisationName,
    organisationType: campaign.organisationType,
    category: campaign.category,
    communityScope: campaign.communityScope,
    description: campaign.publicDescription,
    beneficiarySummary: campaign.beneficiarySummary,
    targetAmountMinor: campaign.targetAmountMinor,
    currency: campaign.currency,
    budgetLines: (campaign.budgetLines || []).map((line) => ({ category: line.category, description: line.description, amountMinor: line.amountMinor })),
    startAt: campaign.startAt,
    endAt: campaign.endAt,
    feeDisclosure: campaign.feeDisclosure,
    refundPolicy: campaign.refundPolicy,
    surplusPolicy: campaign.surplusPolicy,
    verificationNotice: 'Campaign organizer and evidence were reviewed within TITech workflow. This is not a statutory, charitable, insurer or regulatory certification.',
    collectionStatus: 'NOT_ENABLED',
  });
}
