import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const k6 = fs.readFileSync(path.join(root, 'tests/performance/k6/titech-read-only-capacity.js'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'tests/performance/README.md'), 'utf8');
const plan = fs.readFileSync(path.join(root, 'docs/scalability/TITECH_CAPACITY_VALIDATION_PLAN.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('capacity workload targets only existing versioned health, refugee-partner and insurance read routes', () => {
  for (const route of [
    '/api/v1/health', '/api/v1/ready', '/api/v1/participant-onboarding/me',
    '/api/v1/refugee-partners/me', '/api/v1/insurance/readiness', '/api/v1/insurance/institution',
    '/api/v1/insurance/products', '/api/v1/insurance/enrolments', '/api/v1/insurance/premiums', '/api/v1/insurance/claims',
  ]) assert.ok(k6.includes(route), `missing repository route ${route}`);
});

test('initial capacity workload has no business-mutating HTTP calls', () => {
  assert.doesNotMatch(k6, /\bhttp\.(post|put|patch|del|delete)\s*\(/);
  assert.match(k6, /http\.get\(/);
  assert.match(k6, /does not create identity records/);
});

test('load profiles are bounded by the explicit approved virtual-user ceiling', () => {
  assert.match(k6, /TITECH_PERF_APPROVED_MAX_VUS/);
  assert.match(k6, /PROFILE\.maxVUs > APPROVED_MAX_VUS/);
  assert.match(k6, /'load-100'/);
  assert.match(k6, /'load-1000'/);
});

test('external and higher-load runs require staging, exact target approval and an approval ID', () => {
  assert.match(k6, /ENVIRONMENT !== 'staging'/);
  assert.match(k6, /APPROVED_TARGET !== BASE_URL/);
  assert.match(k6, /!APPROVAL_ID/);
  assert.match(k6, /production target is blocked/);
});

test('performance pass criteria include tail latency, errors and HTTP checks', () => {
  assert.match(k6, /http_req_failed: \['rate<0\.001'\]/);
  assert.match(k6, /p\(95\)<500/);
  assert.match(k6, /p\(99\)<1500/);
  assert.match(k6, /checks: \['rate>=0\.999'\]/);
});

test('tenant header is documented and implemented only as a consistency assertion', () => {
  assert.match(k6, /tenant-scope consistency assertion/);
  assert.match(readme, /cannot grant tenant authority or override the authenticated tenant/);
});

test('capacity claims explicitly distinguish virtual users from unique sessions and global capacity', () => {
  assert.match(readme, /does not establish distinct authenticated session counts/);
  assert.match(plan, /1.5-billion active-member objective/);
  assert.match(plan, /not evidence of capacity/);
});

test('root package exposes the performance contract check and test', () => {
  assert.equal(typeof pkg.scripts?.['check:performance-contract'], 'string');
  assert.equal(typeof pkg.scripts?.['test:performance-contract'], 'string');
});
