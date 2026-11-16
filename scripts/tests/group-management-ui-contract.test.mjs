import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeTitechRole } from '../../frontend/src/security/rbacPolicy.js';
import { normalizeRole } from '../../backend/security/rbacPolicy.js';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('Create Group uses the canonical route and preserves the optional-invitation path', async () => {
  const dashboard = await read('../../frontend/src/pages/Dashboard.jsx');
  const groupList = await read('../../frontend/src/pages/GroupList.jsx');
  const form = await read('../../frontend/src/pages/CreateGroupV2.jsx');
  assert.doesNotMatch(dashboard, /\/groups\/create/);
  assert.doesNotMatch(groupList, /\/groups\/create/);
  assert.match(form, /members:\s*\[\]/, 'group creation must not create invitations before the durable group exists');
  assert.match(form, /\/groups\/\$\{encodeURIComponent\(groupId\)\}\/send-invitations/);
  assert.match(form, /members:\s*batch\.map\(\(member\) =>/);
  assert.doesNotMatch(form, /Please add at least one valid member/);
  assert.doesNotMatch(form, /disabled=\{[\s\S]{0,80}validMembers\.length === 0/);
  assert.match(form, /invitations can be added later/);
  assert.match(dashboard, /dashboardNavigation\.map\(\(item\) =>/);
  assert.match(dashboard, /getNavigationItems\(true, userRoles\)/);
  assert.match(groupList, /canCreateGroup && \(/);
});


test('group creation email inputs keep a stable React key while the user types', async () => {
  const form = await read('../../frontend/src/pages/CreateGroupV2.jsx');
  const emailRows = form.match(/memberEmails\.map\(\(email, index\) =>[\s\S]*?\n\s*\}\)\}/)?.[0] ?? '';

  assert.ok(emailRows, 'manual member email list should be rendered from memberEmails');
  assert.match(emailRows, /const rowId = memberRowIds\[index\]/);
  assert.match(emailRows, /key=\{rowId\}/);
  assert.match(form, /setMemberRowIds\(members\.map\(\(\) => createMemberRowId\(\)\)\)/);
  assert.match(form, /setMemberRowIds\(\(previous\) => \[\.\.\.previous, createMemberRowId\(\)\]\)/);
  assert.doesNotMatch(emailRows, /key=\{[^}]*email/);
  assert.match(emailRows, /value=\{email\}/);
  assert.match(emailRows, /type="email"/);
  assert.match(emailRows, /placeholder="Existing institution member email"/);
  assert.match(emailRows, /handleEmailChange\(\s*rowId,\s*event\.currentTarget\.value\s*\)/);
  assert.match(emailRows, /const roleId = `member-role-\$\{rowId\}`/);
  assert.match(emailRows, /handleRoleChange\(\s*rowId,\s*event\.currentTarget\.value\s*\)/);
  assert.match(emailRows, /handleRemoveMember\(rowId\)/);
  assert.match(form, /pending in-app group invitation; it does not create a user account or send an external email/);
  assert.match(form, /GROUP_INVITE_MEMBER_UNAVAILABLE/);
});


test('group creation styling follows official semantic tokens and explicit theme selection', async () => {
  const css = await read('../../frontend/src/pages/CreateGroupV2.css');
  assert.match(css, /var\(--titech-official-electric-blue\)/);
  assert.match(css, /var\(--titech-state-danger\)/);
  assert.match(css, /var\(--titech-color-surface\)/);
  assert.doesNotMatch(css, /prefers-color-scheme/);
  assert.match(css, /data-titech-brand=\"official\"\]\[data-theme=\"dark\"\] \.create-group-wrapper/);
});

test('Group discovery join action passes a stable group ID and reconciles from the API', async () => {
  const groupList = await read('../../frontend/src/pages/GroupList.jsx');
  const card = await read('../../frontend/src/components/GroupCard.jsx');
  assert.match(groupList, /onClick=\{\(\) => onJoin\(normalizedId\)\}/);
  assert.match(groupList, /async \(groupId\) =>/);
  assert.match(groupList, /await fetchGroups\(\{\s*silent:\s*true/);
  assert.match(card, /onJoin\?\.\(resolvedId\)/);
  assert.doesNotMatch(groupList, /setGroups\(\(current\) =>[\s\S]{0,220}members:/);
});

test('Group Details only queries administrator membership requests after scoped role/ownership check', async () => {
  const details = await read('../../frontend/src/pages/GroupDetails.jsx');
  assert.match(details, /canManageMembershipForUser\(user, normalizedGroup\)/);
  assert.match(details, /\/membership-requests/);
  assert.match(details, /canManageMembershipRequests = canManageMembershipForUser\(user, group\)/);
  assert.match(details, /api\.patch\([\s\S]*members\/\$\{encodeURIComponent\(targetUserId\)\}[\s\S]*\{ action \}/);
});

test('frontend legacy admin alias matches the authoritative backend role contract', async () => {
  for (const legacyRole of ['admin', 'super_admin', 'tenantadmin', 'groupadmin', 'user']) {
    assert.equal(normalizeTitechRole(legacyRole), normalizeRole(legacyRole), `${legacyRole} role alias drifted`);
  }
  assert.equal(normalizeTitechRole('admin'), 'platform_admin');
  assert.equal(normalizeTitechRole('tenantadmin'), 'tenant_admin');
  assert.notEqual(normalizeTitechRole('platformadmin'), 'platform_admin', 'unsupported frontend-only aliases must not grant canonical privileges');
  assert.equal(normalizeTitechRole('administrator'), 'administrator', 'unsupported frontend-only privilege aliases must not be introduced');
});
test('group creation explains ambiguous network outcomes without encouraging blind duplicate retries', async () => {
  const form = await read('../../frontend/src/pages/CreateGroupV2.jsx');
  assert.match(form, /ERR_NETWORK/);
  assert.match(form, /refresh Group Management before retrying/);
  assert.match(form, /check whether the group exists before submitting again/);
});

