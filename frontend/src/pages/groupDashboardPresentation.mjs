/** Safe, source-aware presentation helpers for tenant-scoped group cards. */

const ACTIVE_MEMBERSHIP_STATUSES = new Set(['active', 'reinstated']);

function validCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function getGroupMemberCount(group) {
  if (!group || typeof group !== 'object') return null;

  const explicitActiveCount = validCount(group.activeMemberCount);
  if (explicitActiveCount !== null) return explicitActiveCount;

  // Group.memberRoles is authoritative in the canonical Group model. Match
  // its active-member virtual, including accepted legacy invitations.
  if (Array.isArray(group.memberRoles)) {
    return group.memberRoles.filter((membership) => {
      const status = String(membership?.membershipStatus || '').toLowerCase();
      const acceptedLegacyInvite = !status && String(membership?.invitationStatus || '').toLowerCase() === 'accepted';
      const active = ACTIVE_MEMBERSHIP_STATUSES.has(status) || acceptedLegacyInvite;
      return active && status !== 'suspended' && !membership?.removedAt;
    }).length;
  }

  const compatibilityCount = validCount(group.memberCount);
  if (compatibilityCount !== null) return compatibilityCount;
  if (Array.isArray(group.members)) return group.members.length;
  return null;
}

export function getGroupTypeLabel(group) {
  const source = group?.type ?? group?.category;
  if (typeof source !== 'string' || !source.trim()) return 'Group type unavailable';
  return source.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function getNextContributionDate(group) {
  const value = group?.nextContributionDate ?? group?.nextContribution ?? null;
  return value instanceof Date || typeof value === 'string' || typeof value === 'number'
    ? value
    : null;
}
