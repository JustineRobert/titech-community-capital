#!/usr/bin/env node
/** Dependency-free canonical RBAC repository gate. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(ROOT, file));
const assert = (condition, message) => { if (!condition) failures.push(message); };

assert(exists('backend/middleware/authorization/roleHierarchy.js'), 'Canonical role hierarchy is missing.');
assert(exists('backend/middleware/authorization/permissionRegistry.js'), 'Canonical permission registry is missing.');
assert(exists('backend/middleware/authorization/policyEngine.js'), 'Canonical policy engine is missing.');
assert(exists('backend/middleware/authorization/resourceAuthorization.js'), 'Canonical resource authorization module is missing.');
assert(exists('backend/routes/rbac.js'), 'Canonical RBAC route is missing.');
assert(exists('frontend/src/security/rbacPolicy.js'), 'Canonical frontend role vocabulary module is missing.');

const auth = read('backend/middleware/auth.js');
assert(auth.includes('User.findById(tokenUser.id)'), 'Authentication middleware does not re-resolve live user state.');
assert(auth.includes('sessionVersion'), 'Authentication middleware does not enforce session-version revocation.');
assert(auth.includes('getEffectivePermissions'), 'Authentication middleware does not resolve permissions through the canonical policy engine.');
assert(auth.includes('getCanonicalRole'), 'Authentication middleware does not canonicalize legacy roles.');
assert(auth.includes('const requestedTenantId'), 'Authentication middleware must preserve requested tenant context separately from authenticated tenant context.');

const user = read('backend/models/User.js');
assert(user.includes('default: "member"'), 'New users are not defaulted to the least-privileged Member role.');
assert(user.includes('authorizationStateInvalidation'), 'Role/tenant/status changes do not invalidate sessions at the User model boundary.');

const authController = read('backend/controllers/authController.js');
assert(authController.includes('sessionVersion:'), 'Access tokens do not carry session-version state.');
assert(authController.includes('verificationRequired: true'), 'Registration does not require email verification before issuing a session.');

const groups = read('backend/controllers/groupController.js');
assert(groups.includes('GROUP_MEMBERSHIP_PENDING'), 'Group membership requests do not enter a pending state.');
assert(groups.includes('approveMembership'), 'Group membership approval lifecycle is missing.');
assert(groups.includes('rejectMembership'), 'Group membership rejection lifecycle is missing.');
assert(groups.includes('canManageGroup'), 'Group administration is not object-scoped.');

const groupRoute = read('backend/routes/groups.js');
assert(groupRoute.includes('requireVerifiedUser'), 'Group APIs are not gated by account verification.');
assert(groupRoute.includes('membership-requests'), 'Membership approval routes are not mounted.');

const rbacRoute = read('backend/routes/rbac.js');
assert(rbacRoute.includes('requirePermission(PERMISSIONS.ROLE_ASSIGN)'), 'Role mutation endpoint is not permission protected.');
assert(rbacRoute.includes('RBAC_CROSS_TENANT'), 'Role mutation does not explicitly deny cross-tenant changes.');
assert(rbacRoute.includes('AuditLog'), 'Role mutation is not centrally audited.');

const routeIndex = read('backend/routes/index.js');
assert(routeIndex.includes("import rbacRoutes from './rbac.js';"), 'Canonical RBAC router is not imported by the runtime route registry.');
assert(routeIndex.includes("app.use('/api/rbac', rbacRoutes);"), 'Canonical RBAC router is not mounted.');

const frontendPolicy = read('frontend/src/security/rbacPolicy.js');
assert(frontendPolicy.includes('admin: TITECH_ROLES.TENANT_ADMIN'), 'Frontend legacy admin alias is not normalized to TenantAdmin.');
assert(frontendPolicy.includes('user: TITECH_ROLES.MEMBER'), 'Frontend legacy user alias is not normalized to Member.');

const status = failures.length ? 'FAIL' : 'PASS';
const result = { generatedAt: new Date().toISOString(), status, failures, scope: 'dependency-free-rbac-contract' };
fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports/titech-rbac-gate.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exit(1);
