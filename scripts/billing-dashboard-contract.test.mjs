import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../frontend/src/pages/billing/BillingDashboardPage.jsx', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../frontend/src/routes/AppRoutes.jsx', import.meta.url), 'utf8');
const nav = fs.readFileSync(new URL('../frontend/src/navigation/navigationRegistry.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../frontend/src/pages/billing/BillingDashboardPage.css', import.meta.url), 'utf8');

test('all three billing workspaces call their canonical read-only API routes', () => {
  for (const route of ['/api/v1/billing/platform/overview', '/api/v1/billing/me/overview', '/api/v1/billing/platform/collections']) {
    assert.ok(dashboard.includes(route), `missing API route ${route}`);
  }
  assert.ok(dashboard.includes('/api/v1/billing/me/payments'));
});

test('three role-protected billing pages are registered and discoverable', () => {
  for (const route of ['/platform/billing', '/settings/billing', '/finance/billing-operations']) {
    assert.ok(routes.includes(route), `missing protected route ${route}`);
    assert.ok(nav.includes(route), `missing navigation path ${route}`);
  }
});

test('dashboard clearly avoids presenting incomplete revenue as a verified metric', () => {
  assert.ok(dashboard.includes("'NOT_AVAILABLE'") || dashboard.includes('Not available'));
  assert.ok(dashboard.includes('does not initiate payments'));
  assert.ok(dashboard.includes('TITECH_BRAND.tagline'));
  const brand = fs.readFileSync(new URL('../frontend/src/branding/brand.js', import.meta.url), 'utf8');
  assert.ok(brand.includes("tagline: 'Community Finance. Stronger Together.'"));
});

test('dashboard styling consumes the official light/dark-compatible tokens', () => {
  for (const token of ['--titech-color-background', '--titech-color-surface', '--titech-brand-deep-blue', '--titech-brand-cyan', '--titech-brand-lime', '--titech-brand-gold']) {
    assert.ok(styles.includes(`var(${token})`), `missing theme token ${token}`);
  }
});
