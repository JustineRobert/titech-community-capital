/**
 * ============================================================================
 * TITech Community Capital — Platform Permission Boundary
 * ============================================================================
 *
 * Architectural role
 *   Reusable action-based authorization for control-plane domains that sit
 *   outside the legacy route registry.
 *
 * Responsibilities
 *   - Enforce explicit action permissions.
 *   - Support role-to-permission defaults for privileged platform roles.
 *   - Fail closed when authentication/permissions are absent.
 *
 * Non-responsibilities
 *   - Authentication/token verification.
 *   - Tenant resolution.
 *   - Financial ledger mutation.
 *
 * Security principle
 *   Screen visibility is not authorization. Every protected action must be
 *   independently authorized at the API boundary.
 * ============================================================================
 */

const ROLE_PERMISSIONS = Object.freeze({
  PLATFORM_ADMIN: '*',
  TENANT_ADMIN: new Set([
    'consent:read', 'consent:grant', 'consent:withdraw',
    'capital:share:read', 'capital:share:create', 'capital:share:revoke',
    'support:case:read', 'support:case:create', 'support:case:transition',
  ]),
  COMPLIANCE_OFFICER: new Set([
    'consent:read', 'consent:withdraw', 'capital:share:read', 'capital:share:approve',
    'support:case:read', 'support:case:transition',
  ]),
  APPROVER: new Set([
    'capital:share:read', 'capital:share:approve',
    'support:case:read', 'support:case:transition',
  ]),
  SUPPORT_AGENT: new Set(['support:case:read', 'support:case:create', 'support:case:transition']),
  AUDITOR: new Set(['consent:read', 'capital:share:read', 'support:case:read']),
});

function normalizedPermissions(user = {}) {
  return new Set((Array.isArray(user.permissions) ? user.permissions : [])
    .map((item) => String(item).trim())
    .filter(Boolean));
}

function normalizedRoles(user = {}) {
  const raw = [user.role, ...(Array.isArray(user.roles) ? user.roles : [])].filter(Boolean);
  return new Set(raw.map((item) => String(item).trim().toUpperCase()));
}

export function hasPermission(user, permission) {
  if (!user) return false;
  const roles = normalizedRoles(user);
  const permissions = normalizedPermissions(user);
  if ([...roles].some((role) => ROLE_PERMISSIONS[role] === '*')) return true;
  if (permissions.has(permission)) return true;
  for (const role of roles) {
    if (ROLE_PERMISSIONS[role]?.has?.(permission)) return true;
  }
  return false;
}

export function requirePermission(permission) {
  const required = String(permission || '').trim();
  if (!required) throw new TypeError('A non-empty permission is required.');
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication required.' }, requestId: req.requestId || null });
    }
    if (!hasPermission(req.user, required)) {
      return res.status(403).json({ success: false, error: { code: 'PERMISSION_DENIED', message: 'Permission denied.' }, requestId: req.requestId || null });
    }
    return next();
  };
}

export const PLATFORM_ROLE_PERMISSIONS = ROLE_PERMISSIONS;
