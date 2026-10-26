import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const checks = [];
function check(name, predicate, detail) {
  checks.push({ name, ok: Boolean(predicate), detail });
  if (!predicate) failures.push(name);
}
function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : null;
}

const themeText = read('branding/TITECH_OFFICIAL_THEME.json');
let theme = null;
if (themeText) {
  try { theme = JSON.parse(themeText); } catch { /* checked below */ }
}
check('official theme JSON parses', Boolean(theme), 'branding/TITECH_OFFICIAL_THEME.json');
check('official organization name', theme?.organization === 'TITech Capital LTD', `found ${JSON.stringify(theme?.organization)}`);
const expectedPalette = {
  deepBlue: '#0030A0', electricBlue: '#0058D8', brightBlue: '#0066E8', cyan: '#00B8F8',
  africaGreen: '#008000', limeGreen: '#A8F000', goldYellow: '#F8D800', navyInk: '#082B67', white: '#FFFFFF',
};
const palette = theme?.palette ?? {};
check('all nine official palette colors preserved', Object.entries(expectedPalette).every(([key, value]) => palette[key] === value), JSON.stringify(palette));

const brandJs = read('frontend/src/branding/brand.js');
check('frontend brand contract exists', brandJs !== null, 'frontend/src/branding/brand.js');
check('frontend legalName is canonical', Boolean(brandJs?.includes("legalName: 'TITech Capital LTD'")), 'TITECH_BRAND.legalName');

for (const relativePath of ['package.json', 'backend/package.json']) {
  const content = read(relativePath);
  let parsed = null;
  if (content) { try { parsed = JSON.parse(content); } catch { /* reported below */ } }
  check(`${relativePath} parses`, Boolean(parsed), relativePath);
  check(`${relativePath} does not use stale corporate suffix`, !String(parsed?.author ?? '').includes('TITech Community Capital LTD'), `author=${JSON.stringify(parsed?.author)}`);
}

const legalContentText = read('shared/legal/legalDocuments.json');
let legalContent = null;
if (legalContentText) { try { legalContent = JSON.parse(legalContentText); } catch { /* checked below */ } }
check('canonical shared legal source parses', Boolean(legalContent), 'shared/legal/legalDocuments.json');
check('legal content remains visibly gated as draft', legalContent?.status === 'draft', `status=${JSON.stringify(legalContent?.status)}`);
check('canonical operator and product identities are consistent', legalContent?.organizationName === 'TITech Capital LTD' && legalContent?.productName === 'TITech Community Capital', 'organizationName/productName');
check('canonical legal documents include all required routes', ['/legal', '/terms', '/privacy'].every((route) => Object.values(legalContent?.documents || {}).some((document) => document.path === route)), 'legal paths');

const report = { status: failures.length ? 'FAIL' : 'PASS', checkedAt: new Date().toISOString(), checks, failures };
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
