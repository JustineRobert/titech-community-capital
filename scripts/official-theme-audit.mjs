#!/usr/bin/env node

/**
 * TITech Community Capital — Official Theme Consistency Audit
 * Dependency-free repository check for the visual reference supplied on
 * 2026-09-30 and the deterministic light/dark theme runtime.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const fail = (id, message) => checks.push({ id, status: 'FAIL', message });
const pass = (id, message) => checks.push({ id, status: 'PASS', message });
const checks = [];

const requiredPalette = {
  deepBlue: '#0030A0',
  electricBlue: '#0058D8',
  brightBlue: '#0066E8',
  cyan: '#00B8F8',
  africaGreen: '#008000',
  limeGreen: '#A8F000',
  goldYellow: '#F8D800',
  navyInk: '#082B67',
  white: '#FFFFFF',
};

function normalizedHexes(text) {
  return new Set((text.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).map((x) => x.toUpperCase()));
}

let manifest;
try {
  manifest = JSON.parse(read('branding/BRAND_MANIFEST.json'));
  pass('manifest-json', 'branding/BRAND_MANIFEST.json is valid JSON.');
} catch (error) {
  fail('manifest-json', `Brand manifest is invalid: ${error.message}`);
  manifest = {};
}

const refs = [
  ['manifest-visual-identity', manifest.visual_identity_reference ?? {}, { deepBlue: 'deep_blue', electricBlue: 'electric_blue', brightBlue: 'bright_blue', cyan: 'cyan', africaGreen: 'africa_green', limeGreen: 'lime_green', goldYellow: 'gold_yellow', navyInk: 'navy_ink', white: 'white' }],
  ['manifest-platform-theme', manifest.platform_theme?.palette ?? {}, { deepBlue: 'deep_blue', electricBlue: 'electric_blue', brightBlue: 'bright_blue', cyan: 'cyan', africaGreen: 'africa_green', limeGreen: 'lime_green', goldYellow: 'gold_yellow', navyInk: 'navy_ink', white: 'white' }],
];
for (const [id, palette, keyMap] of refs) {
  const missing = Object.entries(requiredPalette).filter(([key, value]) => String(palette[keyMap[key]] ?? '').toUpperCase() !== value);
  if (missing.length) fail(id, `Missing or mismatched palette entries: ${missing.map(([k]) => k).join(', ')}`);
  else pass(id, 'All nine official palette values match the supplied reference contract.');
}

try {
  const contract = JSON.parse(read('branding/TITECH_OFFICIAL_THEME.json'));
  const missing = Object.entries(requiredPalette).filter(([name, value]) => String(contract.palette?.[name] ?? '').toUpperCase() !== value);
  if (missing.length) fail('root-theme-contract', `branding/TITECH_OFFICIAL_THEME.json mismatches: ${missing.map(([k]) => k).join(', ')}`);
  else if (!Array.isArray(contract.supportedThemes) || !contract.supportedThemes.includes('light') || !contract.supportedThemes.includes('dark')) fail('root-theme-contract', 'Theme contract must declare explicit light and dark themes.');
  else pass('root-theme-contract', 'Root official theme contract contains all nine palette values and explicit light/dark modes.');
} catch (error) {
  fail('root-theme-contract', `Unable to validate branding/TITECH_OFFICIAL_THEME.json: ${error.message}`);
}

for (const [id, file, key] of [
  ['mobile-tokens', 'mobile/branding/titech-theme.tokens.json', 'palette'],
]) {
  try {
    const data = JSON.parse(read(file));
    const missing = Object.entries(requiredPalette).filter(([name, value]) => String(data[key]?.[name] ?? '').toUpperCase() !== value);
    if (missing.length) fail(id, `Mismatched palette entries: ${missing.map(([k]) => k).join(', ')}`);
    else pass(id, 'Mobile token palette matches the official TITech palette.');
  } catch (error) {
    fail(id, `Unable to validate ${file}: ${error.message}`);
  }
}

const sourceHash = '8a82c0164b927cd1bba45179b7a817b12259567850fa14f71d0c9504facd2f21';
const providedLogo = 'branding/official/TITech_Official_Logo_Transparent_Provided_2026-10-08.png';
const providedLogoHash = 'f3736df3e46aca7941e71cd8d7cacd87fe7aceb79620d38c181c8ebce528dce5';
if (!exists(providedLogo)) {
  fail('provided-logo-provenance', `${providedLogo} is missing.`);
} else {
  const actualLogoHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, providedLogo))).digest('hex');
  if (actualLogoHash === providedLogoHash) pass('provided-logo-provenance', 'User-supplied official transparent logo asset is present and SHA-256 verified.');
  else fail('provided-logo-provenance', `Provided official logo SHA-256 mismatch: ${actualLogoHash}`);
}

const reference = 'branding/reference/TITech_FinTech_Platform_Hosting_Guide_2026-09-30.png';
if (!exists(reference)) {
  fail('reference-image', `${reference} is missing.`);
} else {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, reference))).digest('hex');
  if (actual === sourceHash) pass('reference-image', 'Supplied theme reference image is present and SHA-256 verified.');
  else fail('reference-image', `Theme reference SHA-256 mismatch: ${actual}`);
}

const brandJs = read('frontend/src/branding/brand.js');
const brandCss = read('frontend/src/branding/brand.css');
const officialCss = read('frontend/src/branding/official-theme.css');
const themeTokensJs = read('frontend/src/branding/themeTokens.js');

const tokenBridgeMissing = Object.entries(requiredPalette).filter(([, value]) => !(themeTokensJs.match(new RegExp(value, 'gi')) ?? []).length);
if (tokenBridgeMissing.length) {
  fail('js-token-bridge-palette', `frontend/src/branding/themeTokens.js is missing official palette values: ${tokenBridgeMissing.map(([k]) => k).join(', ')}`);
} else if (!/TITECH_CHART_COLORS/.test(themeTokensJs) || !/TITECH_SEMANTIC_COLORS/.test(themeTokensJs)) {
  fail('js-token-bridge-contract', 'themeTokens.js must expose canonical chart and semantic runtime color contracts.');
} else {
  pass('js-token-bridge-contract', 'JavaScript/JSX color consumers have a centralized official chart palette and semantic state-color bridge.');
}
for (const [id, text, scope] of [
  ['brand-js-palette', brandJs, 'frontend/src/branding/brand.js'],
  ['brand-css-palette', brandCss, 'frontend/src/branding/brand.css'],
  ['official-theme-css-palette', officialCss, 'frontend/src/branding/official-theme.css'],
]) {
  const hexes = normalizedHexes(text);
  const missing = Object.entries(requiredPalette).filter(([, value]) => !hexes.has(value));
  if (missing.length) fail(id, `${scope} is missing official palette values: ${missing.map(([k]) => k).join(', ')}`);
  else pass(id, `${scope} exposes all official palette values.`);
}

const themeJs = read('frontend/src/branding/theme.js');
if (/DEFAULT_THEME\s*=\s*'light'/.test(themeJs) && /THEME_LIGHT\s*=\s*'light'/.test(themeJs) && /THEME_DARK\s*=\s*'dark'/.test(themeJs)) {
  pass('theme-runtime-contract', 'Theme runtime uses deterministic light default with explicit light/dark values.');
} else {
  fail('theme-runtime-contract', 'Theme runtime default/valid theme contract is incomplete.');
}
if (!/matchMedia\s*\(/.test(themeJs) && !/prefers-color-scheme/.test(themeJs)) {
  pass('no-system-default', 'Theme runtime does not consult OS/browser system preference as the default contract.');
} else {
  fail('no-system-default', 'Theme runtime still contains system-preference coupling.');
}

for (const [id, file, required] of [
  ['main-entry-theme-bootstrap', 'frontend/src/main.jsx', ["import { applyTheme, getInitialTheme } from './branding/theme';", 'applyTheme(getInitialTheme());']],
  ['index-entry-theme-bootstrap', 'frontend/src/index.js', ["import { applyTheme, getInitialTheme } from './branding/theme';", 'applyTheme(initialTheme);']],
  ['theme-tests', 'frontend/src/branding/__tests__/theme.test.js', ['defaults deterministically to light', 'uses the TITech-namespaced storage key while preserving explicit preferences', 'falls back to light for invalid persisted state', 'clear']],
]) {
  if (!exists(file)) {
    fail(id, `${file} is missing.`);
    continue;
  }
  const text = read(file);
  const missing = required.filter((needle) => !text.includes(needle));
  if (missing.length) fail(id, `${file} is missing required theme contract markers: ${missing.join(' | ')}`);
  else pass(id, `${file} is wired to the canonical official theme contract.`);
}



const FRONTEND_SOURCE_ROOT = path.join(ROOT, 'frontend', 'src');
const officialPaletteHexes = new Set(Object.values(requiredPalette).map((value) => value.toUpperCase()));
const officialColorToRole = Object.fromEntries(
  Object.entries(requiredPalette).map(([role, value]) => [value.toUpperCase(), role]),
);

function walkFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage', 'build'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, result);
    else result.push(full);
  }
  return result;
}

function auditFrontendThemeCoverage() {
  const files = walkFiles(FRONTEND_SOURCE_ROOT);
  const cssFiles = files.filter((file) => /\.css$/i.test(file));
  const nonBrandCssFiles = cssFiles.filter((file) => !file.includes(`${path.sep}branding${path.sep}`));
  const hardcodedOfficial = [];
  const hardcodedOfficialByRole = Object.fromEntries(Object.keys(requiredPalette).map((key) => [key, 0]));

  for (const file of nonBrandCssFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const hits = normalizedHexes(text);
    for (const hex of hits) {
      if (!officialPaletteHexes.has(hex)) continue;
      const role = officialColorToRole[hex];
      const occurrences = (text.match(new RegExp(hex.replace('#', '#'), 'gi')) ?? []).length;
      hardcodedOfficial.push({
        file: path.relative(ROOT, file).replaceAll(path.sep, '/'),
        role,
        occurrences,
      });
      hardcodedOfficialByRole[role] += occurrences;
    }
  }

  if (hardcodedOfficial.length === 0) {
    pass(
      'frontend-css-token-coverage',
      `All ${nonBrandCssFiles.length} non-brand frontend CSS files consume the centralized TITech brand token layer rather than hard-coding official palette hex values.`,
    );
  } else {
    fail(
      'frontend-css-token-coverage',
      `Found ${hardcodedOfficial.reduce((sum, item) => sum + item.occurrences, 0)} hard-coded official palette usages across ${hardcodedOfficial.length} non-brand CSS files.`,
    );
  }

  const componentEntrypoints = [
    'frontend/src/main.jsx',
    'frontend/src/index.js',
    'frontend/src/branding/brand.css',
    'frontend/src/branding/official-theme.css',
    'frontend/src/branding/theme.js',
  ];
  const missingEntrypoints = componentEntrypoints.filter((file) => !exists(file));
  if (missingEntrypoints.length) {
    fail('frontend-theme-entrypoints', `Canonical frontend theme entrypoints are missing: ${missingEntrypoints.join(', ')}`);
  } else {
    pass('frontend-theme-entrypoints', 'Web/PWA startup, semantic brand CSS and theme runtime entrypoints are present.');
  }

  // Inline chart/JS colors are retained as an advisory metric because CSS
  // custom properties cannot safely replace colors consumed by canvas/chart
  // libraries. New UI code should use TITECH_BRAND.colorRoles instead.
  const scriptFiles = files.filter((file) => /\.(?:js|jsx|ts|tsx)$/i.test(file) && !file.includes(`${path.sep}branding${path.sep}`));
  let inlineHexOccurrences = 0;
  const inlineFiles = [];
  for (const file of scriptFiles) {
    const text = fs.readFileSync(file, 'utf8');
    let count = 0;
    for (const [hex] of Object.entries(requiredPalette)) {
      const value = requiredPalette[hex];
      count += (text.match(new RegExp(value, 'gi')) ?? []).length;
    }
    if (count) {
      inlineHexOccurrences += count;
      inlineFiles.push(path.relative(ROOT, file).replaceAll(path.sep, '/'));
    }
  }

  return {
    cssFilesScanned: nonBrandCssFiles.length,
    hardcodedOfficialCssOccurrences: hardcodedOfficial.reduce((sum, item) => sum + item.occurrences, 0),
    hardcodedOfficialCssFiles: hardcodedOfficial,
    hardcodedOfficialCssByRole: hardcodedOfficialByRole,
    inlineScriptOfficialColorOccurrences: inlineHexOccurrences,
    inlineScriptOfficialColorFiles: inlineFiles,
  };
}

const frontendThemeCoverage = auditFrontendThemeCoverage();

const legacyBrandLiterals = [
  '#1e3a5f', '#2c5a8a', '#f5b642', '#3182ce', '#2b6cb0',
  '#38a169', '#4caf50', '#007bff', '#2196f3', '#45a049',
];
const legacyCssHits = [];
for (const file of walkFiles(FRONTEND_SOURCE_ROOT).filter((file) => /\.css$/i.test(file) && !file.includes(`${path.sep}branding${path.sep}`))) {
  const text = fs.readFileSync(file, 'utf8');
  for (const literal of legacyBrandLiterals) {
    if (new RegExp(literal, 'i').test(text)) {
      legacyCssHits.push(path.relative(ROOT, file).replaceAll(path.sep, '/'));
      break;
    }
  }
}
if (legacyCssHits.length) {
  fail('legacy-brand-css-literals', `Legacy brand literals remain in frontend CSS: ${legacyCssHits.join(', ')}`);
} else {
  pass('legacy-brand-css-literals', 'Known legacy brand literals are routed through centralized TITech semantic tokens.');
}

const chartFallbackPattern = /var\(--titech-[^,\n]+,\s*(?:#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\))/g;
const chartFallbackHits = [];
for (const file of walkFiles(path.join(ROOT, 'frontend', 'src', 'charts')).filter((file) => /\.jsx$/i.test(file))) {
  const text = fs.readFileSync(file, 'utf8');
  const count = (text.match(chartFallbackPattern) ?? []).length;
  if (count) chartFallbackHits.push({ file: path.relative(ROOT, file).replaceAll(path.sep, '/'), count });
}
if (chartFallbackHits.length) {
  fail('chart-fallback-colors', `Chart components still contain hard-coded fallback colors: ${chartFallbackHits.map((x) => `${x.file} (${x.count})`).join(', ')}`);
} else {
  pass('chart-fallback-colors', 'Chart components resolve colors through the centralized TITech theme contract rather than hard-coded fallback literals.');
}

const result = {
  generatedAt: new Date().toISOString(),
  status: checks.some((x) => x.status === 'FAIL') ? 'FAIL' : 'PASS',
  palette: requiredPalette,
  frontendThemeCoverage,
  checks,
};
fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports/official-theme-audit.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (result.status === 'FAIL') process.exitCode = 1;
