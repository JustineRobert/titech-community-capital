/**
 * TITech Community Capital — Canonical Authorization Policy
 *
 * This module is the single policy source for role names, role aliases,
 * permissions, hierarchy and tenant/group authorization decisions.
 * It deliberately has no database or HTTP dependencies so the policy can be
 * tested independently from persistence.
 */

export const CANONICAL_ROLES = Object.freeze([
  'platform_admin',
  'tenant_admin',
  'group_admin',
  'member',
  'guest',
]);

export const ROLE_ALIASES = Object.freeze({
  super_admin: 'platform_admin',
  admin: 'platform_admin',
  tenantadmin: 'tenant_admin',
  tenant_admin: 'tenant_admin',
  groupadmin: 'group_admin',
  group_admin: 'group_admin',
  user: 'member',
  member: 'member',
  guest: 'guest',
});

export const ROLE_RANK = Object.freeze({
  guest: 10,
  member: 20,
  group_admin: 60,
  tenant_admin: 80,
  platform_admin: 100,
});

const AUTH_PERMISSIONS = Object.freeze([
  'AUTH_REGISTER',
  'AUTH_VERIFY',
  'AUTH_LOGIN',
  'AUTH_LOGOUT',
  'AUTH_REFRESH',
  'AUTH_PASSWORD_RESET',
  'AUTH_CHANGE_PASSWORD',
  'AUTH_REVOKE_SESSION',
]);

export const PERMISSIONS = Object.freeze({
  AUTH: AUTH_PERMISSIONS,
  USER: [
    'USER_VIEW',
    'USER_CREATE',
    'USER_UPDATE',
    'USER_DISABLE',
    'USER_ENABLE',
    'USER_INVITE',
    'USER_VIEW_SESSIONS',
    'USER_REVOKE_SESSIONS',
  ],
  TENANT: [
    'TENANT_VIEW',
    'TENANT_CREATE',
    'TENANT_UPDATE',
    'TENANT_DISABLE',
    'TENANT_MANAGE_SETTINGS',
    'TENANT_VIEW_USERS',
    'TENANT_MANAGE_USERS',
    'TENANT_INVITE_USER',
  ],
  ROLE: [
    'ROLE_VIEW',
    'ROLE_ASSIGN',
    'ROLE_PROMOTE',
    'ROLE_DEMOTE',
    'ROLE_REVOKE',
  ],
  GROUP: [
    'GROUP_CREATE',
    'GROUP_VIEW',
    'GROUP_UPDATE',
    'GROUP_ARCHIVE',
    'GROUP_MANAGE_SETTINGS',
    'GROUP_INVITE',
    'GROUP_VIEW_MEMBERS',
    'GROUP_MANAGE_MEMBERS',
  ],
  MEMBERSHIP: [
    'MEMBERSHIP_REQUEST',
    'MEMBERSHIP_VIEW',
    'MEMBERSHIP_APPROVE',
    'MEMBERSHIP_REJECT',
    'MEMBERSHIP_SUSPEND',
    'MEMBERSHIP_REMOVE',
    'MEMBERSHIP_REINSTATE',
    'MEMBERSHIP_ROLE_CHANGE',
  ],
  DASHBOARD: [
    'DASHBOARD_VIEW_PLATFORM',
    'DASHBOARD_VIEW_TENANT',
    'DASHBOARD_VIEW_GROUP',
    'DASHBOARD_VIEW_MEMBER',
    'DASHBOARD_VIEW_ADMIN',
    'DASHBOARD_VIEW_AUDIT',
  ],
  AUDIT: [
    'AUDIT_VIEW',
    'AUDIT_SEARCH',
    'AUDIT_EXPORT',
  ],
  SESSION: [
    'SESSION_VIEW_ANY',
    'SESSION_REVOKE_ANY',
  ],
});

const ALL_PERMISSIONS = Object.freeze(
  Object.values(PERMISSIONS).flat(),
);

