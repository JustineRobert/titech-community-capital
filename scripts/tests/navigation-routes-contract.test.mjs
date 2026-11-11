import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAVIGATION_REGISTRY } from '../../frontend/src/navigation/navigationRegistry.js';

const routeSource = await readFile(new URL('../../frontend/src/routes/AppRoutes.jsx', import.meta.url), 'utf8');

test('the actual mounted router registers every navigation destination', () => {
  const expected = new Map([
    ['/dashboard', 'DASHBOARD'], ['/groups', 'GROUPS'], ['/create-group', 'CREATE_GROUP'],
    ['/meetings', 'MEETINGS'], ['/inclusive-onboarding', 'INCLUSIVE_ONBOARDING'],
    ['/retirement-support', 'RETIREMENT_SUPPORT'], ['/education-support', 'EDUCATION_SUPPORT'],
    ['/edufinance', 'EDUFINANCE'], ['/agriculture', 'AGRICULTURE'],
    ['/ubuntu-float', 'UBUNTU_FLOAT'], ['/partner-support', 'PARTNER_SUPPORT'],
    ['/faith-community-giving', 'FAITH_GIVING'],
    ['/faith-community-giving/manage', 'FAITH_GIVING_MANAGE'],
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
  assert.match(routeSource, /path=\{ROUTES\.FAITH_GIVING\}[\s\S]*FaithCommunityGivingPage/);
  assert.match(routeSource, /path=\{ROUTES\.FAITH_GIVING_MANAGE\}[\s\S]*FaithGivingManagerPage/);
});

test('route lazy-load failures reach the router-aware error boundary', () => {
  assert.match(routeSource, /import RouteErrorBoundary from '\.\/RouteErrorBoundary';/);
  assert.match(routeSource, /<RouteErrorBoundary>[\s\S]*<Suspense[\s\S]*<ApplicationRouteTree \/>[\s\S]*<\/RouteErrorBoundary>/);
  assert.match(routeSource, /throw error;/);
  assert.doesNotMatch(routeSource, /return new Promise\(\s*\(\) => \{\}\s*\)/);
});


test('every lazy route import target exists in the frontend source tree', () => {
  const sourceFile = fileURLToPath(new URL('../../frontend/src/routes/AppRoutes.jsx', import.meta.url));
  const sourceDirectory = dirname(sourceFile);
  const importSpecifiers = [...routeSource.matchAll(/import\(['"](\.{1,2}\/[^'"]+)['"]\)/g)]
    .map((match) => match[1]);

  assert.ok(importSpecifiers.length > 0, 'expected lazy route imports to be discovered');

  for (const specifier of importSpecifiers) {
    const base = join(sourceDirectory, specifier);
    const candidates = [
      base,
      ...['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].map((extension) => `${base}${extension}`),
      ...['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].map((extension) => join(base, `index${extension}`)),
    ];
    assert.ok(candidates.some((candidate) => existsSync(candidate)), `missing lazy route import target: ${specifier}`);
  }
});
