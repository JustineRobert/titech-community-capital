import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCampaignTransition,
  assertEducationPartnerVerified,
  canTransitionCampaign,
  isEducationPartnerVerified,
  toPublicCampaignDTO,
  validateCampaignInput,
} from '../../../modules/education/educationCampaign.policy.js';

const validCampaign = () => ({
  title: 'Community school fees support',
  publicDescription: 'Verified education assistance for learners through an approved institution.',
  category: 'SCHOOL_FEES',
  communityScope: 'REFUGEE_AND_HOST_COMMUNITIES',
  eligibilitySummary: 'An institution reviews eligibility using published criteria.',
  selectionMethod: 'Two authorised institutional reviewers record a reasoned decision.',
  targetAmountMinor: 1000000,
  currency: 'UGX',
  budgetLines: [{ category: 'TUITION_AND_FEES', description: 'Approved school fees', amountMinor: 800000 }],
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2026-12-31T23:59:59.000Z',
  feeDisclosure: 'No platform fees are charged by this workflow.',
  refundPolicy: 'No funds are collected; partner-approved return policy applies before fundraising.',
  surplusPolicy: 'PARTNER_TERMS_REVIEW_REQUIRED',
});

test('accepts safe integer campaign target and budget in allowlisted currency', () => {
  const normalized = validateCampaignInput(validCampaign());
  assert.equal(normalized.targetAmountMinor, 1000000);
  assert.equal(normalized.budgetLines[0].amountMinor, 800000);
  assert.equal(normalized.communityScope, 'REFUGEE_AND_HOST_COMMUNITIES');
});

test('rejects floating-point, unsafe, non-positive or over-target budget values', () => {
  for (const value of [0, -1, 1.25, Number.MAX_SAFE_INTEGER + 1, '']) {
    assert.throws(() => validateCampaignInput({ ...validCampaign(), targetAmountMinor: value }));
  }
  assert.throws(() => validateCampaignInput({ ...validCampaign(), budgetLines: [{ category: 'TUITION_AND_FEES', description: 'Fees', amountMinor: 1000001 }] }), { code: 'EDUCATION_BUDGET_EXCEEDS_TARGET' });
});

test('rejects unapproved category, unsupported currency, malformed timeline and missing surplus policy', () => {
  assert.throws(() => validateCampaignInput({ ...validCampaign(), category: 'UNLISTED' }), { code: 'EDUCATION_CATEGORY_INVALID' });
  assert.throws(() => validateCampaignInput({ ...validCampaign(), currency: 'EUR' }), { code: 'EDUCATION_CURRENCY_NOT_ENABLED' });
  assert.throws(() => validateCampaignInput({ ...validCampaign(), endAt: '2026-10-01T00:00:00.000Z' }), { code: 'EDUCATION_CAMPAIGN_DATES_INVALID' });
  assert.throws(() => validateCampaignInput({ ...validCampaign(), surplusPolicy: '' }), { code: 'EDUCATION_SURPLUS_POLICY_INVALID' });
});

test('campaign lifecycle blocks invalid transitions and terminal closure', () => {
  assert.equal(canTransitionCampaign('DRAFT', 'SUBMITTED'), true);
  assert.equal(canTransitionCampaign('SUBMITTED', 'PUBLISHED'), false);
  assert.equal(canTransitionCampaign('PUBLISHED', 'CLOSED'), false);
  assert.equal(canTransitionCampaign('CLOSED', 'DRAFT'), false);
  assert.throws(() => assertCampaignTransition('SUBMITTED', 'PUBLISHED'), { code: 'EDUCATION_CAMPAIGN_TRANSITION_NOT_ALLOWED', statusCode: 409 });
});

test('institution must have verified status and an approved education scope', () => {
  assert.equal(isEducationPartnerVerified({ verificationStatus: 'VERIFIED', programmeScopes: ['EDUCATION'] }), true);
  assert.equal(isEducationPartnerVerified({ verificationStatus: 'PENDING_REVIEW', programmeScopes: ['EDUCATION'] }), false);
  assert.equal(isEducationPartnerVerified({ verificationStatus: 'VERIFIED', programmeScopes: ['HEALTH'] }), false);
  assert.throws(() => assertEducationPartnerVerified(null), { code: 'EDUCATION_PARTNER_NOT_VERIFIED', statusCode: 403 });
});

test('public campaign DTO is allowlisted and excludes tenant, actor, evidence and financial execution fields', () => {
  const dto = toPublicCampaignDTO({
    publicReference: 'public-reference', tenantId: 'secret-tenant', createdBy: 'private-user', reviewerId: 'private-reviewer',
    title: 'Community school fees support', publicDescription: 'A safe programme description without individual case information.',
    category: 'SCHOOL_FEES', communityScope: 'COMMUNITY_WIDE', eligibilitySummary: 'Published institutional eligibility criteria.',
    selectionMethod: 'Independent human review.', targetAmountMinor: 5000, currency: 'UGX', budgetLines: [], startAt: new Date(), endAt: new Date(),
    feeDisclosure: 'No platform fees.', refundPolicy: 'No funds are collected.', surplusPolicy: 'PARTNER_TERMS_REVIEW_REQUIRED',
    beneficiaryName: 'must-not-be-exposed', paymentStatus: 'SUCCESS', ledgerReference: 'must-not-be-exposed', evidenceReference: 'private',
  }, 'Verified School Partner');
  assert.equal(dto.id, 'public-reference');
  assert.equal(dto.verifiedPartnerName, 'Verified School Partner');
  assert.equal('tenantId' in dto, false);
  assert.equal('createdBy' in dto, false);
  assert.equal('beneficiaryName' in dto, false);
  assert.equal('paymentStatus' in dto, false);
  assert.equal('ledgerReference' in dto, false);
  assert.equal('evidenceReference' in dto, false);
});
