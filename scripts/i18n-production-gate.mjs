#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = path.join(ROOT, 'frontend/src/i18n/locales/registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const unapproved = (registry.languages || []).filter((language) => language.code !== 'en' && language.status !== 'approved_for_production');
const result = {
  generatedAt: new Date().toISOString(),
  status: unapproved.length ? 'BLOCKED' : 'PASS',
  productionApproval: unapproved.length ? 'NO' : 'ELIGIBLE_FOR_OTHER_RELEASE_GATES',
  rule: 'Bundled locale files are not production approved until required linguistic and domain reviews have been recorded; passing structural validation is not an approval.',
  unapprovedLocales: unapproved.map(({ code, nativeName, status }) => ({ code, nativeName, status })),
};
console.log(JSON.stringify(result, null, 2));
if (unapproved.length) process.exitCode = 1;
