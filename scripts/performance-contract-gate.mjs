import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const k6Path = path.join(root, 'tests/performance/k6/titech-read-only-capacity.js');
const docsPath = path.join(root, 'tests/performance/README.md');
const planPath = path.join(root, 'docs/scalability/TITECH_CAPACITY_VALIDATION_PLAN.md');
const packagePath = path.join(root, 'package.json');
const failures = [];

function requireText(file, content, description) {
  if (!content.includes(description)) failures.push(`${path.relative(root, file)} is missing required contract: ${description}`);
}

for (const file of [k6Path, docsPath, planPath, packagePath]) {
  if (!fs.existsSync(file)) failures.push(`Missing required performance artifact: ${path.relative(root, file)}`);
}

if (failures.length === 0) {
  const k6 = fs.readFileSync(k6Path, 'utf8');
  const docs = fs.readFileSync(docsPath, 'utf8');
  const plan = fs.readFileSync(planPath, 'utf8');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  for (const endpoint of [
    '/api/v1/health',
    '/api/v1/ready',
    '/api/v1/participant-onboarding/me',
    '/api/v1/refugee-partners/me',
    '/api/v1/insurance/readiness',
    '/api/v1/insurance/products',
    '/api/v1/insurance/enrolments',
    '/api/v1/insurance/premiums',
    '/api/v1/insurance/claims',
  ]) requireText(k6Path, k6, endpoint);

  for (const fragment of [
    'TITECH_PERF_APPROVED_MAX_VUS',
    'TITECH_PERF_TARGET_APPROVED',
    'TITECH_PERF_APPROVAL_ID',
    'production target is blocked',
    "http.get(",
    "http_req_failed",
    "p(95)<500",
    "p(99)<1500",
  ]) requireText(k6Path, k6, fragment);

  if (/\bhttp\.(post|put|patch|del|delete)\s*\(/.test(k6)) {
    failures.push('The first-stage capacity script must remain read-only (GET requests only).');
  }
  requireText(docsPath, docs, 'does not establish distinct authenticated session counts');
  requireText(docsPath, docs, 'A production target is blocked by the harness');
  requireText(planPath, plan, '1.5-billion active-member objective');
  if (typeof pkg.scripts?.['check:performance-contract'] !== 'string') {
    failures.push('package.json does not expose check:performance-contract.');
  }
  if (typeof pkg.scripts?.['test:performance-contract'] !== 'string') {
    failures.push('package.json does not expose test:performance-contract.');
  }
}

const report = {
  status: failures.length ? 'FAIL' : 'PASS',
  artifact: 'TITech read-only capacity-test contract',
  checks: failures.length ? 'required-artifact and safety contract checks failed' : 'required files, confirmed endpoint paths, thresholds, bounded profiles and safety guards are present',
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
