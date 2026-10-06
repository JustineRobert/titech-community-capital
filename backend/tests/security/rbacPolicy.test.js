import {
  CANONICAL_ROLES,
  getPermissionsForRole,
  canAssignUserRole,
  canViewGroup,
  canManageGroup,
  normalizeRole,
} from '../../security/rbacPolicy.js';

describe('TITech canonical RBAC policy', () => {
  test('normalizes legacy admin aliases without changing the canonical model', () => {
    expect(normalizeRole('admin')).toBe('platform_admin');
    expect(normalizeRole('super_admin')).toBe('platform_admin');
    expect(normalizeRole('user')).toBe('member');
    expect(CANONICAL_ROLES).toEqual(['platform_admin', 'tenant_admin', 'group_admin', 'member', 'guest']);
  });

  test('member cannot promote self or another user', () => {
    const actor = { id: 'a', role: 'member', tenantId: 'tenant-a' };
    const target = { id: 'b', role: 'member', tenantId: 'tenant-a' };
    expect(canAssignUserRole(actor, target, 'tenant_admin').allowed).toBe(false);
    expect(canAssignUserRole(actor, { ...actor }, 'tenant_admin').allowed).toBe(false);
  });

  test('tenant admin cannot grant an equal or higher tenant/platform role', () => {
    const actor = { id: 'a', role: 'tenant_admin', tenantId: 'tenant-a' };
    const target = { id: 'b', role: 'member', tenantId: 'tenant-a' };
    expect(canAssignUserRole(actor, target, 'tenant_admin').allowed).toBe(false);
    expect(canAssignUserRole(actor, target, 'platform_admin').allowed).toBe(false);
    expect(canAssignUserRole(actor, target, 'group_admin', { group: { tenantId: 'tenant-a', memberRoles: [{ userId: 'b', membershipStatus: 'active', role: 'member' }] } }).allowed).toBe(true);
  });

  test('tenant isolation denies cross-tenant group access', () => {
    const actor = { id: 'a', role: 'tenant_admin', tenantId: 'tenant-a' };
    const group = { tenantId: 'tenant-b', createdBy: 'x', memberRoles: [] };
    expect(canViewGroup(actor, group)).toBe(false);
    expect(canManageGroup(actor, group)).toBe(false);
  });

  test('group admin authority is object-scoped to active group-admin membership', () => {
    const group = { tenantId: 'tenant-a', createdBy: 'owner', memberRoles: [{ userId: 'a', role: 'group_admin', membershipStatus: 'active', removedAt: null }] };
    expect(canManageGroup({ id: 'a', role: 'group_admin', tenantId: 'tenant-a' }, group)).toBe(true);
    expect(canManageGroup({ id: 'a', role: 'group_admin', tenantId: 'tenant-a' }, { ...group, memberRoles: [{ userId: 'a', role: 'group_admin', membershipStatus: 'suspended', removedAt: null }] })).toBe(false);
  });

  test('least privilege is reflected in permissions', () => {
    expect(getPermissionsForRole('member')).toContain('MEMBERSHIP_REQUEST');
    expect(getPermissionsForRole('member')).not.toContain('ROLE_ASSIGN');
    expect(getPermissionsForRole('tenant_admin')).toContain('ROLE_ASSIGN');
  });
});
