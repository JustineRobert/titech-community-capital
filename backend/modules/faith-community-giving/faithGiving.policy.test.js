import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFaithGivingBudgetReservation,
  assertFaithGivingCampaignTransition,
  assertVerifiedFaithGivingPartner,
  canTransitionFaithGivingCampaign,
  normalizeFaithGivingReview,
  toFaithGivingPublicDTO,
  validateFaithGivingCampaignInput,
  validateFaithGivingExpenseInput,
  validateFaithGivingPledgeInput,
} from './faithGiving.policy.js';

const validCampaign = (overrides = {}) => ({
  title: 'Community church building project',
  organisationName: 'St Mark Community Church',
  organisationType: 'CHURCH',
  category: 'CHURCH_PROJECTS',
  communityScope: 'COMMUNITY_WIDE',
  publicDescription: 'The congregation is raising funds to improve its shared worship and community facility.',
  beneficiarySummary: 'Congregation members and nearby host-community residents will use the facility.',
  targetAmountMinor: 100000000,
  currency: 'UGX',
  budgetLines: [{ category: 'CHURCH_CONSTRUCTION', description: 'Roofing and structural works', amountMinor: 80000000 }],
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2027-02-01T00:00:00.000Z',
  visibility: 'PUBLIC',
  feeDisclosure: 'No platform fee is currently collected through this workflow.',
  refundPolicy: 'Refund requests require review and use an approved institutional process.',
  surplusPolicy: 'DONOR_CONSENT_REQUIRED_REALLOCATION',
  ...overrides,
});

test('accepts valid UGX community campaign input with integer minor units', () => {
  const result = validateFaithGivingCampaignInput(validCampaign());
  assert.equal(result.currency, 'UGX');
  assert.equal(result.targetAmountMinor, 100000000);
  assert.equal(result.budgetLines[0].amountMinor, 80000000);
  assert.ok(result.startAt instanceof Date);
});

test('rejects unknown categories, organisation types, scopes and currencies', () => {
  assert.throws(() => validateFaithGivingCampaignInput(validCampaign({ category: 'UNSUPPORTED' })), { code: 'FAITH_GIVING_CATEGORY_INVALID' });
  assert.throws(() => validateFaithGivingCampaignInput(validCampaign({ organisationType: 'UNSUPPORTED' })), { code: 'FAITH_GIVING_ORGANISATION_TYPE_INVALID' });
  assert.throws(() => validateFaithGivingCampaignInput(validCampaign({ communityScope: 'UNKNOWN' })), { code: 'FAITH_GIVING_COMMUNITY_SCOPE_INVALID' });
  assert.throws(() => validateFaithGivingCampaignInput(validCampaign({ currency: 'KES' })), { code: 'FAITH_GIVING_CURRENCY_NOT_ENABLED' });
});

test('rejects unsafe, fractional, zero and negative money amounts', () => {
  for (const amount of [0, -1, 1.25, Number.MAX_SAFE_INTEGER + 1, 'not-money']) {
    assert.throws(() => validateFaithGivingCampaignInput(validCampaign({ targetAmountMinor: amount })), { code: 'FAITH_GIVING_AMOUNT_INVALID' });
  }
});

test('rejects budgets that exceed target or contain unsafe totals', () => {
  assert.throws(() => validateFaithGivingCampaignInput(validCampaign({
    targetAmountMinor: 100,
    budgetLines: [{ category: 'CHURCH_CONSTRUCTION', description: 'Roofing', amountMinor: 101 }],
  })), { code: 'FAITH_GIVING_BUDGET_EXCEEDS_TARGET' });
  assert.throws(() => validateFaithGivingCampaignInput(validCampaign({
    targetAmountMinor: Number.MAX_SAFE_INTEGER,
    budgetLines: [
      { category: 'CHURCH_CONSTRUCTION', description: 'Roofing', amountMinor: Number.MAX_SAFE_INTEGER },
      { category: 'OTHER_APPROVED_COST', description: 'Facility materials', amountMinor: 1 },
    ],
  })), { code: 'FAITH_GIVING_BUDGET_TOTAL_INVALID' });
});

