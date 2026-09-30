#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const sha256 = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const manifest = JSON.parse(read('branding/BRAND_MANIFEST.json'));
const colors = manifest.visual_identity_reference;
const requiredColors = Object.entries(colors);
const checks = [];
const blockers = [];
const warnings = [];

function add(id, status, message, details = []) {
  checks.push({ id, status, message, details });
  if (status === 'BLOCKED') blockers.push(`${id}: ${message}`);
  if (status === 'WARN') warnings.push(`${id}: ${message}`);
}

if (!exists('frontend/src/branding/official-theme.css')) {
  add('official-theme-file', 'BLOCKED', 'Official theme stylesheet is missing.');
} else {
  add('official-theme-file', 'PASS', 'Official theme stylesheet exists.');
}

const brandJs = read('frontend/src/branding/brand.js');
const brandConfig = read('backend/shared/branding/brandConfig.cjs');
const themeCss = read('frontend/src/branding/official-theme.css');

const missingFrontendColors = requiredColors.filter(([, hex]) => !brandJs.includes(hex));
const missingBackendColors = requiredColors.filter(([, hex]) => !brandConfig.includes(hex));
const missingThemeColors = requiredColors.filter(([, hex]) => !themeCss.includes(hex.toLowerCase()));

add(
  'palette-frontend',
  missingFrontendColors.length ? 'BLOCKED' : 'PASS',
  missingFrontendColors.length ? 'Frontend brand contract does not contain every official palette value.' : 'All official palette values are present in the frontend brand contract.',
  missingFrontendColors.map(([name]) => name),
);
add(
  'palette-backend',
  missingBackendColors.length ? 'BLOCKED' : 'PASS',
  missingBackendColors.length ? 'Backend brand contract does not contain every official palette value.' : 'All official palette values are present in the backend brand contract.',
  missingBackendColors.map(([name]) => name),
);
add(
  'palette-theme',
  missingThemeColors.length ? 'BLOCKED' : 'PASS',
  missingThemeColors.length ? 'Official theme does not reference every supplied palette value.' : 'Official theme references every supplied palette value.',
  missingThemeColors.map(([name]) => name),
);

const mainJs = read('frontend/src/main.jsx');
add('runtime-brand-namespace', (mainJs.includes('applyOfficialBrandTheme()') || mainJs.includes('applyOfficialBrandRuntime()')) ? 'PASS' : 'BLOCKED', 'Browser startup applies the official brand namespace.');

const chartFiles = [
  'frontend/src/charts/BarChartCard.jsx',
  'frontend/src/charts/PieChartCard.jsx',
  'frontend/src/charts/LineChartCard.jsx',
  'frontend/src/charts/AreaChartCard.jsx',
];
const chartViolations = chartFiles.flatMap((rel) => {
  const s = read(rel);
  return /#(8b5cf6|ec4899|ef4444|f59e0b|22c55e|0ea5e9)/i.test(s) ? [rel] : [];
});
add('chart-palette', chartViolations.length ? 'BLOCKED' : 'PASS', chartViolations.length ? 'Default chart palettes still contain non-official visual colors.' : 'Default chart palettes use the official TITech palette contract.', chartViolations);

const variants = [
  'branding/generated/titech-community-capital-full.png',
  'branding/generated/titech-community-capital-transparent.png',
  'branding/generated/titech-community-capital-monochrome.png',
  'branding/generated/titech-community-capital-app-icon.png',
  'branding/generated/titech-community-capital-icon-512.png',
  'branding/generated/titech-community-capital-icon-192.png',
  'branding/generated/favicon.ico',
];
const missingVariants = variants.filter((rel) => !exists(rel));
add('generated-assets', missingVariants.length ? 'BLOCKED' : 'PASS', missingVariants.length ? 'Generated brand variants are missing.' : 'Generated official brand variants exist.', missingVariants);

const copyPairs = [
  ['branding/generated/titech-community-capital-full.png', 'frontend/public/brand/titech-community-capital-full.png'],
  ['branding/generated/titech-community-capital-transparent.png', 'frontend/public/brand/titech-community-capital-transparent.png'],
  ['branding/generated/titech-community-capital-monochrome.png', 'frontend/public/brand/titech-community-capital-monochrome.png'],
  ['branding/generated/titech-community-capital-icon-192.png', 'frontend/public/brand/titech-community-capital-icon-192.png'],
  ['branding/generated/titech-community-capital-icon-512.png', 'frontend/public/brand/titech-community-capital-icon-512.png'],
  ['branding/generated/favicon.ico', 'frontend/public/brand/favicon.ico'],
];
const copyMismatches = copyPairs.filter(([a,b]) => !exists(b) || sha256(path.join(ROOT,a)) !== sha256(path.join(ROOT,b))).map(([a,b]) => `${a} != ${b}`);
add('deployment-copy-integrity', copyMismatches.length ? 'BLOCKED' : 'PASS', copyMismatches.length ? 'Deployment brand copies differ from canonical generated variants.' : 'Deployment brand copies match canonical generated variants.', copyMismatches);

const sourceSha = sha256(path.join(ROOT, manifest.source));
add('canonical-logo-hash', sourceSha === manifest.source_sha256 ? 'PASS' : 'BLOCKED', sourceSha === manifest.source_sha256 ? 'Canonical logo hash matches the approved manifest.' : 'Canonical logo hash does not match the approved manifest.', [sourceSha, manifest.source_sha256]);

const srcRoot = path.join(ROOT, 'frontend/src');
const jsFiles = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build', 'coverage'].includes(item.name)) continue;
    const p = path.join(dir, item.name);
    if (item.isDirectory()) walk(p);
    else if (/\.(css|scss|jsx?|tsx?)$/i.test(item.name)) jsFiles.push(p);
  }
}
walk(srcRoot);
const officialHex = new Set(Object.values(colors).map((v) => v.toLowerCase()));
const literalMatches = [];
for (const p of jsFiles) {
  const rel = path.relative(ROOT, p).replaceAll(path.sep, '/');
  if (['frontend/src/branding/brand.css', 'frontend/src/branding/official-theme.css'].includes(rel)) continue;
  const s = fs.readFileSync(p, 'utf8');
  for (const match of s.matchAll(/#[0-9a-fA-F]{6}/g)) {
    const hex = match[0].toLowerCase();
    if (!officialHex.has(hex)) literalMatches.push({ file: rel, hex });
  }
}
add('legacy-literals-inventory', literalMatches.length ? 'WARN' : 'PASS', literalMatches.length ? `${literalMatches.length} non-official color literals remain in frontend source; these require component-by-component semantic migration rather than blanket replacement.` : 'No non-official color literals remain outside the brand-layer stylesheets.', literalMatches.slice(0, 40));

const status = blockers.length ? 'BLOCKED' : 'PASS';
const payload = {
  generatedAt: new Date().toISOString(),
  repository: 'https://github.com/JustineRobert/titech-community-capital',
  mode: strict ? 'strict' : 'audit',
  status: strict && blockers.length ? 'BLOCKED' : status,
  blockers,
  warnings,
  checks,
};
fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports/titech-brand-gate.json'), JSON.stringify(payload, null, 2) + '\n');
console.log(`TITech brand gate: ${payload.status}`);
for (const check of checks) console.log(`[${check.status}] ${check.id}: ${check.message}`);
if (strict && blockers.length) process.exitCode = 1;
