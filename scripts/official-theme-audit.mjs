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
  ['theme-tests', 'frontend/src/branding/__tests__/theme.test.js', ['defaults deterministically to light', 'preserves explicit light and dark preferences', 'falls back to light for invalid persisted state', 'clear']],
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

const result = {
  generatedAt: new Date().toISOString(),
  status: checks.some((x) => x.status === 'FAIL') ? 'FAIL' : 'PASS',
  palette: requiredPalette,
  checks,
};
fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports/official-theme-audit-2026-09-30.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (result.status === 'FAIL') process.exitCode = 1;