test('rejects unsafe public descriptions containing direct contacts or URLs', () => {
  assert.throws(() => validateFaithGivingCampaignInput(validCampaign({ publicDescription: 'Please contribute at https://example.org to this campaign purpose.' })), { code: 'FAITH_GIVING_PUBLIC_CONTACT_DATA_FORBIDDEN' });
  assert.throws(() => validateFaithGivingCampaignInput(validCampaign({ beneficiarySummary: 'Contact finance@example.org for assistance.' })), { code: 'FAITH_GIVING_PUBLIC_CONTACT_DATA_FORBIDDEN' });
});

test('rejects invalid date ranges, missing budget lines and invalid visibility', () => {
  assert.throws(() => validateFaithGivingCampaignInput(validCampaign({ startAt: '2027-01-02', endAt: '2027-01-01' })), { code: 'FAITH_GIVING_CAMPAIGN_DATES_INVALID' });
  assert.throws(() => validateFaithGivingCampaignInput(validCampaign({ budgetLines: [] })), { code: 'FAITH_GIVING_BUDGET_LINES_INVALID' });
  assert.throws(() => validateFaithGivingCampaignInput(validCampaign({ visibility: 'OPEN_TO_ALL' })), { code: 'FAITH_GIVING_VISIBILITY_INVALID' });
});

test('requires an explicitly configured campaign currency match for pledges', () => {
  assert.deepEqual(validateFaithGivingPledgeInput({ amountMinor: 10000 }, { currency: 'UGX' }), {
    pledgeType: 'CASH', amountMinor: 10000, currency: 'UGX', items: [], contributorLabel: null, anonymous: false,
  });
  assert.throws(() => validateFaithGivingPledgeInput({ amountMinor: 10000, currency: 'USD' }, { currency: 'UGX' }), { code: 'FAITH_GIVING_PLEDGE_CURRENCY_INVALID' });
  assert.throws(() => validateFaithGivingPledgeInput({ amountMinor: 2.5 }, { currency: 'UGX' }), { code: 'FAITH_GIVING_AMOUNT_INVALID' });
});

test('accepts controlled school-support campaign categories and budget lines', () => {
  const result = validateFaithGivingCampaignInput(validCampaign({
    category: 'EDUCATION_RESOURCES_AND_MATERIALS',
    budgetLines: [{ category: 'COMPUTERS_AND_DIGITAL_EQUIPMENT', description: 'School laboratory computers', amountMinor: 80000000 }],
  }));
  assert.equal(result.category, 'EDUCATION_RESOURCES_AND_MATERIALS');
  assert.equal(result.budgetLines[0].category, 'COMPUTERS_AND_DIGITAL_EQUIPMENT');
});

test('validates in-kind scholastic and equipment offers without monetary values', () => {
  const result = validateFaithGivingPledgeInput({ pledgeType: 'IN_KIND', items: [{ category: 'COMPUTERS_AND_DIGITAL_EQUIPMENT', description: 'Refurbished laptop computers', quantity: 5, unit: 'PIECE', condition: 'REFURBISHED' }] }, { currency: 'UGX' });
  assert.equal(result.pledgeType, 'IN_KIND'); assert.equal(result.amountMinor, null); assert.equal(result.currency, null); assert.equal(result.items[0].quantity, 5);
  assert.throws(() => validateFaithGivingPledgeInput({ pledgeType: 'IN_KIND', items: [] }, { currency: 'UGX' }), { code: 'FAITH_GIVING_IN_KIND_ITEMS_INVALID' });
  assert.throws(() => validateFaithGivingPledgeInput({ pledgeType: 'IN_KIND', amountMinor: 1000, items: [{ category: 'SCHOOL_FURNITURE', description: 'School desks', quantity: 2, unit: 'PIECE' }] }, { currency: 'UGX' }), { code: 'FAITH_GIVING_IN_KIND_AMOUNT_FORBIDDEN' });
  assert.throws(() => validateFaithGivingPledgeInput({ pledgeType: 'IN_KIND', items: [{ category: 'SCHOOL_FURNITURE', description: 'School desks', quantity: 1.5, unit: 'PIECE' }] }, { currency: 'UGX' }), { code: 'FAITH_GIVING_AMOUNT_INVALID' });
});