const ROLE_PERMISSION_MAP = Object.freeze({
  platform_admin: Object.freeze(ALL_PERMISSIONS),
  tenant_admin: Object.freeze([
    ...AUTH_PERMISSIONS,
    ...PERMISSIONS.USER,
    'TENANT_VIEW',
    'TENANT_UPDATE',
    'TENANT_MANAGE_SETTINGS',
    'TENANT_VIEW_USERS',
    'TENANT_MANAGE_USERS',
    'TENANT_INVITE_USER',
    ...PERMISSIONS.ROLE,
    ...PERMISSIONS.GROUP,
    ...PERMISSIONS.MEMBERSHIP,
    'DASHBOARD_VIEW_TENANT',
    'DASHBOARD_VIEW_GROUP',
    'DASHBOARD_VIEW_MEMBER',
    'DASHBOARD_VIEW_ADMIN',
    ...PERMISSIONS.AUDIT,
    'USER_VIEW_SESSIONS',
    'USER_REVOKE_SESSIONS',
  ]),
  group_admin: Object.freeze([
    ...AUTH_PERMISSIONS,
    'USER_VIEW',
    'GROUP_VIEW',
    'GROUP_UPDATE',
    'GROUP_MANAGE_SETTINGS',
    'GROUP_INVITE',
    'GROUP_VIEW_MEMBERS',
    'GROUP_MANAGE_MEMBERS',
    ...PERMISSIONS.MEMBERSHIP,
    'DASHBOARD_VIEW_GROUP',
    'DASHBOARD_VIEW_MEMBER',
    'AUDIT_VIEW',
  ]),
  member: Object.freeze([
    ...AUTH_PERMISSIONS,
    'USER_VIEW',
    'USER_UPDATE',
    'TENANT_VIEW',
    'GROUP_VIEW',
    'MEMBERSHIP_REQUEST',
    'MEMBERSHIP_VIEW',
    'DASHBOARD_VIEW_MEMBER',
    'AUTH_REVOKE_SESSION',
  ]),
  guest: Object.freeze([
    'AUTH_REGISTER',
    'AUTH_VERIFY',
    'AUTH_LOGIN',
    'AUTH_LOGOUT',
    'AUTH_REFRESH',
  ]),
});

export function normalizeRole(role) {
  if (typeof role !== 'string') return null;
  const key = role.trim().toLowerCase();
  return ROLE_ALIASES[key] || null;
}

export function normalizeRoles(roles) {
  const values = Array.isArray(roles) ? roles : [roles];
  return [...new Set(values.map(normalizeRole).filter(Boolean))];
}

export function getRoleRank(role) {
  const normalized = normalizeRole(role);
  return normalized ? (ROLE_RANK[normalized] || 0) : 0;
}

export function isKnownRole(role) {
  return Boolean(normalizeRole(role));
}

export function getPermissionsForRoles(roles) {
  const normalized = normalizeRoles(roles);
  return [...new Set(normalized.flatMap((role) => ROLE_PERMISSION_MAP[role] || []))];
}

export function getPermissionsForRole(role) {
  return getPermissionsForRoles([role]);
}

export function hasPermission(roles, permission) {
  if (typeof permission !== 'string' || !permission.trim()) return false;
  return getPermissionsForRoles(roles).includes(permission.trim());
}

export function isAtLeastRole(role, minimumRole) {
  return getRoleRank(role) >= getRoleRank(minimumRole);
}

export function isPrivilegedRole(role) {
  return getRoleRank(role) >= ROLE_RANK.group_admin;
}

export function tenantMatches(actor, tenantId) {
  if (!tenantId || !actor) return false;
  return String(actor.tenantId || '') === String(tenantId);
}

export function canOperateTenant(actor, tenantId) {
  const role = normalizeRole(actor?.role || actor?.roles?.[0]);
  if (role === 'platform_admin') return true;
  if (role === 'tenant_admin') return tenantMatches(actor, tenantId);
  return false;
}

function activeMembership(group, userId) {
  if (!group || !userId || !Array.isArray(group.memberRoles)) return null;
  return group.memberRoles.find((m) =>
    m && String(m.userId) === String(userId) &&
    !m.removedAt &&
    (m.membershipStatus === 'active' || m.membershipStatus === 'reinstated' || m.invitationStatus === 'accepted') &&
    m.membershipStatus !== 'suspended'
  ) || null;
}

