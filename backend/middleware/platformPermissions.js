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
    'agriculture:read', 'agriculture:write', 'agriculture:manage', 'agriculture:verify', 'agriculture:settle', 'agriculture:finance', 'agriculture:audit:read',
    'participant:identity:read', 'participant:credential:submit', 'insurance:institution:read', 'insurance:institution:submit',
    'refugee-partner:read', 'refugee-partner:submit', 'consent:read',
    'education:campaign:read', 'education:campaign:create', 'education:campaign:submit',
    'retirement:case:read:own', 'retirement:case:create:own', 'retirement:financial-support:create:own', 'retirement:financial-support:read:own', 'offline:sync:submit',
    'meetings:read', 'meetings:read:any', 'meetings:create', 'meetings:write', 'meetings:manage:any', 'meetings:attendance:record', 'meetings:minutes:write', 'meetings:minutes:publish', 'meetings:decision:record', 'meetings:action-item:write', 'meetings:video:manage', 'meetings:video:join',
  ]),
  COMPLIANCE_OFFICER: new Set([
    'consent:read', 'consent:withdraw', 'capital:share:read', 'capital:share:approve',
    'support:case:read', 'support:case:transition', 'agriculture:read', 'agriculture:audit:read',
    'participant:kyc:review', 'participant:kyc:assignment:override', 'participant:document:read',
    'insurance:licence:review', 'insurance:document:read', 'insurance:institution:read',
    'refugee-partner:review', 'refugee-partner:read', 'insurance:claims:review', 'insurance:claims:read',
    'education:campaign:read', 'education:campaign:review', 'education:campaign:publish', 'education:campaign:manage',
    'retirement:case:read', 'retirement:case:review', 'retirement:verification:record', 'retirement:contribution:read', 'retirement:contribution:reconcile', 'retirement:contribution:record-credit', 'retirement:financial-support:read', 'retirement:financial-support:provider-outcome', 'meetings:read', 'meetings:read:any',
  ]),
  APPROVER: new Set([
    'capital:share:read', 'capital:share:approve',
    'support:case:read', 'support:case:transition',
  ]),
  SUPPORT_AGENT: new Set(['support:case:read', 'support:case:create', 'support:case:transition']),
  EDUCATION_PARTNER_ADMIN: new Set(['education:campaign:read', 'education:campaign:create', 'education:campaign:submit']),
  EDUCATION_REVIEWER: new Set(['education:campaign:read', 'education:campaign:review', 'education:campaign:publish', 'education:campaign:manage']),
  AUDITOR: new Set(['consent:read', 'capital:share:read', 'support:case:read', 'agriculture:read', 'agriculture:audit:read', 'education:campaign:read']),
  AGRICULTURE_MANAGER: new Set(['agriculture:read', 'agriculture:write', 'agriculture:manage', 'agriculture:verify']),
  GROUP_ADMIN: new Set(['agriculture:read', 'agriculture:write', 'agriculture:verify', 'offline:sync:submit', 'meetings:read', 'meetings:create', 'meetings:write', 'meetings:attendance:record', 'meetings:minutes:write', 'meetings:minutes:publish', 'meetings:decision:record', 'meetings:action-item:write', 'meetings:video:manage', 'meetings:video:join']),
  GROUP_LEADER: new Set(['agriculture:read', 'agriculture:write', 'offline:sync:submit', 'meetings:read', 'meetings:create', 'meetings:write', 'meetings:attendance:record', 'meetings:minutes:write', 'meetings:minutes:publish', 'meetings:decision:record', 'meetings:action-item:write', 'meetings:video:manage', 'meetings:video:join']),
  PRODUCER: new Set(['agriculture:read', 'agriculture:write']),
  BUYER: new Set(['agriculture:read', 'agriculture:write', 'agriculture:settle']),
  SUPPLIER: new Set(['agriculture:read', 'agriculture:write']),
  FINANCE_OFFICER: new Set(['agriculture:read', 'agriculture:settle', 'agriculture:finance', 'retirement:case:read', 'retirement:contribution:read', 'retirement:contribution:create', 'retirement:contribution:reconcile', 'retirement:financial-support:read']),
  RISK_OFFICER: new Set(['agriculture:read', 'agriculture:risk:read']),
  MEMBER: new Set(['meetings:read', 'meetings:attendance:record', 'meetings:action-item:write', 'meetings:video:join', 'offline:sync:submit', 'participant:identity:read', 'participant:credential:submit', 'participant:appeal:submit', 'participant:insurance-consent:grant', 'retirement:case:read:own', 'retirement:case:create:own', 'retirement:financial-support:create:own', 'retirement:financial-support:read:own']),
  PARTICIPANT: new Set(['meetings:read', 'meetings:attendance:record', 'meetings:action-item:write', 'meetings:video:join', 'offline:sync:submit', 'participant:identity:read', 'participant:credential:submit', 'participant:appeal:submit', 'participant:insurance-consent:grant', 'retirement:case:read:own', 'retirement:case:create:own', 'retirement:financial-support:create:own', 'retirement:financial-support:read:own']),
  GROUP_MEMBER: new Set(['meetings:read', 'meetings:attendance:record', 'meetings:action-item:write', 'meetings:video:join', 'offline:sync:submit', 'agriculture:read', 'agriculture:write', 'participant:identity:read', 'participant:credential:submit', 'participant:appeal:submit', 'participant:insurance-consent:grant', 'retirement:case:read:own', 'retirement:case:create:own', 'retirement:financial-support:create:own', 'retirement:financial-support:read:own']),
  FIELD_AGENT: new Set(['offline:sync:submit', 'agriculture:read', 'agriculture:write', 'participant:credential:submit', 'participant:assisted-onboarding:create', 'participant:identity:read', 'retirement:case:create']),
  KYC_REVIEWER: new Set(['participant:kyc:review', 'participant:document:read', 'participant:identity:read']),
  REFUGEE_PARTNER_ADMIN: new Set(['offline:sync:submit', 'refugee-partner:read', 'refugee-partner:submit', 'participant:assisted-onboarding:create', 'participant:credential:submit', 'education:campaign:read', 'education:campaign:create', 'education:campaign:submit']),
  INSURANCE_ADMIN: new Set(['insurance:institution:read', 'insurance:institution:submit', 'insurance:product:read', 'insurance:product:create', 'insurance:enrolment:read', 'insurance:enrolment:create', 'insurance:premium:read', 'insurance:premium:create', 'insurance:claims:read', 'insurance:claims:create']),
  INSURANCE_COMPLIANCE_OFFICER: new Set(['insurance:institution:read', 'insurance:licence:review', 'insurance:document:read', 'insurance:product:read', 'refugee-partner:review', 'refugee-partner:read']),
  INSURANCE_PRODUCT_MANAGER: new Set(['insurance:institution:read', 'insurance:product:read', 'insurance:product:create', 'insurance:product:activate']),
  INSURANCE_ENROLMENT_OFFICER: new Set(['insurance:institution:read', 'insurance:product:read', 'insurance:enrolment:read', 'insurance:enrolment:create', 'insurance:enrolment:decision:record']),
  INSURANCE_FINANCE_OFFICER: new Set(['insurance:institution:read', 'insurance:premium:read', 'insurance:premium:create', 'insurance:claims:read']),
  INSURANCE_CLAIMS_OFFICER: new Set(['insurance:institution:read', 'insurance:claims:read', 'insurance:claims:create', 'insurance:claims:decision:record', 'insurance:documents:read']),
  RETIREMENT_CASE_OFFICER: new Set(['retirement:case:read', 'retirement:case:review', 'retirement:contribution:read']),
  RETIREMENT_AUTHORITY_VERIFIER: new Set(['retirement:case:read', 'retirement:verification:record', 'retirement:contribution:read', 'retirement:contribution:record-credit']),
  EMPLOYER_PAYROLL_OFFICER: new Set(['retirement:case:read', 'retirement:contribution:read', 'retirement:contribution:create', 'retirement:contribution:reconcile']),
  RETIREMENT_PROVIDER_OFFICER: new Set(['retirement:financial-support:read', 'retirement:financial-support:provider-outcome']),
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
