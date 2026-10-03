#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'backend/bootstrap/ApplicationBootstrap.js',
  'backend/bootstrap/app.js',
  'backend/bootstrap/infrastructure/index.js',
  'backend/bootstrap/server.js',
  'backend/bootstrap/servicesContext.js',
  'frontend/src/branding/brand.js',
  'frontend/src/branding/brand.css',
  'frontend/src/branding/official-theme.css',
  'frontend/src/branding/theme.js',
  'mobile/branding/titech-theme.tokens.json',
  'branding/TITECH_OFFICIAL_THEME.json',
];

const palette = ['#0030A0','#0058D8','#0066E8','#00B8F8','#008000','#A8F000','#F8D800','#082B67','#FFFFFF'];
const failures = [];

for (const file of required) {
  if (!fs.existsSync(path.join(ROOT,file))) failures.push(`Missing required implementation artifact: ${file}`);
}

const read = (file) => fs.readFileSync(path.join(ROOT,file), 'utf8');
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const app = codeOnly(read('backend/bootstrap/app.js'));
if (/\bmodule\.exports\s*=/.test(app) || !app.includes("from './ApplicationBootstrap.js'")) failures.push('bootstrap/app.js is not a canonical ESM facade.');
for (const file of ['backend/bootstrap/infrastructure/index.js','backend/bootstrap/server.js','backend/bootstrap/servicesContext.js']) {
  const text=codeOnly(read(file));
  if (/\bmodule\.exports\s*=/.test(text)) failures.push(`${file} still contains a CommonJS module.exports assignment.`);
  const hasNativeEsmBoundary = /\bimport\s+/.test(text) && /\bexport\s+/.test(text);
  const hasCompatibilityBoundary = text.includes('createRequire');
  if (!hasNativeEsmBoundary && !hasCompatibilityBoundary) failures.push(`${file} lacks an explicit native-ESM or compatibility module boundary.`);
}

for (const file of ['frontend/src/branding/brand.js','frontend/src/branding/brand.css','frontend/src/branding/official-theme.css','branding/TITECH_OFFICIAL_THEME.json']) {
  const text=read(file).toUpperCase();
  for (const value of palette) if (!text.includes(value)) failures.push(`${file} is missing official palette value ${value}.`);
}

const result={
  generatedAt:new Date().toISOString(),
  status:failures.length?'FAIL':'PASS',
  checks:{
    canonicalBootstrap:'backend/bootstrap/app.js re-exports ApplicationBootstrap.js',
    bootstrapCompatibility:'legacy imports are isolated behind explicit createRequire boundaries',
    officialTheme:'all nine canonical palette values are present in the brand contract',
  },
  failures,
};
fs.mkdirSync(path.join(ROOT,'reports'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'reports/titech-implementation-gate-2026-10-02.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(result.status==='FAIL') process.exitCode=1;
