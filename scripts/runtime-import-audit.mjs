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
  'backend/bootstrap/servicesContext.js',
  'backend/bootstrap/logger.js',
  'backend/routes/index.js',
  'backend/models/Tenant.js',
  'backend/services/tenantService.js',
  'backend/middleware/tenantMiddleware.js',
  'backend/controllers/groupWalletController.js',
  'backend/modules/finance/ledger/core/ledgerEngine.js',
  'backend/modules/finance/ledger/core/balanceService.js',
  'backend/modules/finance/ledger/core/journalService.js',
  'backend/modules/finance/ledger/core/postingEngine.js',
  'backend/modules/finance/ledger/core/reversalService.js',
  'backend/modules/finance/ledger/core/snapshotService.js',
  'backend/modules/finance/ledger/core/periodCloseService.js',
  'backend/modules/finance/ledger/postingEngine.js',
  'backend/modules/finance/ledger/reversalService.js',
  'backend/modules/finance/period/periodCloseService.js',
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

/** Remove comments without touching quoted strings/template literals.
 * This prevents documentation examples such as require('./foo') from being
 * misclassified as executable dependency edges.
 */
function stripComments(source) {
  let output = '';
  let state = 'code';
  let quote = '';
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (state === 'lineComment') {
      if (char === '\n') { state = 'code'; output += char; } else output += ' ';
      continue;
    }
    if (state === 'blockComment') {
      if (char === '*' && next === '/') { state = 'code'; output += '  '; i += 1; }
      else output += char === '\n' ? '\n' : ' ';
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      output += char;
      if (char === '\\') { output += next ?? ''; i += 1; continue; }
      if (char === quote) { state = 'code'; quote = ''; }
      continue;
    }
    if (char === '/' && next === '/') { state = 'lineComment'; output += '  '; i += 1; continue; }
    if (char === '/' && next === '*') { state = 'blockComment'; output += '  '; i += 1; continue; }
    if (char === "'") { state = 'single'; quote = char; output += char; continue; }
    if (char === '"') { state = 'double'; quote = char; output += char; continue; }
    if (char === '`') { state = 'template'; quote = char; output += char; continue; }
    output += char;
  }
  return output;
}

walk(backendRoot);

const importPattern = /(?:\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport(?:[^'";]*?from\s*)?['"]([^'"]+)['"])/g;
const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const executableSource = stripComments(source);
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  let match;
  while ((match = importPattern.exec(executableSource))) {
    const specifier = match[1] ?? match[2];
    if (!specifier?.startsWith('.')) continue;
    if (!resolveLocal(file, specifier)) {
      missing.push({ file: relative, specifier, critical: critical.has(relative) });
    }
  }
  while ((match = dynamicImportPattern.exec(executableSource))) {
    const specifier = match[1];
    if (!specifier?.startsWith('.')) continue;
    if (!resolveLocal(file, specifier)) {
      missing.push({ file: relative, specifier, critical: critical.has(relative), importKind: 'dynamic' });
    }
  }

  if (critical.has(relative)) {
    if (/\bmodule\.exports\s*=/.test(executableSource) || /\brequire\s*\(\s*['"]/ .test(executableSource) || /createRequire\(/.test(executableSource)) {
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
  methodology: {
    commentsExcluded: true,
    dynamicImportsChecked: true,
    note: 'Bare package imports are intentionally outside this local-relative audit. Legacy/non-critical debt remains tracked separately.'
  },
}, null, 2) + '\n');

console.log(`Report: ${path.relative(root, reportFile)}`);

if (criticalMissing.length || mixed.length) process.exit(1);

if (legacyMissing.length) {
  console.warn(`WARN: ${legacyMissing.length} legacy/non-critical missing local imports require later consolidation.`);
}

console.log('Runtime import audit: PASS for canonical financial surface.');
