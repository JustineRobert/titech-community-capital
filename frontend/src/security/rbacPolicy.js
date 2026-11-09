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
