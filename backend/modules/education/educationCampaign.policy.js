/**
 * Pure policy contract for TITech Community Capital education campaigns.
 * No database, HTTP, payment, ledger, or external-provider dependencies.
 */

export const EDUCATION_CAMPAIGN_CATEGORIES = Object.freeze([
  'SCHOOL_FEES',
  'EXAMINATION_FEES',
  'SCHOLASTIC_MATERIALS',
  'MEALS_AND_TRANSPORT',
  'VOCATIONAL_TRAINING',
  'UNIVERSITY_SCHOLARSHIP',
  'COMMUNITY_EDUCATION_PROJECT',
]);

export const EDUCATION_COMMUNITY_SCOPES = Object.freeze([
  'COMMUNITY_WIDE',
  'REFUGEE_AND_HOST_COMMUNITIES',
]);

export const EDUCATION_BUDGET_CATEGORIES = Object.freeze([
  'TUITION_AND_FEES',
  'EXAMINATIONS',
  'BOOKS_AND_STATIONERY',
  'LEARNING_DEVICES',
  'UNIFORMS',
  'MEALS',
  'TRANSPORT',
  'VOCATIONAL_TRAINING',
  'SCHOOL_SUPPLIES',
  'ACCESSIBILITY_SUPPORT',
  'OTHER_APPROVED_EDUCATION_COST',
]);

export const EDUCATION_CURRENCIES = Object.freeze(['UGX', 'USD']);

export const EDUCATION_CAMPAIGN_STATES = Object.freeze([
  'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PUBLISHED', 'PAUSED', 'CLOSED',
]);

export const EDUCATION_CAMPAIGN_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['SUBMITTED']),
  SUBMITTED: Object.freeze(['APPROVED', 'REJECTED']),
  APPROVED: Object.freeze(['PUBLISHED']),
  REJECTED: Object.freeze(['DRAFT']),
  PUBLISHED: Object.freeze(['PAUSED']),
  PAUSED: Object.freeze(['DRAFT', 'PUBLISHED', 'CLOSED']),
  CLOSED: Object.freeze([]),
});

export const EDUCATION_PARTNER_SCOPES = Object.freeze([
  'EDUCATION', 'SCHOOLING', 'SCHOLARSHIPS', 'EDUCATION_SUPPORT',
]);

function policyError(message, code, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function hasObviousPublicContactData(value) {
  if (/(?:https?:\/\/|www\.)/i.test(value) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) return true;
  const phoneCandidates = value.match(/(?:^|\s)\+?[0-9][0-9 ().-]{7,}[0-9](?:$|\s)/g) || [];
  return phoneCandidates.some((candidate) => (candidate.match(/\d/g) || []).length >= 10);
}

export function normalizeSafeInteger(value, name, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const candidate = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw policyError(`${name} must be a safe integer within the permitted range.`, 'EDUCATION_AMOUNT_INVALID');
  }
  return candidate;
}

export function validateCampaignInput(payload = {}) {
  const category = String(payload.category ?? '').trim().toUpperCase();
  if (!EDUCATION_CAMPAIGN_CATEGORIES.includes(category)) {
    throw policyError('Select a supported education campaign category.', 'EDUCATION_CATEGORY_INVALID');
  }

  const communityScope = String(payload.communityScope ?? 'COMMUNITY_WIDE').trim().toUpperCase();
  if (!EDUCATION_COMMUNITY_SCOPES.includes(communityScope)) {
    throw policyError('Select a supported community scope.', 'EDUCATION_COMMUNITY_SCOPE_INVALID');
  }

  const currency = String(payload.currency ?? '').trim().toUpperCase();
  if (!EDUCATION_CURRENCIES.includes(currency)) {
    throw policyError('The requested campaign currency is not enabled for this release.', 'EDUCATION_CURRENCY_NOT_ENABLED');
  }

  const targetAmountMinor = normalizeSafeInteger(payload.targetAmountMinor, 'targetAmountMinor', { minimum: 1 });
  if (!Array.isArray(payload.budgetLines) || payload.budgetLines.length < 1 || payload.budgetLines.length > 20) {
    throw policyError('Provide between one and twenty approved budget lines.', 'EDUCATION_BUDGET_LINES_INVALID');
  }

  const budgetLines = payload.budgetLines.map((line, index) => {
    const budgetCategory = String(line?.category ?? '').trim().toUpperCase();
    if (!EDUCATION_BUDGET_CATEGORIES.includes(budgetCategory)) {
      throw policyError(`Budget line ${index + 1} uses an unsupported category.`, 'EDUCATION_BUDGET_CATEGORY_INVALID');
    }
    const description = String(line?.description ?? '').trim();
    if (hasObviousPublicContactData(description)) throw policyError('Budget descriptions must not contain public URLs, email addresses or phone numbers.', 'EDUCATION_PUBLIC_CONTACT_DATA_FORBIDDEN');
    if (!description || description.length > 180) {
      throw policyError(`Budget line ${index + 1} requires a description of at most 180 characters.`, 'EDUCATION_BUDGET_DESCRIPTION_INVALID');
    }
    return {
      category: budgetCategory,
      description,
      amountMinor: normalizeSafeInteger(line?.amountMinor, `budgetLines[${index}].amountMinor`, { minimum: 1 }),
    };
  });

  const budgetTotal = budgetLines.reduce((sum, line) => {
    const next = sum + line.amountMinor;
    if (!Number.isSafeInteger(next)) throw policyError('The budget total exceeds safe monetary precision.', 'EDUCATION_BUDGET_TOTAL_INVALID');
    return next;
  }, 0);
  if (budgetTotal > targetAmountMinor) {
    throw policyError('The approved budget total cannot exceed the campaign target.', 'EDUCATION_BUDGET_EXCEEDS_TARGET');
  }

  const startAt = new Date(payload.startAt);
  const endAt = new Date(payload.endAt);
  if (!payload.startAt || !payload.endAt || !Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
    throw policyError('The campaign end date must be later than its start date.', 'EDUCATION_CAMPAIGN_DATES_INVALID');
  }

  const boundedText = (value, name, minimum, maximum) => {
    const normalized = String(value ?? '').trim();
    if (normalized.length < minimum || normalized.length > maximum) {
      throw policyError(`${name} must contain ${minimum}–${maximum} characters.`, `EDUCATION_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_INVALID`);
    }
    // A conservative screen for obvious contact/link disclosures in fields
    // intended for public display. It is not a substitute for human review.
    if (hasObviousPublicContactData(normalized)) {
      throw policyError(`${name} must not include public URLs, email addresses or phone numbers.`, 'EDUCATION_PUBLIC_CONTACT_DATA_FORBIDDEN');
    }
    return normalized;
  };

  const surplusPolicy = String(payload.surplusPolicy ?? '').trim().toUpperCase();
  const allowedSurplusPolicies = ['REFUND_OR_RETURN', 'DONOR_CONSENT_REQUIRED_REALLOCATION', 'PARTNER_TERMS_REVIEW_REQUIRED'];
  if (!allowedSurplusPolicies.includes(surplusPolicy)) {
    throw policyError('Select an explicit surplus and unused-fund policy.', 'EDUCATION_SURPLUS_POLICY_INVALID');
  }

  return {
    title: boundedText(payload.title, 'title', 5, 120),
    publicDescription: boundedText(payload.publicDescription, 'publicDescription', 30, 2400),
    category,
    communityScope,
    eligibilitySummary: boundedText(payload.eligibilitySummary, 'eligibilitySummary', 10, 1200),
    selectionMethod: boundedText(payload.selectionMethod, 'selectionMethod', 10, 1200),
    targetAmountMinor,
    currency,
    budgetLines,
    startAt,
    endAt,
    feeDisclosure: boundedText(payload.feeDisclosure, 'feeDisclosure', 5, 600),
    refundPolicy: boundedText(payload.refundPolicy, 'refundPolicy', 10, 1200),
    surplusPolicy,
  };
}

