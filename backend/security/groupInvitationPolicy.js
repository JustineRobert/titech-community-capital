/** Pure invitation policy used by the canonical Group invitation controller. */
export function normalizeInvitationEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function classifyExistingGroupMembership(membership) {
  if (!membership) return null;
  if (membership.removedAt || membership.membershipStatus === 'removed') {
    return { success: false, status: 'REMOVED_MEMBERSHIP_REVIEW_REQUIRED', code: 'GROUP_MEMBER_PREVIOUSLY_REMOVED', retryable: false, message: 'This person’s previous group membership requires administrator review before another invitation.' };
  }
  if (membership.membershipStatus === 'suspended') {
    return { success: false, status: 'MEMBERSHIP_SUSPENDED', code: 'GROUP_MEMBER_SUSPENDED', retryable: false, message: 'This person’s group membership is suspended and cannot be invited.' };
  }
  if (membership.membershipStatus === 'rejected' || membership.invitationStatus === 'rejected') {
    return { success: false, status: 'REJECTED_REVIEW_REQUIRED', code: 'GROUP_MEMBER_PREVIOUSLY_REJECTED', retryable: false, message: 'A previous rejection must be reviewed by a group administrator.' };
  }
  if (['active', 'reinstated'].includes(membership.membershipStatus) || membership.invitationStatus === 'accepted') {
    return { success: true, status: 'ALREADY_MEMBER', code: 'GROUP_ALREADY_MEMBER', retryable: false, message: 'This person is already an active group member.' };
  }
  if (membership.membershipStatus === 'pending' && membership.membershipOrigin === 'invited' && membership.invitationStatus === 'pending') {
    return { success: true, status: 'ALREADY_INVITED', code: 'GROUP_INVITATION_ALREADY_PENDING', retryable: false, message: 'An in-app invitation is already pending for this person.' };
  }
  if (membership.membershipStatus === 'pending' && membership.membershipOrigin === 'requested') {
    return { success: false, status: 'MEMBERSHIP_REQUEST_PENDING', code: 'GROUP_MEMBERSHIP_REQUEST_PENDING', retryable: false, message: 'This person already has a membership request awaiting an administrator decision.' };
  }
  return { success: false, status: 'MEMBERSHIP_STATE_REVIEW_REQUIRED', code: 'GROUP_MEMBERSHIP_STATE_REVIEW_REQUIRED', retryable: false, message: 'The existing membership state requires administrator review.' };
}
