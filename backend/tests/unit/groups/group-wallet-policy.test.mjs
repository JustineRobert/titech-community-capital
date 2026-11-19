import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCanonicalGroupTenantId } from '../../../security/groupWalletPolicy.js';
import { canManageGroup, canViewGroupFinancials } from '../../../security/rbacPolicy.js';

const tenantObjectId = '6a0000000000000000000001';
const otherTenantObjectId = '6a0000000000000000000002';
const userObjectId = '6a0000000000000000000010';
const group = {
  tenantId: tenantObjectId,
  memberRoles: [
    { userId: userObjectId, role: 'treasurer', membershipStatus: 'active', invitationStatus: 'accepted' },
    { userId: '6a0000000000000000000011', role: 'member', membershipStatus: 'active', invitationStatus: 'accepted' },
    { userId: '6a0000000000000000000012', role: 'group_admin', membershipStatus: 'active', invitationStatus: 'accepted' },
  ],
};

test('wallet tenant resolver prefers authenticated ObjectId over tenant slug', () => {
  assert.equal(resolveCanonicalGroupTenantId({
    auth: { tenantId: tenantObjectId },
    tenant: { _id: tenantObjectId, tenantId: 'community-east' },
    tenantId: 'community-east',
  }), tenantObjectId);
});

test('wallet tenant resolver uses Tenant._id when middleware replaced req.tenantId with a slug', () => {
  assert.equal(resolveCanonicalGroupTenantId({
    tenant: { _id: tenantObjectId, tenantId: 'community-east' },
    tenantId: 'community-east',
  }), tenantObjectId);
});

test('wallet tenant resolver rejects a tenant slug when no canonical ObjectId exists', () => {
  assert.throws(
    () => resolveCanonicalGroupTenantId({ tenantId: 'community-east', tenant: { tenantId: 'community-east' } }),
    (error) => error.code === 'GROUP_TENANT_CONTEXT_INVALID' && error.statusCode === 403,
  );
});

test('wallet tenant resolver accepts authenticated user tenant ObjectId', () => {
  assert.equal(resolveCanonicalGroupTenantId({ user: { tenantId: tenantObjectId }, tenantId: 'community-east' }), tenantObjectId);
});

test('tenant administrator can view financial data only in the same tenant', () => {
  assert.equal(canViewGroupFinancials({ id: userObjectId, tenantId: tenantObjectId, role: 'tenant_admin' }, group), true);
  assert.equal(canViewGroupFinancials({ id: userObjectId, tenantId: otherTenantObjectId, role: 'tenant_admin' }, group), false);
});

test('active group treasurer and group administrator can view group financials', () => {
  assert.equal(canViewGroupFinancials({ id: userObjectId, tenantId: tenantObjectId, role: 'member' }, group), true);
  assert.equal(canViewGroupFinancials({ id: '6a0000000000000000000012', tenantId: tenantObjectId, role: 'member' }, group), true);
});

test('ordinary group membership does not grant access to wallet financials', () => {
  assert.equal(canViewGroupFinancials({ id: '6a0000000000000000000011', tenantId: tenantObjectId, role: 'member' }, group), false);
});

test('cross-tenant and unscoped platform support actors do not receive wallet access', () => {
  assert.equal(canViewGroupFinancials({ id: userObjectId, tenantId: otherTenantObjectId, role: 'platform_admin' }, group), false);
  assert.equal(canViewGroupFinancials({ id: userObjectId, role: 'platform_admin' }, group), false);
});

test('group-level administrators can manage their group without institution-wide admin roles', () => {
  assert.equal(canManageGroup({ id: '6a0000000000000000000012', tenantId: tenantObjectId, role: 'member' }, group), true);
  assert.equal(canManageGroup({ id: '6a0000000000000000000011', tenantId: tenantObjectId, role: 'group_admin' }, group), false);
  assert.equal(canManageGroup({ id: '6a0000000000000000000012', tenantId: otherTenantObjectId, role: 'member' }, group), false);
});

test('explicit financial-view delegation requires the correct tenant scope', () => {
  assert.equal(canViewGroupFinancials({ id: '6a0000000000000000000013', tenantId: tenantObjectId, role: 'payroll_auditor', permissions: ['GROUP_FINANCIAL_VIEW'] }, group), true);
  assert.equal(canViewGroupFinancials({ id: '6a0000000000000000000013', tenantId: otherTenantObjectId, role: 'payroll_auditor', permissions: ['GROUP_FINANCIAL_VIEW'] }, group), false);
});
