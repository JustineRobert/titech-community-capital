import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const canonicalGroupTypes = [
  'savings',
  'investment',
  'community',
  'welfare',
  'farmer_group',
  'cooperative',
  'producer_organization',
  'vsla',
  'sacco',
  'chama',
  'rosca',
  'mixed_community_group',
];

test('official brand identity and tagline are consistent in active brand contracts', async () => {
  const [brand, backendBrand, theme, manifest, authLocale, html] = await Promise.all([
    read('frontend/src/branding/brand.js'),
    read('backend/shared/branding/brandConfig.cjs'),
    read('branding/TITECH_OFFICIAL_THEME.json'),
    read('branding/BRAND_MANIFEST.json'),
    read('frontend/src/i18n/locales/en/auth.json'),
    read('frontend/index.html'),
  ]);

  for (const source of [brand, backendBrand, theme, manifest, authLocale, html]) {
    assert.match(source, /Community Finance\. Stronger Together\./);
  }
  assert.match(brand, /fullName: 'TITech Community Capital'/);
  assert.match(brand, /displayName: 'TITECH CAPITAL - SMC LTD'/);
  assert.match(brand, /entityRegistrationNumber: '80049233029029'/);
  assert.match(brand, /postalAddress: 'P\.O\. Box 601200'/);
  assert.doesNotMatch(brand, /BUILD LESS\. PROVE MORE\./);
});

test('group model, controller and active creation UI share the canonical group type set', async () => {
  const [model, controller, createPage] = await Promise.all([
    read('backend/models/Group.js'),
    read('backend/controllers/groupController.js'),
    read('frontend/src/pages/CreateGroupV2.jsx'),
  ]);

  assert.match(controller, /GROUP_TYPES as SUPPORTED_GROUP_TYPES/);
  assert.match(controller, /new Set\(SUPPORTED_GROUP_TYPES\)/);
  for (const type of canonicalGroupTypes) {
    assert.match(model, new RegExp(`\\"${type}\\"`));
    assert.match(createPage, new RegExp(`value: '${type}'`));
  }
  assert.match(createPage, /does not establish licensing or regulated financial authority/i);
  assert.match(createPage, /members: \[\]/);
});

test('group details do not call the unmounted group-scoped contribution endpoint', async () => {
  const details = await read('frontend/src/pages/GroupDetails.jsx');
  assert.doesNotMatch(details, /\/api\/groups\/\$\{encodeURIComponent\([\s\S]{0,100}?\)\}\/contribute/);
  assert.match(details, /Contribution flow is awaiting authorized integration/);
  assert.match(details, /No payment has been initiated and no contribution has been recorded from this screen/);
  assert.match(details, /GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED|authoritative ledger position could not be retrieved/i);
});

test('group wallet financial reads enforce membership visibility and never synthesize a zero balance', async () => {
  const controller = await read('backend/controllers/groupWalletController.js');
  assert.match(controller, /await requireGroupViewAccess\(req, tenantId, groupId\)/);
  assert.match(controller, /GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED/);
  assert.match(controller, /error\.statusCode = 503/);
  assert.doesNotMatch(controller, /entries\.reduce\(applyLine/);
});

test('official theme and dashboard bridge use the canonical nine-color tokens', async () => {
  const [theme, dashboard, main] = await Promise.all([
    read('frontend/src/branding/official-theme.css'),
    read('frontend/src/branding/dashboard-theme.css'),
    read('frontend/src/main.jsx'),
  ]);
  const tokens = [
    '--titech-official-deep-blue',
    '--titech-official-electric-blue',
    '--titech-official-bright-blue',
    '--titech-official-cyan',
    '--titech-official-green',
    '--titech-official-lime',
    '--titech-official-gold',
    '--titech-official-navy',
    '--titech-official-white',
  ];
  for (const token of tokens) {
    assert.match(theme, new RegExp(`${token}:`));
  }
  assert.match(dashboard, /--dashboard-primary: var\(--titech-official-electric-blue\)/);
  assert.match(dashboard, /data-theme="dark"|titech-color-surface/);
  assert.match(main, /\.\/branding\/official-theme\.css/);
  assert.match(main, /\.\/branding\/dashboard-theme\.css/);
});

test('production approval remains fail-closed', async () => {
  const profile = JSON.parse(await read('branding/TITECH_ORGANIZATION_PROFILE.json'));
  assert.equal(profile.productionApproved, false);
});