export function canTransitionCampaign(from, to) {
  return Boolean(EDUCATION_CAMPAIGN_TRANSITIONS[String(from ?? '').trim().toUpperCase()]?.includes(String(to ?? '').trim().toUpperCase()));
}

export function assertCampaignTransition(from, to) {
  if (!canTransitionCampaign(from, to)) {
    throw policyError(`The education campaign transition from ${String(from)} to ${String(to)} is not permitted.`, 'EDUCATION_CAMPAIGN_TRANSITION_NOT_ALLOWED', 409);
  }
}

export function isEducationPartnerVerified(profile) {
  if (!profile || String(profile.verificationStatus ?? '').toUpperCase() !== 'VERIFIED') return false;
  const scopes = Array.isArray(profile.programmeScopes) ? profile.programmeScopes : [];
  return scopes.some((scope) => EDUCATION_PARTNER_SCOPES.includes(String(scope ?? '').trim().toUpperCase()));
}

export function assertEducationPartnerVerified(profile) {
  if (!isEducationPartnerVerified(profile)) {
    throw policyError('A currently verified partner with an approved education programme scope is required.', 'EDUCATION_PARTNER_NOT_VERIFIED', 403);
  }
  return profile;
}

export function toPublicCampaignDTO(campaign, partnerDisplayName) {
  return Object.freeze({
    id: String(campaign.publicReference),
    title: campaign.title,
    description: campaign.publicDescription,
    category: campaign.category,
    communityScope: campaign.communityScope,
    eligibilitySummary: campaign.eligibilitySummary,
    selectionMethod: campaign.selectionMethod,
    targetAmountMinor: campaign.targetAmountMinor,
    currency: campaign.currency,
    budgetLines: (campaign.budgetLines || []).map((line) => ({
      category: line.category,
      description: line.description,
      amountMinor: line.amountMinor,
    })),
    startAt: campaign.startAt,
    endAt: campaign.endAt,
    feeDisclosure: campaign.feeDisclosure,
    refundPolicy: campaign.refundPolicy,
    surplusPolicy: campaign.surplusPolicy,
    verifiedPartnerName: String(partnerDisplayName || 'Verified institutional partner'),
  });
}

export function toManagementCampaignDTO(campaign) {
  return {
    id: String(campaign._id ?? campaign.id),
    publicReference: campaign.publicReference,
    title: campaign.title,
    publicDescription: campaign.publicDescription,
    category: campaign.category,
    communityScope: campaign.communityScope,
    eligibilitySummary: campaign.eligibilitySummary,
    selectionMethod: campaign.selectionMethod,
    targetAmountMinor: campaign.targetAmountMinor,
    currency: campaign.currency,
    budgetLines: (campaign.budgetLines || []).map((line) => ({ category: line.category, description: line.description, amountMinor: line.amountMinor })),
    startAt: campaign.startAt,
    endAt: campaign.endAt,
    feeDisclosure: campaign.feeDisclosure,
    refundPolicy: campaign.refundPolicy,
    surplusPolicy: campaign.surplusPolicy,
    status: campaign.status,
    version: campaign.version,
    reviewedVersion: campaign.reviewedVersion ?? null,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    history: (campaign.history || []).map((event) => ({
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      reason: event.reason,
      at: event.at,
      version: event.version,
    })),
  };
}
