/**
 * TITech frontend RBAC vocabulary mirror.
 * Backend authorization remains authoritative; this module prevents the UI
 * from drifting across legacy role aliases.
 */
export const TITECH_ROLES = Object.freeze({
  PLATFORM_ADMIN: 'platform_admin',
  TENANT_ADMIN: 'tenant_admin',
  GROUP_ADMIN: 'group_admin',
  MEMBER: 'member',
  GUEST: 'guest',
});

const ROLE_ALIASES = Object.freeze({
  super_admin: TITECH_ROLES.PLATFORM_ADMIN,
  platformadmin: TITECH_ROLES.PLATFORM_ADMIN,
  admin: TITECH_ROLES.TENANT_ADMIN,
  administrator: TITECH_ROLES.TENANT_ADMIN,
  tenantadmin: TITECH_ROLES.TENANT_ADMIN,
  groupadmin: TITECH_ROLES.GROUP_ADMIN,
  user: TITECH_ROLES.MEMBER,
});

export function normalizeTitechRole(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, '_');
  return normalized ? ROLE_ALIASES[normalized] || normalized : null;
}

export function normalizeTitechRoles(values) {
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list.map(normalizeTitechRole).filter(Boolean))];
}

export function hasTitechRole(values, required) {
  const actual = new Set(normalizeTitechRoles(values));
  return normalizeTitechRoles(required).some((role) => actual.has(role));
}

export function roleDashboard(role) {
  switch (normalizeTitechRole(role)) {
    case TITECH_ROLES.PLATFORM_ADMIN: return '/platform';
    case TITECH_ROLES.TENANT_ADMIN: return '/admin';
    case TITECH_ROLES.GROUP_ADMIN: return '/groups';
    case TITECH_ROLES.MEMBER: return '/dashboard';
    default: return '/';
  }
}


// Minimal frontend permission mirror for route visibility. Server-side
// backend/middleware/platformPermissions.js remains the authority. Keep this
// subset aligned with its support and meeting grants only.
const ROUTE_PERMISSION_GRANTS = Object.freeze({
  PLATFORM_ADMIN: '*',
  TENANT_ADMIN: new Set(['support:case:read', 'support:case:create', 'support:case:transition', 'meetings:read']),
  SUPPORT_AGENT: new Set(['support:case:read', 'support:case:create', 'support:case:transition']),
  COMPLIANCE_OFFICER: new Set(['support:case:read', 'support:case:transition', 'meetings:read']),
  APPROVER: new Set(['support:case:read', 'support:case:transition']),
  AUDITOR: new Set(['support:case:read']),
  GROUP_ADMIN: new Set(['meetings:read']),
  GROUP_LEADER: new Set(['meetings:read']),
  MEMBER: new Set(['meetings:read']),
  PARTICIPANT: new Set(['meetings:read']),
  GROUP_MEMBER: new Set(['meetings:read']),
});

export function hasTitechPermission(user, permission) {
  if (!user || typeof permission !== 'string' || !permission.trim()) return false;
  const required = permission.trim();
  const explicit = Array.isArray(user.permissions) ? user.permissions : [];
  if (explicit.some((item) => String(item).trim() === required || String(item).trim() === '*')) return true;
  const roles = [user.role, ...(Array.isArray(user.roles) ? user.roles : [])]
    .filter(Boolean)
    .map((role) => String(normalizeTitechRole(role) || role).trim().toUpperCase().replace(/[\s-]+/g, '_'));
  return roles.some((role) => ROUTE_PERMISSION_GRANTS[role] === '*' || ROUTE_PERMISSION_GRANTS[role]?.has?.(required));
}
