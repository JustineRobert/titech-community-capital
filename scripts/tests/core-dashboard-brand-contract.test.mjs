import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

const surfaces = [
  {
    name: 'community dashboard',
    component: 'frontend/src/pages/Dashboard.jsx',
    stylesheet: 'frontend/src/pages/Dashboard.css',
    className: 'dashboard-eyebrow',
  },
  {
    name: 'platform administration dashboard',
    component: 'frontend/src/pages/admin/AdminDashboard.jsx',
    stylesheet: 'frontend/src/pages/admin/AdminDashboard.css',
    className: 'admin-eyebrow',
  },
  {
    name: 'groups directory',
    component: 'frontend/src/pages/GroupList.jsx',
    stylesheet: 'frontend/src/pages/GroupList.css',
    className: 'group-list-eyebrow',
  },
  {
    name: 'members directory',
    component: 'frontend/src/pages/Members.jsx',
    stylesheet: 'frontend/src/pages/Members.css',
    className: 'members-eyebrow',
  },
  {
    name: 'agriculture dashboard',
    component: 'frontend/src/pages/agriculture/AgricultureDashboard.jsx',
    stylesheet: 'frontend/src/pages/agriculture/AgricultureDashboard.css',
    className: 'agriculture-eyebrow',
  },
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('core dashboard headers render the canonical organization, product and tagline', () => {
  for (const surface of surfaces) {
    const source = read(surface.component);
    assert.match(
      source,
      /import\s+TITECH_BRAND\s+from\s+['"][^'"]*branding\/brand['"]/,
      `${surface.name} must import the canonical brand contract`,
    );
    assert.match(
      source,
      /TITECH_BRAND\.organizationName\s*\}\s*·\s*\{\s*TITECH_BRAND\.fullName\s*\}\s*·\s*\{\s*TITECH_BRAND\.tagline/,
      `${surface.name} must render the legal entity, product and official tagline from the brand contract`,
    );
  }
});

test('core dashboard brand eyebrows wrap safely on narrow screens', () => {
  for (const surface of surfaces) {
    const css = read(surface.stylesheet);
    assert.ok(
      css.includes(`.${surface.className}`),
      `${surface.name} must have a scoped eyebrow style`,
    );
    assert.match(
      css,
      /overflow-wrap:\s*anywhere/,
      `${surface.name} must prevent the longer organization lockup from overflowing`,
    );
  }
});

test('brand identity remains centralized in the official platform contract', () => {
  const brand = read('frontend/src/branding/brand.js');
  const profile = JSON.parse(read('branding/TITECH_ORGANIZATION_PROFILE.json'));

  assert.match(brand, /tagline:\s*'Community Finance\. Stronger Together\.'/);
  assert.equal(profile.productName, 'TITech Community Capital');
  assert.equal(profile.organizationDisplayName, 'TITECH CAPITAL - SMC LTD');
  assert.equal(profile.entityRegistrationNumber, '80049233029029');
  assert.equal(profile.officialContacts.email, 'titechcapital@gmail.com');
  assert.equal(profile.officialContacts.telephone, '+256782397907');
  assert.equal(profile.officialContacts.whatsapp, '+256772123546');
  assert.equal(profile.postalAddress, 'P.O. Box 601200');
});