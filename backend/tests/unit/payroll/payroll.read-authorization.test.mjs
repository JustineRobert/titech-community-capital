import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hasPermission, getPermissionsForRole, canAssignUserRole, normalizeRole } from '../../../security/rbacPolicy.js';

const require = createRequire(import.meta.url);
const { roleMatches } = require('../../../modules/payroll/payroll.authorization.cjs');
const routeSource = await readFile(new URL('../../../modules/payroll/payroll.routes.js', import.meta.url), 'utf8');

const payrollReadRoles = ['ADMIN', 'AUDITOR', 'EMPLOYER_USER', 'PLATFORM_ADMIN', 'TENANT_ADMIN', 'PAYROLL_OFFICER', 'PAYROLL_AUDITOR'];

test('canonical platform and tenant administrators can read tenant-scoped payroll reports', () => {
  assert.equal(roleMatches({ role: 'platform_admin' }, payrollReadRoles), true);
  assert.equal(roleMatches({ role: 'platform_admin' }, ['ADMIN']), true);
  assert.equal(roleMatches({ role: 'tenant_admin' }, payrollReadRoles), true);
});

test('existing payroll auditor and employer roles retain report access', () => {
  assert.equal(roleMatches({ role: 'AUDITOR' }, payrollReadRoles), true);
  assert.equal(roleMatches({ role: 'EMPLOYER_USER' }, payrollReadRoles), true);
  assert.equal(roleMatches({ role: 'employer' }, payrollReadRoles), true);
  assert.equal(roleMatches({ role: 'payroll_officer' }, payrollReadRoles), true);
  assert.equal(roleMatches({ role: 'payroll_auditor' }, payrollReadRoles), true);
});

test('ordinary members and group administrators cannot read payroll reports', () => {
  assert.equal(roleMatches({ role: 'member' }, payrollReadRoles), false);
  assert.equal(roleMatches({ role: 'group_admin' }, payrollReadRoles), false);
});

test('canonical administrator report access does not grant payroll mutation role access', () => {
  const mutationRoles = ['ADMIN', 'EMPLOYER_USER'];
  assert.equal(roleMatches({ role: 'tenant_admin' }, mutationRoles), false);
  assert.equal(roleMatches({ role: 'platform_admin' }, mutationRoles), true);
  assert.equal(roleMatches({ role: 'auditor' }, mutationRoles), false);
  assert.equal(roleMatches({ role: 'payroll_officer' }, mutationRoles), false);
  assert.equal(roleMatches({ role: 'payroll_auditor' }, mutationRoles), false);
  assert.equal(roleMatches({ role: 'payroll_officer' }, mutationRoles), false);
});

test('only report and webhook-audit read routes add canonical administrator roles', () => {
  assert.match(routeSource, /router\.get\('\/report',[^\n]*requirePayrollPermission\('payroll:report:read'\)/);
  assert.match(routeSource, /router\.get\('\/testWebhook\/auditLogs',[^\n]*requirePayrollPermission\('payroll:webhook:audit:read'\)/);
  assert.match(routeSource, /router\.post\('\/processBatch',[^\n]*requirePayrollRole\('ADMIN'\)/);
  assert.match(routeSource, /router\.post\('\/reconcile',[^\n]*requirePayrollRole\('ADMIN'\)/);
  assert.doesNotMatch(routeSource, /router\.post\('\/processBatch',[^\n]*'TENANT_ADMIN'/);
  assert.doesNotMatch(routeSource, /router\.post\('\/reconcile',[^\n]*'TENANT_ADMIN'/);
  assert.match(routeSource, /function requirePayrollPermission\(permission\)/);
  assert.match(routeSource, /hasCanonicalPermission\(roles, permission\)/);
});

test('canonical RBAC grants institution administrators payroll reporting but not arbitrary write permissions', () => {
  assert.equal(hasPermission(['tenant_admin'], 'payroll:report:read'), true);
  assert.equal(hasPermission(['tenant_admin'], 'payroll:webhook:audit:read'), true);
  assert.equal(hasPermission(['tenant_admin'], 'payroll:batch:upload'), false);
  assert.equal(hasPermission(['member'], 'payroll:report:read'), false);
  assert.equal(hasPermission(['group_admin'], 'payroll:report:read'), false);
});

test('payroll officer is assignable as a tenant role and receives only scoped payroll operations', () => {
  const actor = { id: 'manager', role: 'tenant_admin', tenantId: 'tenant-a' };
  const sameTenant = { id: 'officer', role: 'member', tenantId: 'tenant-a' };
  const otherTenant = { id: 'other', role: 'member', tenantId: 'tenant-b' };
  assert.equal(canAssignUserRole(actor, sameTenant, 'payroll_officer').allowed, true);
  assert.equal(canAssignUserRole(actor, otherTenant, 'payroll_officer').allowed, false);
  assert.equal(hasPermission(['payroll_officer'], 'payroll:batch:upload'), true);
  assert.equal(hasPermission(['payroll_officer'], 'payroll:report:read'), true);
  assert.equal(hasPermission(['payroll_officer'], 'payroll:webhook:manage'), true);
  assert.equal(hasPermission(['payroll_officer'], 'payroll:batch:process'), false);
  assert.equal(hasPermission(['payroll_officer'], 'payroll:batch:reconcile'), false);
});

test('payroll auditor is a distinct read-only canonical role with legacy alias normalization', () => {
  assert.equal(normalizeRole('auditor'), 'payroll_auditor');
  assert.equal(hasPermission(['payroll_auditor'], 'payroll:report:read'), true);
  assert.equal(hasPermission(['payroll_auditor'], 'payroll:webhook:audit:read'), true);
  assert.equal(hasPermission(['payroll_auditor'], 'payroll:batch:upload'), false);
  assert.deepEqual(getPermissionsForRole('payroll_auditor').filter((p) => p.startsWith('payroll:')).sort(), [
    'payroll:report:read',
    'payroll:webhook:audit:read',
  ]);
});