test('anonymous pledges do not retain contributor labels', () => {
  const result = validateFaithGivingPledgeInput({ amountMinor: 4000, anonymous: true, contributorLabel: 'Private Donor' }, { currency: 'UGX' });
  assert.equal(result.anonymous, true);
  assert.equal(result.contributorLabel, null);
});

test('validates an expense against the campaign currency and category contract', () => {
  const expense = validateFaithGivingExpenseInput({
    category: 'CHURCH_CONSTRUCTION', amountMinor: 20000, currency: 'UGX',
    description: 'Payment request for approved roofing materials.',
    payeeLabel: 'Approved supplier', evidenceReference: 'secure-document:1234',
  }, { currency: 'UGX' });
  assert.equal(expense.amountMinor, 20000);
  assert.throws(() => validateFaithGivingExpenseInput({
    category: 'CHURCH_CONSTRUCTION', amountMinor: 20000, currency: 'USD',
    description: 'Payment request for approved roofing materials.',
    payeeLabel: 'Approved supplier', evidenceReference: 'secure-document:1234',
  }, { currency: 'UGX' }), { code: 'FAITH_GIVING_EXPENSE_CURRENCY_INVALID' });
});

test('campaign lifecycle rejects unsupported shortcuts and allows governed steps', () => {
  assert.equal(canTransitionFaithGivingCampaign('DRAFT', 'SUBMITTED'), true);
  assert.equal(canTransitionFaithGivingCampaign('SUBMITTED', 'PUBLISHED'), false);
  assert.equal(canTransitionFaithGivingCampaign('APPROVED', 'PUBLISHED'), true);
  assert.equal(canTransitionFaithGivingCampaign('CLOSED', 'PUBLISHED'), false);
  assert.throws(() => assertFaithGivingCampaignTransition('DRAFT', 'PUBLISHED'), { code: 'FAITH_GIVING_TRANSITION_NOT_ALLOWED' });
});

test('campaign approval requires all independent review attestations', () => {
  assert.throws(() => normalizeFaithGivingReview({ decision: 'APPROVED' }, { communityScope: 'COMMUNITY_WIDE' }), { code: 'FAITH_GIVING_REVIEW_ATTESTATIONS_REQUIRED' });
  const result = normalizeFaithGivingReview({
    decision: 'APPROVED', organiserAuthorityReviewed: true,
    privacyAndSafeguardingReviewed: true, budgetAndTermsReviewed: true,
  }, { communityScope: 'COMMUNITY_WIDE' });
  assert.equal(result.decision, 'APPROVED');
});

test('refugee and host-community campaigns require partner authorization and safeguarding review', () => {
  const campaign = { communityScope: 'REFUGEE_AND_HOST_COMMUNITIES', partnerAuthorizationReference: null };
  assert.throws(() => normalizeFaithGivingReview({
    decision: 'APPROVED', organiserAuthorityReviewed: true,
    privacyAndSafeguardingReviewed: true, budgetAndTermsReviewed: true,
    partnerSafeguardingReviewed: true,
  }, campaign), { code: 'FAITH_GIVING_PARTNER_REVIEW_REQUIRED' });
  assert.throws(() => normalizeFaithGivingReview({
    decision: 'APPROVED', organiserAuthorityReviewed: true,
    privacyAndSafeguardingReviewed: true, budgetAndTermsReviewed: true,
    partnerSafeguardingReviewed: false,
  }, { communityScope: 'REFUGEE_AND_HOST_COMMUNITIES', partnerAuthorizationReference: 'partner-approval-ref' }), { code: 'FAITH_GIVING_REVIEW_ATTESTATIONS_REQUIRED' });
});

