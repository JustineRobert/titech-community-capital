import test from 'node:test';
import assert from 'node:assert/strict';
import { NAVIGATION_REGISTRY, getNavigationItems } from '../../frontend/src/navigation/navigationRegistry.js';

test('public service navigation exposes Education, EduFinance, Agriculture, UbuntuFloat and Partner Support', () => {
  const items = getNavigationItems(false);
  const routes = new Set(items.map((item) => item.to));
  for (const route of ['/education-support', '/edufinance', '/agriculture', '/ubuntu-float', '/partner-support']) {
    assert.ok(routes.has(route), `missing public discovery route ${route}`);
  }
  assert.equal(items.some((item) => item.to === '/dashboard'), false);
});

test('authenticated navigation includes all service discovery routes and group creation', () => {
  const items = getNavigationItems(true, ['tenant_admin']);
  const routes = new Set(items.map((item) => item.to));
  for (const route of ['/dashboard', '/groups', '/create-group', '/meetings', '/education-support', '/edufinance', '/agriculture', '/ubuntu-float', '/partner-support']) {
    assert.ok(routes.has(route), `missing authenticated route ${route}`);
  }
  assert.equal(new Set(NAVIGATION_REGISTRY.map((item) => item.id)).size, NAVIGATION_REGISTRY.length);
  assert.equal(new Set(NAVIGATION_REGISTRY.map((item) => item.to)).size, NAVIGATION_REGISTRY.length);
  assert.equal(getNavigationItems(true, ['member']).some((item) => item.to === '/create-group'), false);
  assert.equal(getNavigationItems(true, ['admin']).some((item) => item.to === '/create-group'), true);
});