export function canViewGroup(actor, group) {
  const role = normalizeRole(actor?.role || actor?.roles?.[0]);
  if (!role || !group) return false;
  if (role === 'platform_admin') return true;
  if (!tenantMatches(actor, group.tenantId)) return false;
  if (role === 'tenant_admin') return true;
  return Boolean(activeMembership(group, actor.id || actor._id));
}

export function canManageGroup(actor, group) {
  const role = normalizeRole(actor?.role || actor?.roles?.[0]);
  if (!role || !group) return false;
  if (role === 'platform_admin') return true;
  if (!tenantMatches(actor, group.tenantId)) return false;
  if (role === 'tenant_admin') return true;
  if (role !== 'group_admin') return false;
  const membership = activeMembership(group, actor.id || actor._id);
  return membership?.role === 'group_admin' || String(group.createdBy) === String(actor.id || actor._id);
}

export function canManageMembership(actor, group) {
  return canManageGroup(actor, group);
}

export function canAssignUserRole(actor, target, requestedRole, { group } = {}) {
  const actorRole = normalizeRole(actor?.role || actor?.roles?.[0]);
  const targetRole = normalizeRole(requestedRole);
  if (!actorRole || !targetRole || !target) return { allowed: false, reason: 'invalid_input' };
  if (String(actor.id || actor._id) === String(target.id || target._id)) return { allowed: false, reason: 'self_promotion_denied' };
  if (actorRole === 'platform_admin') {
    return { allowed: true, reason: 'platform_scope' };
  }
  if (actorRole !== 'tenant_admin' || !tenantMatches(actor, target.tenantId)) {
    return { allowed: false, reason: 'scope_denied' };
  }
  if (getRoleRank(targetRole) >= getRoleRank('tenant_admin')) {
    return { allowed: false, reason: 'superior_role_denied' };
  }
  if (targetRole === 'group_admin') {
    if (!group || !tenantMatches(actor, group.tenantId) || !tenantMatches(target, group.tenantId)) {
      return { allowed: false, reason: 'group_scope_required' };
    }
    const membership = activeMembership(group, target.id || target._id);
    if (!membership) return { allowed: false, reason: 'active_membership_required' };
  }
  return { allowed: true, reason: 'tenant_scope' };
}

export function canChangeMembershipRole(actor, group, targetMembership, requestedMembershipRole) {
  const actorRole = normalizeRole(actor?.role || actor?.roles?.[0]);
  const allowedMembershipRoles = new Set(['member', 'group_admin', 'treasurer', 'secretary']);
  if (!actorRole || !group || !targetMembership || !allowedMembershipRoles.has(requestedMembershipRole)) {
    return { allowed: false, reason: 'invalid_input' };
  }
  if (!canManageMembership(actor, group)) return { allowed: false, reason: 'scope_denied' };
  if (requestedMembershipRole === 'group_admin' && actorRole === 'group_admin') {
    return { allowed: false, reason: 'group_admin_cannot_promote_group_admin' };
  }
  return { allowed: true, reason: 'authorized' };
}

export function buildAuthorizationContext({ user, tenantId, group = null } = {}) {
  const roles = normalizeRoles([user?.role, ...(user?.roles || [])]);
  return Object.freeze({
    userId: user?.id || user?._id || null,
    tenantId: tenantId || user?.tenantId || null,
    role: normalizeRole(user?.role || roles[0]),
    roles,
    permissions: getPermissionsForRoles(roles),
    groupId: group?._id || group?.id || null,
    groupRole: group ? activeMembership(group, user?.id || user?._id)?.role || null : null,
  });
}

export const AUTHORIZATION_POLICY = Object.freeze({
  roles: CANONICAL_ROLES,
  aliases: ROLE_ALIASES,
  rank: ROLE_RANK,
  permissions: ALL_PERMISSIONS,
});

export default AUTHORIZATION_POLICY;