test('rejected campaigns require a reason', () => {
  assert.throws(() => normalizeFaithGivingReview({ decision: 'REJECTED', reason: ' ' }, { communityScope: 'COMMUNITY_WIDE' }), { code: 'FAITH_GIVING_REVIEW_REASON_REQUIRED' });
});

test('public DTO excludes tenant identifiers and private receiving or partner references', () => {
  const dto = toFaithGivingPublicDTO({
    _id: 'internal-db-id', publicReference: 'safe-public-ref', tenantId: 'private-tenant',
    title: 'Public campaign title', organisationName: 'Public organisation', organisationType: 'CHURCH',
    category: 'CHURCH_PROJECTS', communityScope: 'COMMUNITY_WIDE', publicDescription: 'An approved public campaign description.',
    beneficiarySummary: 'Community members will benefit from this approved facility.', targetAmountMinor: 1000,
    currency: 'UGX', budgetLines: [], startAt: new Date('2026-11-01'), endAt: new Date('2026-12-01'),
    feeDisclosure: 'No collection fees are currently processed.', refundPolicy: 'A documented review is required for refund requests.',
    surplusPolicy: 'REFUND_OR_RETURN', receivingDestinationReference: 'private-destination-ref',
    organiserVerificationReference: 'private-organiser-doc-ref', partnerAuthorizationReference: 'private-partner-ref',
    createdBy: 'private-user',
  });
  assert.equal(dto.id, 'safe-public-ref');
  assert.equal(dto.collectionStatus, 'NOT_ENABLED');
  assert.equal('tenantId' in dto, false);
  assert.equal('receivingDestinationReference' in dto, false);
  assert.equal('organiserVerificationReference' in dto, false);
  assert.equal('partnerAuthorizationReference' in dto, false);
  assert.equal('createdBy' in dto, false);
});


test('refugee and host-community workflows require a verified scoped institutional partner', () => {
  assert.throws(() => assertVerifiedFaithGivingPartner(null), { code: 'FAITH_GIVING_PARTNER_NOT_VERIFIED' });
  assert.throws(() => assertVerifiedFaithGivingPartner({ verificationStatus: 'PENDING_REVIEW', programmeScopes: ['HUMANITARIAN'] }), { code: 'FAITH_GIVING_PARTNER_NOT_VERIFIED' });
  assert.throws(() => assertVerifiedFaithGivingPartner({ verificationStatus: 'VERIFIED', programmeScopes: ['EDUCATION'] }), { code: 'FAITH_GIVING_PARTNER_NOT_VERIFIED' });
  assert.equal(assertVerifiedFaithGivingPartner({ verificationStatus: 'VERIFIED', programmeScopes: ['HUMANITARIAN'] }).verificationStatus, 'VERIFIED');
});

test('budget reservations prevent aggregate pending/approved requests from exceeding a line', () => {
  const lines = [{ category: 'FUNERAL_SERVICES', amountMinor: 1000, committedAmountMinor: 0 }];
  assert.equal(applyFaithGivingBudgetReservation(lines, 'FUNERAL_SERVICES', 600), 600);
  assert.equal(applyFaithGivingBudgetReservation(lines, 'FUNERAL_SERVICES', 400), 1000);
  assert.throws(() => applyFaithGivingBudgetReservation(lines, 'FUNERAL_SERVICES', 1), { code: 'FAITH_GIVING_BUDGET_RESERVATION_EXCEEDED' });
  assert.equal(applyFaithGivingBudgetReservation(lines, 'FUNERAL_SERVICES', 400, 'RELEASE'), 600);
  assert.throws(() => applyFaithGivingBudgetReservation(lines, 'FUNERAL_SERVICES', 601, 'RELEASE'), { code: 'FAITH_GIVING_BUDGET_RESERVATION_INTEGRITY_ERROR' });
});
