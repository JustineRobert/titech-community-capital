import test from 'node:test';
import assert from 'node:assert/strict';
import { getGroupMemberCount, getGroupTypeLabel, getNextContributionDate } from './groupDashboardPresentation.mjs';

test('member count uses an explicit canonical count when available', () => {
  assert.equal(getGroupMemberCount({ memberCount: 1 }), 1);
  assert.equal(getGroupMemberCount({ activeMemberCount: 0, memberCount: 9 }), 0);
});

test('member count derives active and reinstated members from canonical memberRoles', () => {
  assert.equal(getGroupMemberCount({ memberRoles: [
    { membershipStatus: 'active' },
    { membershipStatus: 'reinstated' },
    { membershipStatus: 'pending' },
    { membershipStatus: 'suspended' },
  ] }), 2);
});

test('unknown membership data remains unavailable rather than becoming a false zero', () => {
  assert.equal(getGroupMemberCount({ name: 'Group without membership data' }), null);
  assert.equal(getGroupMemberCount({ members: [] }), 0);
});

test('group type presentation uses the supplied type/category and never renders an object', () => {
  assert.equal(getGroupTypeLabel({ type: 'faith_based' }), 'Faith Based');
  assert.equal(getGroupTypeLabel({ category: 'community-development' }), 'Community Development');
  assert.equal(getGroupTypeLabel({ type: { name: 'Savings' } }), 'Group type unavailable');
});

test('next contribution is only displayed from a date-like supplied schedule field', () => {
  assert.equal(getNextContributionDate({}), null);
  assert.equal(getNextContributionDate({ nextContribution: { dueDate: '2026-11-30' } }), null);
  assert.equal(getNextContributionDate({ nextContributionDate: '2026-11-30' }), '2026-11-30');
});

test('member count follows canonical membership states and accepted legacy invites', () => {
  const group = {
    memberCount: 99,
    memberRoles: [
      { membershipStatus: 'active' },
      { membershipStatus: 'reinstated' },
      { membershipStatus: 'pending' },
      { membershipStatus: 'suspended' },
      { invitationStatus: 'accepted' },
      { invitationStatus: 'accepted', removedAt: new Date() },
    ],
  };
  assert.equal(getGroupMemberCount(group), 3);
});

test('an explicitly loaded empty canonical membership list is a real zero', () => {
  assert.equal(getGroupMemberCount({ memberRoles: [], memberCount: 12 }), 0);
});
