import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPermission } from '../../../middleware/platformPermissions.js';

test('explicit action permission is honored', () => {
  assert.equal(hasPermission({ permissions: ['capital:share:create'] }, 'capital:share:create'), true);
  assert.equal(hasPermission({ permissions: ['capital:share:create'] }, 'capital:share:approve'), false);
});

test('tenant admin gets scoped control-plane permissions', () => {
  assert.equal(hasPermission({ role: 'TENANT_ADMIN' }, 'consent:grant'), true);
  assert.equal(hasPermission({ role: 'TENANT_ADMIN' }, 'capital:share:approve'), false);
});
