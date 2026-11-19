import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyExistingGroupMembership, normalizeInvitationEmail } from '../../../security/groupInvitationPolicy.js';

test('invitation email normalization trims whitespace and ignores case', () => {
  assert.equal(normalizeInvitationEmail('  Member@Example.COM  '), 'member@example.com');
  assert.equal(normalizeInvitationEmail(null), '');
});

test('pending invitation is idempotently recognized', () => {
  assert.deepEqual(classifyExistingGroupMembership({ membershipStatus: 'pending', membershipOrigin: 'invited', invitationStatus: 'pending' }), {
    success: true, status: 'ALREADY_INVITED', code: 'GROUP_INVITATION_ALREADY_PENDING', retryable: false,
    message: 'An in-app invitation is already pending for this person.',
  });
});

test('active membership is not duplicated', () => {
  assert.equal(classifyExistingGroupMembership({ membershipStatus: 'active', invitationStatus: 'accepted' }).status, 'ALREADY_MEMBER');
});

test('membership requests are not overwritten by invitation batches', () => {
  const result = classifyExistingGroupMembership({ membershipStatus: 'pending', membershipOrigin: 'requested', invitationStatus: 'pending' });
  assert.equal(result.code, 'GROUP_MEMBERSHIP_REQUEST_PENDING');
  assert.equal(result.success, false);
});

test('suspended, rejected and removed membership states fail closed', () => {
  assert.equal(classifyExistingGroupMembership({ membershipStatus: 'suspended' }).code, 'GROUP_MEMBER_SUSPENDED');
  assert.equal(classifyExistingGroupMembership({ membershipStatus: 'rejected', invitationStatus: 'rejected' }).code, 'GROUP_MEMBER_PREVIOUSLY_REJECTED');
  assert.equal(classifyExistingGroupMembership({ membershipStatus: 'removed', removedAt: new Date() }).code, 'GROUP_MEMBER_PREVIOUSLY_REMOVED');
});
