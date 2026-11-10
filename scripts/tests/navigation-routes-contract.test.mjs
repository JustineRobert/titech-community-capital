import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NAVIGATION_REGISTRY } from '../../frontend/src/navigation/navigationRegistry.js';

const routeSource = await readFile(new URL('../../frontend/src/routes/AppRoutes.jsx', import.meta.url), 'utf8');

test('the actual mounted router registers every navigation destination', () => {
  const expected = new Map([
    ['/dashboard', 'DASHBOARD'], ['/groups', 'GROUPS'], ['/create-group', 'CREATE_GROUP'],
    ['/meetings', 'MEETINGS'], ['/inclusive-onboarding', 'INCLUSIVE_ONBOARDING'],
    ['/retirement-support', 'RETIREMENT_SUPPORT'], ['/education-support', 'EDUCATION_SUPPORT'],
    ['/edufinance', 'EDUFINANCE'], ['/agriculture', 'AGRICULTURE'],
    ['/ubuntu-float', 'UBUNTU_FLOAT'], ['/partner-support', 'PARTNER_SUPPORT'],
  ]);
  for (const item of NAVIGATION_REGISTRY) {
    const constant = expected.get(item.to);
    assert.ok(constant, `unexpected navigation destination ${item.to}`);
    assert.match(routeSource, new RegExp(`path={ROUTES\.${constant}}`), `route not registered: ${item.to}`);
  }
  assert.match(routeSource, /path=\{ROUTES\.LEGACY_CREATE_GROUP\}[\s\S]*Navigate to=\{ROUTES\.CREATE_GROUP\}/);
});

test('public landing and product information pages are public and wrapped in the public site layout', () => {
  assert.match(routeSource, /path=\{ROUTES\.ROOT\}[\s\S]*InstitutionalHomePage/);
  assert.match(routeSource, /path=\{ROUTES\.EDUCATION_SUPPORT\}[\s\S]*EducationSupportPage/);
  assert.match(routeSource, /path=\{ROUTES\.EDUFINANCE\}[\s\S]*EduFinancePage/);
});
