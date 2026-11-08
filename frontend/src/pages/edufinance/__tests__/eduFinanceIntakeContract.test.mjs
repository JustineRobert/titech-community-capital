import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(here, relative), 'utf8');

test('guardian intake UI delegates to the canonical applicant API wrapper', () => {
  const page = read('../EduFinancePage.jsx');
  const api = read('../../../services/eduFinanceApi.js');
  assert.match(page, /listMyEduFinanceApplications/);
  assert.match(page, /submitEduFinanceApplication/);
  assert.match(api, /EDUFINANCE_BASE = '\/api\/v1\/edufinance'/);
  assert.match(api, /\$\{EDUFINANCE_BASE\}\/applications\/me/);
  assert.match(api, /\/api\/v1\/edufinance/);
  assert.match(api, /'Idempotency-Key'/);
});

test('guardian intake UI requires the public presentation switch and authenticated session', () => {
  const page = read('../EduFinancePage.jsx');
  assert.match(page, /VITE_TITECH_EDUFINANCE_APPLICATIONS_ENABLED === 'true'/);
  assert.match(page, /APPLICATIONS_ENABLED && authenticated/);
  assert.match(read('../../../../.env.example'), /VITE_TITECH_EDUFINANCE_APPLICATIONS_ENABLED=false/);
  assert.match(read('../../../../.env.production.example'), /VITE_TITECH_EDUFINANCE_APPLICATIONS_ENABLED=false/);
});

test('EduFinance UI does not persist authentication or device credentials', () => {
  const page = read('../EduFinancePage.jsx');
  const api = read('../../../services/eduFinanceApi.js');
  assert.doesNotMatch(page, /localStorage|sessionStorage|accessToken|refreshToken|deviceSecret/i);
  assert.doesNotMatch(api, /localStorage|sessionStorage|accessToken|refreshToken|deviceSecret/i);
});

test('EduFinance CSS consumes the existing official semantic theme rather than a new palette', () => {
  const css = read('../edufinance.css');
  assert.match(css, /var\(--titech-brand-deep-blue\)/);
  assert.match(css, /var\(--titech-color-surface\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});
