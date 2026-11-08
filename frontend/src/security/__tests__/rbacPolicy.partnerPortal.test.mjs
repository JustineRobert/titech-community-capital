import test from 'node:test';
import assert from 'node:assert/strict';
import { hasTitechPermission } from '../rbacPolicy.js';

test('route permission mirror exposes support workspace only to aligned roles', () => {
  assert.equal(hasTitechPermission({ role: 'SUPPORT_AGENT' }, 'support:case:read'), true);
  assert.equal(hasTitechPermission({ role: 'AUDITOR' }, 'support:case:create'), false);
  assert.equal(hasTitechPermission({ role: 'MEMBER' }, 'support:case:read'), false);
  assert.equal(hasTitechPermission({ role: 'TENANT_ADMIN' }, 'support:case:create'), true);
});

test('route permission mirror reflects meeting read grants and explicit permissions', () => {
  assert.equal(hasTitechPermission({ role: 'GROUP_LEADER' }, 'meetings:read'), true);
  assert.equal(hasTitechPermission({ role: 'GROUP_LEADER' }, 'meetings:minutes:publish'), false);
  assert.equal(hasTitechPermission({ role: 'CUSTOM_ROLE', permissions: ['support:case:read'] }, 'support:case:read'), true);
  assert.equal(hasTitechPermission({ role: 'CUSTOM_ROLE' }, 'support:case:read'), false);
});
