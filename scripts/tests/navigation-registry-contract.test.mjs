import test from 'node:test';
import assert from 'node:assert/strict';
import { NAVIGATION_REGISTRY, getNavigationItems } from '../../frontend/src/navigation/navigationRegistry.js';

test('public service navigation exposes Education, EduFinance, Agriculture, UbuntuFloat and Partner Support', () => {
  const items = getNavigationItems(false);
  const routes = new Set(items.map((item) => item.to));
  for (const route of ['/education-support', '/edufinance', '/agriculture', '/ubuntu-float', '/partner-support', '/donations']) {
    assert.ok(routes.has(route), `missing public discovery route ${route}`);
  }
  assert.equal(items.some((item) => item.to === '/dashboard'), false);
});

test('authenticated navigation includes all service discovery routes and group creation', () => {
  const items = getNavigationItems(true, ['tenant_admin']);
  const routes = new Set(items.map((item) => item.to));
  for (const route of ['/dashboard', '/groups', '/create-group', '/meetings', '/education-support', '/edufinance', '/agriculture', '/ubuntu-float', '/partner-support', '/donations']) {
    assert.ok(routes.has(route), `missing authenticated route ${route}`);
  }
  assert.equal(new Set(NAVIGATION_REGISTRY.map((item) => item.id)).size, NAVIGATION_REGISTRY.length);
  assert.equal(new Set(NAVIGATION_REGISTRY.map((item) => item.to)).size, NAVIGATION_REGISTRY.length);
  assert.equal(getNavigationItems(true, ['member']).some((item) => item.to === '/create-group'), false);
  assert.equal(getNavigationItems(true, ['admin']).some((item) => item.to === '/create-group'), true);
});

test('public product discovery is derived from the canonical registry and includes partner-gated entry paths', async () => {
  const { PUBLIC_PRODUCT_DISCOVERY } = await import('../../frontend/src/navigation/navigationRegistry.js');
  const page = await (await import('node:fs/promises')).readFile(new URL('../../frontend/src/pages/public/InstitutionalPublicPages.jsx', import.meta.url), 'utf8');
  const ids = new Set(PUBLIC_PRODUCT_DISCOVERY.map((item) => item.id));
  for (const id of ['groups', 'educationSupport', 'eduFinance', 'agriculture', 'ubuntuFloat', 'partnerSupport', 'inclusiveOnboarding', 'retirementSupport', 'donations']) {
    assert.ok(ids.has(id), `homepage catalogue should include ${id}`);
  }
  assert.match(page, /PUBLIC_PRODUCT_DISCOVERY\.map\(\(product\) =>/);
  assert.match(page, /to=\{product\.requiresAuthentication \? '\/login' : product\.to\}/);
  assert.match(page, /state=\{product\.requiresAuthentication \? \{ from: \{ pathname: product\.to \} \} : undefined\}/);
  assert.match(page, /Community Finance\. Stronger Together\./);
  assert.match(page, /Register \/ Request Access/);
});
