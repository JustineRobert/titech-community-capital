import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PUBLIC_PRODUCT_DISCOVERY } from '../../frontend/src/navigation/navigationRegistry.js';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('homepage publishes the canonical TITech service catalogue without creating a second registry', async () => {
  const page = await read('../../frontend/src/pages/public/InstitutionalPublicPages.jsx');
  const registry = await read('../../frontend/src/navigation/navigationRegistry.js');
  for (const id of ['groups', 'educationSupport', 'eduFinance', 'agriculture', 'ubuntuFloat', 'partnerSupport', 'inclusiveOnboarding', 'retirementSupport', 'donations']) {
    assert.ok(PUBLIC_PRODUCT_DISCOVERY.some((item) => item.id === id), `missing discovery record ${id}`);
  }
  assert.match(page, /PUBLIC_PRODUCT_DISCOVERY\.map\(\(product\) =>/);
  assert.match(registry, /PUBLIC_PRODUCT_DISCOVERY = Object\.freeze\(/);
  assert.match(page, /Community Finance\. Stronger Together\./);
  assert.match(page, /Licensed insurers and approved intermediaries/);
  assert.match(page, /refugee \/ host-community programmes/);
  assert.match(registry, /licence review, explicit participant consent, enrolment, premium-evidence and claims-reference workflows/);
});

test('protected service cards preserve the requested destination through the existing login route', async () => {
  const page = await read('../../frontend/src/pages/public/InstitutionalPublicPages.jsx');
  const login = await read('../../frontend/src/pages/Login.jsx');
  assert.match(page, /to=\{product\.requiresAuthentication \? '\/login' : product\.to\}/);
  assert.match(page, /state=\{product\.requiresAuthentication \? \{ from: \{ pathname: product\.to \} \} : undefined\}/);
  assert.match(login, /stateFromLocation/);
  assert.match(login, /storedTarget\?\.pathname/);
});

test('shared application footer renders the official tagline and official palette accents', async () => {
  const footer = await read('../../frontend/src/components/Footer.jsx');
  const css = await read('../../frontend/src/components/Footer.css');
  assert.match(footer, /TITECH_BRAND\.tagline/);
  assert.match(css, /--titech-footer-bg: var\(--titech-official-navy\)/);
  assert.match(css, /--titech-footer-accent: var\(--titech-official-cyan\)/);
  assert.doesNotMatch(css, /#38bdf8|#0ea5e9|#0b1220|#111b2e/i);
});
