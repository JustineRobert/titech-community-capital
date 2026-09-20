#!/usr/bin/env node
/**
 * TITech Community Capital — Local Runtime Import Audit
 *
 * Purpose:
 *   Detect missing local require()/import targets and mixed ESM/CommonJS
 *   declarations that syntax-only validation cannot detect.
 *
 * This is a static audit. Bare package imports are deliberately not resolved.
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const backendRoot = path.join(root, 'backend');
const critical = new Set([
  'backend/services/financial/financialTransaction.service.js',
  'backend/services/financial/financialOperation.service.js',
  'backend/services/idempotency/idempotency.service.js',
  'backend/services/idempotency/idempotency.store.js',
  'backend/controllers/financial/financial.controller.js',
  'backend/controllers/contributionsController.js',
  'backend/middleware/idempotency.js',
]);

const files = [];
const missing = [];
const mixed = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'coverage', 'dist', 'build', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(?:js|mjs|cjs|jsx|ts|tsx)$/.test(entry.name)) files.push(full);
  }
}

function resolveLocal(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.jsx`,
    `${base}.ts`, `${base}.tsx`,
    path.join(base, 'index.js'), path.join(base, 'index.mjs'), path.join(base, 'index.cjs'),
  ];
  return candidates.find(fs.existsSync) ?? null;
}

walk(backendRoot);

const importPattern = /(?:\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport(?:[^'";]*?from\s*)?['"]([^'"]+)['"])/g;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  let match;
  while ((match = importPattern.exec(source))) {
    const specifier = match[1] ?? match[2];
    if (!specifier?.startsWith('.')) continue;
    if (!resolveLocal(file, specifier)) {
      missing.push({ file: relative, specifier, critical: critical.has(relative) });
    }
  }

  if (critical.has(relative)) {
    if (/\bmodule\.exports\s*=/.test(source) || /\brequire\s*\(/.test(source) || /createRequire\(/.test(source)) {
      mixed.push({ file: relative, reason: 'CommonJS loading/export construct on canonical ESM financial surface' });
    }
  }
}

const criticalMissing = missing.filter(x => x.critical);
const legacyMissing = missing.filter(x => !x.critical);

console.log('TITech runtime import audit');
console.log(`Backend source files scanned: ${files.length}`);
console.log(`Missing local imports: ${missing.length}`);
console.log(`Missing local imports on canonical financial surface: ${criticalMissing.length}`);
console.log(`Mixed-module violations on canonical financial surface: ${mixed.length}`);

if (criticalMissing.length) {
  for (const item of criticalMissing) console.error(`FAIL ${item.file} -> ${item.specifier}`);
}
if (mixed.length) {
  for (const item of mixed) console.error(`FAIL ${item.file} -> ${item.reason}`);
}

const reportPath = path.join(root, 'reports');
fs.mkdirSync(reportPath, { recursive: true });
const reportFile = path.join(reportPath, 'runtime-import-audit.json');
fs.writeFileSync(reportFile, JSON.stringify({
  generatedAt: new Date().toISOString(),
  backendFilesScanned: files.length,
  missingLocalImports: missing,
  criticalMissing,
  mixedCanonicalFinancialModules: mixed,
}, null, 2) + '\n');

console.log(`Report: ${path.relative(root, reportFile)}`);

if (criticalMissing.length || mixed.length) process.exit(1);

if (legacyMissing.length) {
  console.warn(`WARN: ${legacyMissing.length} legacy/non-critical missing local imports require later consolidation.`);
}

console.log('Runtime import audit: PASS for canonical financial surface.');
